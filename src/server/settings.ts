// The login settings that the Route Handlers need: AUTH_URL, whose origin is the only one a write may come from.

export type LoginSettings = {
  /** The app's own origin, as a browser writes it in the Origin header. */
  origin: string,
  /** Whether the made-up login for development on this machine is on. */
  localLogin: boolean,
  /** Whether the shared demo account's login is on (DEMO_LOGIN=1), in production as anywhere else. */
  demoLogin: boolean,
  /** Whether AUTH_URL is HTTPS, which names the login cookie __Host-. */
  secure: boolean,
}

/**
 * The login settings from the environment, or null when they cannot be used: AUTH_URL is not an http or https URL
 * with a host.
 */
export function readLoginSettings(env: Record<string, string | undefined> = process.env): LoginSettings | null {
  let base: URL
  try {
    base = new URL(env.AUTH_URL ?? '')
  } catch {
    return null
  }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:') || !base.hostname) return null
  return {
    origin: base.origin,
    localLogin: env.VERCEL !== '1' && localLoginAllowed(env, base),
    demoLogin: env.DEMO_LOGIN === '1',
    secure: base.protocol === 'https:',
  }
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
