require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

// The Better Auth instance (src/server/betterAuth.ts): it refuses to start without its settings, and an OAuth sign-up
// (which hands Better Auth only the provider's email) makes the user the account ID the email stands for.

const modulePath = path.join(__dirname, '../src/server/betterAuth.ts')

test('building the instance without BETTER_AUTH_SECRET or AUTH_URL fails, naming them, instead of falling back to AUTH_SECRET', () => {
  const env = { ...process.env, DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x', AUTH_URL: 'https://typle.example', AUTH_SECRET: 'y'.repeat(40) }
  delete env.BETTER_AUTH_SECRET
  delete env.NEXT_PHASE
  const run = spawnSync(process.execPath, ['-e', `require('./tests/register.cjs'); require(${JSON.stringify(modulePath)})`],
    { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /BETTER_AUTH_SECRET must be set/)
  assert.doesNotMatch(run.stderr, /y{40}/)
})

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const ids = []
let auth
if (url) {
  process.env.DATABASE_URL = url
  process.env.BETTER_AUTH_SECRET = 'better-auth-test-secret-0123456789abcdef'
  process.env.AUTH_URL = 'http://127.0.0.1:3101'
  auth = require('../src/server/betterAuth.ts').auth
}
after(async () => {
  if (!auth) return
  const context = await auth.$context
  for (const id of ids) await context.internalAdapter.deleteUser(id)
  await require('../src/server/database.ts').prisma().$disconnect()
})

test('a first OAuth sign-in creates the user with the account ID as its id, a made-up address and a 30-day session', database, async () => {
  const { handleOAuthUserInfo } = require('better-auth/oauth2')
  const context = await auth.$context
  const id = `sid:t${Date.now().toString(36)}`
  ids.push(id)
  const account = { providerId: 'sid', accountId: id.slice(4), accessToken: 'a' }
  // What a provider returns: the made-up address, never a real one (the real address is not copied).
  const userInfo = { id: account.accountId, name: 'Test', email: `${id}@users.invalid`, emailVerified: false }
  const result = await handleOAuthUserInfo({ context, request: undefined }, { userInfo, account })
  assert.equal(result.error, null)
  assert.equal(result.isRegister, true)
  assert.equal(result.data.user.id, id)
  assert.equal(result.data.user.email, `${id}@users.invalid`)
  assert.equal(result.data.user.emailVerified, true)
  assert.equal(result.data.session.userId, id)
  assert.ok(Math.abs(result.data.session.expiresAt - result.data.session.createdAt - 30 * 24 * 3600 * 1000) < 5000)
  const again = await handleOAuthUserInfo({ context, request: undefined }, { userInfo, account })
  assert.equal(again.error, null)
  assert.equal(again.isRegister, false)
  assert.equal(again.data.user.id, id)
})

test('an OAuth sign-up with a real address is refused', database, async () => {
  const { handleOAuthUserInfo } = require('better-auth/oauth2')
  const context = await auth.$context
  const result = await handleOAuthUserInfo({ context, request: undefined }, {
    userInfo: { id: 'real1', name: 'Real', email: 'real@example.com', emailVerified: true },
    account: { providerId: 'sid', accountId: 'real1' },
  })
  assert.equal(result.data, null)
  assert.ok(result.error)
})
