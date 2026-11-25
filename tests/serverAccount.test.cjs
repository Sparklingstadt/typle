require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { currentUser, signedIn } = require('../src/server/account.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

const secret = 'typle-account-test-secret'
const http = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'http://127.0.0.1:3101' })
const https = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'https://typle.example' })

/** A cookie (info "typle session v1") or app token ("typle app session v1"), sealed as tests/e2e/sessionCookie.ts does. */
function seal(info, claims) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}
const now = Math.floor(Date.now() / 1000)
const claimsFor = sub => ({ sub, name: 'N', image: '', iat: now - 60, exp: now + 3600 })
const cookie = sub => seal('typle session v1', claimsFor(sub))
const token = sub => seal('typle app session v1', claimsFor(sub))
const request = headers => new Request('http://localhost/api/workspace', { headers })

test('the user is read from the cookie alone', () => {
  assert.equal(currentUser(request({ Cookie: `typle-session=${cookie('github:1')}` }), http).sub, 'github:1')
  assert.equal(currentUser(request({ Cookie: `other=x; __Host-typle-session=${cookie('github:1')}` }), https).sub, 'github:1')
  assert.equal(currentUser(request({ Cookie: `typle-session=${cookie('github:1')}` }), https), null)
  assert.equal(currentUser(request({ Cookie: `typle-session=${token('github:1')}` }), http), null)
  assert.equal(currentUser(request({}), http), null)
})

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const owners = []
after(async () => {
  if (!db) return
  await sql.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [owners])
  await sql.end()
  await db.$disconnect()
})
const newOwner = () => {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return owner
}

test('a session that was not revoked is signed in', database, async () => {
  const owner = newOwner()
  const result = await signedIn(request({ Cookie: `typle-session=${cookie(owner)}` }), db, http)
  assert.equal(result.user.sub, owner)
})

// Signing out of every device revokes every login until then, the login in that very second too.
test('a revoked session is signed out, and a browser loses its cookie', database, async () => {
  const owner = newOwner()
  await sql.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, to_timestamp($2))', [owner, now - 60])
  const browser = await signedIn(request({ Cookie: `typle-session=${cookie(owner)}` }), db, http)
  assert.equal(browser.refusal.status, 401)
  assert.equal(await browser.refusal.text(), '{"error":"loginRequired"}\n')
  assert.equal(browser.refusal.headers.get('set-cookie'), 'typle-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  const secure = await signedIn(request({ Cookie: `__Host-typle-session=${cookie(owner)}` }), db, https)
  assert.equal(secure.refusal.headers.get('set-cookie'), '__Host-typle-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')
})

test('a login after the revocation is signed in', database, async () => {
  const owner = newOwner()
  await sql.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, to_timestamp($2))', [owner, now - 61])
  assert.equal((await signedIn(request({ Cookie: `typle-session=${cookie(owner)}` }), db, http)).user.sub, owner)
})

test('without a session the request is refused with loginRequired', async () => {
  const result = await signedIn(request({}), null, http)
  assert.equal(result.refusal.status, 401)
  assert.equal(await result.refusal.text(), '{"error":"loginRequired"}\n')
})

test('503 when the revocations cannot be read', async () => {
  const down = createPrisma('postgres://user:pass@127.0.0.1:1/none')
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args.map(String).join(' '))
  try {
    const result = await signedIn(request({ Cookie: `typle-session=${cookie('github:5')}` }), down, http)
    assert.equal(result.refusal.status, 503)
    assert.equal(await result.refusal.text(), '{"error":"databaseUnavailable"}\n')
  } finally {
    console.error = original
    await down.$disconnect()
  }
  assert.match(logged[0], /: session\.check:/)
})
