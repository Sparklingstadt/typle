require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openSession, sessionCookieName, sealSession } = require('../src/server/session.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// The cookies and tokens were sealed by the Go backend (session.Keys.Seal and SealApp), so a login made by either side
// stays signed in on the other.
const fixture = require('./fixtures/sessions.json')
const settings = readLoginSettings({ AUTH_SECRET: fixture.secret, AUTH_URL: 'https://typle.example' })
const claimsOf = session => session && { sub: session.sub, name: session.name, image: session.image, iat: session.issuedAt, exp: session.expires }

test('the Go backend\'s cookies open as they did there', () => {
  for (const { value, session } of fixture.cookies) assert.deepEqual(claimsOf(openSession(settings.sessionKey, value, fixture.now)), session, value)
})

test('a cookie opens with its own key only', () => {
  const [cookie] = fixture.cookies
  const [token] = fixture.tokens
  assert.equal(openSession(settings.sessionKey, token.value, fixture.now), null)
  const other = readLoginSettings({ AUTH_SECRET: 'another-secret', AUTH_URL: 'https://typle.example' })
  assert.equal(openSession(other.sessionKey, cookie.value, fixture.now), null)
})

test('a changed or malformed value does not open', () => {
  const { value } = fixture.cookies[0]
  const [payload, signature] = value.split('.')
  const flip = text => text.slice(0, -1) + (text.at(-1) === 'A' ? 'B' : 'A')
  for (const changed of [`${payload}.${flip(signature)}`, `${flip(payload)}.${signature}`, `${payload}.${signature}=`,
    `${payload}=.${signature}`, payload, '', '.', `${payload}.${signature}.x`, `${payload}.${signature.slice(0, -1)}`]) {
    assert.equal(openSession(settings.sessionKey, changed, fixture.now), null, changed)
  }
})

test('a session opens until it expires', () => {
  const { value, session } = fixture.cookies[0]
  assert.ok(openSession(settings.sessionKey, value, session.exp - 1))
  assert.equal(openSession(settings.sessionKey, value, session.exp), null)
})

test('the cookie is __Host- over HTTPS', () => {
  assert.equal(sessionCookieName(true), '__Host-typle-session')
  assert.equal(sessionCookieName(false), 'typle-session')
  assert.equal(settings.secure, true)
  assert.equal(readLoginSettings({ AUTH_SECRET: 's', AUTH_URL: 'http://127.0.0.1:3101' }).secure, false)
})

// The login cookies and app tokens the Go backend sealed at a fixed time (tests/fixtures/auth-answers.json):
// TS seals the same bytes, so that what the Go backend issued before v2.47.0 still opens.
const auth = require('./fixtures/auth-answers.json')
const authSettings = readLoginSettings({ AUTH_SECRET: auth.secret, AUTH_URL: 'https://typle.example' })
const login = auth.now - 100
const MONTH = 30 * 24 * 3600

test('a session is sealed with the same bytes as the Go backend\'s', () => {
  const alice = { sub: 'github:9100000001', name: 'Alice', image: 'https://avatars.example/u/1', issuedAt: login, expires: login + MONTH }
  assert.equal(sealSession(authSettings.sessionKey, alice), auth.values.alice)
  const bob = { sub: 'github:9100000002', name: '<b&o> b  😀', image: '', issuedAt: login, expires: login + MONTH }
  assert.equal(sealSession(authSettings.sessionKey, bob), auth.values.bob)
  assert.deepEqual(openSession(authSettings.sessionKey, auth.values.bob, auth.now), bob)
})
