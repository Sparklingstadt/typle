require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { encodeSession, decodeSession } = require('../src/server/authJwt.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// Auth.js reads and writes the login cookie through these, so that it keeps the form the Go backend sealed
// (tests/fixtures/sessions.json): a login made before the move to Auth.js stays signed in, and one made after still
// opens on the Go and Kotlin backends.
const fixture = require('./fixtures/sessions.json')
const key = readLoginSettings({ AUTH_SECRET: fixture.secret, AUTH_URL: 'https://typle.example' }).sessionKey

const valid = fixture.cookies.filter(cookie => cookie.session)

test('every cookie of the fixture decodes to its account, and those that do not open to null', () => {
  assert.ok(valid.length >= 2)
  for (const { value, session } of fixture.cookies) {
    assert.deepEqual(decodeSession(value, key, fixture.now),
      session && { sub: session.sub, name: session.name, picture: session.image, iat: session.iat, exp: session.exp }, value)
  }
})

test('a decoded cookie encodes to the same text, so the login is never extended', () => {
  for (const { value } of valid) {
    assert.equal(encodeSession(decodeSession(value, key, fixture.now), key, fixture.now + 86400), value)
  }
})

test('a new login lasts 30 days from now', () => {
  const now = 1800000000.7
  const value = encodeSession({ sub: 'github:1', name: 'Taro', picture: 'https://avatars.example/u/1' }, key, now)
  const token = decodeSession(value, key, now)
  assert.equal(token.iat, 1800000000)
  assert.equal(token.exp - token.iat, 2592000)
  assert.deepEqual(decodeSession(encodeSession({ sub: 'github:2', name: 'Hanako' }, key, now), key, now).picture, '')
})

test('an expired, changed or foreign value decodes to null', () => {
  const { value, session } = valid[0]
  assert.equal(decodeSession(value, key, session.exp), null)
  const [payload, signature] = value.split('.')
  assert.equal(decodeSession(`${payload}.${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`, key, fixture.now), null)
  const other = readLoginSettings({ AUTH_SECRET: 'another-secret', AUTH_URL: 'https://typle.example' }).sessionKey
  assert.equal(decodeSession(value, other, fixture.now), null)
  assert.equal(decodeSession(fixture.tokens[0].value, key, fixture.now), null)
  const unknown = Buffer.from(JSON.stringify({ sub: 'google:1', name: 'x', image: '', iat: 1, exp: 4102444800 })).toString('base64url')
  assert.equal(decodeSession(`${unknown}.${createHmac('sha256', key).update(unknown).digest('base64url')}`, key, fixture.now), null)
})
