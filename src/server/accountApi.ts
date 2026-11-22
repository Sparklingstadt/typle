import type { Pool } from 'pg'
import { dropCookie, revokeLogins, signedIn } from './account'
import { reportFailure } from './report'
import { sameOrigin } from './request'
import { methodNotAllowed, refuse } from './response'
import { readLoginSettings, type LoginSettings } from './settings'

// The account's own request (/api/account): signing out of every device.

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
    await revokeLogins(db, result.user.sub)
  } catch (error) {
    reportFailure(request, error, 'session.revoke')
    return refuse(503, 'databaseUnavailable')
  }
  const response = new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  return dropCookie(response, login)
}
