require('./register.cjs')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { answerLogin } = require('../src/server/signin.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { openOAuth, challengeOf } = require('../src/server/session.ts')

// /api/auth/signin and the callback, with GitHub played at 127.0.0.1:38917. The answers, and the requests GitHub got, are
// the Go backend's at the same fixed time (tests/fixtures/signin-answers.json): the cookies, codes and redirects byte for
// byte, and the random state and verifier of a signin by what they open to. The Go run also played FFPF ID, whose login
// was removed in v2.54.0: those cases answer otherwise now (the tests at the end).
const fixture = require('./fixtures/signin-answers.json')
const PROVIDER = '127.0.0.1:38917'
// The logins to the administrator's dashboard of the Go run: the dashboard was removed in v2.48.0, and these answer
// otherwise now (the tests at the end).
const DASHBOARD_CASES = new Set(['admin, whatever else', 'admin not configured', 'admin at github', 'admin at github, other state',
  'admin', 'admin again', 'not an admin', 'admin refused by ffpf'])
/** The cases of the Go run that logged in with FFPF ID: a signin with provider=ffpf, or its callback. */
const isFfpf = q => q.path.startsWith('/api/auth/callback/ffpf') || new URL(q.path, 'http://x').searchParams.get('provider') === 'ffpf'

/** The provider's exchanges the current request is expected to make, and the requests it made. */
let expected = []
let got = []
let server
before(async () => {
  server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const headers = {}
      for (const name of ['authorization', 'content-type', 'accept', 'x-github-api-version']) if (request.headers[name]) headers[name] = request.headers[name]
      const [path, query = ''] = request.url.split(/\?(.*)/s)
      got.push({ method: request.method, path, query, body, ...headers })
      const next = expected[got.length - 1]
      if (!next) { response.statusCode = 404; return response.end('unexpected') }
      if (next.response.contentType) response.setHeader('Content-Type', next.response.contentType)
      if (next.response.location) response.setHeader('Location', next.response.location)
      response.statusCode = next.response.status
      response.end(next.response.body)
    })
  })
  await new Promise(resolve => server.listen(38917, '127.0.0.1', resolve))
})
after(() => { server?.close() })

/** The settings of a configuration of the fixture, with GitHub's endpoints at the played provider as in the Go run. */
function settingsOf(config) {
  const login = readLoginSettings(fixture.env[config])
  if (login?.github) login.github = { ...login.github, tokenUrl: `http://${PROVIDER}/github/token`, apiUrl: `http://${PROVIDER}/github/api` }
  return login
}

const paths = { '/api/auth/signin': 'signin', '/api/auth/callback/github': 'github' }

function requestOf(q) {
  const base = fixture.env[q.config].AUTH_URL
  const cookies = Object.entries(q.cookie ?? {}).map(([name, value]) => `${name}=${name === 'typle-oauth' && value in fixture.values ? fixture.values[value] : value}`)
  return new Request(base + q.path, { method: q.method, headers: cookies.length ? { Cookie: cookies.join('; ') } : {} })
}

/** The operations reported (reportFailure logs them with console.error) while answer runs. */
async function reported(answer) {
  const operations = []
  const { error, warn } = console
  console.error = (message) => { const match = /: ([a-z]+\.[a-z]+):$/.exec(String(message)); if (match) operations.push(match[1]) }
  console.warn = () => {}
  try {
    return { response: await answer(), operations }
  } finally {
    Object.assign(console, { error, warn })
  }
}

test('the Route Handlers answer as the Go backend did, and ask GitHub what it asked', async () => {
  for (const [n, q] of fixture.requests.entries()) {
    if (DASHBOARD_CASES.has(q.note) || isFfpf(q)) continue
    const want = fixture.answers[n]
    expected = want.provider
    got = []
    const login = settingsOf(q.config)
    const { response, operations } = await reported(() =>
      answerLogin(paths[q.path.split('?')[0]], requestOf(q), () => login, () => fixture.now))
    assert.equal(response.status, want.status, q.note)
    for (const header of ['allow', 'cache-control', 'vary', 'content-type']) assert.equal(response.headers.get(header) ?? undefined, want[header], `${q.note}: ${header}`)
    let location = response.headers.get('Location')
    location = location === null ? undefined : Buffer.from(location, 'latin1').toString('utf8')
    let setCookie = response.headers.getSetCookie()
    if (want.oauth) {
      const at = setCookie.findIndex(c => c.startsWith('typle-oauth='))
      const value = setCookie[at].slice('typle-oauth='.length).split(';')[0]
      const pending = openOAuth(login.oauthKey, value, fixture.now)
      for (const random of [pending.state, pending.verifier]) assert.match(random, /^[A-Za-z0-9_-]{43}$/, q.note)
      assert.notEqual(pending.state, pending.verifier)
      location = location.replaceAll(pending.state, 'STATE').replaceAll(challengeOf(pending.verifier), 'CHALLENGE')
      setCookie = setCookie.with(at, 'typle-oauth=OAUTH;' + setCookie[at].split(';').slice(1).join(';'))
      const { admin: _admin, ...oauth } = want.oauth
      assert.deepEqual({ returnTo: pending.returnTo, challenge: pending.challenge, provider: pending.provider, nonce: pending.nonce !== '', exp: pending.expires }, oauth, q.note)
    }
    // The Go backend sent a Location that is not ASCII as raw UTF-8, which Vercel re-encodes wrongly; it is percent-encoded
    // instead, which a browser follows to the same page (the spec's differences).
    assert.equal(location, want.location === undefined ? undefined : want.location.replace(/[^\x00-\x7f]+/gu, encodeURIComponent), q.note)
    assert.deepEqual(setCookie, want.setCookie, q.note)
    assert.equal(await response.text(), want.body, q.note)
    assert.deepEqual(got, want.provider.map(exchange => exchange.request), q.note)
    assert.deepEqual(operations, want.reports, q.note)
  }
})

test('a returnTo that is not ASCII goes back percent-encoded, as Vercel would otherwise mangle it', async () => {
  const { sealOAuth } = require('../src/server/session.ts')
  const login = settingsOf('https')
  const now = fixture.now
  const pending = { state: 's', verifier: 'v', returnTo: '/ほげ?q=a b&r=%E3%81%BB#é', challenge: '', provider: '', nonce: '', expires: now + 600 }
  const request = new Request('https://typle.example/api/auth/callback/github?state=other', { headers: { Cookie: `typle-oauth=${sealOAuth(login.oauthKey, pending)}` } })
  const response = await answerLogin('github', request, () => login, () => now)
  assert.equal(response.headers.get('Location'), '/%E3%81%BB%E3%81%92?q=a b&r=%E3%81%BB#%C3%A9')
})

test('without the login settings every path is 503 authUnavailable', async () => {
  for (const path of Object.values(paths)) {
    const response = await answerLogin(path, new Request('http://127.0.0.1:3101/api/auth/signin'), () => null, () => fixture.now)
    assert.equal(response.status, 503, path)
    assert.equal(await response.text(), '{"error":"authUnavailable"}\n', path)
  }
})

const caseOf = note => {
  const n = fixture.requests.findIndex(r => r.note === note)
  return { q: fixture.requests[n], want: fixture.answers[n] }
}

test('admin=1 is not read any more: the login is the one the rest of the query asks for', async () => {
  const { q } = caseOf('admin, whatever else')
  const login = settingsOf(q.config)
  const response = await answerLogin('signin', requestOf(q), () => login, () => fixture.now)
  assert.equal(response.status, 302)
  assert.ok(response.headers.get('Location').startsWith('https://github.com/login/oauth/authorize?'))
  const value = response.headers.getSetCookie().find(c => c.startsWith('typle-oauth=')).split(';')[0].slice('typle-oauth='.length)
  const pending = openOAuth(login.oauthKey, value, fixture.now)
  assert.deepEqual({ returnTo: pending.returnTo, challenge: pending.challenge, provider: pending.provider }, { returnTo: '/lists', challenge: fixture.challenge, provider: '' })
  assert.equal('admin' in pending, false)
})

test('a login the old version started for the dashboard ends as an ordinary login, back to where it was to return', async () => {
  const { q } = caseOf('admin at github')
  expected = caseOf('github success').want.provider
  got = []
  const { response } = await reported(() => answerLogin('github', requestOf(q), () => settingsOf(q.config), () => fixture.now))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), '/admin')
  const cookies = response.headers.getSetCookie().map(c => c.split('=')[0])
  assert.ok(cookies.includes('typle-session'), `${cookies}`)
  assert.ok(!cookies.includes('typle-admin'))
})

test('provider=ffpf is not read any more: the login is GitHub\'s, the app\'s too', async () => {
  for (const note of ['ffpf', 'android ffpf', 'ffpf not configured']) {
    const { q } = caseOf(note)
    const login = settingsOf(q.config)
    const response = await answerLogin('signin', requestOf(q), () => login, () => fixture.now)
    assert.equal(response.status, 302, note)
    assert.ok(response.headers.get('Location').startsWith('https://github.com/login/oauth/authorize?'), note)
    const value = response.headers.getSetCookie().find(c => c.startsWith('typle-oauth=')).split(';')[0].slice('typle-oauth='.length)
    const pending = openOAuth(login.oauthKey, value, fixture.now)
    assert.deepEqual({ provider: pending.provider, nonce: pending.nonce }, { provider: '', nonce: '' }, note)
    assert.equal(pending.challenge, note === 'android ffpf' ? fixture.challenge : '', note)
  }
})

