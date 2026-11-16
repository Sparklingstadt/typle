require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readLoginSettings, clientMac } = require('../src/server/settings.ts')

// The values were made by the Go backend (session.Keys.ClientMAC), so that the counts of the rate limit go on as they
// were whichever of the two counts them.
test('the rate limit key and client MAC are the Go backend\'s', () => {
  const { secret, macs } = require('./fixtures/client-mac.json')
  const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'https://typle.example' })
  for (const [ip, hex] of Object.entries(macs)) assert.equal(clientMac(settings.rateLimitKey, ip).toString('hex'), hex, ip)
})

test('the settings need a secret and an http or https AUTH_URL', () => {
  const ok = { AUTH_SECRET: 's', AUTH_URL: 'https://Typle.Example:443/api/auth' }
  assert.equal(readLoginSettings(ok).origin, 'https://typle.example')
  assert.equal(readLoginSettings(ok).onVercel, false)
  assert.equal(readLoginSettings({ ...ok, AUTH_URL: 'http://127.0.0.1:3101' }).origin, 'http://127.0.0.1:3101')
  assert.equal(readLoginSettings({ ...ok, VERCEL: '1' }).onVercel, true)
  for (const env of [{ ...ok, AUTH_SECRET: '' }, { ...ok, AUTH_URL: '' }, { ...ok, AUTH_URL: 'ftp://x' }, { ...ok, AUTH_URL: 'not a url' }, { AUTH_URL: ok.AUTH_URL }]) {
    assert.equal(readLoginSettings(env), null, JSON.stringify(env))
  }
})
