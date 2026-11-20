require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const {
  answerVerify, answerResendVerification, answerForgotPassword, answerResetPassword, answerForgotId, answerChangePassword,
  answerMe,
} = require('../src/server/accountRecovery.ts')
const { revokedSoon } = require('../src/server/account.ts')
const { issueToken } = require('../src/server/emailTokens.ts')
const { loginIdsMail } = require('../src/server/mail.ts')
const { hashPassword } = require('../src/server/password.ts')
const { authorizePassword } = require('../src/server/passwordLogin.ts')
const { newSession, sealSession } = require('../src/server/session.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { accountIdOf, createUser, findUserById, markEmailVerified } = require('../src/server/users.ts')
const { fakeResend } = require('./fakeResendServer.cjs')

// Confirming an address, resetting and changing a password, and mailing an address's IDs (/api/account/*), against a
// real database and a fake Resend. Runs as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
const origin = 'http://127.0.0.1:3103'
const settings = readLoginSettings({ AUTH_SECRET: 'typle-recovery-test-secret', AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const resend = fakeResend()
const owners = []
after(async () => {
  await resend.close()
  if (!db) return
  // Tokens go with their users (ON DELETE CASCADE).
  await db.query('DELETE FROM typle_users WHERE login_id LIKE $1', [`${prefix}%`])
  await db.query('DELETE FROM typle_auth_limits WHERE key LIKE $1', [`%${prefix}%`])
  await db.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [owners])
  await db.end()
})

const PASSWORD = 'correct horse battery'
const NEW_PASSWORD = 'staple battery horse'
let ips = 0
/** A new client address, so that the tests do not share the IP limits. */
const newIp = () => `test-${prefix}-${++ips}`

/** An account prefix+name with PASSWORD, its address verified when verified is true. */
async function account(name, { verified = false, locale = 'ja', email } = {}) {
  const loginId = `${prefix}${name}`
  const address = email ?? `${loginId}@example.com`
  const { id } = await createUser(db, { loginId, email: address, passwordHash: await hashPassword(PASSWORD), locale })
  if (verified) await markEmailVerified(db, id, address)
  owners.push(`password:${id}`)
  return { id, loginId, email: address, sub: `password:${id}` }
}

/** The login cookie of sub, issued at issuedAt (Unix seconds). */
const cookieOf = (sub, issuedAt = Math.floor(Date.now() / 1000) - 60) =>
  `typle-session=${sealSession(settings.sessionKey, newSession(sub, 'N', '', issuedAt))}`

function post(path, body, { ip = newIp(), headers = {} } = {}) {
  return new Request(`${origin}/api/account/${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const call = (answer, request) => resend.withEnv(() => answer(request, open, withSettings))

/** A Defer that holds the tasks until run() runs them, in order. */
function collector() {
  const tasks = []
  const defer = task => { tasks.push(task) }
  defer.tasks = tasks
  defer.run = async () => { while (tasks.length) await tasks.shift()() }
  return defer
}
/** call for forgot-password and forgot-id: their deferred work is run before the answer is returned. */
const callDeferred = (answer, request) => resend.withEnv(async () => {
  const defer = collector()
  const response = await answer(request, open, withSettings, defer)
  await defer.run()
  return response
})
const mailsTo = address => resend.received.filter(mail => mail.body.to[0] === address)
const tokenIn = mail => mail.body.text.match(/token=([A-Za-z0-9_-]{43})/)[1]

test('verify confirms the address once; a second use is invalidToken', database, async () => {
  const user = await account('ver')
  const token = await issueToken(db, { userId: user.id, kind: 'verify', email: user.email, ttlSeconds: 3600 })
  const first = await call(answerVerify, post('verify', { token }))
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), {})
  assert.ok((await findUserById(db, user.id)).emailVerifiedAt)
  const second = await call(answerVerify, post('verify', { token }))
  assert.equal(second.status, 400)
  assert.deepEqual(await second.json(), { error: 'invalidToken' })
})

test('a reset token does not verify', database, async () => {
  const user = await account('verreset')
  const token = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  const response = await call(answerVerify, post('verify', { token }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalidToken' })
  assert.equal((await findUserById(db, user.id)).emailVerifiedAt, null)
  const shape = await call(answerVerify, post('verify', { token: 1 }))
  assert.equal(shape.status, 400)
  assert.deepEqual(await shape.json(), { error: 'invalidRequest' })
})

test('forgot-password answers 200 {} for every ID and mails only a verified address', database, async () => {
  await resend.ready
  const unverified = await account('fpun')
  const verified = await account('fpok', { verified: true })
  for (const loginId of [`${prefix}fpnone`, unverified.loginId, verified.loginId.toUpperCase(), 'x']) {
    const response = await callDeferred(answerForgotPassword, post('forgot-password', { loginId }))
    assert.equal(response.status, 200, loginId)
    assert.deepEqual(await response.json(), {})
  }
  assert.equal(mailsTo(unverified.email).length, 0)
  const mails = mailsTo(verified.email)
  assert.equal(mails.length, 1)
  assert.match(mails[0].body.text, new RegExp(`${origin.replace(/[.]/g, '\\.')}/reset-password\\?token=[A-Za-z0-9_-]{43}`))
  const { rows } = await db.query("SELECT kind FROM typle_email_tokens WHERE user_id = $1", [verified.id])
  assert.deepEqual(rows.map(row => row.kind), ['reset'])
})

test('the fourth forgot-password in an hour for one ID sends no mail', database, async () => {
  await resend.ready
  const user = await account('fplim', { verified: true })
  for (let i = 1; i <= 4; i++) {
    const response = await callDeferred(answerForgotPassword, post('forgot-password', { loginId: user.loginId }))
    assert.equal(response.status, 200, `request ${i}`)
    assert.deepEqual(await response.json(), {})
  }
  assert.equal(mailsTo(user.email).length, 3)
})

test('forgot-password and forgot-id answer before the token, the mail and the counting', database, async () => {
  await resend.ready
  const user = await account('defer', { verified: true })
  for (const [answer, path, body] of [
    [answerForgotPassword, 'forgot-password', { loginId: user.loginId }],
    [answerForgotId, 'forgot-id', { email: user.email }],
  ]) {
    const ip = newIp()
    const defer = collector()
    const sent = mailsTo(user.email).length
    const response = await resend.withEnv(() => answer(post(path, body, { ip }), open, withSettings, defer))
    assert.equal(response.status, 200, path)
    assert.deepEqual(await response.json(), {})
    assert.equal(defer.tasks.length, 1, path)
    assert.equal(mailsTo(user.email).length, sent, path)
    const { rows } = await db.query('SELECT 1 FROM typle_auth_limits WHERE key = $1', [`mail:ip:${ip}`])
    assert.equal(rows.length, 0, path)
    await resend.withEnv(defer.run)
    assert.equal(mailsTo(user.email).length, sent + 1, path)
    assert.equal((await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [`mail:ip:${ip}`])).rows[0].count, 1)
  }
  // An unknown ID defers the same one task (the counting), so both paths answer alike.
  const defer = collector()
  await answerForgotPassword(post('forgot-password', { loginId: `${prefix}nobody` }), open, withSettings, defer)
  assert.equal(defer.tasks.length, 1)
  await defer.run()
})

test('the fourth forgot-id in an hour for one address sends no mail', database, async () => {
  await resend.ready
  const user = await account('idlim', { verified: true })
  for (let i = 1; i <= 4; i++) {
    const response = await callDeferred(answerForgotId, post('forgot-id', { email: user.email }))
    assert.equal(response.status, 200, `request ${i}`)
  }
  assert.equal(mailsTo(user.email).length, 3)
})

test('a reset whose writes fail leaves the password and the link as they were', database, async () => {
  const user = await account('resetfail')
  const token = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  // A pool whose connections fail on the revocation, the last write of the transaction.
  const failing = {
    query: (...args) => db.query(...args),
    connect: async () => {
      const client = await db.connect()
      return {
        query: (sql, ...rest) => /typle_session_revocations/.test(sql) ? Promise.reject(new Error('revocation failed')) : client.query(sql, ...rest),
        release: destroy => client.release(destroy),
      }
    },
  }
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  let response
  try {
    response = await resend.withEnv(() => answerResetPassword(post('reset-password', { token, password: NEW_PASSWORD }), () => failing, withSettings))
  } finally {
    console.error = original
  }
  assert.equal(response.status, 503)
  assert.ok(errors.some(line => line.includes('account.resetPassword')), errors.join('\n'))
  assert.ok(errors.every(line => !line.includes(token)), errors.join('\n'))
  assert.ok(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, newIp()))
  const retry = await call(answerResetPassword, post('reset-password', { token, password: NEW_PASSWORD }))
  assert.equal(retry.status, 200)
})

test('reset-password sets the new password, verifies the address and revokes the logins before it', database, async () => {
  await resend.ready
  const user = await account('reset')
  const token = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  // The password may not be the token owner's ID; the token stays usable after that refusal.
  const same = await call(answerResetPassword, post('reset-password', { token, password: user.loginId.toUpperCase() }))
  assert.equal(same.status, 400)
  assert.deepEqual(await same.json(), { error: 'passwordSameAsId' })
  const short = await call(answerResetPassword, post('reset-password', { token, password: 'short' }))
  assert.equal(short.status, 400)
  assert.deepEqual(await short.json(), { error: 'passwordLength' })

  const response = await call(answerResetPassword, post('reset-password', { token, password: NEW_PASSWORD }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { loginId: user.loginId })
  const ip = newIp()
  assert.equal(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, ip), null)
  assert.deepEqual(await authorizePassword(db, { loginId: user.loginId, password: NEW_PASSWORD }, ip),
    { id: user.sub, name: user.loginId, image: '' })
  assert.ok((await findUserById(db, user.id)).emailVerifiedAt)
  // A cookie made before the reset is revoked; one made by the sign-in right after it is not.
  const issuedBefore = Math.floor(Date.now() / 1000) - 60
  assert.equal(await revokedSoon(open, user.sub, issuedBefore), true)
  assert.equal(await revokedSoon(open, user.sub, Math.floor(Date.now() / 1000)), false)

  const again = await call(answerResetPassword, post('reset-password', { token, password: NEW_PASSWORD }))
  assert.equal(again.status, 400)
  assert.deepEqual(await again.json(), { error: 'invalidToken' })
})

test('a verify token does not reset a password', database, async () => {
  const user = await account('resetver')
  const token = await issueToken(db, { userId: user.id, kind: 'verify', email: user.email, ttlSeconds: 3600 })
  const response = await call(answerResetPassword, post('reset-password', { token, password: NEW_PASSWORD }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalidToken' })
})

test('forgot-id mails the IDs of a verified address in the reader\'s language, and nothing to an unverified one', database, async () => {
  await resend.ready
  const email = `${prefix}ids@example.com`
  const a = await account('ida', { verified: true, email })
  const b = await account('idb', { verified: true, email })
  await account('idc', { email })
  const lone = await account('idlone')
  const response = await callDeferred(answerForgotId, post('forgot-id', { email: ` ${email.toUpperCase()} ` }, { headers: { Cookie: 'NEXT_LOCALE=en' } }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {})
  const mails = mailsTo(email)
  assert.equal(mails.length, 1)
  const expected = loginIdsMail('en', [a.loginId, b.loginId])
  assert.equal(mails[0].body.subject, expected.subject)
  assert.equal(mails[0].body.text, expected.text)
  for (const address of [lone.email, `${prefix}nobody@example.com`, 'not-an-address']) {
    const other = await callDeferred(answerForgotId, post('forgot-id', { email: address }))
    assert.equal(other.status, 200, address)
    assert.deepEqual(await other.json(), {})
  }
  assert.equal(mailsTo(lone.email).length, 0)
})

test('change-password refuses a wrong current password and counts it as a failed login', database, async () => {
  const user = await account('chg')
  const ip = newIp()
  const wrong = await call(answerChangePassword, post('change-password',
    { currentPassword: 'wrong password!!', newPassword: NEW_PASSWORD }, { ip, headers: { Cookie: cookieOf(user.sub) } }))
  assert.equal(wrong.status, 400)
  assert.deepEqual(await wrong.json(), { error: 'wrongPassword' })
  const { rows } = await db.query('SELECT key, count FROM typle_auth_limits WHERE key = ANY($1) ORDER BY key',
    [[`login-fail:id:${user.loginId}`, `login-fail:ip:${ip}`]])
  assert.deepEqual(rows.map(row => [row.key, row.count]), [[`login-fail:id:${user.loginId}`, 1], [`login-fail:ip:${ip}`, 1]])
  assert.ok(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, newIp()))
})

test('change-password sets the new password and revokes the logins before it', database, async () => {
  const user = await account('chgok')
  const cookie = cookieOf(user.sub)
  const sameId = await call(answerChangePassword, post('change-password',
    { currentPassword: PASSWORD, newPassword: user.loginId }, { headers: { Cookie: cookie } }))
  assert.equal(sameId.status, 400)
  assert.deepEqual(await sameId.json(), { error: 'passwordSameAsId' })
  const response = await call(answerChangePassword, post('change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { headers: { Cookie: cookie } }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { loginId: user.loginId })
  assert.equal(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, newIp()), null)
  assert.ok(await authorizePassword(db, { loginId: user.loginId, password: NEW_PASSWORD }, newIp()))
  assert.equal(await revokedSoon(open, user.sub, Math.floor(Date.now() / 1000) - 60), true)
  assert.equal(await revokedSoon(open, user.sub, Math.floor(Date.now() / 1000)), false)
  // The old cookie no longer works.
  const again = await call(answerChangePassword, post('change-password',
    { currentPassword: NEW_PASSWORD, newPassword: PASSWORD }, { headers: { Cookie: cookie } }))
  assert.equal(again.status, 401)
})

test('change-password and resend-verification need a login with an ID and a password', database, async () => {
  const none = await call(answerChangePassword, post('change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }))
  assert.equal(none.status, 401)
  assert.deepEqual(await none.json(), { error: 'loginRequired' })
  const github = cookieOf('github:1')
  const other = await call(answerChangePassword, post('change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { headers: { Cookie: github } }))
  assert.equal(other.status, 400)
  assert.deepEqual(await other.json(), { error: 'notPasswordAccount' })
  const resendNone = await call(answerResendVerification, post('resend-verification', {}))
  assert.equal(resendNone.status, 401)
  const resendOther = await call(answerResendVerification, post('resend-verification', {}, { headers: { Cookie: github } }))
  assert.equal(resendOther.status, 400)
  assert.deepEqual(await resendOther.json(), { error: 'notPasswordAccount' })
})

test('resend-verification mails a new link, three times an hour, and tells an already verified address', database, async () => {
  await resend.ready
  const user = await account('rsv', { locale: 'fr' })
  const cookie = cookieOf(user.sub)
  for (let i = 1; i <= 3; i++) {
    const response = await call(answerResendVerification, post('resend-verification', {}, { headers: { Cookie: cookie } }))
    assert.equal(response.status, 200, `request ${i}`)
    assert.deepEqual(await response.json(), { mailSent: true })
  }
  const fourth = await call(answerResendVerification, post('resend-verification', {}, { headers: { Cookie: cookie } }))
  assert.equal(fourth.status, 429)
  assert.deepEqual(await fourth.json(), { error: 'tooManyRequests' })
  const mails = mailsTo(user.email)
  assert.equal(mails.length, 3)
  const verify = await call(answerVerify, post('verify', { token: tokenIn(mails.at(-1)) }))
  assert.equal(verify.status, 200)
  const done = await call(answerResendVerification, post('resend-verification', {}, { headers: { Cookie: cookie } }))
  assert.equal(done.status, 200)
  assert.deepEqual(await done.json(), { alreadyVerified: true })
})

test('me answers the signed-in password account, with whether its address is confirmed', database, async () => {
  const get = headers => new Request(`${origin}/api/account/me`, { headers })
  const user = await account('me')
  const cookie = cookieOf(user.sub)
  const before = await answerMe(get({ Cookie: cookie }), open, withSettings)
  assert.equal(before.status, 200)
  assert.equal(before.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await before.json(), { loginId: user.loginId, email: user.email, emailVerified: false })
  await markEmailVerified(db, user.id, user.email)
  const after = await answerMe(get({ Cookie: cookie }), open, withSettings)
  assert.deepEqual(await after.json(), { loginId: user.loginId, email: user.email, emailVerified: true })
  const none = await answerMe(get({}), open, withSettings)
  assert.equal(none.status, 401)
  assert.deepEqual(await none.json(), { error: 'loginRequired' })
  const github = await answerMe(get({ Cookie: cookieOf('github:1') }), open, withSettings)
  assert.equal(github.status, 400)
  assert.deepEqual(await github.json(), { error: 'notPasswordAccount' })
})

test('me answers 503 without the login settings and 405 to another method', async () => {
  const unset = await answerMe(new Request(`${origin}/api/account/me`), open, () => null)
  assert.equal(unset.status, 503)
  const posted = await answerMe(post('me', {}), open, withSettings)
  assert.equal(posted.status, 405)
  assert.equal(posted.headers.get('Allow'), 'GET, HEAD')
})

test('accountIdOf takes the UUID out of a password: account only', () => {
  const id = randomUUID()
  assert.equal(accountIdOf(`password:${id}`), id)
  assert.equal(accountIdOf('github:1'), null)
  assert.equal(accountIdOf('password:not-a-uuid'), null)
})

test('each request answers 503 without the login settings, 405 to GET, and 403 without the app\'s Origin or JSON', async () => {
  const answers = [
    [answerVerify, 'verify'], [answerResendVerification, 'resend-verification'], [answerForgotPassword, 'forgot-password'],
    [answerResetPassword, 'reset-password'], [answerForgotId, 'forgot-id'], [answerChangePassword, 'change-password'],
  ]
  for (const [answer, path] of answers) {
    const unset = await answer(post(path, {}), open, () => null)
    assert.equal(unset.status, 503, path)
    assert.deepEqual(await unset.json(), { error: 'authUnavailable' })
    const get = await answer(new Request(`${origin}/api/account/${path}`), open, withSettings)
    assert.equal(get.status, 405, path)
    const foreign = await answer(post(path, {}, { headers: { Origin: 'https://evil.example' } }), open, withSettings)
    assert.equal(foreign.status, 403, path)
    const text = await answer(post(path, {}, { headers: { 'Content-Type': 'text/plain' } }), open, withSettings)
    assert.equal(text.status, 403, path)
  }
})
