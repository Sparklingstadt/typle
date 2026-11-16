require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openSession, sessionCookieName, sealSession, openCode, challengeOf, openOAuth, sealOAuth, sealCode, newCode } = require('../src/server/session.ts')
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

// The login cookies, app tokens and app codes the Go backend sealed at a fixed time (tests/fixtures/auth-answers.json):
// TS seals the same bytes, so that what the Go backend issued before v2.47.0 still opens.
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

// The login in progress (the OAuth cookie) and the app code, as the Go backend sealed them at a
// fixed time (tests/fixtures/signin-answers.json): TS opens Go's and seals the same bytes, so that a login one side starts
// the other finishes, as during a rollback.
const signin = require('./fixtures/signin-answers.json')
const signinSettings = readLoginSettings({ AUTH_SECRET: 'typle-fixture-secret', AUTH_URL: 'https://typle.example' })
const pendingExp = signin.now + 600
const pendingLogins = {
  gh: { state: 'state-1', verifier: 'verifier-1', returnTo: '/lists?x=1&y=<2>', challenge: '', provider: '', nonce: '', expires: pendingExp },
  ghApp: { state: 'state-1', verifier: 'verifier-1', returnTo: '/lists', challenge: signin.challenge, provider: '', nonce: '', expires: pendingExp },
  ghUtf: { state: 'state-1', verifier: 'verifier-1', returnTo: '/ほげ?q=a b', challenge: '', provider: '', nonce: '', expires: pendingExp },
  ff: { state: 'state-1', verifier: 'verifier-1', returnTo: '/play', challenge: '', provider: 'ffpf', nonce: 'nonce-1', expires: pendingExp },
  ffApp: { state: 'state-1', verifier: 'verifier-1', returnTo: '/play', challenge: signin.challenge, provider: 'ffpf', nonce: 'nonce-1', expires: pendingExp },
}
// The logins to the dashboard (removed in v2.48.0) open as ordinary ones: their admin claim is not read.
const dashboardLogins = {
  ghAdmin: { state: 'state-1', verifier: 'verifier-1', returnTo: '/admin', challenge: '', provider: '', nonce: '', expires: pendingExp },
  ffAdmin: { state: 'state-1', verifier: 'verifier-1', returnTo: '/admin', challenge: '', provider: 'ffpf', nonce: 'nonce-1', expires: pendingExp },
}

test('the Go backend\'s OAuth cookies open, and TS seals the same bytes', () => {
  for (const [name, pending] of Object.entries(pendingLogins)) {
    assert.deepEqual(openOAuth(signinSettings.oauthKey, signin.values[name], signin.now), pending, name)
    assert.equal(sealOAuth(signinSettings.oauthKey, pending), signin.values[name], name)
  }
  for (const [name, pending] of Object.entries(dashboardLogins)) {
    assert.deepEqual(openOAuth(signinSettings.oauthKey, signin.values[name], signin.now), pending, name)
  }
  assert.equal(openOAuth(signinSettings.oauthKey, signin.values.ghOld, signin.now), null)
  assert.equal(openOAuth(signinSettings.oauthKey, signin.values.gh, pendingExp), null)
  assert.equal(openOAuth(signinSettings.sessionKey, signin.values.gh, signin.now), null)
  assert.equal(openOAuth(signinSettings.oauthKey, 'e30.AAAA', signin.now), null)
})

test('an OAuth cookie of the wrong types does not open; absent and null fields are empty', () => {
  const { createHmac } = require('node:crypto')
  const sealRaw = json => {
    const payload = Buffer.from(json).toString('base64url')
    return `${payload}.${createHmac('sha256', signinSettings.oauthKey).update(payload).digest('base64url')}`
  }
  const exp = signin.now + 10
  assert.deepEqual(openOAuth(signinSettings.oauthKey, sealRaw(`{"state":"s","exp":${exp},"nonce":null,"admin":null}`), signin.now),
    { state: 's', verifier: '', returnTo: '', challenge: '', provider: '', nonce: '', expires: exp })
  for (const json of [`{"state":1,"exp":${exp}}`, `{"exp":"${exp}"}`, '{"state":"s"}', `[${exp}]`]) {
    assert.equal(openOAuth(signinSettings.oauthKey, sealRaw(json), signin.now), null, json)
  }
})

const answerOf = note => signin.answers[signin.requests.findIndex(q => q.note === note)]

test('the app code is sealed with the same bytes as the Go backend\'s', () => {
  const code = new URL(answerOf('github app').location).searchParams.get('code')
  assert.equal(sealCode(signinSettings.codeKey, newCode('github:583231', 'The Octocat', 'https://avatars.example/u/583231?v=4', signin.challenge, signin.now + 0.9)), code)
  assert.equal(openCode(signinSettings.codeKey, code, signin.now).expires, signin.now + 120)
})
