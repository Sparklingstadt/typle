require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { githubAuthorizeUrl, exchangeGitHubCode, githubUser, GitHubError } = require('../src/server/github.ts')

// The GitHub OAuth App's side of the login, as the Go backend's auth.OAuth and auth.GitHub did it (their tests
// are copied here).

const servers = []
after(() => { for (const server of servers) server.close() })

/** A server that answers every request with answer, and counts them. */
async function serve(answer) {
  const calls = { count: 0, requests: [] }
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      calls.count++
      calls.requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      answer(request, response, body)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { url: `http://127.0.0.1:${server.address().port}`, calls }
}

const settings = (url = 'http://127.0.0.1:1') => ({
  clientId: 'client-id', clientSecret: 'client-secret', authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: `${url}/login/oauth/access_token`, apiUrl: url,
})
const json = text => (request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(text) }

test('the authorize URL asks for no scope and has no secret', () => {
  const raw = githubAuthorizeUrl(settings(), 'the state', 'the challenge', 'https://app.example/api/auth/callback/github')
  assert.equal(raw, 'https://github.com/login/oauth/authorize?client_id=client-id&code_challenge=the+challenge&code_challenge_method=S256' +
    '&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fauth%2Fcallback%2Fgithub&state=the+state')
})

test('the code is traded for the token with the client secret in the form', async () => {
  const { url, calls } = await serve(json('{"access_token":"gho_token","token_type":"bearer","scope":""}'))
  assert.equal(await exchangeGitHubCode(settings(url), 'the code', 'the verifier', 'https://app.example/cb'), 'gho_token')
  const [request] = calls.requests
  assert.equal(request.method, 'POST')
  assert.equal(request.url, '/login/oauth/access_token')
  assert.equal(request.headers.accept, 'application/json')
  assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(request.body, 'client_id=client-id&client_secret=client-secret&code=the+code&code_verifier=the+verifier&redirect_uri=https%3A%2F%2Fapp.example%2Fcb')
})

test('a refused or broken exchange is an error that names no secret', async () => {
  const answers = {
    'error with 200': json('{"error":"bad_verification_code","error_description":"The code passed is incorrect or expired."}'),
    'error and token': json('{"error":"x","access_token":"gho_token"}'),
    'no token': json('{"token_type":"bearer"}'),
    'empty token': json('{"access_token":""}'),
    'null token': json('{"access_token":null}'),
    'token not a string': json('{"access_token":1}'),
    'server error': (request, response) => { response.statusCode = 500; response.end() },
    'error with 400': (request, response) => { response.statusCode = 400; response.end('{"error":"bad_verification_code"}') },
    'not JSON': json('<html>'),
    'cut off at 1 MiB': json(' '.repeat((1 << 20) + 1) + '{"access_token":"gho_token"}'),
  }
  for (const [name, answer] of Object.entries(answers)) {
    const { url } = await serve(answer)
    const error = await exchangeGitHubCode(settings(url), 'secret-code', 'secret-verifier', 'https://app.example/cb').then(() => null, error => error)
    assert.ok(error instanceof Error, name)
    for (const secret of ['client-secret', 'secret-code', 'secret-verifier']) assert.ok(!error.message.includes(secret), `${name}: ${error.message}`)
  }
  const { url } = await serve(json('{"error":"bad_verification_code"}'))
  await assert.rejects(exchangeGitHubCode(settings(url), 'c', 'v', 'r'), /bad_verification_code/)
  await assert.rejects(exchangeGitHubCode(settings(), 'secret-code', 'v', 'r'), error => !error.message.includes('secret'))
})

test('the key of the token is matched in any case, as Go\'s decoder did', async () => {
  const { url } = await serve(json('{"Access_Token":"gho_token"}'))
  assert.equal(await exchangeGitHubCode(settings(url), 'c', 'v', 'r'), 'gho_token')
})

test('a redirect is not followed, and is an error', async () => {
  for (const status of [301, 302, 307, 308]) {
    const other = await serve(json('{"access_token":"gho_stolen"}'))
    const { url, calls } = await serve((request, response) => { response.statusCode = status; response.setHeader('Location', `${other.url}/steal`); response.end() })
    await assert.rejects(exchangeGitHubCode(settings(url), 'c', 'v', 'r'), error => error.message.includes('answered') && !error.message.includes('client-secret'))
    assert.equal(other.calls.count, 0)
    assert.equal(calls.count, 1)
  }
})

test('the user is read from GET /user with the token', async () => {
  const { url, calls } = await serve(json('{"id":1,"login":"octo","name":"","avatar_url":"https://a"}'))
  assert.deepEqual(await githubUser(settings(url), 'gho_abc'), { id: 1, login: 'octo', name: '', avatarUrl: 'https://a' })
  const [request] = calls.requests
  assert.equal(request.url, '/user')
  assert.equal(request.headers.authorization, 'Bearer gho_abc')
  assert.equal(request.headers.accept, 'application/vnd.github+json')
  assert.equal(request.headers['x-github-api-version'], '2022-11-28')
  const nulls = await serve(json('{"id":2,"login":"octo","name":null,"avatar_url":null}'))
  assert.deepEqual(await githubUser(settings(nulls.url), 'gho_abc'), { id: 2, login: 'octo', name: '', avatarUrl: '' })
})

test('a token GitHub refuses is invalidToken, and anything else that goes wrong unavailable', async () => {
  const refused = await serve((request, response) => { response.statusCode = 401; response.end() })
  await assert.rejects(githubUser(settings(refused.url), 'gho_bad'), error => error instanceof GitHubError && error.kind === 'invalidToken')
  const answers = {
    'rate limited': (request, response) => { response.statusCode = 403; response.end() },
    'server error': (request, response) => { response.statusCode = 502; response.end() },
    'no id': json('{"login":"x"}'),
    'id 0': json('{"id":0}'),
    'id not an integer': json('{"id":1.5}'),
    'name not a string': json('{"id":1,"name":1}'),
    'not JSON': json('<html>'),
  }
  for (const [name, answer] of Object.entries(answers)) {
    const { url } = await serve(answer)
    await assert.rejects(githubUser(settings(url), 'gho_good'), error => error instanceof GitHubError && error.kind === 'unavailable', name)
  }
  await assert.rejects(githubUser(settings(), 'gho_good'), error => error instanceof GitHubError && error.kind === 'unavailable')
})
