require('./register.cjs')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createPool } = require('../src/server/database.ts')
const { answerAuth } = require('../src/server/auth.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// /api/auth/session, token, signout and local, against a real database as npm run verify runs it
// (`TYPLE_TEST_DATABASE_URL=… npm test`). The answers are the Go backend's at the same fixed time
// (tests/fixtures/auth-answers.json), cookie values and tokens included.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const open = () => db
const fixture = require('./fixtures/auth-answers.json')
const subs = ['github:9100000001', 'github:9100000002', 'github:9100000003', 'github:9100000004', 'ffpf:zzerin']
const clean = () => db.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [subs])
before(async () => {
  if (!db) return
  await clean()
  // github:9100000003 signed out of every device just before, as in the Go run.
  await db.query(`INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ('github:9100000003', now())`)
})
after(async () => {
  if (!db) return
  await clean()
  await db.end()
})

const paths = {
  '/api/auth/session': 'session', '/api/auth/token': 'token', '/api/auth/signout': 'signout',
  '/api/auth/local': 'local',
}

/** The request of the fixture as a browser or an app would send it to the configuration's AUTH_URL. */
function requestOf(q) {
  const env = fixture.env[q.config]
  const base = new URL(env.AUTH_URL)
  const headers = {}
  if (q.cookie) headers.Cookie = `${base.protocol === 'https:' ? '__Host-' : ''}typle-session=${fixture.values[q.cookie]}`
  if (q.authorization) {
    const [scheme, name] = q.authorization.split(' ', 2)
    headers.Authorization = scheme === 'Bearer' && name in fixture.values ? `Bearer ${fixture.values[name]}` : q.authorization
  }
  if (q.origin) headers.Origin = base.origin
  return new Request(`${base.origin}${q.path}`, { method: q.method, headers, body: q.body || undefined })
}

test('the Route Handlers answer as the Go backend did, cookies and tokens included', database, async () => {
  for (const [n, q] of fixture.requests.entries()) {
    const want = fixture.answers[n]
    const [path] = q.path.split('?')
    // The dashboard's signout of the Go run: removed in v2.48.0, a 404 of Next.js now.
    if (!(path in paths)) continue
    const response = await answerAuth(paths[path], requestOf(q), open, () => readLoginSettings(fixture.env[q.config]), () => fixture.now)
    assert.equal(response.status, want.status, q.note)
    assert.equal(response.headers.get('Allow') ?? '', want.allow ?? '', q.note)
    assert.deepEqual(response.headers.getSetCookie(), want.setCookie, q.note)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', q.note)
    assert.equal(response.headers.get('Vary'), 'Cookie', q.note)
    const text = await response.text()
    if (q.method === 'HEAD' || want.body === '') {
      assert.equal(text, '', q.note)
    } else {
      // Go wrote < > & as < and so on; the values are the same (the spec's differences).
      assert.ok(text.endsWith('\n'), q.note)
      assert.deepEqual(JSON.parse(text), JSON.parse(want.body), q.note)
    }
  }
  const { rows } = await db.query('SELECT owner_id FROM typle_session_revocations WHERE owner_id = ANY($1) ORDER BY owner_id', [subs])
  assert.deepEqual(rows.map(row => row.owner_id), fixture.revokedAfter)
})

const env = fixture.env.http
const settings = () => readLoginSettings(env)
const cookie = `typle-session=${fixture.values.alice}`
const session = headers => new Request('http://127.0.0.1:3101/api/auth/session', { headers })

// The session never waits for the database: the screen would stay signed out while it is down.
test('without the database the session is answered, unchecked', async () => {
  const closed = await answerAuth('session', session({ Cookie: cookie }), () => { throw new Error('no database') }, settings, () => fixture.now)
  assert.equal(JSON.parse(await closed.text()).user.id, 'github:9100000001')
  const failing = { query: async () => { throw new Error('down') } }
  const failed = await answerAuth('session', session({ Cookie: cookie }), () => failing, settings, () => fixture.now)
  assert.equal(JSON.parse(await failed.text()).user.id, 'github:9100000001')
  const hanging = { query: () => new Promise(() => {}) }
  const started = Date.now()
  const slow = await answerAuth('session', session({ Cookie: cookie }), () => hanging, settings, () => fixture.now)
  assert.ok(Date.now() - started < 2500)
  assert.equal(JSON.parse(await slow.text()).user.id, 'github:9100000001')
})

test('signing out everywhere without the database is 503 and keeps the cookie', async () => {
  const failing = { query: async () => { throw new Error('down') } }
  const request = new Request('http://127.0.0.1:3101/api/auth/signout?everywhere=1', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:3101' } })
  const response = await answerAuth('signout', request, () => failing, settings, () => fixture.now)
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
  assert.deepEqual(response.headers.getSetCookie(), [])
})

test('without the login settings the answer is 503 authUnavailable', async () => {
  for (const path of Object.values(paths)) {
    const response = await answerAuth(path, session({}), open, () => null, () => fixture.now)
    assert.equal(response.status, 503, path)
    assert.equal(await response.text(), '{"error":"authUnavailable"}\n', path)
  }
})

test('every other method is 405, OPTIONS included', async () => {
  for (const [path, allow] of [['session', 'GET, HEAD'], ['token', 'POST'], ['signout', 'POST']]) {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await answerAuth(path, new Request('http://127.0.0.1:3101/api/auth/x', { method }), open, settings, () => fixture.now)
      assert.equal(response.status, 405, `${path} ${method}`)
      assert.equal(response.headers.get('Allow'), allow)
    }
  }
})

// As the Go backend: a body whose stream breaks is a failed login (400), not the server's failure; and a body that starts
// with a byte order mark is not JSON (Go's json.Unmarshal refused it).
test('a broken or BOM-led token request is loginFailed', async () => {
  const broken = new Request('http://127.0.0.1:3101/api/auth/token', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({ pull(controller) { controller.error(new Error('connection reset')) } }),
  })
  const response = await answerAuth('token', broken, open, settings, () => fixture.now)
  assert.equal(response.status, 400)
  assert.equal(await response.text(), '{"error":"loginFailed"}\n')
  const body = JSON.stringify({ code: fixture.values.code, verifier: fixture.verifier })
  const plain = await answerAuth('token', new Request('http://127.0.0.1:3101/api/auth/token', { method: 'POST', body }), open, settings, () => fixture.now)
  assert.equal(plain.status, 200)
  const bom = await answerAuth('token', new Request('http://127.0.0.1:3101/api/auth/token', { method: 'POST', body: '﻿' + body }), open, settings, () => fixture.now)
  assert.equal(bom.status, 400)
})
