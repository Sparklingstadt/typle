import { isIPv6 } from 'node:net'
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
  /**
   * Every mail the app sends in a UTC day (YYYY-MM-DD), kept below Resend's free 100 a day so that one client cannot
   * use up the mail of everyone's password reset. scope (TYPLE_MAIL_CAP_SCOPE, empty in production) keeps the tests'
   * mails apart from each other's.
   */
  mailDaily: (scope: string, day: string): Limit =>
    ({ key: `mail:global:${scope ? `${scope}:` : ''}${day}`, max: 80, windowSeconds: 24 * 60 * 60 }),
}

/** The eight 16-bit groups of an IPv6 address that isIPv6 accepts (a zone after % is left out). */
function ipv6Groups(address: string): number[] {
  let text = address.split('%')[0].toLowerCase()
  // A dotted IPv4 tail (::ffff:192.0.2.1) is its last two groups.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number)
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, '']
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(group => parseInt(group, 16))
}

/**
 * The client of request as the per-IP limits know it: the last non-empty value of x-forwarded-for, trimmed ('unknown'
 * when there is none). Vercel replaces the header with the one address it saw, and an AWS load balancer appends the
 * address it saw to whatever the client sent, so the last value is the one a client cannot forge on either.
 * An IPv6 client is known by its /64 (as 2001:db8:1:2::/64), because one connection is usually given a whole /64 and
 * could otherwise take a new address for every request; an IPv4 address written as IPv6 (::ffff:192.0.2.1) is that
 * IPv4 address. Anything else is kept as written.
 */
export function clientIp(request: Request): string {
  const values = (request.headers.get('x-forwarded-for') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  const last = values.at(-1)
  if (!last) return 'unknown'
  if (!isIPv6(last)) return last
  const groups = ipv6Groups(last)
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  }
  return `${groups.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`
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

/**
 * Deletes the rows whose window and block both ended over a day before now, so that the table holds only the limits
 * that are still in use. The longest window is a day (mailDaily), so a row whose window started over two days ago has
 * no window left.
 */
export async function pruneLimits(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(
    `DELETE FROM typle_auth_limits
     WHERE window_start < $1::timestamptz - interval '2 days'
       AND (blocked_until IS NULL OR blocked_until < $1::timestamptz - interval '1 day')`,
    [now],
  )
}
