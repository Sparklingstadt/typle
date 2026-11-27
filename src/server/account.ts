import { demoConfigured } from '../lib/demoLogin'
import { reportFailure } from './report'
import { refuse } from './response'

// Who a request is signed in as: the Better Auth session its cookie names (src/server/betterAuth.ts). Signing out of
// every device deletes the user's session rows (src/server/accountApi.ts), the one way to stop a stolen cookie before
// it expires; the cookie cache (5 minutes) is the longest another device can still be read as signed in.

/** The shared demo account's ID (src/server/demoLogin.ts makes it). */
const DEMO_ACCOUNT_ID = 'demo:shared'

/** The signed-in user of a request, as the routes use it: sub is the account ID (the owner_id of its data). */
export type SessionUser = { sub: string, name: string, image: string }

/** Reads the session the request headers name: null without one, or when it is unknown or expired; throws when it cannot be read. */
export type ReadSession = (headers: Headers, options?: { fresh?: boolean }) => Promise<{ user: { id: string, name: string, image?: string | null } } | null>

/**
 * Better Auth's own reader. Loaded on first use, so that code that is given another reader needs no auth settings. With
 * fresh the cookie cache is not used: the session row itself is read, so a session that was revoked is refused at once.
 */
const betterAuthSession: ReadSession = async (headers, options) =>
  (await import('./betterAuth')).auth.api.getSession({ headers, query: options?.fresh ? { disableCookieCache: true } : undefined })

/**
 * The user of a request that reads or changes the account's data, or the answer to refuse it with: loginRequired
 * without a session (or with an ended one), and databaseUnavailable when the session cannot be read, as the data cannot
 * be either. fresh reads the session row, not the cookie cache (for what must not be done by a revoked session).
 */
export async function signedIn(request: Request, read: ReadSession = betterAuthSession, options?: { fresh?: boolean }):
  Promise<{ user: SessionUser } | { refusal: Response }> {
  let session: Awaited<ReturnType<ReadSession>>
  try {
    session = await read(request.headers, options)
  } catch (error) {
    reportFailure(request, error, 'session.check')
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
  if (!session) return { refusal: refuse(401, 'loginRequired') }
  const { id, name, image } = session.user
  // The shared demo account's sessions stop working when its login is turned off (DEMO_LOGIN), not only new logins.
  if (id === DEMO_ACCOUNT_ID && !demoConfigured()) return { refusal: refuse(401, 'loginRequired') }
  return { user: { sub: id, name, image: image ?? '' } }
}
