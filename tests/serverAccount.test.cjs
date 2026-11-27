require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, randomBytes, randomInt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { signedIn } = require('../src/server/account.ts')
const { answerSignOutEverywhere } = require('../src/server/accountApi.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { cookieFor, readTestSession } = require('./fakeSession.cjs')

// signedIn reads Better Auth's session (src/server/account.ts); signing out of every device deletes the user's sessions and
// removes this browser's cookies. The sessions here are real rows read by the real Better Auth instance: it runs against a
// real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const secret = 'better-auth-test-secret-0123456789abcdef'
const origin = 'http://127.0.0.1:3101'
const sql = url ? createPool(url) : null
if (url) {
  // As tests/betterAuth.test.cjs sets it, before the instance is first loaded.
  process.env.DATABASE_URL = url
  process.env.BETTER_AUTH_SECRET = secret
  process.env.AUTH_URL = origin
}
const users = []
after(async () => {
  if (!sql) return
  await sql.query('DELETE FROM typle_auth_users WHERE id = ANY($1)', [users])
  await sql.end()
  await require('../src/server/database.ts').prisma().$disconnect()
})

/** A user and a session of it, and the cookie header that Better Auth's signed cookie makes (as better-call's signCookieValue). */
async function login(expiresAt = new Date(Date.now() + 3600_000)) {
  const id = `github:${randomInt(1e9, 2e9)}`
  users.push(id)
  const token = randomBytes(24).toString('base64url')
  await sql.query(`INSERT INTO typle_auth_users (id, name, email, email_verified, image) VALUES ($1, 'N', $2, true, '')`, [id, `${id}@users.invalid`])
  await sql.query('INSERT INTO typle_auth_sessions (id, expires_at, token, user_id) VALUES ($1, $2, $3, $4)', [token.slice(0, 12), expiresAt, token, id])
  const signed = encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
  return { id, token, cookie: `better-auth.session_token=${signed}` }
}
const request = headers => new Request(`${origin}/api/workspace`, { headers })
const signOut = headers => new Request(`${origin}/api/account/signout-everywhere`, { method: 'POST', headers })
const sessionsOf = async id => Number((await sql.query('SELECT count(*) FROM typle_auth_sessions WHERE user_id = $1', [id])).rows[0].count)

test('a session of Better Auth is signed in, as its user', database, async () => {
  const user = await login()
  const result = await signedIn(request({ Cookie: user.cookie }))
  assert.deepEqual(result.user, { sub: user.id, name: 'N', image: '' })
})

test('without a session, with a forged cookie or with an ended session the request is refused with loginRequired', database, async () => {
  const user = await login()
  const forged = `better-auth.session_token=${encodeURIComponent(`${user.token}.${createHmac('sha256', 'another').update(user.token).digest('base64')}`)}`
  const expired = await login(new Date(Date.now() - 1000))
  for (const headers of [{}, { Cookie: forged }, { Cookie: `better-auth.session_token=${user.token}` }, { Cookie: expired.cookie }, { Cookie: 'typle-session=x' }]) {
    const result = await signedIn(request(headers))
    assert.equal(result.refusal.status, 401, JSON.stringify(headers))
    assert.equal(await result.refusal.text(), '{"error":"loginRequired"}\n')
  }
})

test('503 when the session cannot be read', async () => {
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args.map(String).join(' '))
  try {
    const result = await signedIn(request({}), async () => { throw new Error('the database is down') })
    assert.equal(result.refusal.status, 503)
    assert.equal(await result.refusal.text(), '{"error":"databaseUnavailable"}\n')
  } finally {
    console.error = original
  }
  assert.match(logged[0], /: session\.check:/)
})

const login0 = () => readLoginSettings({ AUTH_URL: origin })

test('signing out of every device is refused without an Origin, without a login, and for other methods', database, async () => {
  const user = await login()
  const noOrigin = await answerSignOutEverywhere(signOut({ Cookie: user.cookie }), login0)
  assert.equal(noOrigin.status, 403)
  assert.equal(await noOrigin.text(), '{"error":"forbiddenRequest"}\n')
  assert.equal((await answerSignOutEverywhere(signOut({ Cookie: user.cookie, Origin: 'https://evil.example' }), login0)).status, 403)
  const noLogin = await answerSignOutEverywhere(signOut({ Origin: origin }), login0)
  assert.equal(noLogin.status, 401)
  assert.equal(await noLogin.text(), '{"error":"loginRequired"}\n')
  assert.equal(await sessionsOf(user.id), 1)
  const get = await answerSignOutEverywhere(new Request(`${origin}/api/account/signout-everywhere`), login0)
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST')
  assert.equal((await answerSignOutEverywhere(signOut({ Origin: origin }), () => null)).status, 503)
})

test('signing out of every device deletes every session of the user and removes this browser\'s cookies', database, async () => {
  const user = await login()
  const other = await login()
  await sql.query('INSERT INTO typle_auth_sessions (id, expires_at, token, user_id) VALUES ($1, now() + interval \'1 hour\', $2, $3)', ['second-session', 'second-token', user.id])
  assert.equal(await sessionsOf(user.id), 2)
  const response = await answerSignOutEverywhere(signOut({ Cookie: user.cookie, Origin: origin }), login0)
  assert.equal(response.status, 204)
  assert.deepEqual(response.headers.getSetCookie(), [
    'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    'better-auth.session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
  ])
  assert.equal(await sessionsOf(user.id), 0)
  assert.equal(await sessionsOf(other.id), 1)
  // The session is gone, so the same cookie signs no one in, and a second sign-out is refused.
  assert.equal((await signedIn(request({ Cookie: user.cookie }))).refusal.status, 401)
  assert.equal((await answerSignOutEverywhere(signOut({ Cookie: user.cookie, Origin: origin }), login0)).status, 401)
  assert.equal((await signedIn(request({ Cookie: other.cookie }))).user.sub, other.id)
})

test('the made-up session of the other tests reads as a user', async () => {
  assert.equal((await readTestSession(new Headers({ cookie: cookieFor('github:1') }))).user.id, 'github:1')
})

test('signing out of every device reads the session fresh, not from the cookie cache', async () => {
  const seen = []
  const read = async (headers, options) => { seen.push(options); return { user: { id: 'github:1', name: 'N', image: '' } } }
  const end = { revokeAll: async () => {}, loginCookies: async () => [] }
  assert.equal((await answerSignOutEverywhere(signOut({ Origin: origin }), login0, read, end)).status, 204)
  assert.deepEqual(seen, [{ fresh: true }])
  // The reads of the account's data may use the cache.
  await signedIn(request({}), read)
  assert.equal(seen[1], undefined)
})

test('the fresh read of Better Auth disables the cookie cache, so a revoked session cannot sign out the others', database, async () => {
  const user = await login()
  const { auth } = require('../src/server/betterAuth.ts')
  // A browser with the cache: its session_data cookie, from a read through the endpoint.
  const first = await auth.api.getSession({ headers: new Headers({ Cookie: user.cookie }), returnHeaders: true })
  const cache = first.headers.getSetCookie().find(line => line.startsWith('better-auth.session_data='))?.split(';')[0]
  assert.ok(cache)
  const cookie = `${user.cookie}; ${cache}`
  // The stolen session is revoked; the owner has signed in again since.
  await sql.query(`INSERT INTO typle_auth_sessions (id, expires_at, token, user_id) VALUES ('newer', now() + interval '1 hour', 'newer-token', $1)`, [user.id])
  await sql.query(`DELETE FROM typle_auth_sessions WHERE user_id = $1 AND id <> 'newer'`, [user.id])
  assert.equal((await signedIn(request({ Cookie: cookie }))).user.sub, user.id)
  assert.equal((await signedIn(request({ Cookie: cookie }), undefined, { fresh: true })).refusal.status, 401)
  const stolen = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), login0)
  assert.equal(stolen.status, 401)
  assert.equal(await sessionsOf(user.id), 1)
})
