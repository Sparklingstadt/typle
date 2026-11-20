import type { Pool } from 'pg'
import { reportFailure } from './report'
import { refuse } from './response'
import { openSession, sessionCookieName, type Session } from './session'
import type { LoginSettings } from './settings'

// Who a request is signed in as, and whether that login still counts: signing out of every device revokes every login
// made until then (typle_session_revocations), which is the one way to stop a stolen cookie before it expires.

/** The value of the cookie name in the request, the first one when there are several; quotes around it are dropped. */
export function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const value = part.slice(at + 1).trim()
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  }
  return null
}

/** The signed-in user, from the login cookie; null without one, or when it is broken, of another kind or expired. */
export function currentUser(request: Request, settings: LoginSettings, now: number = Date.now() / 1000): Session | null {
  const cookie = cookieValue(request, sessionCookieName(settings.secure))
  return cookie === null ? null : openSession(settings.sessionKey, cookie, now)
}

/** When the owner last signed out of every device, or null when they never did. */
export async function readRevokedAt(db: Pick<Pool, 'query'>, owner: string): Promise<Date | null> {
  const { rows } = await db.query<{ revoked_at: Date }>('SELECT revoked_at FROM typle_session_revocations WHERE owner_id = $1', [owner])
  return rows[0]?.revoked_at ?? null
}

/** Whether signing out of every device at revokedAt revoked user: a login in that very second counts too (whole seconds). */
export const revokedBy = (user: Session, revokedAt: Date | null) => !!revokedAt && user.issuedAt * 1000 <= revokedAt.getTime()

/** How long the session check waits for the revocations before it goes on without them. */
const REVOCATION_WAIT_MS = 1000

/**
 * Whether the account sub signed out of every device since a login made at issuedAt (Unix seconds): null when that
 * cannot be told within REVOCATION_WAIT_MS, as the session never waits for the database (the account's data, read with
 * the revocations, stays out of reach all the same). The failure is only logged, and the answer goes on.
 */
export async function revokedSoon(open: () => Pool, sub: string, issuedAt: number): Promise<boolean | null> {
  const late = Symbol('late')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const db = open()
    const deadline = new Promise<typeof late>(resolve => { timer = setTimeout(() => resolve(late), REVOCATION_WAIT_MS) })
    const revokedAt = await Promise.race([readRevokedAt(db, sub), deadline])
    if (revokedAt === late) throw new Error(`the revocations were not read within ${REVOCATION_WAIT_MS} ms`)
    return !!revokedAt && issuedAt * 1000 <= revokedAt.getTime()
  } catch (error) {
    console.warn('session.check:', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The answer that removes the login cookie of a browser whose login ended or was revoked. */
export function dropCookie(response: Response, settings: LoginSettings): Response {
  const secure = settings.secure ? '; Secure' : ''
  response.headers.append('Set-Cookie', `${sessionCookieName(settings.secure)}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Lax`)
  return response
}

/**
 * The user of a request that reads or changes the account's data, or the answer to refuse it with: loginRequired
 * without a session or with a revoked one (whose cookie is then removed), and databaseUnavailable when the revocations
 * cannot be read, as the data cannot be either.
 */
export async function signedIn(request: Request, db: Pool | null, settings: LoginSettings,
  now: number = Date.now() / 1000): Promise<{ user: Session } | { refusal: Response }> {
  const user = currentUser(request, settings, now)
  if (!user) return { refusal: refuse(401, 'loginRequired') }
  let revokedAt: Date | null
  try {
    if (!db) throw new Error('no database to check the session against')
    revokedAt = await readRevokedAt(db, user.sub)
  } catch (error) {
    reportFailure(request, error, 'session.check')
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
  if (revokedBy(user, revokedAt)) {
    return { refusal: dropCookie(refuse(401, 'loginRequired'), settings) }
  }
  return { user }
}
