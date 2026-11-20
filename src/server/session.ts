import { createHmac, timingSafeEqual } from 'node:crypto'

// The login session, as the Go backend sealed it until v2.47.0: base64url(JSON) + "." +
// base64url(HMAC-SHA256 of that text), without padding, under a key derived from AUTH_SECRET (src/server/settings.ts).
// The cookie and the iPad and Mac apps' token are the same JSON under different keys, so one never opens as the other.

/** A signed-in user. Times are Unix seconds; issuedAt is the time of the login, as a session is never sealed again. */
export type Session = { sub: string, name: string, image: string, issuedAt: number, expires: number }

/**
 * The only subjects accepted: a GitHub account (its numeric id) or an FFPF ID account (its lowercase alphanumeric sub).
 * The login with FFPF ID was removed in v2.54.0; its sessions and tokens still open until they expire (30 days).
 */
const ACCOUNT_SUB = /^(github:\d+|ffpf:[a-z0-9]{1,64})$/

/** The login cookie's name: __Host- over HTTPS, which makes the browser insist on Secure, Path=/ and no Domain. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-typle-session' : 'typle-session'
}

/**
 * The bytes of base64url text written strictly, as Go's base64.RawURLEncoding.Strict() reads it: no padding, no other
 * characters, and the unused bits of the last character zero, so that one value has one spelling. Otherwise null.
 */
export function strictBase64url(text: string): Buffer | null {
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

/** How long a login lasts: a session is never sealed again, and ends this long after the login. */
export const SESSION_MAX_AGE = 30 * 24 * 3600

/**
 * The JSON of claims as the Go backend signed it (session.encode): JSON.stringify, with U+2028 and U+2029 written
 * escaped as Go's encoder writes them. The keys must be given in the order of Go's wire struct.
 */
function encodeClaims(claims: Record<string, string | number | boolean>): string {
  return JSON.stringify(claims).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** value sealed with key: base64url(JSON) + "." + base64url(HMAC-SHA256 of that text), as the Go backend sealed it. */
function seal(key: Buffer, claims: Record<string, string | number | boolean>): string {
  const payload = Buffer.from(encodeClaims(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

/** The login cookie (with the session key) or an app's token (with the app key) of session. */
export function sealSession(key: Buffer, session: Session): string {
  return seal(key, { sub: session.sub, name: session.name, image: session.image, iat: session.issuedAt, exp: session.expires })
}

/** A session that starts at now (whole seconds) and lasts SESSION_MAX_AGE. */
export function newSession(sub: string, name: string, image: string, now: number = Date.now() / 1000): Session {
  const issuedAt = Math.floor(now)
  return { sub, name, image, issuedAt, expires: issuedAt + SESSION_MAX_AGE }
}
