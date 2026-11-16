import type { Pool } from 'pg'
import { reportFailure } from './report'
import { refuse } from './response'
import { openSession, sessionCookieName, type Session } from './session'
import type { LoginSettings } from './settings'

// Who a request is signed in as, and whether that login still counts: signing out of every device revokes every login
// made until then (typle_session_revocations), which is the one way to stop a stolen cookie or token before it expires.

/** The value of the cookie name in the request, the first one when there are several; quotes around it are dropped. */
function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const value = part.slice(at + 1).trim()
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  }
  return null
}

/**
 * The signed-in user: from an app's (iPad, Mac) bearer token when the request has an Authorization header, and otherwise
 * from the login cookie. A request with both is judged by the token, so a cookie never stands in for a token that is
 * refused.
 */
export function currentUser(request: Request, settings: LoginSettings, now: number = Date.now() / 1000): Session | null {
  const authorization = request.headers.get('Authorization')
  if (authorization) {
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    if (!token || /[ \t]/.test(token)) return null
    return openSession(settings.appKey, token, now)
  }
  const cookie = cookieValue(request, sessionCookieName(settings.secure))
  return cookie === null ? null : openSession(settings.sessionKey, cookie, now)
}

/** The answer that removes the login cookie of a browser whose login was revoked. */
function dropCookie(response: Response, settings: LoginSettings): Response {
  const secure = settings.secure ? '; Secure' : ''
  response.headers.append('Set-Cookie', `${sessionCookieName(settings.secure)}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Lax`)
  return response
}

/**
 * The user of a request that reads or changes the account's data, or the answer to refuse it with: loginRequired
 * without a session or with a revoked one (whose cookie is then removed), and databaseUnavailable when the revocations
 * cannot be read, as the data cannot be either.
 */
export async function signedIn(request: Request, db: Pool | null, settings: LoginSettings): Promise<{ user: Session } | { refusal: Response }> {
  const user = currentUser(request, settings)
  if (!user) return { refusal: refuse(401, 'loginRequired') }
  let revokedAt: Date | null
  try {
    if (!db) throw new Error('no database to check the session against')
    const { rows } = await db.query<{ revoked_at: Date }>(
      'SELECT revoked_at FROM typle_session_revocations WHERE owner_id = $1', [user.sub])
    revokedAt = rows[0]?.revoked_at ?? null
  } catch (error) {
    reportFailure(request, error, 'session.check')
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
  // A login in the very second of the revocation counts as revoked too: issuedAt is in whole seconds.
  if (revokedAt && user.issuedAt * 1000 <= revokedAt.getTime()) {
    const refusal = refuse(401, 'loginRequired')
    return { refusal: request.headers.get('Authorization') ? refusal : dropCookie(refusal, settings) }
  }
  return { user }
}
