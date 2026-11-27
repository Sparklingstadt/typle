import { signedIn, type ReadSession } from './account'
import { reportFailure } from './report'
import { sameOrigin } from './request'
import { methodNotAllowed, refuse } from './response'
import { readLoginSettings, type LoginSettings } from './settings'

// The account's own request (/api/account): signing out of every device.

/** What Better Auth does for this request: ends every session of a user, and names the cookies of a browser's login. */
export type SessionEnd = {
  /** Deletes every session of the user. */
  revokeAll: (userId: string) => Promise<void>,
  /** The cookies that hold a login (the session token and the cookie cache), with the attributes they were set with. */
  loginCookies: () => Promise<{ name: string, attributes: { path?: string, secure?: boolean, httpOnly?: boolean, sameSite?: string } }[]>,
}

const betterAuthEnd: SessionEnd = {
  revokeAll: async userId => { await (await (await import('./betterAuth')).auth.$context).internalAdapter.deleteUserSessions(userId) },
  loginCookies: async () => {
    const { sessionToken, sessionData } = (await (await import('./betterAuth')).auth.$context).authCookies
    return [sessionToken, sessionData]
  },
}

/** A Set-Cookie value that removes the cookie from the browser. */
const expired = ({ name, attributes }: Awaited<ReturnType<SessionEnd['loginCookies']>>[number]) =>
  `${name}=; Path=${attributes.path ?? '/'}; Max-Age=0${attributes.httpOnly === false ? '' : '; HttpOnly'}${attributes.secure ? '; Secure' : ''}; SameSite=Lax`

/**
 * POST /api/account/signout-everywhere: deletes every session of the account (Better Auth's tables) and removes the
 * cookies of this browser. It needs the app's own Origin and a session that is itself alive, and the cookies are kept
 * when the sessions cannot be deleted, so that the user can try again. Another device may still read as signed in until
 * its cookie cache (5 minutes) runs out.
 */
export async function answerSignOutEverywhere(request: Request, settings: () => LoginSettings | null = readLoginSettings,
  read?: ReadSession, end: SessionEnd = betterAuthEnd): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method !== 'POST') return methodNotAllowed(['POST'])
  if (!sameOrigin(request, login.origin)) return refuse(403, 'forbiddenRequest')
  // Not from the cookie cache: a session that was revoked must not end the owner's other logins.
  const result = await signedIn(request, read, { fresh: true })
  if ('refusal' in result) return result.refusal
  let cookies: Awaited<ReturnType<SessionEnd['loginCookies']>>
  try {
    await end.revokeAll(result.user.sub)
    cookies = await end.loginCookies()
  } catch (error) {
    reportFailure(request, error, 'session.revoke')
    return refuse(503, 'databaseUnavailable')
  }
  const response = new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  for (const cookie of cookies) response.headers.append('Set-Cookie', expired(cookie))
  return response
}
