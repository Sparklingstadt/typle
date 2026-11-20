require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readLoginSettings } = require('../src/server/settings.ts')

test('the settings need a secret and an http or https AUTH_URL', () => {
  const ok = { AUTH_SECRET: 's', AUTH_URL: 'https://Typle.Example:443/api/auth' }
  assert.equal(readLoginSettings(ok).origin, 'https://typle.example')
  assert.equal(readLoginSettings({ ...ok, AUTH_URL: 'http://127.0.0.1:3101' }).origin, 'http://127.0.0.1:3101')
  for (const env of [{ ...ok, AUTH_SECRET: '' }, { ...ok, AUTH_URL: '' }, { ...ok, AUTH_URL: 'ftp://x' }, { ...ok, AUTH_URL: 'not a url' }, { AUTH_URL: ok.AUTH_URL }]) {
    assert.equal(readLoginSettings(env), null, JSON.stringify(env))
  }
  // The day's cap of all mail has a scope of its own only where TYPLE_MAIL_CAP_SCOPE sets one (the tests).
  assert.equal(readLoginSettings(ok).mailCapScope, '')
  assert.equal(readLoginSettings({ ...ok, TYPLE_MAIL_CAP_SCOPE: 'e2e' }).mailCapScope, 'e2e')
})

// The local login of development, as the Go backend judged it (web.FromEnv).
test('the local login is on only for plain http to this machine, never on Vercel', () => {
  const on = (env) => readLoginSettings({ AUTH_SECRET: 's', LOCAL_DEVELOPMENT_LOGIN: '1', ...env }).localLogin
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3101', 'http://[::1]:3000', 'http://LOCALHOST']) assert.equal(on({ AUTH_URL: url }), true, url)
  for (const url of ['https://localhost:3000', 'http://typle.example', 'http://192.168.1.2:3000', 'http://8.8.8.8']) assert.equal(on({ AUTH_URL: url }), false, url)
  assert.equal(on({ AUTH_URL: 'http://192.168.1.2:3000', LOCAL_DEVELOPMENT_LAN_HOST: '192.168.1.2' }), true)
  assert.equal(on({ AUTH_URL: 'http://8.8.8.8', LOCAL_DEVELOPMENT_LAN_HOST: '8.8.8.8' }), false)
  assert.equal(on({ AUTH_URL: 'http://127.0.0.1:3101', VERCEL: '1' }), false)
  assert.equal(on({ AUTH_URL: 'http://127.0.0.1:3101', LOCAL_DEVELOPMENT_LOGIN: '0' }), false)
})
