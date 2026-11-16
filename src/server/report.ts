import * as Sentry from '@sentry/nextjs'

/**
 * Tells of a failure of the server that is answered with a 503: in the log, and to Sentry when it is set up
 * (src/sentry.server.config.ts), with the operation as a tag so that the failures of one kind group together.
 */
export function reportFailure(request: Request, error: unknown, operation: string): void {
  console.error(`${request.method} ${new URL(request.url).pathname}: ${operation}:`, error)
  Sentry.captureException(error, { tags: { operation } })
}
