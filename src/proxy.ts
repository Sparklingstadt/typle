import { NextResponse, type NextRequest } from 'next/server'
import { scriptPolicy, sentryReportUri } from '@/lib/contentSecurityPolicy'

const reportUri = sentryReportUri(process.env.NEXT_PUBLIC_SENTRY_DSN)

// A fresh nonce for each page. Next.js reads it from the request's policy header and adds it to its own scripts; the
// root layout reads x-nonce for the theme script.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const policy = scriptPolicy(nonce, process.env.NODE_ENV === 'development', reportUri)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy-report-only', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy-Report-Only', policy)
  return response
}

// Pages only: Route Handlers, build output, Vercel's own paths and files with an extension send no HTML. Prefetches
// carry no scripts of their own.
export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/|_vercel/|.*\\.[^/]+$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
