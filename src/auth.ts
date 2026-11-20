import NextAuth from 'next-auth'
import type { Provider } from 'next-auth/providers'
import Credentials from 'next-auth/providers/credentials'
import GitHub from 'next-auth/providers/github'
import { revokedSoon } from './server/account'
import {
  authorizeLocal, githubConfigured, githubProfile, jwtCallback, redirectCallback, redirectProxyUrl, sessionCallback,
} from './server/authOptions'
import { decodeSession, encodeSession } from './server/authJwt'
import { pool } from './server/database'
import { clientIp } from './server/limits'
import { authorizePassword } from './server/passwordLogin'
import { SESSION_MAX_AGE, sessionCookieName } from './server/session'
import { readLoginSettings } from './server/settings'

// The login, by Auth.js: GitHub, the ID and password, and the made-up local login for development, under /api/auth
// (src/app/api/auth/[...nextauth]/route.ts). The session is Auth.js's JWT one, but its cookie keeps the name and the
// form of the login cookie the Go backend sealed (src/server/session.ts), so the logins made before keep working, and
// the Route Handlers and the Go and Kotlin backends read it as they did. What the callbacks decide is in
// src/server/authOptions.ts.

/** The key the login cookie is sealed with, from AUTH_SECRET and AUTH_URL; without them no session is read or made. */
function sessionKey(): Buffer {
  const settings = readLoginSettings()
  if (!settings) throw new Error('AUTH_SECRET or AUTH_URL is missing or invalid')
  return settings.sessionKey
}

const settings = readLoginSettings()
const secure = settings?.secure ?? false

const providers: Provider[] = []
/** The ids of the providers in use, which name the paths /api/auth/signin/<id> and /api/auth/callback/<id>. */
export const providerIds: string[] = []
if (githubConfigured()) {
  providers.push(GitHub({
    // No scope: the app only needs to know who the user is, as the login before Auth.js asked for nothing more.
    authorization: { params: { scope: '' } },
    profile: githubProfile,
    redirectProxyUrl: redirectProxyUrl(settings),
  }))
  providerIds.push('github')
}
providers.push(Credentials({
  id: 'password',
  credentials: { loginId: {}, password: { type: 'password' } },
  // Auth.js passes a Request rebuilt with the original headers, so x-forwarded-for is the client's as elsewhere.
  authorize: (credentials, request) => authorizePassword(pool(), credentials, clientIp(request)),
}))
// next-auth/react's signIn('password') posts to /api/auth/callback/password, which authPathKnown lets through by this id.
providerIds.push('password')
if (settings?.localLogin) {
  providers.push(Credentials({
    id: 'local',
    credentials: {},
    // authorize reads the settings again, so that it never signs in once the local login is off.
    authorize: () => authorizeLocal(),
  }))
  providerIds.push('local')
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE },
  cookies: {
    sessionToken: {
      name: sessionCookieName(secure),
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure },
    },
  },
  jwt: {
    // Auth.js writes the session again each time it reads it; encodeSession keeps the login's iat and exp, so the login
    // still ends 30 days after it was made.
    encode: ({ token }) => encodeSession(token ?? {}, sessionKey()),
    decode: ({ token }) => token ? decodeSession(token, sessionKey()) : null,
  },
  callbacks: {
    jwt: jwtCallback((sub, issuedAt) => revokedSoon(pool, sub, issuedAt)),
    session: ({ session, token }) => sessionCallback({ session, token }),
    ...(settings ? { redirect: redirectCallback(settings.origin) } : {}),
  },
})
