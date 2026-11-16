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
  /** The key of the administrator's cookie of /admin. */
  adminKey: Buffer,
  /** The key of the code a login an app started ends with, which the app trades for its token. */
  codeKey: Buffer,
  /** The key of the OAuth cookie, which holds a login in progress. */
  oauthKey: Buffer,
  /** The GitHub OAuth App the login goes through, when AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are both set. */
  github: GitHubSettings | null,
  /** The FFPF ID client, when FFPF_ID_ISSUER, FFPF_ID_CLIENT_ID and FFPF_ID_CLIENT_SECRET are all set. */
  ffpf: FfpfSettings | null,
  /** The logins that are configured, in the order the screen lists them. */
  providers: ('github' | 'ffpf')[],
  /** Whether POST /api/auth/local, the made-up login for development on this machine, is on. */
  localLogin: boolean,
  /** Whether AUTH_URL is HTTPS, which names the login cookie __Host-. */
  secure: boolean,
}

/** The GitHub OAuth App and the endpoints of GitHub it is used with (the tests point them elsewhere). */
export type GitHubSettings = { clientId: string, clientSecret: string, authorizeUrl: string, tokenUrl: string, apiUrl: string }

/** The FFPF ID client: the portal's issuer, without one trailing slash, and the client's credentials. */
export type FfpfSettings = { issuer: string, clientId: string, clientSecret: string }

/** The HKDF info of each key: the same as Go's (server/internal/session), so that each kind opens only as itself. */
const RATE_LIMIT_INFO = 'typle gallery-rate-limit v1'
const SESSION_INFO = 'typle session v1'
const APP_INFO = 'typle app session v1'
const ADMIN_INFO = 'typle admin v2'
const CODE_INFO = 'typle app code v1'
const OAUTH_INFO = 'typle oauth v1'

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
    adminKey: deriveKey(secret, ADMIN_INFO),
    codeKey: deriveKey(secret, CODE_INFO),
    oauthKey: deriveKey(secret, OAUTH_INFO),
    github: env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET
      ? {
          clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET,
          authorizeUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', apiUrl: 'https://api.github.com',
        }
      : null,
    ffpf: env.FFPF_ID_ISSUER && env.FFPF_ID_CLIENT_ID && env.FFPF_ID_CLIENT_SECRET
      ? { issuer: env.FFPF_ID_ISSUER.replace(/\/$/, ''), clientId: env.FFPF_ID_CLIENT_ID, clientSecret: env.FFPF_ID_CLIENT_SECRET }
      : null,
    providers: [
      ...(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET ? ['github' as const] : []),
      ...(env.FFPF_ID_ISSUER && env.FFPF_ID_CLIENT_ID && env.FFPF_ID_CLIENT_SECRET ? ['ffpf' as const] : []),
    ],
    localLogin: env.VERCEL !== '1' && localLoginAllowed(env, base),
    secure: base.protocol === 'https:',
  }
}

/** The hash the rate limit counts a client by: the first bytes of the HMAC-SHA256 of its IP. The IP is never kept. */
export function clientMac(key: Buffer, ip: string): Buffer {
  return createHmac('sha256', key).update(ip).digest().subarray(0, CLIENT_MAC_SIZE)
}

/**
 * Whether the local login may be on: LOCAL_DEVELOPMENT_LOGIN is 1 and AUTH_URL is plain http to this machine, a
 * loopback name or address, or a private IPv4 address that LOCAL_DEVELOPMENT_LAN_HOST names exactly. As the Go backend
 * judged it (localLoginAllowed), and never on Vercel. Unlike the page's localDevelopmentEnabled it does not ask for
 * NODE_ENV=development, so that the end-to-end tests' production build can use it.
 */
function localLoginAllowed(env: Record<string, string | undefined>, base: URL): boolean {
  if (env.LOCAL_DEVELOPMENT_LOGIN !== '1' || base.protocol !== 'http:') return false
  const host = base.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true
  const octets = host.split('.')
  if (octets.length !== 4 || !octets.every(octet => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return false
  const [a, b] = octets.map(Number)
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  return isPrivate && env.LOCAL_DEVELOPMENT_LAN_HOST === host
}
