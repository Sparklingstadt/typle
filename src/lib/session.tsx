"use client"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createAuthClient } from 'better-auth/react'
import { api } from '@/lib/api'

export type SessionUser = { id: string; name: string; image: string | null }
type SessionData = { user: SessionUser } | null
type SessionState = {
  data: SessionData
  status: 'loading' | 'authenticated' | 'unauthenticated'
  /** Reads the session again and resolves with what it is then: the previous state when the read failed. */
  update: () => Promise<SessionData>
}

// Better Auth's client, used for its requests only (the session is read by fetchSession). It talks to /api/auth of this site.
const authClient = createAuthClient({ basePath: '/api/auth' })

const SessionContext = createContext<SessionState>({ data: null, status: 'loading', update: async () => null })

// The waits before the first read is tried again. When all have failed, the session settles on signed out, so the app is
// usable as a guest.
const RETRY_DELAYS_MS = [1000, 2000, 4000]
const SESSION_TIMEOUT_MS = 10_000

/**
 * Reads the signed-in user from /api/auth/get-session, Better Auth's answer. Only a 200 answer says who is signed in: null when
 * the body is null or has no `user`. Anything else (a failed request, one that timed out, another status, a body that is
 * not the session) rejects, since it does not say that the user signed out.
 */
async function fetchSession(): Promise<SessionData> {
  // A request that hangs (a network that is half there) fails after a while, so that it does not stay in flight for good
  // and hold back every later check.
  const response = await fetch('/api/auth/get-session', { cache: 'no-store', signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) })
  if (response.status !== 200) throw new Error(`session answered ${response.status}`)
  const body: unknown = await response.json()
  if (body === null) return null
  if (typeof body !== 'object' || Array.isArray(body)) throw new Error('session answer is not an object')
  const user = (body as { user?: unknown }).user
  if (user === null || user === undefined) return null
  if (typeof user !== 'object' || typeof (user as { id?: unknown }).id !== 'string') throw new Error('session user is invalid')
  const { id, name, image } = user as { id: string, name?: unknown, image?: unknown }
  return { user: { id, name: typeof name === 'string' ? name : '', image: typeof image === 'string' && image ? image : null } }
}

const sameUser = (a: SessionData, b: SessionData) =>
  a?.user.id === b?.user.id && a?.user.name === b?.user.name && a?.user.image === b?.user.image

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SessionData>(null)
  const [loaded, setLoaded] = useState(false)
  // The same as data and loaded, for the callbacks of a read.
  const current = useRef<SessionData>(null)
  const settled = useRef(false)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inflight = useRef<Promise<SessionData> | null>(null)
  const failures = useRef(0)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The read a retry starts: load, set once it exists.
  const again = useRef(() => {})
  const settle = useCallback((next: SessionData) => {
    // The same user keeps the same object, so a refresh on focus renders nothing again.
    if (!sameUser(current.current, next)) current.current = next
    settled.current = true
    setData(current.current)
    setLoaded(true)
  }, [])
  // A forced read (update) always starts a new request. Only the newest request started is applied, so an older one that
  // resolves late cannot overwrite a fresher result. A read that is not forced joins the one already under way.
  //
  // A failed read changes nothing once the session is known: a passing failure, such as waking from sleep before the
  // network is back, must not sign the user out of the cloud lists. The first read is tried again after each delay of
  // RETRY_DELAYS_MS (sooner when a focus starts a read), and settles on signed out when all have failed.
  const load = useCallback((force: boolean): Promise<SessionData> => {
    if (!force && inflight.current) return inflight.current
    const id = ++latest.current
    clearTimeout(retry.current)
    const request: Promise<SessionData> = fetchSession().then((next) => {
      if (inflight.current === request) inflight.current = null
      if (!mounted.current || id !== latest.current) return current.current
      failures.current = 0
      settle(next)
      return current.current
    }, () => {
      if (inflight.current === request) inflight.current = null
      if (!mounted.current || id !== latest.current || settled.current) return current.current
      const delay = RETRY_DELAYS_MS[failures.current++]
      if (delay === undefined) settle(null)
      else retry.current = setTimeout(() => again.current(), delay)
      return current.current
    })
    inflight.current = request
    return request
  }, [settle])
  const refresh = useCallback(() => load(true), [load])
  useEffect(() => {
    mounted.current = true
    again.current = () => { void load(false) }
    void load(false)
    // Another tab may have signed in or out, or switched account: look again whenever this one comes back into view.
    const look = () => { if (document.visibilityState === 'visible') void load(false) }
    document.addEventListener('visibilitychange', look)
    window.addEventListener('focus', look)
    return () => {
      mounted.current = false
      clearTimeout(retry.current)
      document.removeEventListener('visibilitychange', look)
      window.removeEventListener('focus', look)
    }
  }, [load])
  const value = useMemo<SessionState>(() => ({
    data,
    status: !loaded ? 'loading' : data ? 'authenticated' : 'unauthenticated',
    update: refresh,
  }), [data, loaded, refresh])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  return useContext(SessionContext)
}

/**
 * Starts a login with provider and goes to where Better Auth sends the browser: the provider. The login comes back to
 * returnTo, a path of this site; a failed one comes back to /signin?error=<code>. Rejects, staying on the page, when the
 * login cannot be started: the request fails, or Better Auth answers with an error or with no URL to go to.
 */
async function signInWith(provider: 'sid' | 'github', returnTo: string): Promise<void> {
  // disableRedirect, so that a failed answer rejects here instead of the client following it.
  const { data, error } = await authClient.signIn.social({
    provider, callbackURL: returnTo, errorCallbackURL: '/signin', disableRedirect: true,
  })
  if (error || !data?.url) throw new Error(`${provider} sign-in could not start`)
  location.assign(data.url)
}

/** Goes to Sparklingstadt ID, and comes back to returnTo, a path of this site. Rejects, staying on the page, when the login cannot be started. */
export const signInWithSid = (returnTo: string): Promise<void> => signInWith('sid', returnTo)

/** Goes to GitHub, and comes back to returnTo, a path of this site. Rejects, staying on the page, when the login cannot be started. */
export const signInWithGitHub = (returnTo: string): Promise<void> => signInWith('github', returnTo)

/**
 * Signs in with the development login (POST /api/auth/sign-in/local, only answered while it is on). Rejects when it is
 * refused or does not answer with a user.
 */
export async function signInLocal(): Promise<void> {
  const { data, error } = await authClient.$fetch<{ user?: { id?: string } }>('/sign-in/local', { method: 'POST' })
  if (error || !data?.user?.id) throw new Error('local login was refused')
}

/**
 * Signs in to the shared demo account (POST /api/auth/sign-in/demo, only answered while DEMO_LOGIN is 1) and goes to
 * returnTo, a path of this site, with a full page load so that every screen reads the new session. Rejects, staying on
 * the page, when it is refused or does not answer with a user.
 */
export async function signInDemo(returnTo: string): Promise<void> {
  const { data, error } = await authClient.$fetch<{ user?: { id?: string } }>('/sign-in/demo', { method: 'POST' })
  if (error || !data?.user?.id) throw new Error('demo login was refused')
  location.assign(returnTo)
}

/**
 * Signs out of every device, this browser included, and goes home: every login until now
 * stops working, such as one that was stolen. Rejects, and stays on the page signed in, when the request fails or is
 * refused.
 */
export async function signOutEverywhere(): Promise<void> {
  await api('/api/account/signout-everywhere', { method: 'POST' })
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.assign('/home')
}

/** Signs out and goes home. Rejects, and stays on the page signed in, when the sign-out request fails or is refused. */
export async function signOut(): Promise<void> {
  const { data, error } = await authClient.signOut()
  if (error || !data?.success) throw new Error('sign-out failed')
  // A full page load, so nothing from the signed-in session stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.assign('/home')
}
