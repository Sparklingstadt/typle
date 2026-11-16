require('./register.cjs')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createPool } = require('../src/server/database.ts')
const { answerLogin } = require('../src/server/signin.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { openOAuth, challengeOf } = require('../src/server/session.ts')
const { newJwksCache } = require('../src/server/ffpf.ts')

// /api/auth/signin and the callbacks, against a real database as npm run verify runs it (`TYPLE_TEST_DATABASE_URL=…
// npm test`) and the providers GitHub and FFPF ID played at 127.0.0.1:38917. The answers, and the requests the providers
// got, are the Go backend's at the same fixed time (tests/fixtures/signin-answers.json): the cookies, codes and
// redirects byte for byte, and the random state, verifier and nonce of a signin by what they open to.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const open = () => db
const fixture = require('./fixtures/signin-answers.json')
const PROVIDER = '127.0.0.1:38917'
const cleanAdmins = () => db.query(`DELETE FROM typle_admins WHERE email LIKE 'zz-%@example.com'`)

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
  if (!db) return
  await cleanAdmins()
  await db.query(`INSERT INTO typle_admins (email) VALUES ('zz-admin@example.com')`)
})
after(async () => {
  server?.close()
  if (!db) return
  await cleanAdmins()
  await db.end()
})

/** The settings of a configuration of the fixture, with GitHub's endpoints at the played provider as in the Go run. */
function settingsOf(config) {
  const login = readLoginSettings(fixture.env[config])
  if (login?.github) login.github = { ...login.github, tokenUrl: `http://${PROVIDER}/github/token`, apiUrl: `http://${PROVIDER}/github/api` }
  return login
}

const paths = { '/api/auth/signin': 'signin', '/api/auth/callback/github': 'github', '/api/auth/callback/ffpf': 'ffpf' }

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

test('the Route Handlers answer as the Go backend did, and ask the providers what it asked', database, async () => {
  // One FFPF ID client for the whole run, as one Vercel instance keeps one: the JWKS is fetched once, as in the Go run.
  const jwks = newJwksCache()
  for (const [n, q] of fixture.requests.entries()) {
    const want = fixture.answers[n]
    expected = want.provider
    got = []
    const login = settingsOf(q.config)
    const { response, operations } = await reported(() =>
      answerLogin(paths[q.path.split('?')[0]], requestOf(q), open, () => login, () => fixture.now, jwks))
    assert.equal(response.status, want.status, q.note)
    for (const header of ['allow', 'cache-control', 'vary', 'content-type']) assert.equal(response.headers.get(header) ?? undefined, want[header], `${q.note}: ${header}`)
    let location = response.headers.get('Location')
    location = location === null ? undefined : Buffer.from(location, 'latin1').toString('utf8')
    let setCookie = response.headers.getSetCookie()
    if (want.oauth) {
      const at = setCookie.findIndex(c => c.startsWith('typle-oauth='))
      const value = setCookie[at].slice('typle-oauth='.length).split(';')[0]
      const pending = openOAuth(login.oauthKey, value, fixture.now)
      for (const random of [pending.state, pending.verifier, ...(pending.nonce ? [pending.nonce] : [])]) assert.match(random, /^[A-Za-z0-9_-]{43}$/, q.note)
      assert.notEqual(pending.state, pending.verifier)
      location = location.replaceAll(pending.state, 'STATE').replaceAll(challengeOf(pending.verifier), 'CHALLENGE')
      if (pending.nonce) location = location.replaceAll(pending.nonce, 'NONCE')
      setCookie = setCookie.with(at, 'typle-oauth=OAUTH;' + setCookie[at].split(';').slice(1).join(';'))
      assert.deepEqual({ returnTo: pending.returnTo, challenge: pending.challenge, admin: pending.admin, provider: pending.provider, nonce: pending.nonce !== '', exp: pending.expires }, want.oauth, q.note)
    }
    // The Go backend sent a Location that is not ASCII as raw UTF-8, which Vercel re-encodes wrongly; it is percent-encoded
    // instead, which a browser follows to the same page (the spec's differences).
    assert.equal(location, want.location === undefined ? undefined : want.location.replace(/[^\x00-\x7f]+/gu, encodeURIComponent), q.note)
    assert.deepEqual(setCookie, want.setCookie, q.note)
    assert.equal(await response.text(), want.body, q.note)
    assert.deepEqual(got, want.provider.map(exchange => exchange.request), q.note)
    assert.deepEqual(operations, want.reports, q.note)
  }
  const { rows } = await db.query(`SELECT email, ffpf_sub FROM typle_admins WHERE email LIKE 'zz-%@example.com' ORDER BY email`)
  assert.deepEqual(rows.map(row => ({ email: row.email, ffpfSub: row.ffpf_sub })), fixture.adminsAfter)
})

test('a login to the dashboard when typle_admins cannot be asked ends at adminUnavailable, and is reported', async () => {
  const q = fixture.requests.find(r => r.note === 'admin')
  const exchanges = fixture.answers[fixture.requests.indexOf(q)].provider
  for (const opener of [() => { throw new Error('no database') }, () => ({ query: async () => { throw new Error('down') } })]) {
    // The JWKS is fetched again for a fresh cache, as in the first FFPF ID login of the Go run.
    const ffpfFirst = fixture.answers[fixture.requests.findIndex(r => r.note === 'ffpf success')].provider
    expected = [exchanges[0], ffpfFirst[1]]
    got = []
    const { response, operations } = await reported(() =>
      answerLogin('ffpf', requestOf(q), opener, () => settingsOf('http'), () => fixture.now, newJwksCache()))
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/admin?error=adminUnavailable')
    assert.deepEqual(response.headers.getSetCookie(), ['typle-oauth=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax'])
    assert.deepEqual(operations, ['admin.check'])
  }
})

test('a returnTo that is not ASCII goes back percent-encoded, as Vercel would otherwise mangle it', async () => {
  const { sealOAuth } = require('../src/server/session.ts')
  const login = settingsOf('https')
  const now = fixture.now
  const pending = { state: 's', verifier: 'v', returnTo: '/ほげ?q=a b&r=%E3%81%BB#é', challenge: '', admin: false, provider: '', nonce: '', expires: now + 600 }
  const request = new Request('https://typle.example/api/auth/callback/github?state=other', { headers: { Cookie: `typle-oauth=${sealOAuth(login.oauthKey, pending)}` } })
  const response = await answerLogin('github', request, open, () => login, () => now)
  assert.equal(response.headers.get('Location'), '/%E3%81%BB%E3%81%92?q=a b&r=%E3%81%BB#%C3%A9')
})

test('without the login settings every path is 503 authUnavailable', async () => {
  for (const path of Object.values(paths)) {
    const response = await answerLogin(path, new Request('http://127.0.0.1:3101/api/auth/signin'), open, () => null, () => fixture.now)
    assert.equal(response.status, 503, path)
    assert.equal(await response.text(), '{"error":"authUnavailable"}\n', path)
  }
})
