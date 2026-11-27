require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { accountEmail, accountIdFromEmail, betterAuthSettings } = require('../src/server/authUser.ts')

// The stand-in address Better Auth's user table needs, and the settings (secret, base URL) it is built from.

test('the address of an account is made from its ID, under the .invalid domain', () => {
  assert.equal(accountEmail('github:219588180'), 'github:219588180@users.invalid')
  assert.equal(accountEmail('sid:abc'), 'sid:abc@users.invalid')
})

test('Better Auth is set up from BETTER_AUTH_SECRET and AUTH_URL', () => {
  const secret = 'x'.repeat(32)
  assert.deepEqual(betterAuthSettings({ BETTER_AUTH_SECRET: secret, AUTH_URL: 'https://typle.sparklingstadt.com' }),
    { secret, baseURL: 'https://typle.sparklingstadt.com' })
  assert.deepEqual(betterAuthSettings({ BETTER_AUTH_SECRET: secret, AUTH_URL: 'http://127.0.0.1:3101' }),
    { secret, baseURL: 'http://127.0.0.1:3101' })
})

test('without the secret or an http(s) AUTH_URL there are no settings; AUTH_SECRET alone is not the secret', () => {
  const url = 'https://typle.sparklingstadt.com'
  assert.equal(betterAuthSettings({ BETTER_AUTH_SECRET: '', AUTH_URL: url }), null)
  assert.equal(betterAuthSettings({ AUTH_SECRET: 'x'.repeat(32), AUTH_URL: url }), null)
  assert.equal(betterAuthSettings({ BETTER_AUTH_SECRET: 'x', AUTH_URL: 'ftp://x' }), null)
  assert.equal(betterAuthSettings({ BETTER_AUTH_SECRET: 'x', AUTH_URL: 'not a url' }), null)
  assert.equal(betterAuthSettings({ BETTER_AUTH_SECRET: 'x' }), null)
})

test('the account ID comes back from its address, and only from one made by accountEmail', () => {
  assert.equal(accountIdFromEmail('github:219588180@users.invalid'), 'github:219588180')
  assert.equal(accountIdFromEmail('github:0@users.invalid'), 'github:0')
  assert.equal(accountIdFromEmail('sid:abc123@users.invalid'), 'sid:abc123')
  for (const email of ['someone@example.com', 'sid:ABC@users.invalid', 'github:abc@users.invalid', 'github:12', 'sid:@users.invalid',
    'password:x@users.invalid', '@users.invalid', 'github:1@users.invalid.example']) {
    assert.equal(accountIdFromEmail(email), null, email)
  }
})
