import { NextResponse, type NextRequest } from 'next/server'
import { scriptPolicy } from '@/lib/contentSecurityPolicy'

// A fresh nonce for each page. Next.js reads it from the request's policy header and adds it to its own scripts; the
// root layout reads x-nonce for the theme script.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const policy = scriptPolicy(nonce, process.env.NODE_ENV === 'development')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next.js takes the nonce from content-security-policy when there is one, and only then from the report-only header.
  // It also copies the headers set on the response below into the request it renders, so a page cannot be sent an
  // enforced policy without script-src: Next.js would read that one and add no nonce (v2.51.0 on Vercel, where the
  // policy came from next.config.mjs). Until the script policy is enforced, pages are kept from being framed by
  // X-Frame-Options alone, and base-uri and object-src are only reported.
  requestHeaders.delete('content-security-policy')
  requestHeaders.set('content-security-policy-report-only', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy-Report-Only', policy)
  return response
}

// Pages only: Route Handlers, build output, Vercel's own paths and files with an extension send no HTML, and get their
// headers from next.config.mjs. Prefetches go through too, since they get their framing policy only here.
export const config = {
  matcher: ['/((?!api(?:/|$)|_next/|_vercel/|.*\\.[^/]+$).*)'],
}
