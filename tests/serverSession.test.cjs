require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openSession, sessionCookieName, openAdmin, adminCookieName, sealSession, openCode, challengeOf } = require('../src/server/session.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// The cookies and tokens were sealed by the Go backend (session.Keys.Seal and SealApp), so a login made by either side
// stays signed in on the other.
const fixture = require('./fixtures/sessions.json')
const settings = readLoginSettings({ AUTH_SECRET: fixture.secret, AUTH_URL: 'https://typle.example' })
const claimsOf = session => session && { sub: session.sub, name: session.name, image: session.image, iat: session.issuedAt, exp: session.expires }

test('the Go backend\'s cookies and app tokens open as they did there', () => {
  for (const { value, session } of fixture.cookies) assert.deepEqual(claimsOf(openSession(settings.sessionKey, value, fixture.now)), session, value)
  for (const { value, session } of fixture.tokens) assert.deepEqual(claimsOf(openSession(settings.appKey, value, fixture.now)), session, value)
})

test('a cookie opens with its own key only', () => {
  const [cookie] = fixture.cookies
  const [token] = fixture.tokens
  assert.equal(openSession(settings.appKey, cookie.value, fixture.now), null)
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

// The administrator's cookie of /admin, sealed by the Go backend (session.Keys.SealAdmin): it opens only under the admin
// key, before it expires, with an email and an FFPF ID sub.
const admins = require('./fixtures/admin-cookies.json')
const adminSettings = readLoginSettings({ AUTH_SECRET: admins.secret, AUTH_URL: 'https://typle.example' })

test('the Go backend\'s administrator cookies open as they did there', () => {
  for (const { note, value, admin } of admins.cookies) {
    const opened = openAdmin(adminSettings.adminKey, value, admins.now)
    assert.deepEqual(opened && { email: opened.email, sub: opened.sub, iat: opened.issuedAt, exp: opened.expires }, admin && { email: admin.email, sub: admin.sub, iat: admin.iat, exp: admin.exp }, note)
  }
  // The login keys do not open it.
  assert.equal(openSession(adminSettings.sessionKey, admins.cookies[0].value, admins.now), null)
})

test('the administrator cookie is __Host- over HTTPS', () => {
  assert.equal(adminCookieName(true), '__Host-typle-admin')
  assert.equal(adminCookieName(false), 'typle-admin')
})

// The login cookies, app tokens and app codes the Go backend sealed at a fixed time (tests/fixtures/auth-answers.json):
// TS seals the same bytes, so that what either side issues the other reads until the Go backend is gone.
const auth = require('./fixtures/auth-answers.json')
const authSettings = readLoginSettings({ AUTH_SECRET: auth.secret, AUTH_URL: 'https://typle.example' })
const login = auth.now - 100
const MONTH = 30 * 24 * 3600

test('a session is sealed with the same bytes as the Go backend\'s', () => {
  const alice = { sub: 'github:9100000001', name: 'Alice', image: 'https://avatars.example/u/1', issuedAt: login, expires: login + MONTH }
  assert.equal(sealSession(authSettings.sessionKey, alice), auth.values.alice)
  assert.equal(sealSession(authSettings.appKey, alice), auth.values['alice-app'])
  const bob = { sub: 'github:9100000002', name: '<b&o> b  😀', image: '', issuedAt: login, expires: login + MONTH }
  assert.equal(sealSession(authSettings.sessionKey, bob), auth.values.bob)
  assert.deepEqual(openSession(authSettings.sessionKey, auth.values.bob, auth.now), bob)
})

test('an app code opens as the Go backend opened it', () => {
  const code = openCode(authSettings.codeKey, auth.values.code, auth.now)
  assert.deepEqual(code && { sub: code.sub, name: code.name, image: code.image, challenge: code.challenge },
    { sub: 'github:9100000001', name: 'Alice', image: 'https://avatars.example/u/1', challenge: challengeOf(auth.verifier) })
  for (const name of ['code-expired', 'code-badsub', 'code-nochallenge']) assert.equal(openCode(authSettings.codeKey, auth.values[name], auth.now), null, name)
  assert.equal(openCode(authSettings.codeKey, auth.values.alice, auth.now), null)
  assert.equal(openCode(authSettings.sessionKey, auth.values.code, auth.now), null)
})
