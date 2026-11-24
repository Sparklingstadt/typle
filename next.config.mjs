import createNextIntlPlugin from 'next-intl/plugin';

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
  // The container image (Dockerfile) builds a standalone server; Vercel and `next start` (verify, E2E) do not.
  output: process.env.TYPLE_STANDALONE === '1' ? 'standalone' : undefined,
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
  ],
});

export default nextConfig;
