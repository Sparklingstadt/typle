require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openSession, sessionCookieName } = require('../src/server/session.ts')
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
