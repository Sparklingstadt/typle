import { randomBytes, timingSafeEqual } from 'node:crypto'
import { cookieValue } from './account'
import { cookieHeader } from './auth'
import { exchangeFfpfCode, ffpfAuthorizeUrl, FfpfError, type FfpfUser, type JwksCache } from './ffpf'
import { exchangeGitHubCode, githubAuthorizeUrl, githubUser } from './github'
import { encodeValues, parseQuery, safeReturnTo, trimSpace, DEFAULT_RETURN_TO } from './goUrl'
import { reportFailure } from './report'
import { methodNotAllowed, refuse } from './response'
import {
  challengeOf, newCode, newSession, OAUTH_COOKIE, OAUTH_MAX_AGE, openOAuth, sealCode, sealOAuth, sealSession, SESSION_MAX_AGE,
  sessionCookieName, type PendingLogin,
} from './session'
import { readLoginSettings, type LoginSettings } from './settings'

// The login itself: /api/auth/signin sends the browser to GitHub or FFPF ID, and the provider sends it back to
// /api/auth/callback/github or /api/auth/callback/ffpf, which signs it in. A login an app (iPad, Mac, Android, Windows)
// starts ends at typle-r://login with a code the app trades for its token (/api/auth/token). As the Go backend answered
// them, without the login to the administrator's dashboard (admin=1), which was removed in v2.48.0.

export type LoginPath = 'signin' | 'github' | 'ffpf'
type Provider = 'github' | 'ffpf'

const CALLBACK: Record<Provider, string> = { github: '/api/auth/callback/github', ffpf: '/api/auth/callback/ffpf' }
/** The cookie that marks a browser that signed out: its next login with FFPF ID asks for the password again. */
const RELOGIN_COOKIE = 'typle-ffpf-relogin'
/** Where a login an app started ends: the apps wait for this scheme and take the URL. */
const APP_RETURN = 'typle-r://login'
/** The clients of a login an app starts. Every app logs in the same way. */
const APP_CLIENTS = new Set(['ipad', 'macos', 'android', 'windows'])
/** An S256 code challenge (RFC 7636): 43 base64url characters. */
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** 32 random bytes, as a state, a PKCE verifier or a nonce is made. */
const random = () => randomBytes(32).toString('base64url')

/**
 * A redirect, with the cookies it sets; no cache keeps it, as it may set a cookie. The characters of the Location that
 * are not ASCII are percent-encoded as UTF-8, which a browser follows to the same page: the Go backend sent them as raw
 * UTF-8, which Vercel re-encodes as if each byte were a character of its own.
 */
function goTo(location: string, cookies: string[] = []): Response {
  const response = new Response(null, { status: 302, headers: { Location: location.replace(/[^\x00-\x7f]+/gu, encodeURIComponent), 'Cache-Control': 'no-store' } })
  for (const value of cookies) response.headers.append('Set-Cookie', value)
  return response
}

/** The end of a login an app started, with the code or the error. */
const toApp = (key: 'code' | 'error', value: string) => `${APP_RETURN}?${encodeValues({ [key]: value })}`

const oauthCookie = (login: LoginSettings, value: string, maxAge: number) => cookieHeader(OAUTH_COOKIE, value, '/api/auth', maxAge, 'Lax', login.secure)
const dropRelogin = (login: LoginSettings) => cookieHeader(RELOGIN_COOKIE, '', '/api/auth', 0, 'Lax', login.secure)

/** Whether the provider's login is configured. */
const ready = (login: LoginSettings, provider: Provider) => provider === 'ffpf' ? login.ffpf !== null : login.github !== null

/** The answer when the provider's login is not configured. It is only logged: a missing setting is not a failure to report. */
function unavailable(request: Request, provider: Provider): Response {
  console.warn(`${request.method} ${new URL(request.url).pathname}: the ${provider} login is not configured`)
  return refuse(503, 'authUnavailable')
}

/** The first value of key in the query of the request, read as the Go backend read it. */
function queryOf(request: Request): (key: string) => string {
  const query = parseQuery(new URL(request.url).search.slice(1))
  return key => query.get(key)?.[0] ?? ''
}

/**
 * GET /api/auth/signin: sends the browser to GitHub, or with provider=ffpf to FFPF ID, with a state and a PKCE challenge
 * (and for FFPF ID a nonce), and keeps them, the verifier and where to return to in the OAuth cookie. With client=ipad,
 * macos, android or windows and the app's own S256 code_challenge, the login is that app's. admin=1, which asked for a
 * login to the removed dashboard, is not read.
 */
function signin(request: Request, login: LoginSettings, now: number): Response {
  const get = queryOf(request)
  const provider: Provider = get('provider') === 'ffpf' ? 'ffpf' : 'github'
  if (!ready(login, provider)) return unavailable(request, provider)
  const returnTo = safeReturnTo(get('returnTo'))
  let challenge = ''
  if (APP_CLIENTS.has(get('client'))) {
    challenge = get('code_challenge')
    if (!PKCE_CHALLENGE.test(challenge)) return goTo(toApp('error', 'loginFailed'))
  }
  const pending: PendingLogin = {
    state: random(), verifier: random(), returnTo, challenge, provider: provider === 'ffpf' ? 'ffpf' : '', nonce: '',
    expires: Math.floor(now) + OAUTH_MAX_AGE,
  }
  let location: string
  if (provider === 'ffpf') {
    pending.nonce = random()
    const signedOut = cookieValue(request, RELOGIN_COOKIE) !== null
    location = ffpfAuthorizeUrl(login.ffpf!, pending.state, challengeOf(pending.verifier), pending.nonce, login.origin + CALLBACK.ffpf, signedOut)
  } else {
    location = githubAuthorizeUrl(login.github!, pending.state, challengeOf(pending.verifier), login.origin + CALLBACK.github)
  }
  return goTo(location, [oauthCookie(login, sealOAuth(login.oauthKey, pending), OAUTH_MAX_AGE)])
}

/** Whether two strings are the same, in a time that does not tell how much of them is. */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Who a provider says signed in, as the session holds it. */
type SignedIn = { sub: string, name: string, image: string }

/**
 * GET /api/auth/callback/github and /api/auth/callback/ffpf: where the provider sends the browser back to. Whatever
 * happens, the OAuth cookie is spent and the browser goes back to the page it left, signed in only if everything checked
 * out: the cookie was started for this provider, its state matches, and the provider vouches for the account. A login an
 * app started goes back to the app, with a code or loginFailed, and no cookie.
 */
async function callback(provider: Provider, request: Request, login: LoginSettings, now: number, jwks?: JwksCache): Promise<Response> {
  if (!ready(login, provider)) return unavailable(request, provider)
  const cookies = [oauthCookie(login, '', 0)]
  const value = cookieValue(request, OAUTH_COOKIE)
  const pending = value === null ? null : openOAuth(login.oauthKey, value, now)
  const returnTo = pending ? safeReturnTo(pending.returnTo) : DEFAULT_RETURN_TO
  const fail = () => goTo(pending?.challenge ? toApp('error', 'loginFailed') : returnTo, cookies)
  const get = queryOf(request)
  const state = get('state')
  const code = get('code')
  // The cookie of a GitHub login has no provider, and that of an FFPF ID login "ffpf".
  if (!pending || (pending.provider || 'github') !== provider || get('error') !== '' || !state || !code || !sameText(state, pending.state)) return fail()
  const redirectUri = login.origin + CALLBACK[provider]
  let user: SignedIn
  if (provider === 'ffpf') {
    let ffpfUser: FfpfUser
    try {
      ffpfUser = await exchangeFfpfCode(login.ffpf!, code, pending.verifier, redirectUri, pending.nonce, now, jwks)
    } catch (error) {
      // A refusal comes of what the user did, such as a code used twice, and is not the app's failure.
      if (!(error instanceof FfpfError && error.kind === 'rejected')) reportFailure(request, error, 'auth.callback')
      return fail()
    }
    user = { sub: `ffpf:${ffpfUser.sub}`, name: trimSpace(ffpfUser.name), image: '' }
  } else {
    try {
      const token = await exchangeGitHubCode(login.github!, code, pending.verifier, redirectUri)
      const githubAccount = await githubUser(login.github!, token)
      // The profile name if it says anything, else the login.
      const name = trimSpace(githubAccount.name) !== '' ? githubAccount.name : githubAccount.login
      user = { sub: `github:${githubAccount.id}`, name: trimSpace(name), image: githubAccount.avatarUrl }
    } catch (error) {
      reportFailure(request, error, 'auth.callback')
      return fail()
    }
  }
  if (pending.challenge) return goTo(toApp('code', sealCode(login.codeKey, newCode(user.sub, user.name, user.image, pending.challenge, now))), cookies)
  if (provider === 'ffpf') cookies.push(dropRelogin(login))
  const session = sealSession(login.sessionKey, newSession(user.sub, user.name, user.image, now))
  cookies.push(cookieHeader(sessionCookieName(login.secure), session, '/', SESSION_MAX_AGE, 'Lax', login.secure))
  return goTo(returnTo, cookies)
}

/**
 * Answers path of the login: the settings first (503 authUnavailable without them), then the method (GET only: the
 * login steps set cookies and call the providers, which a HEAD must not do), then whether the provider is configured.
 */
export async function answerLogin(path: LoginPath, request: Request,
  settings: () => LoginSettings | null = readLoginSettings, clock: () => number = () => Date.now() / 1000, jwks?: JwksCache): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method !== 'GET') return methodNotAllowed(['GET'])
  const now = clock()
  return path === 'signin' ? signin(request, login, now) : callback(path, request, login, now, jwks)
}
