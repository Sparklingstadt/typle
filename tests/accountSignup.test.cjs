require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerSignup } = require('../src/server/accountApi.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { findUserByLoginId } = require('../src/server/users.ts')
const { verifyPassword } = require('../src/server/password.ts')
const { fakeResend } = require('./fakeResendServer.cjs')

// POST /api/account/signup against a real database and a fake Resend. Runs as npm run verify does:
// `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
const origin = 'http://127.0.0.1:3102'
const settings = readLoginSettings({ AUTH_SECRET: 'typle-signup-test-secret', AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const resend = fakeResend()
after(async () => {
  await resend.close()
  if (!db) return
  // Tokens go with their users (ON DELETE CASCADE).
  await db.query('DELETE FROM typle_users WHERE login_id LIKE $1', [`${prefix}%`])
  await db.query('DELETE FROM typle_auth_limits WHERE key LIKE $1', [`%${prefix}%`])
  await db.end()
})

const PASSWORD = 'correct horse battery'
let ips = 0
/** A new client address, so that the tests do not share the sign-up limit. */
const newIp = () => `test-${prefix}-${++ips}`

function signup(body, { ip = newIp(), headers = {} } = {}) {
  return new Request(`${origin}/api/account/signup`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const call = request => resend.withEnv(() => answerSignup(request, open, withSettings))

test('a sign-up creates the account and mails the confirmation link in the reader\'s language', database, async () => {
  await resend.ready
  const before = resend.received.length
  const loginId = `${prefix}Ok`
  const email = ` ${prefix}OK@Example.com `
  const response = await call(signup({ loginId, email, password: PASSWORD }, { headers: { Cookie: 'NEXT_LOCALE=en' } }))
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { loginId: loginId.toLowerCase(), mailSent: true })
  const user = await findUserByLoginId(db, loginId.toLowerCase())
  assert.ok(user)
  assert.equal(user.email, `${prefix}ok@example.com`)
  assert.equal(user.locale, 'en')
  assert.equal(user.emailVerifiedAt, null)
  assert.ok(await verifyPassword(PASSWORD, user.passwordHash))
  assert.equal(resend.received.length, before + 1)
  const mail = resend.received.at(-1).body
  assert.deepEqual(mail.to, [`${prefix}ok@example.com`])
  assert.match(mail.text, new RegExp(`${origin.replace(/[.]/g, '\\.')}/verify-email\\?token=[A-Za-z0-9_-]{43}`))
  const { rows } = await db.query("SELECT kind FROM typle_email_tokens WHERE user_id = $1", [user.id])
  assert.deepEqual(rows.map(row => row.kind), ['verify'])
})

test('the same ID in other case is taken', database, async () => {
  const first = await call(signup({ loginId: `${prefix}dup`, email: `${prefix}a@example.com`, password: PASSWORD }))
  assert.equal(first.status, 201)
  const second = await call(signup({ loginId: `${prefix}DUP`, email: `${prefix}b@example.com`, password: PASSWORD }))
  assert.equal(second.status, 409)
  assert.deepEqual(await second.json(), { error: 'loginIdTaken' })
})

test('the sixth sign-up from one address in an hour is refused', database, async () => {
  const ip = newIp()
  for (let i = 1; i <= 5; i++) {
    const response = await call(signup({ loginId: `${prefix}lim${i}`, email: `${prefix}lim${i}@example.com`, password: PASSWORD }, { ip }))
    assert.equal(response.status, 201, `sign-up ${i}`)
  }
  const sixth = await call(signup({ loginId: `${prefix}lim6`, email: `${prefix}lim6@example.com`, password: PASSWORD }, { ip }))
  assert.equal(sixth.status, 429)
  assert.deepEqual(await sixth.json(), { error: 'tooManyRequests' })
  assert.equal(await findUserByLoginId(db, `${prefix}lim6`), null)
})

test('refused shapes are answered with their key and do not count', database, async () => {
  const ip = newIp()
  const cases = [
    [{ loginId: 'ab', email: `${prefix}x@example.com`, password: PASSWORD }, 'loginIdFormat'],
    [{ loginId: `${prefix}shape`, email: `${prefix}x@example.com`, password: 'short' }, 'passwordLength'],
    [{ loginId: `${prefix}same`, email: `${prefix}x@example.com`, password: `${prefix}SAME` }, 'passwordSameAsId'],
    [{ loginId: `${prefix}shape`, email: 'not-an-address', password: PASSWORD }, 'emailFormat'],
    [{ loginId: 1, email: `${prefix}x@example.com`, password: PASSWORD }, 'invalidRequest'],
    ['{', 'invalidRequest'],
  ]
  for (const [body, key] of cases) {
    const response = await call(signup(body, { ip }))
    assert.equal(response.status, 400, key)
    assert.deepEqual(await response.json(), { error: key })
  }
  const { rows } = await db.query('SELECT 1 FROM typle_auth_limits WHERE key = $1', [`signup:ip:${ip}`])
  assert.equal(rows.length, 0)
})

test('a sign-up without the app\'s Origin or JSON is forbidden', database, async () => {
  const body = { loginId: `${prefix}orig`, email: `${prefix}orig@example.com`, password: PASSWORD }
  const noOrigin = await call(signup(body, { headers: { Origin: '' } }))
  assert.equal(noOrigin.status, 403)
  assert.deepEqual(await noOrigin.json(), { error: 'forbiddenRequest' })
  const other = await call(signup(body, { headers: { Origin: 'https://evil.example' } }))
  assert.equal(other.status, 403)
  const form = await call(signup(body, { headers: { 'Content-Type': 'text/plain' } }))
  assert.equal(form.status, 403)
  assert.equal(await findUserByLoginId(db, `${prefix}orig`), null)
})

test('a sign-up whose mail fails still creates the account, with mailSent false', database, async () => {
  await resend.ready
  resend.status = 500
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  let response
  try {
    response = await call(signup({ loginId: `${prefix}nomail`, email: `${prefix}nomail@example.com`, password: PASSWORD }))
  } finally {
    console.error = original
    resend.status = 200
  }
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { loginId: `${prefix}nomail`, mailSent: false })
  assert.ok(await findUserByLoginId(db, `${prefix}nomail`))
  // The failure is reported, never with the link and its token.
  assert.ok(errors.some(line => line.includes('mail.send')), errors.join('\n'))
  assert.ok(errors.every(line => !line.includes('token=')), errors.join('\n'))
})

test('the sign-up answers 503 without the login settings and 405 to another method', async () => {
  const unset = await answerSignup(signup({}), open, () => null)
  assert.equal(unset.status, 503)
  assert.deepEqual(await unset.json(), { error: 'authUnavailable' })
  const get = await answerSignup(new Request(`${origin}/api/account/signup`), open, withSettings)
  assert.equal(get.status, 405)
})
