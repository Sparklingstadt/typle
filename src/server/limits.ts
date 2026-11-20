import type { Pool } from 'pg'

// Throttles sign-in, sign-up and mail with counters in typle_auth_limits. Every function takes `now` so tests can move
// the clock; the SQL uses that value, never the database's now().

type Db = Pick<Pool, 'query'>

export type Limit = { key: string; max: number; windowSeconds: number; blockSeconds?: number }

/** The limits in one place (the table in docs/superpowers/plans/2026-11-20-password-login.md). */
export const LIMITS = {
  loginFailId: (id: string): Limit => ({ key: `login-fail:id:${id}`, max: 5, windowSeconds: 15 * 60 }),
  loginFailIp: (ip: string): Limit => ({ key: `login-fail:ip:${ip}`, max: 30, windowSeconds: 15 * 60 }),
  signupIp: (ip: string): Limit => ({ key: `signup:ip:${ip}`, max: 5, windowSeconds: 60 * 60 }),
  mailTarget: (idOrEmail: string): Limit => ({ key: `mail:target:${idOrEmail}`, max: 3, windowSeconds: 60 * 60 }),
  mailIp: (ip: string): Limit => ({ key: `mail:ip:${ip}`, max: 10, windowSeconds: 60 * 60 }),
}

/** The first value of x-forwarded-for, trimmed; 'unknown' when there is none. */
export function clientIp(request: Request): string {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
  return first || 'unknown'
}

export async function isBlocked(db: Db, key: string, now: Date = new Date()): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM typle_auth_limits WHERE key = $1 AND blocked_until > $2::timestamptz', [key, now])
  return rows.length > 0
}

/**
 * Counts one hit in a single upsert, so concurrent hits are never lost. A window that has passed starts again from 1.
 * Reaching `max` blocks the key until now + (blockSeconds ?? windowSeconds). While the key is blocked a hit changes
 * nothing: the count is not reset by a passed window and the block is not extended. `counted` tells whether this hit
 * was recorded (true also for the hit that reaches max), so a caller can reserve an attempt before doing it.
 */
export async function countHit(db: Db, limit: Limit, now: Date = new Date()): Promise<{ blocked: boolean, counted: boolean }> {
  const { rows } = await db.query<{ blocked: boolean }>(
    `INSERT INTO typle_auth_limits AS l (key, count, window_start, blocked_until)
     VALUES ($1, 1, $2::timestamptz,
             CASE WHEN 1 >= $3::int THEN $2::timestamptz + make_interval(secs => $5::int) END)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN l.window_start + make_interval(secs => $4::int) <= $2::timestamptz THEN 1 ELSE l.count + 1 END,
       window_start = CASE WHEN l.window_start + make_interval(secs => $4::int) <= $2::timestamptz THEN $2::timestamptz ELSE l.window_start END,
       blocked_until = CASE
         WHEN (CASE WHEN l.window_start + make_interval(secs => $4::int) <= $2::timestamptz THEN 1 ELSE l.count + 1 END) >= $3::int
         THEN $2::timestamptz + make_interval(secs => $5::int) END
     WHERE l.blocked_until IS NULL OR l.blocked_until <= $2::timestamptz
     RETURNING (blocked_until IS NOT NULL AND blocked_until > $2::timestamptz) AS blocked`,
    [limit.key, now, limit.max, limit.windowSeconds, limit.blockSeconds ?? limit.windowSeconds],
  )
  // No row: the key was already blocked, so the upsert left it alone.
  return rows.length === 0 ? { blocked: true, counted: false } : { blocked: rows[0].blocked, counted: true }
}

/**
 * Takes back one hit reserved with countHit for an attempt that turned out not to count (a successful sign-in): the
 * count goes down by one, never below zero. A blocked key is left as it is, so this never lifts a block.
 */
export async function undoHit(db: Db, key: string, now: Date = new Date()): Promise<void> {
  await db.query(
    `UPDATE typle_auth_limits SET count = GREATEST(count - 1, 0)
     WHERE key = $1 AND (blocked_until IS NULL OR blocked_until <= $2::timestamptz)`,
    [key, now],
  )
}

/** Forgets the hits of key (a successful sign-in clears that ID's failures). */
export async function clearHits(db: Db, key: string): Promise<void> {
  await db.query('DELETE FROM typle_auth_limits WHERE key = $1', [key])
}
