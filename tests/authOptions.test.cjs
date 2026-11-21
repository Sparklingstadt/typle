require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  githubProfile, authorizeLocal, LOCAL_USER, jwtCallback, sessionCallback, redirectCallback,
  redirectProxyUrl, authPathKnown, authErrorLogger,
} = require('../src/server/authOptions.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { githubConfigured } = require('../src/lib/githubLogin.ts')

// What src/auth.ts hands Auth.js: the GitHub profile, the callbacks that give the session its account ID, its end and
// its revocation, the made-up local login, and the paths under /api/auth that Auth.js answers.

const secret = 'typle-auth-options-test-secret'
const settings = (env = {}) => readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'http://127.0.0.1:3101', ...env })

test('the GitHub profile is the account github:<id>, named by its name, or by its login when the name is blank', () => {
  const profile = { id: 42, login: ' octocat ', name: '  Mona Lisa  ', avatar_url: 'https://avatars.example/42' }
  assert.deepEqual(githubProfile(profile), { id: 'github:42', name: 'Mona Lisa', image: 'https://avatars.example/42' })
  for (const name of [null, undefined, '', '   ']) {
    assert.deepEqual(githubProfile({ ...profile, name }), { id: 'github:42', name: 'octocat', image: 'https://avatars.example/42' })
  }
})

test('GitHub is offered only with both its client ID and secret', () => {
  assert.equal(githubConfigured({ AUTH_GITHUB_ID: 'id', AUTH_GITHUB_SECRET: 'secret' }), true)
  assert.equal(githubConfigured({ AUTH_GITHUB_ID: 'id' }), false)
  assert.equal(githubConfigured({ AUTH_GITHUB_SECRET: 'secret' }), false)
  assert.equal(githubConfigured({ AUTH_GITHUB_ID: '', AUTH_GITHUB_SECRET: 'secret' }), false)
  assert.equal(githubConfigured({}), false)
})

test('the local login signs in as github:0 only when it is on', () => {
  assert.deepEqual(LOCAL_USER, { id: 'github:0', name: 'ローカル練習用', image: '' })
  assert.deepEqual(authorizeLocal(settings({ LOCAL_DEVELOPMENT_LOGIN: '1' })), LOCAL_USER)
  assert.equal(authorizeLocal(settings()), null)
  assert.equal(authorizeLocal(settings({ LOCAL_DEVELOPMENT_LOGIN: '1', VERCEL: '1' })), null)
  assert.equal(authorizeLocal(null), null)
})

test('at a login, the session is the provider account: the account ID, not the random id Auth.js gives the user', async () => {
  let asked = 0
  const jwt = jwtCallback(async () => { asked++; return true })
  const token = { sub: '6d0c3a40-0000-4000-8000-000000000000', name: 'Mona', picture: 'p' }
  assert.deepEqual(await jwt({ token, account: { providerAccountId: 'github:42' } }), { sub: 'github:42', name: 'Mona', picture: 'p' })
  assert.deepEqual(await jwt({ token: { sub: 'x' }, account: { providerAccountId: 'github:0' } }), { sub: 'github:0' })
  // A new login is never checked against the revocations.
  assert.equal(asked, 0)
})

test('a login that says when it was made (the ID and password) starts then and lasts 30 days', async () => {
  const jwt = jwtCallback(async () => true)
  const account = { providerAccountId: 'password:6d0c3a40-0000-4000-8000-000000000000' }
  assert.deepEqual(await jwt({ token: { sub: 'x', name: 'mona' }, account, user: { id: account.providerAccountId, issuedAt: 1_700_000_000 } }),
    { sub: account.providerAccountId, name: 'mona', iat: 1_700_000_000, exp: 1_702_592_000 })
  // Not a whole number of seconds: the login starts when its cookie is sealed, as the others.
  assert.deepEqual(await jwt({ token: { sub: 'x' }, account, user: { issuedAt: 1.5 } }), { sub: account.providerAccountId })
})

test('a session read from the cookie ends when its account signed out of every device since the login', async () => {
  const calls = []
  const token = { sub: 'github:42', name: 'Mona', picture: '', iat: 1_700_000_000, exp: 1_702_592_000 }
  const revoked = answer => async (sub, iat) => { calls.push([sub, iat]); return answer }
  assert.equal(await jwtCallback(revoked(true))({ token, account: null }), null)
  assert.deepEqual(calls, [['github:42', 1_700_000_000]])
  // Not revoked, or not known in time: the session stays.
  assert.equal(await jwtCallback(revoked(false))({ token, account: null }), token)
  assert.equal(await jwtCallback(revoked(null))({ token, account: undefined }), token)
  // A token without an account or a login time is not looked up.
  calls.length = 0
  assert.deepEqual(await jwtCallback(revoked(true))({ token: { name: 'N' } }), { name: 'N' })
  assert.deepEqual(await jwtCallback(revoked(true))({ token: { sub: 'github:42' } }), { sub: 'github:42' })
  assert.deepEqual(calls, [])
})

test('the session names the account and ends when the login does, not 30 days after each read', () => {
  const session = { user: { name: 'Mona', email: null, image: null }, expires: '2099-01-01T00:00:00.000Z' }
  assert.deepEqual(sessionCallback({ session, token: { sub: 'github:42', name: 'Mona', picture: 'https://a/1', exp: 1_702_592_000 } }), {
    user: { id: 'github:42', name: 'Mona', email: null, image: 'https://a/1' },
    expires: new Date(1_702_592_000 * 1000).toISOString(),
  })
  // An empty picture (the local login) is no image.
  const local = sessionCallback({ session: { user: { name: 'L' }, expires: 'e' }, token: { sub: 'github:0', picture: '' } })
  assert.deepEqual(local, { user: { id: 'github:0', name: 'L', image: null }, expires: 'e' })
})

test('Auth.js sends the browser back to AUTH_URL, never to another site or to the localhost Next.js makes of 127.0.0.1', () => {
  const redirect = redirectCallback('http://127.0.0.1:3101')
  const baseUrl = 'http://localhost:3101'
  assert.equal(redirect({ url: '/home', baseUrl }), 'http://127.0.0.1:3101/home')
  assert.equal(redirect({ url: '/play?list=a#x', baseUrl }), 'http://127.0.0.1:3101/play?list=a#x')
  assert.equal(redirect({ url: 'http://localhost:3101/edit?a=1', baseUrl }), 'http://127.0.0.1:3101/edit?a=1')
  assert.equal(redirect({ url: 'http://127.0.0.1:3101/records', baseUrl }), 'http://127.0.0.1:3101/records')
  assert.equal(redirect({ url: 'https://attacker.invalid/home', baseUrl }), 'http://127.0.0.1:3101')
  assert.equal(redirect({ url: '//attacker.invalid/home', baseUrl }), 'http://127.0.0.1:3101')
  assert.equal(redirect({ url: 'not a url', baseUrl }), 'http://127.0.0.1:3101')
  const production = redirectCallback('https://typle.example')
  assert.equal(production({ url: 'https://typle.example/home', baseUrl: 'https://typle.example' }), 'https://typle.example/home')
})

test('only a loopback address gets the GitHub callback at AUTH_URL, as Next.js reads it as localhost', () => {
  assert.equal(redirectProxyUrl(settings()), 'http://127.0.0.1:3101/api/auth')
  assert.equal(redirectProxyUrl(readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'http://[::1]:3000' })), 'http://[::1]:3000/api/auth')
  assert.equal(redirectProxyUrl(readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'http://localhost:3000' })), undefined)
  assert.equal(redirectProxyUrl(readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'https://typle.example' })), undefined)
  assert.equal(redirectProxyUrl(null), undefined)
})

test('Auth.js answers its own paths and the providers in use; every other /api/auth path is not found', () => {
  const providers = ['github', 'local']
  for (const path of ['/api/auth/session', '/api/auth/csrf', '/api/auth/providers', '/api/auth/signout', '/api/auth/error',
    '/api/auth/signin', '/api/auth/signin/github', '/api/auth/callback/github', '/api/auth/callback/local']) {
    assert.equal(authPathKnown(path, providers), true, path)
  }
  for (const path of ['/api/auth/token', '/api/auth/local', '/api/auth/callback/ffpf', '/api/auth/signin/ffpf',
    '/api/auth/callback', '/api/auth/session/x', '/api/auth/signout/github', '/api/auth/verify-request', '/api/auth',
    '/api/auth/', '/api/auth/callback/github/x']) {
    assert.equal(authPathKnown(path, providers), false, path)
  }
  assert.equal(authPathKnown('/api/auth/callback/github', ['local']), false)
})

test('the Auth.js logger skips CredentialsSignin and logs every other error', () => {
  const lines = []
  const log = authErrorLogger((...args) => lines.push(args.join(' ')))
  const wrong = Object.assign(new Error('Read more at https://errors.authjs.dev#credentialssignin'), { type: 'CredentialsSignin' })
  log(wrong)
  assert.deepEqual(lines, [])
  const other = Object.assign(new Error('boom'), { type: 'AdapterError' })
  log(other)
  assert.equal(lines[0], '[auth][error] AdapterError: boom')
  assert.ok(lines.length >= 2)
  log(new TypeError('plain'))
  assert.ok(lines.includes('[auth][error] TypeError: plain'))
})

test('the Auth.js logger leaves out the unreadable session cookie, and only that JWTSessionError', () => {
  const lines = []
  const log = authErrorLogger((...args) => lines.push(args.join(' ')))
  // Auth.js's session action throws Error('Invalid JWT') when decode answers null, and logs it as a JWTSessionError.
  const sessionError = err => Object.assign(new Error('Read more at https://errors.authjs.dev#jwtsessionerror'),
    { type: 'JWTSessionError', cause: { err } })
  log(sessionError(new Error('Invalid JWT')))
  assert.deepEqual(lines, [])
  log(sessionError(new Error('database is down')))
  assert.equal(lines[0], '[auth][error] JWTSessionError: Read more at https://errors.authjs.dev#jwtsessionerror')
  assert.ok(lines.some(line => line.includes('database is down')))
})
