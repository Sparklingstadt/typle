// The checks of a request that writes. A browser sends the site's cookies with a request from any other site, so a
// write must show that it comes from the app: its own pages (the Origin) or an app (iPad, Mac), whose token a browser
// never sends on its own.

/**
 * Whether the request is an app's: it carries an Authorization header that is not empty, which is then all it is judged
 * by (src/server/account.ts reads the user from it alone). An empty one is no header, as the Go backend judged it.
 */
export const fromApp = (request: Request) => !!request.headers.get('Authorization')

/** Whether the request comes from the app: an app's, or from a page whose Origin is the app's own, exactly. */
export function fromAppOrOrigin(request: Request, origin: string): boolean {
  return fromApp(request) || request.headers.get('Origin') === origin
}

/**
 * Whether the body is declared as JSON, which a form on another site cannot send without asking first (CORS). The type
 * is compared as written, so Application/JSON is refused, as the Go backend refused it; the app always sends
 * application/json.
 */
export function jsonContent(request: Request): boolean {
  return (request.headers.get('Content-Type') ?? '').split(';')[0].trim() === 'application/json'
}
