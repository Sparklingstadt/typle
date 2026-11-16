import { Pool } from 'pg'

// The database of the Route Handlers. Each server instance keeps one small pool: on Vercel many instances can run at
// once, and DATABASE_URL is Neon's pooled connection.

/**
 * A pool of connections to the database at url. Connecting and each query give up after timeoutMs, so a database that
 * stops answering cannot keep the pool's connections lent out: pg drops a connection whose query timed out.
 */
export function createPool(url: string, timeoutMs = 5_000): Pool {
  const db = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    // On Vercel an instance can sleep with idle connections open; keep-alive finds the dead ones.
    keepAlive: true,
  })
  // The database closing an idle connection (a restart, an idle timeout) is emitted here. Unheard, the event would
  // throw; the pool has already dropped that connection, so it is only logged.
  db.on('error', error => console.error('database pool:', error))
  return db
}

let shared: Pool | undefined

/** The pool of this server instance, opened on first use from DATABASE_URL (or POSTGRES_URL). */
export function pool(): Pool {
  if (!shared) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    shared = createPool(url)
  }
  return shared
}

/**
 * Resolves once the database answers `SELECT 1`, and rejects when it fails or takes longer than timeoutMs. The timeout
 * covers getting a connection too: a server that accepts it and never answers would otherwise keep the request open.
 */
export async function ping(db: Pool, timeoutMs = 5_000): Promise<void> {
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`the database did not answer within ${timeoutMs} ms`))
    }, timeoutMs)
  })
  const query = (async () => {
    const client = await db.connect()
    // A connection that comes back after the deadline is in an unknown state: drop it instead of reusing it.
    if (timedOut) {
      client.release(true)
      return
    }
    try {
      await client.query('SELECT 1')
      client.release()
    } catch (error) {
      client.release(true)
      throw error
    }
  })()
  query.catch(() => {}) // Its failure after the deadline has no one left to tell.
  try {
    await Promise.race([query, deadline])
  } finally {
    clearTimeout(timer)
  }
}
