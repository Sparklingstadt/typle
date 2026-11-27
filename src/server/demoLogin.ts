import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { accountEmail } from './authUser'
import { DEMO_LOGIN_PATH } from './authPaths'

// The shared demo account (POST /api/auth/sign-in/demo): anyone who looks at the app as a portfolio signs in as
// demo:shared without a GitHub or Sparklingstadt ID account. It is answered only while DEMO_LOGIN is 1
// (readLoginSettings), and its data is put back to the sample every day (src/server/demoReset.ts).

/** The shared demo account. */
export const DEMO_USER = { id: 'demo:shared', name: 'デモアカウント', image: '' } // i18n-ignore: a stored account name

/** How long a demo login lasts. */
const DEMO_SESSION_MS = 2 * 24 * 60 * 60 * 1000

/**
 * A Better Auth plugin with the demo login's endpoint. It makes the user demo:shared the first time, through Better
 * Auth's own user creation (so that the user-create hook gives it its ID from the made-up address), calls created
 * then, and starts a session of it. enabled is asked on every call, besides the 404 of src/server/authPaths.ts.
 */
export function demoLogin(enabled: () => boolean, created: () => Promise<unknown> = async () => {}) {
  return {
    id: 'demo-login',
    endpoints: {
      signInDemo: createAuthEndpoint(DEMO_LOGIN_PATH, { method: 'POST', use: [formCsrfMiddleware] }, async ctx => {
        if (!enabled()) throw new APIError('NOT_FOUND')
        const adapter = ctx.context.internalAdapter
        let user = await adapter.findUserById(DEMO_USER.id)
        if (!user) {
          user = await adapter.createUser({
            email: accountEmail(DEMO_USER.id), name: DEMO_USER.name, image: DEMO_USER.image, emailVerified: true,
          }, { method: 'demo-login' })
          await created()
        }
        // 2 days instead of the usual 30: long enough to outlive one daily reset, short enough that the shared
        // account's sessions do not pile up (the reset deletes the ended ones).
        const session = await adapter.createSession(user.id, false, { expiresAt: new Date(Date.now() + DEMO_SESSION_MS) }, true)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ user: { id: user.id, name: user.name, image: user.image ?? '' } })
      }),
    },
  } satisfies BetterAuthPlugin
}
