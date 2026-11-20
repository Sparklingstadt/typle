// The checks of a request that writes. A browser sends the site's cookies with a request from any other site, so a
// write must show that it comes from the app's own pages (the Origin).

/** Whether the request comes from a page whose Origin is the app's own, exactly. */
export const sameOrigin = (request: Request, origin: string) => request.headers.get('Origin') === origin

/**
 * Whether the body is declared as JSON, which a form on another site cannot send without asking first (CORS). The type
 * is compared as written, so Application/JSON is refused, as the Go backend refused it; the app always sends
 * application/json.
 */
export function jsonContent(request: Request): boolean {
  return (request.headers.get('Content-Type') ?? '').split(';')[0].trim() === 'application/json'
}
