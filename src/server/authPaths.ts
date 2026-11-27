import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { refuse } from './response'

// The paths under /api/auth that are answered over HTTP. Better Auth serves many more endpoints than the app uses
// (sign-up and password logins, session lists, account linking, user updates and deletion); every one not listed here
// answers 404, as an unknown /api/auth path did with Auth.js. The app's server code still calls any of them through
// auth.api, which no HTTP request reaches.

export const AUTH_BASE_PATH = '/api/auth'
/** The development login's endpoint (src/server/localLogin.ts), answered only when it is on. */
export const LOCAL_LOGIN_PATH = '/sign-in/local'

/** Each path the logins use, by its method. */
const ALLOWED: ReadonlySet<string> = new Set([
  // The session the screens read, and signing out.
  'GET /get-session',
  'POST /sign-out',
  // A GitHub or Sparklingstadt ID login starts here (provider github or sid) and comes back to its callback.
  'POST /sign-in/social',
  'GET /callback/github',
  'GET /callback/sid',
])

/** Whether method and pathname (the URL's, as received) are one /api/auth answers. */
export function authPathAllowed(method: string, pathname: string, settings: { localLogin: boolean }): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false
  const path = pathname.slice(AUTH_BASE_PATH.length)
  if (method === 'POST' && path === LOCAL_LOGIN_PATH) return settings.localLogin
  return ALLOWED.has(`${method} ${path}`)
}

/**
 * A Better Auth plugin that answers 404 to every HTTP request outside authPathAllowed, before Better Auth routes it, in
 * the form of the app's other 404s. localLogin is read on each request, so the development login is never answered
 * once it is off. A login started with an ID token instead of a redirect to the provider is refused too: the app never
 * starts one so, and the provider's own check (the ID token's audience and nonce) is the whole defence there.
 */
export function authPaths(localLogin: () => boolean) {
  return {
    id: 'auth-paths',
    onRequest: async (request: Request) => {
      if (authPathAllowed(request.method, new URL(request.url).pathname, { localLogin: localLogin() })) return
      return { response: refuse(404, 'notFound') }
    },
    hooks: {
      before: [{
        matcher: ctx => ctx.path === '/sign-in/social' && ctx.request !== undefined,
        handler: createAuthMiddleware(async ctx => {
          if ((ctx.body as { idToken?: unknown } | undefined)?.idToken !== undefined) {
            throw new APIError('BAD_REQUEST', { message: 'A login starts at the provider' })
          }
        }),
      }],
    },
  } satisfies BetterAuthPlugin
}
