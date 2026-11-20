import type { NextRequest } from 'next/server'
import { handlers, providerIds } from '@/auth'
import { authPathKnown } from '@/server/authOptions'
import { refuse } from '@/server/response'

// /api/auth/*: the login, the session and signing out, answered by Auth.js (src/auth.ts). A path it does not serve (the
// removed /api/auth/token and /api/auth/local, a provider not in use) is not found, as before Auth.js.

const known = (request: NextRequest) => authPathKnown(request.nextUrl.pathname, providerIds)

export const GET = (request: NextRequest) => known(request) ? handlers.GET(request) : refuse(404, 'notFound')
export const POST = (request: NextRequest) => known(request) ? handlers.POST(request) : refuse(404, 'notFound')
