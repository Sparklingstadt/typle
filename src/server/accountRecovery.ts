import type { Pool, PoolClient } from 'pg'
import { emailProblem, loginIdProblem, normalizeEmail, normalizeLoginId, passwordProblem } from '../lib/accountRules'
import { signedIn } from './account'
import { readerLocale, readFields } from './accountApi'
import { consumeToken, issueToken, peekToken } from './emailTokens'
import { clientIp, countHit, isBlocked, LIMITS, type Limit } from './limits'
import { loginIdsMail, resetMail, sendMail, verifyMail, type Mail } from './mail'
import { hashPassword } from './password'
import { authorizePassword } from './passwordLogin'
import { reportFailure } from './report'
import { jsonContent, sameOrigin } from './request'
import { methodNotAllowed, refuse, reply } from './response'
import { readLoginSettings, type LoginSettings } from './settings'
import { accountIdOf, findUserById, findUserByLoginId, findVerifiedLoginIdsByEmail, markEmailVerified, setPassword, type UserRow } from './users'

// The requests that recover or look after an account with an ID and a password (/api/account/*): confirming its
// address, mailing the link again, resetting a forgotten password, mailing the IDs of an address, and changing the
// password. Each is a POST with a JSON body from the app's own Origin.
//
// The mails are limited to 3 an hour for one ID or address and 10 an hour for one IP (LIMITS.mailTarget, mailIp): a
// limit is checked before the work and counted after the attempt to send. forgot-password and forgot-id always answer
// 200 {}, also when limited or when there is nothing to send, so they never tell whether an ID or an address exists.
// For the same reason their token, mail and counting run after the answer (Defer: next/server's after in the routes),
// so the time to answer does not tell either.

/** How long the link that confirms an address can be used: 24 hours. */
const VERIFY_TTL_SECONDS = 24 * 60 * 60

/** How long the link that sets a new password can be used: 30 minutes. */
const RESET_TTL_SECONDS = 30 * 60

/**
 * Schedules work to run after the answer is sent: next/server's after in the routes (waitUntil on Vercel), a collector
 * the tests can await. The task catches and reports its own failures.
 */
export type Defer = (task: () => Promise<void>) => void

type Accepted<Name extends string> = { login: LoginSettings, fields: Record<Name, string> }

/**
 * The login settings and the fields of a request, or the answer to refuse it with: 503 authUnavailable without the
 * settings, 405 to another method, 403 forbiddenRequest without the app's Origin or a JSON body, and 400
 * invalidRequest for a body that is not an object whose fields names are strings.
 */
async function accept<Name extends string>(request: Request, settings: () => LoginSettings | null,
  names: readonly Name[]): Promise<Accepted<Name> | { refusal: Response }> {
  const login = settings()
  if (!login) return { refusal: refuse(503, 'authUnavailable') }
  if (request.method !== 'POST') return { refusal: methodNotAllowed(['POST']) }
  if (!sameOrigin(request, login.origin) || !jsonContent(request)) return { refusal: refuse(403, 'forbiddenRequest') }
  const fields = await readFields(request, names)
  if (!fields) return { refusal: refuse(400, 'invalidRequest') }
  return { login, fields }
}

/**
 * Whether a mail to target may be sent now: neither target's nor the request's IP limit is blocked. The two limits are
 * returned for countMail.
 */
async function mailAllowed(db: Pool, request: Request, target: string): Promise<{ allowed: boolean, limits: Limit[] }> {
  const limits = [LIMITS.mailTarget(target), LIMITS.mailIp(clientIp(request))]
  const blocked = await Promise.all(limits.map(limit => isBlocked(db, limit.key)))
  return { allowed: !blocked.some(Boolean), limits }
}

/** Counts an attempt against the mail limits; a hit that cannot be counted only allows one more mail. */
async function countMail(db: Pool, request: Request, limits: Limit[], operation: string): Promise<void> {
  try {
    for (const limit of limits) await countHit(db, limit)
  } catch (error) {
    reportFailure(request, error, operation)
  }
}

/** Sends mail to address; false (with the failure reported) when it cannot be sent. */
async function trySend(request: Request, address: string, mail: () => Promise<Mail>): Promise<boolean> {
  try {
    const { subject, text } = await mail()
    await sendMail(address, subject, text)
    return true
  } catch (error) {
    // sendMail's errors never hold the mail, so a link's token is not in the log.
    reportFailure(request, error, 'mail.send')
    return false
  }
}

/**
 * Revokes every login of the account made before now (typle_session_revocations), after its password was reset or
 * changed. revokedBy counts a login in the very second of revoked_at as revoked, because a session's iat is in whole
 * seconds; the screen signs in again right after this answer, so writing now() would revoke that new login too when it
 * falls in the same second. revoked_at is therefore written one second back: every login of an earlier second is
 * still revoked, the new one is not, and only a login made in the second just before the change could outlive it.
 * GREATEST keeps a later revocation (a sign-out of every device in that second) from being moved back. iat comes from
 * the app's clock and revoked_at from the database's, so a skew between them of a second or more moves this window.
 */
async function revokeEarlierLogins(db: Pick<Pool, 'query'>, sub: string): Promise<void> {
  await db.query(`INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, now() - interval '1 second')
    ON CONFLICT (owner_id) DO UPDATE
    SET revoked_at = GREATEST(typle_session_revocations.revoked_at, EXCLUDED.revoked_at)`, [sub])
}

/**
 * The account with an ID and a password the request is signed in as, or the answer to refuse it with: signedIn's
 * refusals, 400 notPasswordAccount for a login of another kind (GitHub), and 401 loginRequired when the account is
 * gone.
 */
async function signedInAccount(request: Request, db: Pool, login: LoginSettings,
  operation: string): Promise<{ user: UserRow, sub: string } | { refusal: Response }> {
  const session = await signedIn(request, db, login)
  if ('refusal' in session) return session
  const id = accountIdOf(session.user.sub)
  if (!id) return { refusal: refuse(400, 'notPasswordAccount') }
  let user: UserRow | null
  try {
    user = await findUserById(db, id)
  } catch (error) {
    reportFailure(request, error, operation)
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
  return user ? { user, sub: session.user.sub } : { refusal: refuse(401, 'loginRequired') }
}

/**
 * Runs work in one transaction on one connection of db: committed when it returns true, rolled back when it returns
 * false or throws (the error is thrown on).
 */
async function inTransaction(db: Pool, work: (client: PoolClient) => Promise<boolean>): Promise<boolean> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const commit = await work(client)
    await client.query(commit ? 'COMMIT' : 'ROLLBACK')
    client.release()
    return commit
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    client.release(true)
    throw error
  }
}

/** The pool of open, or the answer 503 databaseUnavailable when there is none. */
function openDb(request: Request, open: () => Pool, operation: string): { db: Pool } | { refusal: Response } {
  try {
    return { db: open() }
  } catch (error) {
    reportFailure(request, error, operation)
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
}

/**
 * POST /api/account/verify { token }: confirms the address of the link's account (once; the address must still be the
 * account's). 200 {}, or 400 invalidToken for a token that is unknown, used, expired or of another kind.
 */
export async function answerVerify(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const accepted = await accept(request, settings, ['token'] as const)
  if ('refusal' in accepted) return accepted.refusal
  const opened = openDb(request, open, 'account.verify')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  try {
    const token = await consumeToken(db, accepted.fields.token, 'verify')
    if (!token) return refuse(400, 'invalidToken')
    await markEmailVerified(db, token.userId, token.email)
  } catch (error) {
    reportFailure(request, error, 'account.verify')
    return refuse(503, 'databaseUnavailable')
  }
  return reply(200, {})
}

/**
 * POST /api/account/resend-verification {}: mails the signed-in account a new link that confirms its address, in the
 * account's language. 200 { alreadyVerified: true } when it is confirmed, 429 tooManyRequests over the mail limits
 * (counted for the login ID), and otherwise 200 { mailSent }. Needs a login with an ID and a password (400
 * notPasswordAccount for another kind).
 */
export async function answerResendVerification(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const accepted = await accept(request, settings, [] as const)
  if ('refusal' in accepted) return accepted.refusal
  const { login } = accepted
  const opened = openDb(request, open, 'account.resendVerification')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  const account = await signedInAccount(request, db, login, 'account.resendVerification')
  if ('refusal' in account) return account.refusal
  const { user } = account
  if (user.emailVerifiedAt) return reply(200, { alreadyVerified: true })
  let limits: Limit[]
  try {
    const check = await mailAllowed(db, request, user.loginId)
    if (!check.allowed) return refuse(429, 'tooManyRequests')
    limits = check.limits
  } catch (error) {
    reportFailure(request, error, 'account.resendVerification')
    return refuse(503, 'databaseUnavailable')
  }
  const mailSent = await trySend(request, user.email, async () => {
    const token = await issueToken(db, { userId: user.id, kind: 'verify', email: user.email, ttlSeconds: VERIFY_TTL_SECONDS })
    return verifyMail(user.locale, `${login.origin}/verify-email?token=${token}`)
  })
  await countMail(db, request, limits, 'account.resendVerification')
  return reply(200, { mailSent })
}

/**
 * POST /api/account/forgot-password { loginId }: mails the link that sets a new password (30 minutes) in the account's
 * language, when the ID has an account with a confirmed address and the mail limits (counted for the ID) allow it.
 * Always 200 {} for a well-formed body, also for an unknown ID; each such request that is not limited counts against
 * the limits, whether or not a mail was sent. The token, the mail and the counting run in defer, after the answer.
 */
export async function answerForgotPassword(request: Request, open: () => Pool,
  settings: () => LoginSettings | null, defer: Defer): Promise<Response> {
  const accepted = await accept(request, settings, ['loginId'] as const)
  if ('refusal' in accepted) return accepted.refusal
  const { login } = accepted
  const loginId = normalizeLoginId(accepted.fields.loginId)
  // No account can have such an ID: nothing to send or to count.
  if (loginIdProblem(loginId)) return reply(200, {})
  const opened = openDb(request, open, 'account.forgotPassword')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  let limits: Limit[]
  let user: UserRow | null
  try {
    const check = await mailAllowed(db, request, loginId)
    if (!check.allowed) return reply(200, {})
    limits = check.limits
    user = await findUserByLoginId(db, loginId)
  } catch (error) {
    reportFailure(request, error, 'account.forgotPassword')
    return refuse(503, 'databaseUnavailable')
  }
  const recipient = user?.emailVerifiedAt ? user : null
  defer(async () => {
    if (recipient) {
      const { id, email, locale } = recipient
      await trySend(request, email, async () => {
        const token = await issueToken(db, { userId: id, kind: 'reset', email, ttlSeconds: RESET_TTL_SECONDS })
        return resetMail(locale, `${login.origin}/reset-password?token=${token}`)
      })
    }
    await countMail(db, request, limits, 'account.forgotPassword')
  })
  return reply(200, {})
}

/**
 * POST /api/account/reset-password { token, password }: sets the password of the link's account, confirms its address
 * (the link reached it) and revokes its earlier logins. The password is checked against the rules with the token
 * owner's ID before the token is used, so a refused password leaves the link usable. 200 { loginId }, after which the
 * screen signs in again with it; 400 invalidToken, passwordLength or passwordSameAsId.
 */
export async function answerResetPassword(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const accepted = await accept(request, settings, ['token', 'password'] as const)
  if ('refusal' in accepted) return accepted.refusal
  const { token: raw, password } = accepted.fields
  const opened = openDb(request, open, 'account.resetPassword')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  try {
    const owner = await peekToken(db, raw, 'reset')
    const user = owner && await findUserById(db, owner.userId)
    if (!owner || !user) return refuse(400, 'invalidToken')
    const problem = passwordProblem(password, user.loginId)
    if (problem) return refuse(400, problem)
    const passwordHash = await hashPassword(password)
    const done = await inTransaction(db, async client => {
      // Used only now, so that two requests with one link cannot both set a password; in the one transaction with the
      // writes, so that the link is spent only when all of them land.
      const token = await consumeToken(client, raw, 'reset')
      if (!token || token.userId !== user.id) return false
      await setPassword(client, user.id, passwordHash)
      await markEmailVerified(client, user.id, token.email)
      await revokeEarlierLogins(client, `password:${user.id}`)
      return true
    })
    return done ? reply(200, { loginId: user.loginId }) : refuse(400, 'invalidToken')
  } catch (error) {
    reportFailure(request, error, 'account.resetPassword')
    return refuse(503, 'databaseUnavailable')
  }
}

/**
 * POST /api/account/forgot-id { email }: mails the IDs of the accounts whose confirmed address it is, in the reader's
 * language (the locale cookie), when there is one and the mail limits (counted for the address) allow it. Always
 * 200 {} for a well-formed body; each such request that is not limited counts against the limits. The mail and the
 * counting run in defer, after the answer.
 */
export async function answerForgotId(request: Request, open: () => Pool,
  settings: () => LoginSettings | null, defer: Defer): Promise<Response> {
  const accepted = await accept(request, settings, ['email'] as const)
  if ('refusal' in accepted) return accepted.refusal
  const email = normalizeEmail(accepted.fields.email)
  if (emailProblem(email)) return reply(200, {})
  const opened = openDb(request, open, 'account.forgotId')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  let limits: Limit[]
  let ids: string[]
  try {
    const check = await mailAllowed(db, request, email)
    if (!check.allowed) return reply(200, {})
    limits = check.limits
    ids = await findVerifiedLoginIdsByEmail(db, email)
  } catch (error) {
    reportFailure(request, error, 'account.forgotId')
    return refuse(503, 'databaseUnavailable')
  }
  const locale = readerLocale(request)
  defer(async () => {
    if (ids.length > 0) await trySend(request, email, async () => loginIdsMail(locale, ids))
    await countMail(db, request, limits, 'account.forgotId')
  })
  return reply(200, {})
}

/**
 * POST /api/account/change-password { currentPassword, newPassword }: sets a new password for the signed-in account
 * and revokes its earlier logins. The current password is checked by authorizePassword, as a sign-in with the
 * account's ID, so a wrong one counts as a failed login (IP, then ID, reserved before scrypt) and a blocked ID or IP
 * is answered as a wrong password too. 200 { loginId }, after which the screen signs in again; 400 wrongPassword,
 * passwordLength, passwordSameAsId or notPasswordAccount.
 */
export async function answerChangePassword(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const accepted = await accept(request, settings, ['currentPassword', 'newPassword'] as const)
  if ('refusal' in accepted) return accepted.refusal
  const { login, fields } = accepted
  const opened = openDb(request, open, 'account.changePassword')
  if ('refusal' in opened) return opened.refusal
  const { db } = opened
  const account = await signedInAccount(request, db, login, 'account.changePassword')
  if ('refusal' in account) return account.refusal
  const { user, sub } = account
  // The new password's shape is checked first, so a typing mistake in it does not use up a login attempt.
  const problem = passwordProblem(fields.newPassword, user.loginId)
  if (problem) return refuse(400, problem)
  try {
    const checked = await authorizePassword(db, { loginId: user.loginId, password: fields.currentPassword }, clientIp(request))
    if (checked?.id !== sub) return refuse(400, 'wrongPassword')
    await setPassword(db, user.id, await hashPassword(fields.newPassword))
    await revokeEarlierLogins(db, sub)
  } catch (error) {
    reportFailure(request, error, 'account.changePassword')
    return refuse(503, 'databaseUnavailable')
  }
  return reply(200, { loginId: user.loginId })
}

/**
 * GET /api/account/me: the signed-in account with an ID and a password, as the settings show it:
 * 200 { loginId, email, emailVerified }. 401 loginRequired when signed out (or the account is gone), 400
 * notPasswordAccount for a login of another kind (GitHub).
 */
export async function answerMe(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method !== 'GET') return methodNotAllowed(['GET', 'HEAD'])
  const opened = openDb(request, open, 'account.me')
  if ('refusal' in opened) return opened.refusal
  const account = await signedInAccount(request, opened.db, login, 'account.me')
  if ('refusal' in account) return account.refusal
  const { user } = account
  return reply(200, { loginId: user.loginId, email: user.email, emailVerified: !!user.emailVerifiedAt })
}
