import { type Db, ping } from './database'
import { refuse, reply } from './response'

/**
 * The answer of /api/health: 200 once the database answers within 5 seconds, which is what a deployment check needs to
 * know, and 503 databaseUnavailable otherwise, also when no database is set.
 */
export async function checkHealth(open: () => Db): Promise<Response> {
  try {
    await ping(open())
  } catch (error) {
    console.error('GET /api/health:', error)
    return refuse(503, 'databaseUnavailable')
  }
  return reply(200, { status: 'ok' })
}
