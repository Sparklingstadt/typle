import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { decodeSession, encodeSession } from './server/authJwt'
import { SESSION_MAX_AGE, sessionCookieName } from './server/session'
import { readLoginSettings } from './server/settings'

// The login, by Auth.js: GitHub, under /api/auth (src/app/api/auth/[...nextauth]/route.ts). The session is Auth.js's JWT
// one, but its cookie keeps the name and the form of the login cookie the Go backend sealed (src/server/session.ts), so
// the logins made before keep working, and the Route Handlers and the Go and Kotlin backends read it as they did.

/** The key the login cookie is sealed with, from AUTH_SECRET and AUTH_URL; without them no session is read or made. */
function sessionKey(): Buffer {
  const settings = readLoginSettings()
  if (!settings) throw new Error('AUTH_SECRET or AUTH_URL is missing or invalid')
  return settings.sessionKey
}

const secure = readLoginSettings()?.secure ?? false

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      // No scope: the app only needs to know who the user is, as the login before Auth.js asked for nothing more.
      authorization: { params: { scope: '' } },
      profile(profile) {
        // The profile name if it says anything, else the login, as the login before Auth.js named the account.
        const name = profile.name?.trim() ? profile.name.trim() : profile.login.trim()
        return { id: `github:${profile.id}`, name, image: profile.avatar_url }
      },
    }),
  ],
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
    jwt({ token, account }) {
      // At a login the account is the provider's: for OAuth, Auth.js gives the user a random id and keeps the id of
      // profile() (github:<number>) as providerAccountId, which is the account ID.
      if (account) token.sub = account.providerAccountId
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      session.user.image = token.picture || null
      // Auth.js dates the session 30 days from now each time it is read; the login ends at the cookie's own exp.
      if (typeof token.exp === 'number') session.expires = new Date(token.exp * 1000).toISOString() as typeof session.expires
      return session
    },
  },
})
