import { NextRequest } from 'next/server'
import { handlers, providerIds } from '@/auth'
import { authPathKnown } from '@/server/authOptions'
import { refuse } from '@/server/response'
import { readLoginSettings } from '@/server/settings'
import { sidSignInUrl, withSidRelogin } from '@/server/sidLogin'

// /api/auth/*: the login, the session and signing out, answered by Auth.js (src/auth.ts). A path it does not serve (the
// removed /api/auth/token and /api/auth/local, a provider not in use) is not found, as before Auth.js.

const known = (request: NextRequest) => authPathKnown(request.nextUrl.pathname, providerIds)

/**
 * Auth.js's answer to request, with prompt=login added to a Sparklingstadt ID login after a sign-out, and the cookie
 * that asks for it left or removed (src/server/sidLogin.ts).
 */
async function answer(request: NextRequest, handler: (request: NextRequest) => Promise<Response>): Promise<Response> {
  if (!known(request)) return refuse(404, 'notFound')
  const url = sidSignInUrl(request)
  const response = await handler(url ? new NextRequest(url, request) : request)
  return withSidRelogin(request, response, readLoginSettings()?.secure ?? false)
}

export const GET = (request: NextRequest) => answer(request, handlers.GET)
export const POST = (request: NextRequest) => answer(request, handlers.POST)
