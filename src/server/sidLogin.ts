import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware, isAPIError } from 'better-auth/api'
import { accountEmail } from './authUser'

// The login with Sparklingstadt ID (https://id.sparklingstadt.com), the OpenID Connect provider shared by the
// Sparklingstadt services, through Better Auth's genericOAuth (src/server/betterAuth.ts): what a login of it makes, kept
// apart so that the unit tests can run it, and the cookie that makes the login after a sign-out ask for the password. A
// Sparklingstadt ID is the account sid:<sub>, unless its account row belongs to another user (linked by npm run
// sid:link), which Better Auth then signs in.

/** The provider's id, which names its callback /api/auth/callback/sid. */
export const SID_PROVIDER_ID = 'sid'

/** The form of a sub, as the account ID sid:<sub> takes it (src/server/authUser.ts). */
const SUB = /^[a-z0-9]{1,64}$/

/** The claims of a Sparklingstadt ID token that the app reads. */
export type SidClaims = { sub: unknown, email?: unknown, email_verified?: unknown, name?: unknown }

/**
 * The user a Sparklingstadt ID login makes: sid:<sub>, named by the ID's name, or by its address before @ when the name
 * is blank, with the address made up from the ID (the real one is not kept). An ID whose address is not confirmed, or
 * whose sub is not of its form, is refused (thrown).
 */
export function sidUser(claims: SidClaims): { id: string, name: string, image: '', email: string, emailVerified: true } {
  if (claims.email_verified !== true) throw new Error('Sparklingstadt ID: the address is not confirmed')
  if (typeof claims.sub !== 'string' || !SUB.test(claims.sub)) throw new Error('Sparklingstadt ID: the sub is not of its form')
  const id = `sid:${claims.sub}`
  const given = typeof claims.name === 'string' ? claims.name.trim() : ''
  const name = given || (typeof claims.email === 'string' ? claims.email : '').split('@')[0]
  return { id, name, image: '', email: accountEmail(id), emailVerified: true }
}

/** The claims of a JWT, read without checking its signature, or null when it is not one. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * genericOAuth's getUserInfo for Sparklingstadt ID: the user of the login's ID token, or null, which Better Auth answers
 * by sending the browser to the error page (/signin?error=unable_to_get_user_info) without a session. Better Auth calls
 * it only after it has checked the ID token against the ID server's keys, issuer, audience and nonce (the provider is
 * built with requireIdTokenVerification), so the claims read here, email_verified among them, are the ID server's. A
 * login without an ID token gets nothing: no claim of a userinfo answer stands in for it.
 */
export function sidAccountInfo(tokens: { idToken?: string }) {
  const claims = tokens.idToken ? jwtClaims(tokens.idToken) : null
  if (!claims) return null
  try {
    const user = sidUser(claims as SidClaims)
    const sub = claims.sub as string
    return { id: sub, sub, name: user.name, email: user.email, emailVerified: true }
  } catch {
    return null
  }
}

/**
 * The cookie that makes the next Sparklingstadt ID login ask for the password (prompt=login): the ID server keeps its
 * own login, so without it a browser signed out of this app would be let straight back in. It is left by a sign-out
 * that went through and removed by a Sparklingstadt ID login that succeeded, as the FFPF ID login did in v2.6.4.
 */
export const SID_RELOGIN_COOKIE = 'typle-sid-relogin'
/** How long the cookie is kept: the longest a login lasts (30 days). */
const RELOGIN_MAX_AGE = 30 * 24 * 3600

/** Whether a Cookie header carries the relogin cookie. */
export const hasReloginCookie = (cookie: string | null | undefined) => (cookie ?? '').split(';')
  .some(part => part.trim().startsWith(`${SID_RELOGIN_COOKIE}=`))

const reloginAttributes = (secure: boolean) => ({ path: '/', httpOnly: true, sameSite: 'lax' as const, secure })

/**
 * A Better Auth plugin for the relogin cookie: a Sparklingstadt ID login started with it asks for prompt=login, a
 * sign-out (POST /api/auth/sign-out) that went through leaves it, and a Sparklingstadt ID login that made a session
 * removes it. Signing out of every device is a Route Handler of its own, which leaves it with withSidRelogin.
 */
export function sidRelogin(secure: boolean) {
  const cookieOf = (ctx: { request?: Request, headers?: Headers }) => (ctx.request?.headers ?? ctx.headers)?.get('cookie')
  return {
    id: 'sid-relogin',
    hooks: {
      before: [{
        matcher: ctx => ctx.path === '/sign-in/social' && ctx.body?.provider === SID_PROVIDER_ID,
        handler: createAuthMiddleware(async ctx => {
          if (!hasReloginCookie(cookieOf(ctx))) return
          const body = ctx.body as { additionalParams?: Record<string, string> }
          return { context: { body: { ...body, additionalParams: { ...body.additionalParams, prompt: 'login' } } } }
        }),
      }],
      after: [{
        matcher: ctx => ctx.path === '/sign-out',
        handler: createAuthMiddleware(async ctx => {
          if (isAPIError(ctx.context.returned)) return
          ctx.setCookie(SID_RELOGIN_COOKIE, '1', { ...reloginAttributes(secure), maxAge: RELOGIN_MAX_AGE })
        }),
      }, {
        matcher: ctx => ctx.path === '/callback/:id' && ctx.params?.id === SID_PROVIDER_ID,
        handler: createAuthMiddleware(async ctx => {
          if (!ctx.context.newSession || !hasReloginCookie(cookieOf(ctx))) return
          ctx.setCookie(SID_RELOGIN_COOKIE, '', { ...reloginAttributes(secure), maxAge: 0 })
        }),
      }],
    },
  } satisfies BetterAuthPlugin
}

/**
 * response, with the relogin cookie left after signing out of every device went through (POST
 * /api/account/signout-everywhere answered 2xx). Any other response is answered as it is.
 */
export async function withSidRelogin(request: Request, response: Response, secure: boolean): Promise<Response> {
  const path = new URL(request.url).pathname
  if (request.method !== 'POST' || path !== '/api/account/signout-everywhere' || !response.ok) return response
  // A copy, as the headers of a response may be immutable (Response.redirect).
  const answered = new Response(response.body, response)
  answered.headers.append('Set-Cookie',
    `${SID_RELOGIN_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${RELOGIN_MAX_AGE}`)
  return answered
}
