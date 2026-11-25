require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { currentUser, revokedSoon } = require('../src/server/account.ts')
const { answerSignOutEverywhere } = require('../src/server/accountApi.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// Signing out of every device (typle_session_revocations) and the check of a session against it. Runs against a real
// database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const secret = 'typle-revocation-test-secret'
const origin = 'http://127.0.0.1:3101'
const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const owners = []
after(async () => {
  if (!db) return
  await sql.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [owners])
  await sql.end()
  await db.$disconnect()
})

function seal(info, sub) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub, name: 'N', image: '', iat: now - 60, exp: now + 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}
const newOwner = () => {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return owner
}
const now = Math.floor(Date.now() / 1000)
const signOut = headers => new Request(`${origin}/api/account/signout-everywhere`, { method: 'POST', headers })

test('a login before the revocation is revoked, one after it is not', database, async () => {
  const owner = newOwner()
  assert.equal(await revokedSoon(open, owner, now), false)
  await sql.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, to_timestamp($2))', [owner, now])
  assert.equal(await revokedSoon(open, owner, now - 10), true)
  assert.equal(await revokedSoon(open, owner, now), true)
  assert.equal(await revokedSoon(open, owner, now + 1), false)
})

test('revokedSoon gives up with null after about a second, and says so', async () => {
  const warned = []
  const original = console.warn
  console.warn = (...args) => warned.push(args.map(String).join(' '))
  const started = Date.now()
  try {
    assert.equal(await revokedSoon(() => ({ sessionRevocation: { findUnique: () => new Promise(() => {}) } }), 'github:1', now), null)
    assert.equal(await revokedSoon(() => { throw new Error('no database') }, 'github:1', now), null)
  } finally {
    console.warn = original
  }
  const took = Date.now() - started
  assert.ok(took >= 950 && took < 2500, `took ${took} ms`)
  assert.equal(warned.length, 2)
  assert.match(warned[0], /session\.check:/)
})

test('signing out of every device is refused without an Origin, and without a login', database, async () => {
  const cookie = `typle-session=${seal('typle session v1', newOwner())}`
  const noOrigin = await answerSignOutEverywhere(signOut({ Cookie: cookie }), open, withSettings)
  assert.equal(noOrigin.status, 403)
  assert.equal(await noOrigin.text(), '{"error":"forbiddenRequest"}\n')
  const other = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: 'https://evil.example' }), open, withSettings)
  assert.equal(other.status, 403)
  const noLogin = await answerSignOutEverywhere(signOut({ Origin: origin }), open, withSettings)
  assert.equal(noLogin.status, 401)
  assert.equal(await noLogin.text(), '{"error":"loginRequired"}\n')
})

test('signing out of every device revokes the logins and removes the cookie', database, async () => {
  const owner = newOwner()
  const cookie = `typle-session=${seal('typle session v1', owner)}`
  const response = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), open, withSettings)
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('set-cookie'), 'typle-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  assert.equal(await revokedSoon(open, owner, now - 60), true)
  // The login is revoked now, so a second sign-out is refused and the cookie removed again.
  const again = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), open, withSettings)
  assert.equal(again.status, 401)
  assert.match(again.headers.get('set-cookie'), /Max-Age=0/)
})

test('signing out of every device never leaves the revocation in a second some login was dated after', database, async () => {
  const owner = newOwner()
  // An earlier revocation ahead of the clock: the logins made after it are dated from its next whole second.
  await sql.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, to_timestamp($2))', [owner, now + 100])
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'typle session v1', 32))
  const payload = Buffer.from(JSON.stringify({ sub: owner, name: 'N', image: '', iat: now + 101, exp: now + 3600 })).toString('base64url')
  const cookie = `typle-session=${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
  const response = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), open, withSettings)
  assert.equal(response.status, 204)
  assert.equal(await revokedSoon(open, owner, now + 101), true)
})

test('signing out of every device is 503 when the revocations cannot be written, and 503 without login settings', async () => {
  const down = createPrisma('postgres://user:pass@127.0.0.1:1/none')
  const original = console.error
  console.error = () => {}
  try {
    const cookie = `typle-session=${seal('typle session v1', 'github:5')}`
    const response = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), () => down, withSettings)
    assert.equal(response.status, 503)
    assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
    assert.equal(response.headers.get('set-cookie'), null)
    const unset = await answerSignOutEverywhere(signOut({ Cookie: cookie, Origin: origin }), () => down, () => null)
    assert.equal(unset.status, 503)
    assert.equal(await unset.text(), '{"error":"authUnavailable"}\n')
  } finally {
    console.error = original
    await down.$disconnect()
  }
})

test('only POST is served', async () => {
  const response = await answerSignOutEverywhere(new Request(`${origin}/api/account/signout-everywhere`), open, withSettings)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'POST')
})

test('a Bearer token no longer signs anyone in', () => {
  const token = seal('typle app session v1', 'github:1')
  const cookie = seal('typle session v1', 'github:1')
  for (const value of [token, cookie]) {
    assert.equal(currentUser(new Request(origin, { headers: { Authorization: `Bearer ${value}` } }), settings), null)
  }
  assert.equal(currentUser(new Request(origin, { headers: { Authorization: `Bearer ${token}`, Cookie: `typle-session=${cookie}` } }), settings)?.sub, 'github:1')
})
