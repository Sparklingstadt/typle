import type { Pool } from 'pg'
import { loginIdProblem, normalizeLoginId } from '../lib/accountRules'
import { clearHits, countHit, LIMITS, undoHit } from './limits'
import { verifyPassword, type Scrypt } from './password'
import { findUserByLoginId } from './users'

// The sign-in with an ID and a password (the Credentials provider "password" in src/auth.ts). Each attempt is counted as a
// failure for its IP and then its ID before the password is checked, so attempts sent together cannot all pass the limit
// while scrypt runs; a success takes its hits back. Every attempt that gets past the shape check runs scrypt exactly
// once, so the time taken does not tell a blocked ID, an unknown ID and a wrong password apart.

type Db = Pick<Pool, 'query'>

/** The longest password an account can have (src/lib/accountRules.ts); longer ones never match. */
const MAX_PASSWORD_LENGTH = 128

/**
 * The user of the account whose ID and password are given, or null. The attempt is first reserved as a failure of the
 * IP, then of the ID; when the IP is already blocked the ID is not touched, and when the ID is already blocked the IP's
 * hit is taken back. Either way scrypt runs once against nothing and the answer is null. Otherwise
 * the password is checked once: a failure keeps the reserved hits, and a success forgets the ID's failures and takes
 * back the IP's hit. The attempt that reaches a limit is still checked; the ones after it are refused. The account ID is
 * password:<uuid>, and the name is the (normalized) login ID.
 */
export async function authorizePassword(
  db: Db,
  credentials: { loginId?: unknown, password?: unknown },
  ip: string,
  now: Date = new Date(),
  derive?: Scrypt,
): Promise<{ id: string, name: string, image: '' } | null> {
  const { loginId: rawId, password } = credentials
  if (typeof rawId !== 'string' || typeof password !== 'string') return null
  const loginId = normalizeLoginId(rawId)
  // An ID no account can have, or a password no account can have: nothing to look up or to count.
  if (loginIdProblem(loginId) || [...password].length > MAX_PASSWORD_LENGTH) return null

  const idLimit = LIMITS.loginFailId(loginId)
  const ipLimit = LIMITS.loginFailIp(ip)
  // The IP first: a blocked IP must not add to any ID's count, or it could lock out any number of accounts.
  if (!(await countHit(db, ipLimit, now)).counted) {
    await verifyPassword(password, null, derive)
    return null
  }
  if (!(await countHit(db, idLimit, now)).counted) {
    // A blocked ID takes back the IP's hit, so that attempts on it do not count against the IP.
    await undoHit(db, ipLimit.key, now)
    await verifyPassword(password, null, derive)
    return null
  }
  // When the ID's hit itself reached the limit nothing is undone: this is its 5th allowed attempt, checked as any other.

  const user = await findUserByLoginId(db, loginId)
  if (!await verifyPassword(password, user?.passwordHash ?? null, derive) || !user) return null
  await Promise.all([clearHits(db, idLimit.key), undoHit(db, ipLimit.key, now)])
  return { id: `password:${user.id}`, name: user.loginId, image: '' }
}
