/**
 * Tells of a failure of the server that is answered with a 503 in the log (the Vercel function logs), with the
 * operation so that the failures of one kind can be found together.
 */
export function reportFailure(request: Request, error: unknown, operation: string): void {
  console.error(`${request.method} ${new URL(request.url).pathname}: ${operation}:`, error)
}
