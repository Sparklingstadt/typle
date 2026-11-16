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
})

// The logins the session offers, and the local login of development, as the Go backend judged them (web.FromEnv).
test('the providers are the logins whose settings are all there, GitHub first', () => {
  const base = { AUTH_SECRET: 's', AUTH_URL: 'https://typle.example' }
  assert.deepEqual(readLoginSettings(base).providers, [])
  assert.deepEqual(readLoginSettings({ ...base, AUTH_GITHUB_ID: 'i' }).providers, [])
  assert.deepEqual(readLoginSettings({ ...base, AUTH_GITHUB_ID: 'i', AUTH_GITHUB_SECRET: 's' }).providers, ['github'])
  const ffpf = { FFPF_ID_ISSUER: 'https://id.example', FFPF_ID_CLIENT_ID: 'c', FFPF_ID_CLIENT_SECRET: 's' }
  assert.deepEqual(readLoginSettings({ ...base, ...ffpf }).providers, ['ffpf'])
  assert.deepEqual(readLoginSettings({ ...base, ...ffpf, FFPF_ID_CLIENT_SECRET: '' }).providers, [])
  assert.deepEqual(readLoginSettings({ ...base, ...ffpf, AUTH_GITHUB_ID: 'i', AUTH_GITHUB_SECRET: 's' }).providers, ['github', 'ffpf'])
})

test('the local login is on only for plain http to this machine, never on Vercel', () => {
  const on = (env) => readLoginSettings({ AUTH_SECRET: 's', LOCAL_DEVELOPMENT_LOGIN: '1', ...env }).localLogin
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3101', 'http://[::1]:3000', 'http://LOCALHOST']) assert.equal(on({ AUTH_URL: url }), true, url)
  for (const url of ['https://localhost:3000', 'http://typle.example', 'http://192.168.1.2:3000', 'http://8.8.8.8']) assert.equal(on({ AUTH_URL: url }), false, url)
  assert.equal(on({ AUTH_URL: 'http://192.168.1.2:3000', LOCAL_DEVELOPMENT_LAN_HOST: '192.168.1.2' }), true)
  assert.equal(on({ AUTH_URL: 'http://8.8.8.8', LOCAL_DEVELOPMENT_LAN_HOST: '8.8.8.8' }), false)
  assert.equal(on({ AUTH_URL: 'http://127.0.0.1:3101', VERCEL: '1' }), false)
  assert.equal(on({ AUTH_URL: 'http://127.0.0.1:3101', LOCAL_DEVELOPMENT_LOGIN: '0' }), false)
})

// The clients of the logins, as the Go backend made them (web.FromEnv, auth.NewOAuth, auth.NewGitHub, auth.NewFFPF).
test('the GitHub and FFPF ID clients are there when all their settings are', () => {
  const base = { AUTH_SECRET: 's', AUTH_URL: 'https://typle.example' }
  assert.equal(readLoginSettings(base).github, null)
  assert.equal(readLoginSettings({ ...base, AUTH_GITHUB_ID: 'i' }).github, null)
  assert.deepEqual(readLoginSettings({ ...base, AUTH_GITHUB_ID: 'i', AUTH_GITHUB_SECRET: 's' }).github, {
    clientId: 'i', clientSecret: 's', authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token', apiUrl: 'https://api.github.com',
  })
  const ffpf = { FFPF_ID_ISSUER: 'https://id.example//', FFPF_ID_CLIENT_ID: 'c', FFPF_ID_CLIENT_SECRET: 'x' }
  assert.equal(readLoginSettings(base).ffpf, null)
  assert.equal(readLoginSettings({ ...base, ...ffpf, FFPF_ID_CLIENT_ID: '' }).ffpf, null)
  // Only one trailing slash goes, as strings.TrimSuffix removed it.
  assert.deepEqual(readLoginSettings({ ...base, ...ffpf }).ffpf, { issuer: 'https://id.example/', clientId: 'c', clientSecret: 'x' })
  assert.equal(readLoginSettings(base).oauthKey.length, 32)
})
