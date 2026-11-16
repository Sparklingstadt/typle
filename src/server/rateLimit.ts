import { isIPv4 } from 'node:net'
import type { Pool } from 'pg'
import { reportFailure } from './report'
import { forGallery, refuse } from './response'
import { clientMac, type LoginSettings } from './settings'

// The gallery's writes need no account, so they are limited per client IP in fixed windows of one minute. They are
// counted in the database (typle_gallery_hits) because each request may be served by another instance. The IP is only
// ever hashed (clientMac) before it leaves this file.

/** The client every request whose IP cannot be told on Vercel is counted as, so that it stays limited. */
const UNKNOWN_CLIENT = 'unknown'
/** Off Vercel the forwarding headers are the client's own words, so every request is counted as this one client. */
const LOCAL_CLIENT = 'local'

/** The IP in the form Go's netip writes it (lower-case RFC 5952 IPv6, an IPv4-mapped address as IPv4), or null. */
function canonicalIp(text: string): string | null {
  if (isIPv4(text)) return text
  if (!text.includes(':')) return null
  let host: string
  try {
    host = new URL(`http://[${text}]`).hostname.slice(1, -1)
  } catch {
    return null
  }
  // ::ffff:a.b.c.d, which the URL writes as ::ffff:xxxx:xxxx.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mapped) {
    const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]
    return [high >> 8, high & 255, low >> 8, low & 255].join('.')
  }
  return host
}

/**
 * Where the request comes from. On Vercel it is the first entry of X-Vercel-Forwarded-For, then of X-Forwarded-For,
 * then X-Real-Ip: the first that is an IP address, as Vercel sets them. When none is, known is false.
 */
export function clientIp(request: Request, onVercel: boolean): { ip: string, known: boolean } {
  if (!onVercel) return { ip: LOCAL_CLIENT, known: true }
  for (const name of ['X-Vercel-Forwarded-For', 'X-Forwarded-For', 'X-Real-Ip']) {
    const ip = canonicalIp((request.headers.get(name) ?? '').split(',')[0].trim())
    if (ip) return { ip, known: true }
  }
  return { ip: UNKNOWN_CLIENT, known: false }
}

/** The whole seconds from now until the window ends, rounded up and at least 1. */
export function retryAfter(windowEnd: Date, now: Date): number {
  return Math.max(Math.ceil((windowEnd.getTime() - now.getTime()) / 1000), 1)
}

/** Counts one more hit of action by client in this minute's window, forgetting windows older than ten minutes. */
export async function countHit(db: Pool, action: string, client: Buffer): Promise<{ hits: number, windowEnd: Date }> {
  const connection = await db.connect()
  try {
    await connection.query('BEGIN')
    await connection.query(`DELETE FROM typle_gallery_hits WHERE window_start < now() - interval '10 minutes'`)
    const { rows } = await connection.query<{ hits: number, window_start: Date }>(
      `INSERT INTO typle_gallery_hits (action, client, window_start, hits)
        VALUES ($1, $2, date_trunc('minute', now()), 1)
        ON CONFLICT (action, client, window_start) DO UPDATE SET hits = typle_gallery_hits.hits + 1
        RETURNING hits, window_start`, [action, client])
    await connection.query('COMMIT')
    connection.release()
    return { hits: rows[0].hits, windowEnd: new Date(rows[0].window_start.getTime() + 60_000) }
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    connection.release(true)
    throw error
  }
}

/**
 * Counts one use of action by the request's client. Over limit it is the 429 to answer with, with Retry-After;
 * otherwise null. Counting that fails throws.
 */
export async function overLimit(request: Request, db: Pool, settings: LoginSettings, action: string, limit: number): Promise<Response | null> {
  const { ip, known } = clientIp(request, settings.onVercel)
  if (!known) {
    // Vercel always sets these headers, so this is a change on its side to look into. The request is counted anyway.
    reportFailure(request, new Error('no client IP in the forwarding headers'), 'gallery.limit.ip')
  }
  const { hits, windowEnd } = await countHit(db, action, clientMac(settings.rateLimitKey, ip))
  if (hits <= limit) return null
  const response = forGallery(refuse(429, 'tooManyRequests'))
  // The window comes from the database's clock and now from this one: skew only moves the wait within the window.
  response.headers.set('Retry-After', String(retryAfter(windowEnd, new Date())))
  return response
}
