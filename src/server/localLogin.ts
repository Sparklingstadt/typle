import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { accountEmail } from './authUser'
import { LOCAL_LOGIN_PATH } from './authPaths'

// The made-up login for development on this machine (POST /api/auth/sign-in/local): it signs in as github:0, an
// account of no GitHub user. It is answered only while readLoginSettings says the local login is on (never on Vercel,
// never at an https or public AUTH_URL), as the Credentials provider `local` of Auth.js was.

/** The made-up account of the local login. */
export const LOCAL_USER = { id: 'github:0', name: 'ローカル練習用', image: '' } // i18n-ignore: a stored account name, as the Go backend gave it

/**
 * A Better Auth plugin with the local login's endpoint. It makes the user github:0 the first time, through Better
 * Auth's own user creation, so that the user-create hook gives it its ID from the made-up address (accountEmail), and
 * starts a session of it. enabled is asked on every call, besides the 404 of src/server/authPaths.ts.
 */
export function localLogin(enabled: () => boolean) {
  return {
    id: 'local-login',
    endpoints: {
      signInLocal: createAuthEndpoint(LOCAL_LOGIN_PATH, { method: 'POST', use: [formCsrfMiddleware] }, async ctx => {
        if (!enabled()) throw new APIError('NOT_FOUND')
        const adapter = ctx.context.internalAdapter
        const user = await adapter.findUserById(LOCAL_USER.id) ?? await adapter.createUser({
          email: accountEmail(LOCAL_USER.id), name: LOCAL_USER.name, image: LOCAL_USER.image, emailVerified: true,
        }, { method: 'local-login' })
        const session = await adapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ user: { id: user.id, name: user.name, image: user.image ?? '' } })
      }),
    },
  } satisfies BetterAuthPlugin
}
