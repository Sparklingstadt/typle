import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { prisma } from './database'
import { accountEmail, accountIdFromEmail, betterAuthSettings, githubUser } from './authUser'
import { authPaths } from './authPaths'
import { localLogin } from './localLogin'
import { readLoginSettings } from './settings'
import { SID_PROVIDER_ID, sidAccountInfo, sidRelogin } from './sidLogin'
import { githubConfigured } from '../lib/githubLogin'
import { sidConfigured } from '../lib/sidLogin'

// `next build` imports every route module without the runtime environment, so it gets placeholders there (the database
// client connects only on its first query). Everywhere else the instance is built from the real environment: a missing
// DATABASE_URL or, in production, a missing secret fails at import.
const building = process.env.NEXT_PHASE === 'phase-production-build'
if (building) process.env.DATABASE_URL ??= 'postgresql://build:build@localhost:5432/build'
const settings = betterAuthSettings(building ? { BETTER_AUTH_SECRET: 'build-time-placeholder-secret-0f3a9c7e51d2b84a', AUTH_URL: 'http://localhost:3000', ...process.env } : process.env)
// Without this Better Auth would fall back to AUTH_SECRET and infer the base URL from requests.
if (!settings) throw new Error('BETTER_AUTH_SECRET must be set, and AUTH_URL must be an http(s) URL')

const MONTH_SECONDS = 30 * 24 * 60 * 60
const origin = settings ? new URL(settings.baseURL).origin : ''
const secure = origin.startsWith('https:')
/** Whether the development login is on, read on every request as Auth.js's Credentials provider did. */
const localLoginOn = () => readLoginSettings()?.localLogin === true

/**
 * Sparklingstadt ID, an OpenID Connect provider read from its discovery document: the authorization code with PKCE
 * (S256), state and nonce, the client authenticated with HTTP Basic, and an ID token that must check out against the
 * ID server's keys. Its user comes from that ID token's claims (sidAccountInfo), which refuses an unconfirmed address.
 * Signing out of the app does not sign out of the ID server (no RP-initiated logout); the relogin cookie asks it for
 * the password instead (src/server/sidLogin.ts).
 */
const sidProvider = () => genericOAuth({
  config: [{
    providerId: SID_PROVIDER_ID,
    name: 'Sparklingstadt ID',
    discoveryUrl: `${(process.env.AUTH_SID_ISSUER ?? '').replace(/\/+$/, '')}/.well-known/openid-configuration`,
    clientId: process.env.AUTH_SID_ID ?? '',
    clientSecret: process.env.AUTH_SID_SECRET,
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
    requireIdTokenVerification: true,
    authentication: 'basic',
    disableProviderLogout: true,
    getUserInfo: async tokens => sidAccountInfo(tokens),
  }],
})

/**
 * Better Auth over the app's database, answering /api/auth (src/app/api/auth/[...all]/route.ts): GitHub, Sparklingstadt
 * ID and the development login, each only when configured, and nothing else over HTTP (src/server/authPaths.ts). The user
 * ID is the account ID the providers give (github:<n>, sid:<sub>, github:0 for the local login), which is the owner_id of
 * the account's data; the address is made up from it (accountEmail), never read from a profile.
 */
export const auth = betterAuth({
  secret: settings?.secret,
  baseURL: settings?.baseURL,
  // Where a login may send the browser back to (callbackURL, errorCallbackURL): a path of this site or a URL at
  // AUTH_URL's origin, nothing else.
  trustedOrigins: [origin],
  // A login that fails without an errorCallbackURL of its own comes back to the sign-in page with ?error=<code>.
  onAPIError: { errorURL: `${origin}/signin` },
  // Better Auth limits /sign-in/* to 3 requests in 10 s for the password logins it guards. Starting a GitHub or
  // Sparklingstadt ID login checks no secret (the provider does), so it is limited like the other paths instead, and a
  // few clicks of the login button are not refused.
  rateLimit: { customRules: { '/sign-in/social': { window: 60, max: 100 } } },
  socialProviders: githubConfigured() ? {
    github: {
      clientId: process.env.AUTH_GITHUB_ID ?? '',
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',
      // No scope: the app only needs to know who the user is, as before. The address is made up (githubUser).
      disableDefaultScope: true,
      mapProfileToUser: profile => {
        const { id: _id, ...user } = githubUser(profile)
        return user
      },
    },
  } : {},
  plugins: [
    // First, so that no other plugin answers a path it refuses.
    authPaths(localLoginOn),
    sidRelogin(secure),
    localLogin(localLoginOn),
    // Not while building: its discovery document is fetched when the instance starts.
    ...(sidConfigured() && !building ? [sidProvider()] : []),
  ],
  database: prismaAdapter(prisma(), { provider: 'postgresql' }),
  user: { modelName: 'authUser' },
  session: {
    modelName: 'authSession',
    // A login lasts 30 days from its start and is never extended: no refresh of the row, and the cookie cache (which
    // lets a request skip the database) is short, so a deleted session (sign out everywhere) stops working in 5 minutes.
    expiresIn: MONTH_SECONDS,
    updateAge: MONTH_SECONDS,
    disableSessionRefresh: true,
    cookieCache: { enabled: true, maxAge: 300 },
  },
  account: {
    modelName: 'authAccount',
    // One account of typle-r is one login method; a second is linked by hand (npm run sid:link), never by Better Auth.
    accountLinking: { enabled: false },
  },
  verification: { modelName: 'authVerification' },
  databaseHooks: {
    user: {
      create: {
        // Better Auth's OAuth sign-up drops the provider's id and passes only its email, which the providers set to
        // accountEmail(<account ID>): the ID is taken back from it and becomes the user's id.
        before: async user => {
          const id = accountIdFromEmail(user.email)
          if (!id) throw new Error('A user needs an address made from its account ID (<id>@users.invalid)')
          return { data: { ...user, id, email: accountEmail(id), emailVerified: true } }
        },
      },
    },
  },
})
