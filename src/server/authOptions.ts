import type { Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { readLoginSettings, type LoginSettings } from './settings'

// The parts of the Auth.js configuration (src/auth.ts) that decide something, kept apart from NextAuth so that the unit
// tests can run them: the account a login makes, the session's account ID, end and revocation, where Auth.js sends the
// browser, and which paths under /api/auth it answers.

/** The account a GitHub login makes: github:<numeric id>, named as the login before Auth.js named it. */
export function githubProfile(profile: { id: number | string, login: string, name?: string | null, avatar_url: string }) {
  // The profile name if it says anything, else the login.
  const name = profile.name?.trim() ? profile.name.trim() : profile.login.trim()
  return { id: `github:${profile.id}`, name, image: profile.avatar_url }
}


/** The made-up account of the local login, for development on this machine. */
export const LOCAL_USER = { id: 'github:0', name: 'ローカル練習用', image: '' } // i18n-ignore: a stored account name, as the Go backend gave it

/** The local login's user when it is on (readLoginSettings decides, as the Go backend did), else null: no login. */
export function authorizeLocal(settings: LoginSettings | null = readLoginSettings()) {
  return settings?.localLogin ? { ...LOCAL_USER } : null
}

/**
 * The jwt callback. At a login the account is the provider's: for OAuth, Auth.js gives the user a random id and keeps
 * the id of profile() (github:<number>) as providerAccountId, and for Credentials providerAccountId is the id authorize
 * returned, so it is the account ID either way. A session read from the cookie is null, which Auth.js answers with no
 * session and the cookie removed, when the account signed out of every device since this login; it is kept when that
 * cannot be told in time (revoked answers null).
 */
export function jwtCallback(revoked: (sub: string, issuedAt: number) => Promise<boolean | null>) {
  return async ({ token, account }: { token: JWT, account?: { providerAccountId: string } | null }): Promise<JWT | null> => {
    if (account) {
      token.sub = account.providerAccountId
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

/** The actions under /api/auth that take no provider. */
const PLAIN_ACTIONS = new Set(['session', 'csrf', 'providers', 'signout', 'error'])

/**
 * Whether pathname is one Auth.js answers for these providers. Others (the removed /api/auth/token and /api/auth/local,
 * a provider not in use such as ffpf) are not found, where Auth.js would answer 400 or 500.
 */
export function authPathKnown(pathname: string, providers: readonly string[]): boolean {
  const match = /^\/api\/auth\/([^/]+)(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return false
  const [, action, provider] = match
  if (PLAIN_ACTIONS.has(action)) return provider === undefined
  if (action === 'signin') return provider === undefined || providers.includes(provider)
  if (action === 'callback') return provider !== undefined && providers.includes(provider)
  return false
}

/**
 * The Auth.js logger's error method. A wrong ID or password makes Auth.js log CredentialsSignin as an error with a
 * stack on every attempt; that is an ordinary answer, not a failure, so it is not logged (the limits and the response
 * already handle it). Every other error is logged as Auth.js's own logger does, with its cause when it has one.
 */
export function authErrorLogger(write: (...args: unknown[]) => void = console.error) {
  return (error: Error) => {
    const name = (error as { type?: string }).type ?? error.name
    if (name === 'CredentialsSignin') return
    write(`[auth][error] ${name}: ${error.message}`)
    const cause = error.cause
    if (cause && typeof cause === 'object' && 'err' in cause && (cause as { err: unknown }).err instanceof Error) {
      write('[auth][cause]:', (cause as { err: Error }).err.stack)
    } else if (error.stack) {
      write(error.stack.replace(/.*/, '').substring(1))
    }
  }
}
