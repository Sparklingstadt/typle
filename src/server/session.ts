import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

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

/**
 * The administrator signed in to /admin: the FFPF ID account's verified email and its sub (without "ffpf:"), as the
 * Go backend sealed it (session.Keys.SealAdmin) at the end of a login to the dashboard (sealAdmin since v2.46.10). Times are Unix seconds.
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

/** How long a login lasts: a session is never sealed again, and ends this long after the login. */
export const SESSION_MAX_AGE = 30 * 24 * 3600

/**
 * The JSON of claims as the Go backend signs it (session.encode): JSON.stringify, with U+2028 and U+2029 written
 * escaped as Go's encoder writes them. The keys must be given in the order of Go's wire struct.
 */
function encodeClaims(claims: Record<string, string | number | boolean>): string {
  return JSON.stringify(claims).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** value sealed with key: base64url(JSON) + "." + base64url(HMAC-SHA256 of that text), as the Go backend seals it. */
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

/**
 * The end of a login an app (iPad, Mac, Android, Windows) started: who signed in, for the app that holds the verifier of
 * challenge. The login's callback (src/server/signin.ts) seals it, and the app trades it for a token.
 */
export type AppCode = { sub: string, name: string, image: string, challenge: string, expires: number }

/** The app code in value if it was sealed with key, has not expired at now, is for an account, and has a challenge. */
export function openCode(key: Buffer, value: string, now: number = Date.now() / 1000): AppCode | null {
  const claims = openClaims(key, value)
  if (!claims) return null
  const { sub, name, image, challenge, exp } = claims
  if (typeof sub !== 'string' || typeof name !== 'string' || typeof image !== 'string' || typeof challenge !== 'string' ||
    !Number.isInteger(exp)) return null
  if (!(now < (exp as number)) || !ACCOUNT_SUB.test(sub) || challenge === '') return null
  return { sub, name, image, challenge, expires: exp as number }
}

/** The S256 code challenge of a PKCE verifier. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** How long an app has to trade the code of its login for a token. */
const APP_CODE_MAX_AGE = 120

/** The code of a login an app started, for sub, which expires APP_CODE_MAX_AGE after now. */
export function newCode(sub: string, name: string, image: string, challenge: string, now: number = Date.now() / 1000): AppCode {
  return { sub, name, image, challenge, expires: Math.floor(now) + APP_CODE_MAX_AGE }
}

/** The app code, sealed with the code key, that the app trades for its token at /api/auth/token. */
export function sealCode(key: Buffer, code: AppCode): string {
  return seal(key, { sub: code.sub, name: code.name, image: code.image, challenge: code.challenge, exp: code.expires })
}

/** How long an administrator's session of /admin lasts. It is never renewed: the administrator signs in again. */
export const ADMIN_MAX_AGE = 12 * 3600

/** An administrator's session that starts at now (whole seconds). */
export function newAdmin(email: string, sub: string, now: number = Date.now() / 1000): Admin {
  const issuedAt = Math.floor(now)
  return { email, sub, issuedAt, expires: issuedAt + ADMIN_MAX_AGE }
}

/** The administrator's cookie of admin, sealed with the admin key. */
export function sealAdmin(key: Buffer, admin: Admin): string {
  return seal(key, { email: admin.email, sub: admin.sub, iat: admin.issuedAt, exp: admin.expires })
}

/**
 * A login in progress, as the OAuth cookie (typle-oauth) holds it between /api/auth/signin and the callback: the state
 * and the PKCE verifier, where to go afterwards, and when it ends (Unix seconds). challenge is an app's own PKCE challenge
 * when an app started the login, admin a login to /admin, provider "ffpf" for FFPF ID ("" for GitHub), and nonce the
 * OpenID Connect nonce of an FFPF ID login.
 */
export type PendingLogin = {
  state: string, verifier: string, returnTo: string, challenge: string, admin: boolean, provider: string, nonce: string, expires: number,
}

/** How long a login may take between leaving for GitHub or FFPF ID and coming back. */
export const OAUTH_MAX_AGE = 600
/** The name of the OAuth cookie. */
export const OAUTH_COOKIE = 'typle-oauth'

/**
 * The OAuth cookie of pending, sealed with the OAuth key. challenge, admin, provider and nonce are left out when empty or
 * false, as the Go backend left them out, so that the cookie of a browser's GitHub login keeps its old form.
 */
export function sealOAuth(key: Buffer, pending: PendingLogin): string {
  const claims: Record<string, string | number | boolean> = {
    state: pending.state, verifier: pending.verifier, returnTo: pending.returnTo, exp: pending.expires,
  }
  if (pending.challenge) claims.challenge = pending.challenge
  if (pending.admin) claims.admin = true
  if (pending.provider) claims.provider = pending.provider
  if (pending.nonce) claims.nonce = pending.nonce
  return seal(key, claims)
}

/**
 * The login in progress in value if it was sealed with the OAuth key and has not expired at now. As Go's json.Unmarshal
 * read it: a field that is absent or null is empty, and one of another type makes the cookie unreadable.
 */
export function openOAuth(key: Buffer, value: string, now: number = Date.now() / 1000): PendingLogin | null {
  const claims = openClaims(key, value)
  if (!claims) return null
  const text = (name: string): string | null => {
    const field = claims[name]
    return field === undefined || field === null ? '' : typeof field === 'string' ? field : null
  }
  const [state, verifier, returnTo, challenge, provider, nonce] = ['state', 'verifier', 'returnTo', 'challenge', 'provider', 'nonce'].map(text)
  const { admin, exp } = claims
  if (state === null || verifier === null || returnTo === null || challenge === null || provider === null || nonce === null) return null
  if (admin !== undefined && admin !== null && typeof admin !== 'boolean') return null
  if (exp !== undefined && exp !== null && !Number.isInteger(exp)) return null
  const expires = typeof exp === 'number' ? exp : 0
  if (!(now < expires)) return null
  return { state, verifier, returnTo, challenge, admin: admin === true, provider, nonce, expires }
}
