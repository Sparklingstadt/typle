import { withSentryConfig } from '@sentry/nextjs/config';
import createNextIntlPlugin from 'next-intl/plugin';
import backendCompare from './scripts/backendCompare.cjs';

// Messages are chosen per request in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Every response: no other site may frame the app (clickjacking of its buttons), and responses are not sniffed into
// another type or sent with the full URL as the referrer. The app uses no camera, microphone or location, so no page (or
// a frame inside it) may ask for them.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = (phase) => withNextIntl({
  poweredByHeader: false,
  // Keep local development and verification separate; Vercel expects .next.
  distDir: phase === 'phase-development-server' || process.env.VERCEL === '1' ? '.next' : '.next-production',
  headers: () => [
    { source: '/:path*', headers: securityHeaders },
    // No other site may frame the app (clickjacking of its buttons), and no <base> or plugin content. form-action is left
    // out: Chrome would also apply it to the redirect from the sign-in form to GitHub. Not on pages (where src/proxy.ts
    // runs): Next.js would read this policy, which has no script-src, instead of the proxy's and add no nonce to the
    // page's scripts (v2.51.0 on Vercel). Pages are kept from being framed by X-Frame-Options.
    {
      source: '/:path((?:api|_next|_vercel)(?:/.*)?|.*\\.[^/]+)',
      headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" }],
    },
    // With TYPLE_BACKEND_COMPARE=1 only: the Next.js answers of the compared paths say they came from Next.js.
    ...backendCompare.nextBackendHeaders(),
  ],
  // With TYPLE_BACKEND_COMPARE=1 only: x-typle-backend sends a compared path to the Go function or the Kotlin service
  // (scripts/backendCompare.cjs). Without it there are no rewrites, so the header changes nothing.
  rewrites: async () => ({ beforeFiles: backendCompare.backendRewrites(), afterFiles: [], fallback: [] }),
});

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
