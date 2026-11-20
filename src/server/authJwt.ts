import type { JWT } from 'next-auth/jwt'
import { newSession, openSession, sealSession } from './session'

// Auth.js's session token in the login cookie's own form (src/server/session.ts), in place of its encrypted JWT, so
// that the logins made before the move to Auth.js stay signed in and the Go and Kotlin backends still open the cookie.

/**
 * The login cookie of token. A token Auth.js read from a cookie keeps its iat and exp, so that reading the session
 * never extends the login; one without them (a new login) starts at now and lasts SESSION_MAX_AGE.
 */
export function encodeSession(token: JWT, key: Buffer, now: number = Date.now() / 1000): string {
  if (typeof token.sub !== 'string') throw new Error('a session token without an account')
  const name = token.name ?? ''
  const image = token.picture ?? ''
  const session = Number.isInteger(token.iat) && Number.isInteger(token.exp)
    ? { sub: token.sub, name, image, issuedAt: token.iat as number, expires: token.exp as number }
    : newSession(token.sub, name, image, now)
  return sealSession(key, session)
}

/** The token of a login cookie that was sealed with key, has not expired at now and is for an account; otherwise null. */
export function decodeSession(value: string, key: Buffer, now: number = Date.now() / 1000): JWT | null {
  const session = openSession(key, value, now)
  return session && { sub: session.sub, name: session.name, picture: session.image, iat: session.issuedAt, exp: session.expires }
}
