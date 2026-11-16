import { createHmac, hkdfSync } from 'node:crypto'

// The login settings that the Route Handlers need: AUTH_URL, whose origin is the only one a write may come from, and
// AUTH_SECRET, from which the keys are derived as the Go backend derives them (server/internal/session), so that what
// one of them made the other reads.

export type LoginSettings = {
  /** The app's own origin, as a browser writes it in the Origin header. */
  origin: string,
  /** The key that hashes a client's IP address for the gallery's rate limit. */
  rateLimitKey: Buffer,
  /** Whether this runs on Vercel, whose forwarding headers are the only ones that tell the client's IP. */
  onVercel: boolean,
  /** The keys of the login cookie and of the iPad and Mac apps' token. */
  sessionKey: Buffer,
  appKey: Buffer,
  /** Whether AUTH_URL is HTTPS, which names the login cookie __Host-. */
  secure: boolean,
}

/** The HKDF info of each key: the same as Go's (server/internal/session), so that each kind opens only as itself. */
const RATE_LIMIT_INFO = 'typle gallery-rate-limit v1'
const SESSION_INFO = 'typle session v1'
const APP_INFO = 'typle app session v1'

/** A key of 32 bytes derived from AUTH_SECRET for one kind of value. */
const deriveKey = (secret: string, info: string) => Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))

/** The bytes of a client's hash that the rate limit keeps: half of the SHA-256 output, as Go's ClientMACSize. */
const CLIENT_MAC_SIZE = 16

/**
 * The login settings from the environment, or null when they cannot be used: AUTH_SECRET is empty, or AUTH_URL is not
 * an http or https URL with a host.
 */
export function readLoginSettings(env: Record<string, string | undefined> = process.env): LoginSettings | null {
  const secret = env.AUTH_SECRET ?? ''
  let base: URL
  try {
    base = new URL(env.AUTH_URL ?? '')
  } catch {
    return null
  }
  if (!secret || (base.protocol !== 'http:' && base.protocol !== 'https:') || !base.hostname) return null
  return {
    origin: base.origin,
    rateLimitKey: deriveKey(secret, RATE_LIMIT_INFO),
    onVercel: env.VERCEL === '1',
    sessionKey: deriveKey(secret, SESSION_INFO),
    appKey: deriveKey(secret, APP_INFO),
    secure: base.protocol === 'https:',
  }
}

/** The hash the rate limit counts a client by: the first bytes of the HMAC-SHA256 of its IP. The IP is never kept. */
export function clientMac(key: Buffer, ip: string): Buffer {
  return createHmac('sha256', key).update(ip).digest().subarray(0, CLIENT_MAC_SIZE)
}
