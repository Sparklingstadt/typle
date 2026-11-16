import { timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { currentUser, dropCookie, readRevokedAt, revokedBy } from './account'
import { reportFailure } from './report'
import { fromApp } from './request'
import { methodNotAllowed, refuse, reply, withoutBody } from './response'
import { challengeOf, newSession, openCode, sealSession, SESSION_MAX_AGE, sessionCookieName, type Session } from './session'
import { readLoginSettings, type LoginSettings } from './settings'

// The parts of the login that need no other service: who is signed in (/api/auth/session), the token an app (iPad, Mac,
// Android, Windows) trades its login's code for (/api/auth/token), signing out (of this browser, or of every device),
// and the made-up login for development (/api/auth/local). The login itself (/api/auth/signin and its callbacks) is src/server/signin.ts.

export type AuthPath = 'session' | 'token' | 'signout' | 'local'

const ALLOW: Record<AuthPath, string[]> = {
  session: ['GET', 'HEAD'], token: ['POST'], signout: ['POST'], local: ['POST'],
}

/** The cookie that marks a browser that signed out: its next login with FFPF ID asks for the password again. */
const RELOGIN_COOKIE = 'typle-ffpf-relogin'
/** The made-up account of the local login. */
const LOCAL_SUB = 'github:0'
const LOCAL_NAME = 'ローカル練習用' // i18n-ignore: a stored account name, as the Go backend gave it
/** Far more than a code and a verifier take. */
const MAX_TOKEN_REQUEST = 4096
/** What RFC 7636 allows as a code verifier. */
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
/** How long the session's answer waits for the revocations before it goes on without them. */
const REVOCATION_WAIT_MS = 1000

/** A Set-Cookie value written as Go's http.Cookie writes one; a maxAge of 0 removes the cookie. */
export function cookieHeader(name: string, value: string, path: string, maxAge: number, sameSite: 'Lax' | 'Strict', secure: boolean): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly${secure ? '; Secure' : ''}; SameSite=${sameSite}`
}

const relogin = (login: LoginSettings) => cookieHeader(RELOGIN_COOKIE, '1', '/api/auth', SESSION_MAX_AGE, 'Lax', login.secure)
const dropSession = (login: LoginSettings) => cookieHeader(sessionCookieName(login.secure), '', '/', 0, 'Lax', login.secure)

/** The answer of a request that has nothing to show, with the cookies it sets. */
function noContent(cookies: string[] = []): Response {
  const response = new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  for (const value of cookies) response.headers.append('Set-Cookie', value)
  return response
}

/** The signed-in user as the screen sees them; the image is null when there is none. */
const userOf = (user: Session) => ({ id: user.sub, name: user.name, image: user.image || null })

/**
 * Whether the account signed out of every device since user's login: null when that cannot be told within
 * REVOCATION_WAIT_MS, as the session never waits for the database (the account's data, read with the revocations, stays
 * out of reach all the same).
 */
async function revokedSoon(request: Request, open: () => Pool, user: Session): Promise<boolean | null> {
  const late = Symbol('late')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const db = open()
    const deadline = new Promise<typeof late>(resolve => { timer = setTimeout(() => resolve(late), REVOCATION_WAIT_MS) })
    const revokedAt = await Promise.race([readRevokedAt(db, user.sub), deadline])
    if (revokedAt === late) throw new Error(`the revocations were not read within ${REVOCATION_WAIT_MS} ms`)
    return revokedBy(user, revokedAt)
  } catch (error) {
    // Only logged, as the Go backend did: the answer goes on, and the account's data checks the revocations again.
    console.warn(`${request.method} ${new URL(request.url).pathname}: session.check:`, error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** GET /api/auth/session: who is signed in, and the logins the screen may offer. A revoked login is no one. */
async function session(request: Request, open: () => Pool, login: LoginSettings, now: number): Promise<Response> {
  const user = currentUser(request, login, now)
  const answer = { user: null as ReturnType<typeof userOf> | null, providers: login.providers }
  if (user) {
    if (await revokedSoon(request, open, user) === true) {
      const response = reply(200, answer)
      return fromApp(request) ? response : dropCookie(response, login)
    }
    answer.user = userOf(user)
  }
  return reply(200, answer)
}

/**
 * The code and the verifier of a token request, read as Go's json.Unmarshal read them into a struct: an object (or null)
 * whose members code and verifier are matched in any case, the later one winning, with null leaving a member as it was
 * and any other member ignored. Null when the body is not one.
 */
function readTokenBody(text: string): { code: string, verifier: string } | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const body = { code: '', verifier: '' }
  if (value === null) return body
  if (typeof value !== 'object' || Array.isArray(value)) return null
  for (const [key, member] of Object.entries(value)) {
    const name = key.toLowerCase()
    if (name !== 'code' && name !== 'verifier') continue
    if (member === null) continue
    if (typeof member !== 'string') return null
    body[name] = member
  }
  return body
}

/**
 * POST /api/auth/token: the code an app's login ended with and the verifier of its challenge, for the app's token. It
 * takes no cookie and sets none, so it needs no Origin: only the app that started the login knows the verifier. Any
 * mistake is loginFailed, and the app starts the login again.
 */
async function token(request: Request, login: LoginSettings, now: number): Promise<Response> {
  // A body whose stream breaks is a failed login, as one that is too large; a byte order mark is kept, so that such a
  // body is not JSON, as Go's json.Unmarshal judged it.
  const data = await request.arrayBuffer().then(buffer => new Uint8Array(buffer), () => null)
  const body = !data || data.byteLength > MAX_TOKEN_REQUEST ? null : readTokenBody(new TextDecoder('utf-8', { ignoreBOM: true }).decode(data))
  if (!body || !PKCE_VERIFIER.test(body.verifier)) return refuse(400, 'loginFailed')
  const code = openCode(login.codeKey, body.code, now)
  const challenge = Buffer.from(challengeOf(body.verifier))
  if (!code || challenge.length !== Buffer.byteLength(code.challenge) || !timingSafeEqual(challenge, Buffer.from(code.challenge))) {
    return refuse(400, 'loginFailed')
  }
  const signedIn = newSession(code.sub, code.name, code.image, now)
  return reply(200, { token: sealSession(login.appKey, signedIn), user: userOf(signedIn) })
}

/**
 * POST /api/auth/signout: forgets the login in this browser. With ?everywhere=1 it also revokes every login of the
 * account until now, which an app may ask for with its token and no Origin. That needs a login that is itself not
 * revoked, and the cookie is kept when the revocations cannot be read or written, so that the user can try again.
 */
async function signout(request: Request, open: () => Pool, login: LoginSettings, now: number): Promise<Response> {
  const everywhere = new URL(request.url).searchParams.get('everywhere') === '1'
  if (!(request.headers.get('Origin') === login.origin || (everywhere && fromApp(request)))) return refuse(403, 'forbiddenRequest')
  if (everywhere) {
    const user = currentUser(request, login, now)
    if (!user) return refuse(401, 'loginRequired')
    try {
      const db = open()
      if (revokedBy(user, await readRevokedAt(db, user.sub))) {
        const refusal = refuse(401, 'loginRequired')
        return fromApp(request) ? refusal : dropCookie(refusal, login)
      }
      await db.query(`INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, now())
        ON CONFLICT (owner_id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`, [user.sub])
    } catch (error) {
      reportFailure(request, error, 'session.revoke')
      return refuse(503, 'databaseUnavailable')
    }
  }
  return noContent(fromApp(request) ? [] : [dropSession(login), relogin(login)])
}

/** POST /api/auth/local: signs in as a made-up account, for practice on a development machine. */
function local(request: Request, login: LoginSettings, now: number): Response {
  if (request.headers.get('Origin') !== login.origin) return refuse(403, 'forbiddenRequest')
  const value = sealSession(login.sessionKey, newSession(LOCAL_SUB, LOCAL_NAME, '', now))
  return noContent([cookieHeader(sessionCookieName(login.secure), value, '/', SESSION_MAX_AGE, 'Lax', login.secure)])
}

/**
 * Answers path of /api/auth. As on the Go backend on Vercel, the login settings come first (503 authUnavailable without
 * them), then the local login when it is off (404 notFound, whatever the method), then the method.
 */
export async function answerAuth(path: AuthPath, request: Request, open: () => Pool,
  settings: () => LoginSettings | null = readLoginSettings, clock: () => number = () => Date.now() / 1000): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (path === 'local' && !login.localLogin) return refuse(404, 'notFound')
  if (!ALLOW[path].includes(request.method)) return methodNotAllowed(ALLOW[path])
  const now = clock()
  switch (path) {
    case 'session':
      return request.method === 'HEAD'
        ? withoutBody(await session(new Request(request, { method: 'GET' }), open, login, now))
        : session(request, open, login, now)
    case 'token': return token(request, login, now)
    case 'signout': return signout(request, open, login, now)
    case 'local': return local(request, login, now)
  }
}
