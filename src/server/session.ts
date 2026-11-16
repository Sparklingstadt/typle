import { createHmac, timingSafeEqual } from 'node:crypto'

// The login session, as the Go backend seals it (server/internal/session): base64url(JSON) + "." +
// base64url(HMAC-SHA256 of that text), without padding, under a key derived from AUTH_SECRET (src/server/settings.ts).
// The cookie and the iPad and Mac apps' token are the same JSON under different keys, so one never opens as the other.

/** A signed-in user. Times are Unix seconds; issuedAt is the time of the login, as a session is never sealed again. */
export type Session = { sub: string, name: string, image: string, issuedAt: number, expires: number }

/** The only subjects accepted: a GitHub account (its numeric id) or an FFPF ID account (its lowercase alphanumeric sub). */
const ACCOUNT_SUB = /^(github:\d+|ffpf:[a-z0-9]{1,64})$/

/** The login cookie's name: __Host- over HTTPS, which makes the browser insist on Secure, Path=/ and no Domain. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-typle-session' : 'typle-session'
}

/**
 * The bytes of base64url text written strictly, as Go's base64.RawURLEncoding.Strict() reads it: no padding, no other
 * characters, and the unused bits of the last character zero, so that one value has one spelling. Otherwise null.
 */
function strictBase64url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const bytes = Buffer.from(text, 'base64url')
  return bytes.toString('base64url') === text ? bytes : null
}

/** The claims of value if it was sealed with key and its payload is a JSON object, and otherwise null. */
function openClaims(key: Buffer, value: string): Record<string, unknown> | null {
  const parts = value.split('.')
  if (parts.length !== 2) return null
  const [payload, signature] = parts
  const got = strictBase64url(signature)
  const want = createHmac('sha256', key).update(payload).digest()
  if (!got || got.length !== want.length || !timingSafeEqual(got, want)) return null
  const data = strictBase64url(payload)
  if (!data) return null
  let claims: unknown
  try {
    claims = JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
  return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims as Record<string, unknown> : null
}

/** The session in value if it was sealed with key, has not expired at now, and is for a GitHub or FFPF ID account. */
export function openSession(key: Buffer, value: string, now: number = Date.now() / 1000): Session | null {
  const claims = openClaims(key, value)
  if (!claims) return null
  const { sub, name, image, iat, exp } = claims
  if (typeof sub !== 'string' || typeof name !== 'string' || typeof image !== 'string' ||
    !Number.isInteger(iat) || !Number.isInteger(exp)) return null
  if (!(now < (exp as number)) || !ACCOUNT_SUB.test(sub)) return null
  return { sub, name, image, issuedAt: iat as number, expires: exp as number }
}

/**
 * The administrator signed in to /admin: the FFPF ID account's verified email and its sub (without "ffpf:"), as the
 * Go backend seals it (session.Keys.SealAdmin) at the end of a login to the dashboard. Times are Unix seconds.
 */
export type Admin = { email: string, sub: string, issuedAt: number, expires: number }

/** An FFPF ID sub as the administrator's cookie holds it. */
const FFPF_SUB = /^[a-z0-9]{1,64}$/

/** The administrator's cookie: __Host- over HTTPS, as the login cookie. */
export function adminCookieName(secure: boolean): string {
  return secure ? '__Host-typle-admin' : 'typle-admin'
}

/**
 * The administrator in value if it was sealed with the admin key, has not expired at now, and names an FFPF ID account:
 * an email and a sub. Whether that account is still an administrator is for the caller to ask (src/server/admin.ts).
 */
export function openAdmin(key: Buffer, value: string, now: number = Date.now() / 1000): Admin | null {
  const claims = openClaims(key, value)
  if (!claims) return null
  const { email, sub, iat, exp } = claims
  if (typeof email !== 'string' || typeof sub !== 'string' || !Number.isInteger(iat) || !Number.isInteger(exp)) return null
  if (!(now < (exp as number)) || email === '' || !FFPF_SUB.test(sub)) return null
  return { email, sub, issuedAt: iat as number, expires: exp as number }
}
