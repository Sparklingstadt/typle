import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './database'
import { accountEmail, betterAuthSettings } from './authUser'

// `next build` imports every route module without the runtime environment, so it gets placeholders there (the database
// client connects only on its first query). Everywhere else the instance is built from the real environment: a missing
// DATABASE_URL or, in production, a missing secret fails at import.
const building = process.env.NEXT_PHASE === 'phase-production-build'
if (building) process.env.DATABASE_URL ??= 'postgresql://build:build@localhost:5432/build'
const settings = betterAuthSettings(building ? { BETTER_AUTH_SECRET: 'build-time-placeholder', AUTH_URL: 'http://localhost:3000', ...process.env } : process.env)

const MONTH_SECONDS = 30 * 24 * 60 * 60

/**
 * Better Auth over the app's database. The sign-in methods (providers) are added where the handler is mounted. The user
 * ID is the account ID the providers give (github:<n>, sid:<sub>, github:0 for the local login), which is the owner_id of
 * the account's data; the address is made up from it (accountEmail), never read from a profile.
 */
export const auth = betterAuth({
  secret: settings?.secret,
  baseURL: settings?.baseURL,
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
        // The provider hands over the account ID as the user's id; keep it, and make up the address from it.
        before: async user => {
          if (!user.id) throw new Error('A user needs the account ID as its id')
          return { data: { ...user, id: user.id, email: accountEmail(user.id), emailVerified: true } }
        },
      },
    },
  },
})
