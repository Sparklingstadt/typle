// The policy src/proxy.ts sends with every page as Content-Security-Policy-Report-Only. Only scripts carrying the
// request's nonce, and scripts those load ('strict-dynamic'), may run; Next.js adds the nonce to its own scripts. It only
// reports for now. Once the reports are clean, it becomes the page's Content-Security-Policy together with
// frame-ancestors 'none', which next.config.mjs sends with everything that is not a page.

/** The policy for one request. dev adds 'unsafe-eval', which React needs only in development. */
export function scriptPolicy(nonce: string, dev: boolean, reportUri: string | null): string {
  const directives = [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
  ]
  if (reportUri) directives.push(`report-uri ${reportUri}`)
  return directives.join('; ')
}

/**
 * Sentry's endpoint for CSP reports, from a DSN (https://<key>@<host>/<project>), or null when the DSN is missing or
 * cannot be read.
 */
export function sentryReportUri(dsn: string | undefined): string | null {
  if (!dsn) return null
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    return null
  }
  const project = url.pathname.replace(/^\//, '')
  if (url.protocol !== 'https:' || !url.username || !/^\d+$/.test(project)) return null
  return `https://${url.host}/api/${project}/security/?sentry_key=${encodeURIComponent(url.username)}`
}
