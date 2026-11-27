import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/server/betterAuth'

// /api/auth/*: the logins (GitHub, Sparklingstadt ID, the development one), the session and signing out, answered by
// Better Auth (src/server/betterAuth.ts). A path it is not meant to answer over HTTP is not found (src/server/authPaths.ts).

export const { GET, POST } = toNextJsHandler(auth)
