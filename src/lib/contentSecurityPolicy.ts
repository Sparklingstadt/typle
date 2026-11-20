// The policy src/proxy.ts sends with every page as Content-Security-Policy-Report-Only. Only scripts carrying the
// request's nonce, and scripts those load ('strict-dynamic'), may run; Next.js adds the nonce to its own scripts. It only
// reports for now, in the browser's console (there is no report endpoint). Once the reports are clean, it becomes the
// page's Content-Security-Policy together with frame-ancestors 'none', which next.config.mjs sends with everything that
// is not a page.

/** The policy for one request. dev adds 'unsafe-eval', which React needs only in development. */
export function scriptPolicy(nonce: string, dev: boolean): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}
