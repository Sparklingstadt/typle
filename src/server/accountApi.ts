import type { Pool } from 'pg'
import { defaultLocale, isLocale, LOCALE_COOKIE } from '../i18n/config'
import { emailProblem, loginIdProblem, normalizeEmail, normalizeLoginId, passwordProblem } from '../lib/accountRules'
import { cookieValue, dropCookie, signedIn } from './account'
import { issueToken } from './emailTokens'
import { clientIp, countHit, isBlocked, LIMITS } from './limits'
import { sendMail, verifyMail } from './mail'
import { hashPassword } from './password'
import { reportFailure } from './report'
import { jsonContent, sameOrigin } from './request'
import { methodNotAllowed, refuse, reply } from './response'
import { readLoginSettings, type LoginSettings } from './settings'
import { createUser, findUserByLoginId } from './users'

// The account's own requests (/api/account): signing up with an ID and a password, and, after the login, signing out
// of every device. Confirming an address, resetting and changing a password and mailing an address's IDs are in
// src/server/accountRecovery.ts.

/**
 * POST /api/account/signout-everywhere: revokes every login of the account until now (typle_session_revocations) and
 * removes the cookie of this browser. It needs the app's own Origin and a login that is itself not revoked, and the
 * cookie is kept when the revocations cannot be read or written, so that the user can try again.
 */
export async function answerSignOutEverywhere(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings, now: number = Date.now() / 1000): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method !== 'POST') return methodNotAllowed(['POST'])
  if (!sameOrigin(request, login.origin)) return refuse(403, 'forbiddenRequest')
  let db: Pool
  try {
    db = open()
  } catch (error) {
    reportFailure(request, error, 'session.revoke')
    return refuse(503, 'databaseUnavailable')
  }
  const result = await signedIn(request, db, login, now)
  if ('refusal' in result) return result.refusal
  try {
    await db.query(`INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, now())
      ON CONFLICT (owner_id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`, [result.user.sub])
  } catch (error) {
    reportFailure(request, error, 'session.revoke')
    return refuse(503, 'databaseUnavailable')
  }
  const response = new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  return dropCookie(response, login)
}

/** How long the link that confirms an address can be used: 24 hours. */
const VERIFY_TTL_SECONDS = 24 * 60 * 60

/** The largest account body read: far more than an ID, an address and passwords of the longest allowed. */
const MAX_BODY_BYTES = 4096

/**
 * The string fields names of a JSON object body (others are ignored), or null when the body is larger than
 * MAX_BODY_BYTES, is not a JSON object, or any of the fields is not a string.
 */
export async function readFields<Name extends string>(request: Request, names: readonly Name[]): Promise<Record<Name, string> | null> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const fields = {} as Record<Name, string>
  for (const name of names) {
    const value = (body as Record<string, unknown>)[name]
    if (typeof value !== 'string') return null
    fields[name] = value
  }
  return fields
}

/** The language of the reader's locale cookie, Japanese without a valid one. */
export function readerLocale(request: Request): string {
  const cookieLocale = cookieValue(request, LOCALE_COOKIE)
  return isLocale(cookieLocale) ? cookieLocale : defaultLocale
}

/**
 * POST /api/account/signup { loginId, email, password }: creates an account that signs in with an ID and a password,
 * and mails the link that confirms its address. It needs the app's own Origin and a JSON body. The ID and the address
 * are kept normalized (lower case, trimmed), the password as a hash, and the language of the reader's locale cookie,
 * in which later mails are written.
 *
 * Answers 400 with the first rule the fields break (loginIdFormat, passwordLength, passwordSameAsId, emailFormat, or
 * invalidRequest for a body of another shape), 429 tooManyRequests once the address has created 5 accounts in the
 * hour, 409 loginIdTaken, and otherwise 201 { loginId, mailSent }. Both a created account and a taken ID count toward
 * the limit, so the 409s cannot be used without bound to find which IDs exist; a form refused with 400 does not count,
 * so typing mistakes do not use it up. A taken ID is looked up before the password is hashed, so a 409 costs no hash
 * (one that is created between the look-up and the insert is still answered 409 and counted). A mail that cannot be
 * sent does not undo the account: mailSent is false and the user can ask for the link again after signing in. The
 * screen signs in with the same ID and password afterwards. hash is replaceable for tests only (to count its runs).
 */
export async function answerSignup(request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings,
  hash: (password: string) => Promise<string> = hashPassword): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method !== 'POST') return methodNotAllowed(['POST'])
  if (!sameOrigin(request, login.origin) || !jsonContent(request)) return refuse(403, 'forbiddenRequest')
  const fields = await readFields(request, ['loginId', 'email', 'password'] as const)
  if (!fields) return refuse(400, 'invalidRequest')
  const loginId = normalizeLoginId(fields.loginId)
  const email = normalizeEmail(fields.email)
  const problem = loginIdProblem(loginId) ?? passwordProblem(fields.password, loginId) ?? emailProblem(email)
  if (problem) return refuse(400, problem)

  const locale = readerLocale(request)
  const limit = LIMITS.signupIp(clientIp(request))
  let db: Pool
  let created: { id: string } | 'taken'
  try {
    db = open()
    if (await isBlocked(db, limit.key)) return refuse(429, 'tooManyRequests')
    created = await findUserByLoginId(db, loginId) ? 'taken'
      : await createUser(db, { loginId, email, passwordHash: await hash(fields.password), locale })
  } catch (error) {
    reportFailure(request, error, 'account.signup')
    return refuse(503, 'databaseUnavailable')
  }
  try {
    await countHit(db, limit)
  } catch (error) {
    // A hit that could not be counted only lets this address make one more attempt.
    reportFailure(request, error, 'account.signup')
  }
  if (created === 'taken') return refuse(409, 'loginIdTaken')

  let mailSent = false
  try {
    const token = await issueToken(db, { userId: created.id, kind: 'verify', email, ttlSeconds: VERIFY_TTL_SECONDS })
    const mail = verifyMail(locale, `${login.origin}/verify-email?token=${token}`)
    await sendMail(email, mail.subject, mail.text)
    mailSent = true
  } catch (error) {
    // sendMail's errors never hold the mail, so the link's token is not in the log.
    reportFailure(request, error, 'mail.send')
  }
  return reply(201, { loginId, mailSent })
}
