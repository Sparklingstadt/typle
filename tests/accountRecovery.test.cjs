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
const { LIMITS } = require('../src/server/limits.ts')
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
// The daily cap of all mail is kept under this run's own key, so that the runs of a day do not add up.
const settings = readLoginSettings({ AUTH_SECRET: 'typle-recovery-test-secret', AUTH_URL: origin, TYPLE_MAIL_CAP_SCOPE: prefix })
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
/** Answers forgot-password or forgot-id and runs their deferred work before returning the answer. */
async function answerDeferred(answer, request, login = withSettings) {
  const defer = collector()
  const response = await answer(request, open, login, defer)
  await defer.run()
  return response
}
/** call for forgot-password and forgot-id: their deferred work is run before the answer is returned. */
const callDeferred = (answer, request) => resend.withEnv(() => answerDeferred(answer, request))
/** Runs requests together, in one fake Resend environment (withEnv puts the environment back when it returns). */
const together = (count, run) => resend.withEnv(() => Promise.all(Array.from({ length: count }, (_, i) => run(i))))
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
    // The limits are counted before the answer, so that requests sent together cannot all pass them.
    assert.equal((await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [`mail:ip:${ip}`])).rows[0].count, 1)
    await resend.withEnv(defer.run)
    assert.equal(mailsTo(user.email).length, sent + 1, path)
  }
  // An unknown ID defers the same one task, so both paths answer alike.
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

/** The day's cap of all mail, as LIMITS.mailDaily keys it today, under scope. */
const dailyKey = scope => LIMITS.mailDaily(scope, new Date().toISOString().slice(0, 10)).key

test('forgot-password requests sent together for one ID send no more than three mails', database, async () => {
  await resend.ready
  const user = await account('fppar', { verified: true })
  const answers = await together(8, () => answerDeferred(answerForgotPassword, post('forgot-password', { loginId: user.loginId })))
  assert.deepEqual(answers.map(response => response.status), Array(8).fill(200))
  assert.equal(mailsTo(user.email).length, 3)
})

test('forgot-id requests sent together for one address send no more than three mails', database, async () => {
  await resend.ready
  const user = await account('idpar', { verified: true })
  await together(8, () => answerDeferred(answerForgotId, post('forgot-id', { email: user.email })))
  assert.equal(mailsTo(user.email).length, 3)
})

test('the eleventh resend-verification from one IP in an hour is refused, whatever the account', database, async () => {
  await resend.ready
  const ip = newIp()
  const users = []
  for (let i = 0; i < 4; i++) users.push(await account(`rsip${i}`))
  const statuses = []
  for (let i = 0; i < 11; i++) {
    const user = users[Math.floor(i / 3)]
    const response = await call(answerResendVerification, post('resend-verification', {}, { ip, headers: { Cookie: cookieOf(user.sub) } }))
    statuses.push(response.status)
  }
  assert.deepEqual(statuses, [...Array(10).fill(200), 429])
  assert.equal(mailsTo(users[3].email).length, 1)
})

test('resend-verification requests sent together send no more than three mails', database, async () => {
  await resend.ready
  const user = await account('rspar')
  const cookie = cookieOf(user.sub)
  const answers = await together(8, () =>
    answerResendVerification(post('resend-verification', {}, { headers: { Cookie: cookie } }), open, withSettings))
  assert.equal(answers.filter(response => response.status === 200).length, 3)
  assert.equal(answers.filter(response => response.status === 429).length, 5)
  assert.equal(mailsTo(user.email).length, 3)
})

test('once the day\'s cap of all mail is reached, no mail is sent', database, async () => {
  await resend.ready
  const scope = `${prefix}full`
  const full = readLoginSettings({ AUTH_SECRET: 'typle-recovery-test-secret', AUTH_URL: origin, TYPLE_MAIL_CAP_SCOPE: scope })
  await db.query(`INSERT INTO typle_auth_limits (key, count, window_start, blocked_until)
    VALUES ($1, 80, now(), now() + interval '1 day')`, [dailyKey(scope)])
  const user = await account('cap', { verified: true })
  const unverified = await account('capun')
  const run = (answer, request) => resend.withEnv(() => answerDeferred(answer, request, () => full))
  const forgot = await run(answerForgotPassword, post('forgot-password', { loginId: user.loginId }))
  assert.equal(forgot.status, 200)
  assert.deepEqual(await forgot.json(), {})
  const ids = await run(answerForgotId, post('forgot-id', { email: user.email }))
  assert.equal(ids.status, 200)
  assert.equal(mailsTo(user.email).length, 0)
  const again = await run(answerResendVerification, post('resend-verification', {}, { headers: { Cookie: cookieOf(unverified.sub) } }))
  assert.equal(again.status, 429)
  assert.deepEqual(await again.json(), { error: 'tooManyRequests' })
  assert.equal(mailsTo(unverified.email).length, 0)
})

test('each mail counts toward the day\'s cap of all mail', database, async () => {
  await resend.ready
  const user = await account('capcount', { verified: true })
  const before = (await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [dailyKey(prefix)])).rows[0]?.count ?? 0
  await callDeferred(answerForgotPassword, post('forgot-password', { loginId: user.loginId }))
  // An unknown ID sends nothing, so it takes nothing from the cap.
  await callDeferred(answerForgotPassword, post('forgot-password', { loginId: `${prefix}capnobody` }))
  const { rows } = await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [dailyKey(prefix)])
  assert.equal(rows[0].count, before + 1)
})

test('a reset lifts the lockout of the ID, so the new password signs in', database, async () => {
  const user = await account('unlock', { verified: true })
  for (let i = 0; i < 5; i++) await authorizePassword(db, { loginId: user.loginId, password: `wrong ${i} password` }, newIp())
  assert.equal(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, newIp()), null)
  const token = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  const response = await call(answerResetPassword, post('reset-password', { token, password: NEW_PASSWORD }))
  assert.equal(response.status, 200)
  assert.deepEqual(await authorizePassword(db, { loginId: user.loginId, password: NEW_PASSWORD }, newIp()),
    { id: user.sub, name: user.loginId, image: '' })
})

test('a reset spends the account\'s other reset links', database, async () => {
  const user = await account('spend')
  const first = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  const second = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  const verify = await issueToken(db, { userId: user.id, kind: 'verify', email: user.email, ttlSeconds: 3600 })
  assert.equal((await call(answerResetPassword, post('reset-password', { token: first, password: NEW_PASSWORD }))).status, 200)
  const other = await call(answerResetPassword, post('reset-password', { token: second, password: PASSWORD }))
  assert.equal(other.status, 400)
  assert.deepEqual(await other.json(), { error: 'invalidToken' })
  // A link that confirms the address is not a reset link: it stays usable.
  assert.equal((await call(answerVerify, post('verify', { token: verify }))).status, 200)
})

test('a change of password spends the account\'s reset links', database, async () => {
  const user = await account('chgspend')
  const token = await issueToken(db, { userId: user.id, kind: 'reset', email: user.email, ttlSeconds: 1800 })
  const changed = await call(answerChangePassword, post('change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { headers: { Cookie: cookieOf(user.sub) } }))
  assert.equal(changed.status, 200)
  const reset = await call(answerResetPassword, post('reset-password', { token, password: 'another long password' }))
  assert.equal(reset.status, 400)
  assert.deepEqual(await reset.json(), { error: 'invalidToken' })
})

test('change-password of a locked ID is answered tooManyRequests', database, async () => {
  const user = await account('chglock')
  for (let i = 0; i < 5; i++) await authorizePassword(db, { loginId: user.loginId, password: `wrong ${i} password` }, newIp())
  const response = await call(answerChangePassword, post('change-password',
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { headers: { Cookie: cookieOf(user.sub) } }))
  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), { error: 'tooManyRequests' })
})

test('a change of password whose writes fail leaves the password as it was', database, async () => {
  const user = await account('chgfail')
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
  const original = console.error
  console.error = () => {}
  let response
  try {
    response = await resend.withEnv(() => answerChangePassword(post('change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { headers: { Cookie: cookieOf(user.sub) } }), () => failing, withSettings))
  } finally {
    console.error = original
  }
  assert.equal(response.status, 503)
  assert.ok(await authorizePassword(db, { loginId: user.loginId, password: PASSWORD }, newIp()))
})
