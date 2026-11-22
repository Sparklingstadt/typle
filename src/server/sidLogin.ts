// The login with Sparklingstadt ID (https://id.sparklingstadt.com), the OpenID Connect provider shared by the
// Sparklingstadt services: the parts of its Auth.js provider that decide something, kept apart so that the unit tests
// can run them. A Sparklingstadt ID is the account sid:<sub>, unless typle_sid_links links it to an account of another
// login (src/server/sidLinks.ts, read by jwtCallback in src/server/authOptions.ts).

/** The provider's id, which names /api/auth/signin/sid and /api/auth/callback/sid. */
export const SID_PROVIDER_ID = 'sid'

/** The form of a sub, as src/server/session.ts accepts sid:<sub>. */
const SUB = /^[a-z0-9]{1,64}$/

/** The claims of a Sparklingstadt ID token that the app reads. */
export type SidClaims = { sub: string, email?: string, email_verified?: unknown, name?: string | null }

/**
 * The account a Sparklingstadt ID login makes: sid:<sub>, named by the ID's name, or by its address before @ when the
 * name is blank. An ID whose address is not confirmed, or whose sub is not of its form, is refused (thrown), which
 * Auth.js answers by sending the browser back to the sign-in page with an error.
 */
export function sidProfile(profile: SidClaims): { id: string, name: string, image: '' } {
  if (profile.email_verified !== true) throw new Error('Sparklingstadt ID: the address is not confirmed')
  if (typeof profile.sub !== 'string' || !SUB.test(profile.sub)) throw new Error('Sparklingstadt ID: the sub is not of its form')
  const name = profile.name?.trim() || (profile.email ?? '').split('@')[0]
  return { id: `sid:${profile.sub}`, name, image: '' }
}

/**
 * The cookie that makes the next Sparklingstadt ID login ask for the password (prompt=login): the ID server keeps its
 * own login, so without it a browser signed out of this app would be let straight back in. It is left by a sign-out
 * that went through and removed by a Sparklingstadt ID login that succeeded, as the FFPF ID login did in v2.6.4.
 */
export const SID_RELOGIN_COOKIE = 'typle-sid-relogin'
/** How long the cookie is kept: the longest a login lasts (SESSION_MAX_AGE). */
const RELOGIN_MAX_AGE = 30 * 24 * 3600

const hasReloginCookie = (request: Request) => (request.headers.get('Cookie') ?? '').split(';')
  .some(part => part.trim().startsWith(`${SID_RELOGIN_COOKIE}=`))

/** The URL to start a Sparklingstadt ID login at with prompt=login when the cookie asks for it, else null: as it is. */
export function sidSignInUrl(request: Request): string | null {
  const url = new URL(request.url)
  if (url.pathname !== `/api/auth/signin/${SID_PROVIDER_ID}` || !hasReloginCookie(request)) return null
  url.searchParams.set('prompt', 'login')
  return url.href
}

/** Whether a URL Auth.js answered with (where to go next) is not its error page or the sign-in page with an error. */
const withoutError = (location: string | null | undefined, base: string) => {
  if (!location) return false
  const url = new URL(location, base)
  return !url.searchParams.has('error') && url.pathname !== '/api/auth/error'
}

/** Whether response is a sign-out that went through: Auth.js's answer for next-auth/react (JSON), or its redirect. */
async function signedOut(request: Request, response: Response): Promise<boolean> {
  const path = new URL(request.url).pathname
  if (request.method !== 'POST') return false
  if (path === '/api/account/signout-everywhere') return response.ok
  if (path !== '/api/auth/signout') return false
  if (response.status >= 300 && response.status < 400) return withoutError(response.headers.get('Location'), request.url)
  if (!response.ok) return false
  const body: unknown = await response.clone().json().catch(() => null)
  const url = body && typeof body === 'object' && 'url' in body ? body.url : null
  return typeof url === 'string' && withoutError(url, request.url)
}

/**
 * response, with the cookie left after a sign-out that went through (POST /api/auth/signout or
 * /api/account/signout-everywhere), or removed after a Sparklingstadt ID login that succeeded (the callback sends the
 * browser on, not back to the sign-in page with an error). Any other response is answered as it is.
 */
export async function withSidRelogin(request: Request, response: Response, secure: boolean): Promise<Response> {
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  let cookie: string | null = null
  if (await signedOut(request, response)) {
    cookie = `${SID_RELOGIN_COOKIE}=1; ${attributes}; Max-Age=${RELOGIN_MAX_AGE}`
  } else if (new URL(request.url).pathname === `/api/auth/callback/${SID_PROVIDER_ID}` && hasReloginCookie(request)
    && response.status >= 300 && response.status < 400 && withoutError(response.headers.get('Location'), request.url)) {
    cookie = `${SID_RELOGIN_COOKIE}=; ${attributes}; Max-Age=0`
  }
  if (!cookie) return response
  // A copy, as the headers of a response may be immutable (Response.redirect).
  const answered = new Response(response.body, response)
  answered.headers.append('Set-Cookie', cookie)
  return answered
}
