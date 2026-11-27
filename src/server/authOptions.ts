import type { Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { SESSION_MAX_AGE } from './session'
import type { LoginSettings } from './settings'
import { SID_PROVIDER_ID } from './sidLogin'

// What the Auth.js configuration (removed with the Auth.js route; the login is Better Auth's, src/server/betterAuth.ts)
// decided: the session's account ID, end and revocation, and where Auth.js sent the browser. Removed in the clean-up of
// Auth.js, with its tests.

/**
 * The jwt callback. At a login the account is the provider's: for OAuth, Auth.js gives the user a random id and keeps
 * the id of profile() (github:<number>) as providerAccountId, and for Credentials providerAccountId is the id authorize
 * returned, so it is the account ID either way. A login whose user says when it was made (issuedAt) starts then; the
 * others start when the cookie is sealed (encodeSession). A
 * session read from the cookie is null, which Auth.js answers with no session and the cookie removed, when the account
 * signed out of every device since this login; it is kept when that cannot be told in time (revoked answers null).
 * A Sparklingstadt ID login (sid:<sub>) is the account its sub is linked to when linked answers one; when the link
 * cannot be read, the login fails (linked throws), rather than open the empty account sid:<sub>.
 */
export function jwtCallback(revoked: (sub: string, issuedAt: number) => Promise<boolean | null>,
  linked: (sub: string) => Promise<string | null>) {
  return async ({ token, account, user }: {
    token: JWT, account?: { provider?: string, providerAccountId: string } | null, user?: object | null,
  }): Promise<JWT | null> => {
    if (account) {
      token.sub = account.provider === SID_PROVIDER_ID
        ? await linked(account.providerAccountId.slice('sid:'.length)) ?? account.providerAccountId
        : account.providerAccountId
      const issuedAt = user && 'issuedAt' in user ? user.issuedAt : null
      if (typeof issuedAt === 'number' && Number.isInteger(issuedAt)) {
        token.iat = issuedAt
        token.exp = issuedAt + SESSION_MAX_AGE
      }
      return token
    }
    if (token.sub && typeof token.iat === 'number' && await revoked(token.sub, token.iat) === true) return null
    return token
  }
}

/** The session callback: the account ID and picture of the login, and its end at the cookie's own exp. */
export function sessionCallback<S extends Session & { user: User }>({ session, token }: { session: S, token: JWT }): S {
  if (token.sub) session.user.id = token.sub
  session.user.image = token.picture || null
  // Auth.js dates the session 30 days from now each time it is read; the login ends at the cookie's own exp.
  if (typeof token.exp === 'number') session.expires = new Date(token.exp * 1000).toISOString() as typeof session.expires
  return session
}

/**
 * The redirect callback: a path of this site, or a URL of it, at origin (AUTH_URL's); anything else goes to origin's
 * home. Auth.js judges by the request's origin (baseUrl), which Next.js writes as localhost for 127.0.0.1, so a browser
 * at 127.0.0.1 would be sent to localhost, where its cookies are not.
 */
export function redirectCallback(origin: string) {
  return ({ url, baseUrl }: { url: string, baseUrl: string }): string => {
    if (url.startsWith('/') && !url.startsWith('//')) return origin + url
    try {
      const target = new URL(url)
      if (target.origin === origin || target.origin === baseUrl) return origin + target.pathname + target.search + target.hash
    } catch {
      // Not a URL: home.
    }
    return origin
  }
}

/**
 * Auth.js's redirect proxy at AUTH_URL when it is a loopback address (development and the end-to-end tests): Next.js
 * reads 127.0.0.1 as localhost, so GitHub would be told to come back to localhost, where the browser holds none of the
 * login's cookies. With the proxy, GitHub comes back to AUTH_URL, and the code is exchanged with that same redirect_uri.
 * Elsewhere the request's origin is AUTH_URL's, and there is none.
 */
export function redirectProxyUrl(settings: LoginSettings | null): string | undefined {
  if (!settings) return undefined
  const host = new URL(settings.origin).hostname
  const loopback = host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  return loopback ? `${settings.origin}/api/auth` : undefined
}

/**
 * Whether error is the JWTSessionError Auth.js logs when the session cookie cannot be read: its decode (decodeSession)
 * answered null, for a cookie that expired, was sealed with another key or was changed, and Auth.js threw
 * Error('Invalid JWT') for it. The cookie is removed and the reader is signed out, which is all there is to do.
 */
function unreadableCookie(name: string, error: Error): boolean {
  if (name !== 'JWTSessionError') return false
  const cause = error.cause
  const err = cause && typeof cause === 'object' && 'err' in cause ? (cause as { err: unknown }).err : null
  return err instanceof Error && err.message === 'Invalid JWT'
}

/**
 * The Auth.js logger's error method. An expired or unreadable login cookie makes Auth.js log a JWTSessionError on every
 * read of the session; that is an ordinary answer, not a failure, so it is not logged (the response already handles it).
 * Every other error, including any other JWTSessionError, is logged as Auth.js's own logger does, with its cause when
 * it has one.
 */
export function authErrorLogger(write: (...args: unknown[]) => void = console.error) {
  return (error: Error) => {
    const name = (error as { type?: string }).type ?? error.name
    if (unreadableCookie(name, error)) return
    write(`[auth][error] ${name}: ${error.message}`)
    const cause = error.cause
    if (cause && typeof cause === 'object' && 'err' in cause && (cause as { err: unknown }).err instanceof Error) {
      write('[auth][cause]:', (cause as { err: Error }).err.stack)
    } else if (error.stack) {
      write(error.stack.replace(/.*/, '').substring(1))
    }
  }
}
