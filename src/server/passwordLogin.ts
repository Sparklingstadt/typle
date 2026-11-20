import type { Pool } from 'pg'
import { loginIdProblem, normalizeLoginId } from '../lib/accountRules'
import { clearHits, countHit, isBlocked, LIMITS } from './limits'
import { verifyPassword, type Scrypt } from './password'
import { findUserByLoginId } from './users'

// The sign-in with an ID and a password (the Credentials provider "password" in src/auth.ts). Every attempt that gets
// past the shape check runs scrypt exactly once, so the time taken does not tell a blocked ID, an unknown ID and a
// wrong password apart.

type Db = Pick<Pool, 'query'>

/** The longest password an account can have (src/lib/accountRules.ts); longer ones never match. */
const MAX_PASSWORD_LENGTH = 128

/**
 * The user of the account whose ID and password are given, or null. A blocked ID or IP is refused (after one scrypt run
 * against nothing); a failure is counted for both the ID and the IP; a success forgets the ID's failures. The account ID
 * is password:<uuid>, and the name is the (normalized) login ID.
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
  if (await isBlocked(db, idLimit.key, now) || await isBlocked(db, ipLimit.key, now)) {
    await verifyPassword(password, null, derive)
    return null
  }

  const user = await findUserByLoginId(db, loginId)
  if (!await verifyPassword(password, user?.passwordHash ?? null, derive) || !user) {
    await countHit(db, idLimit, now)
    await countHit(db, ipLimit, now)
    return null
  }
  await clearHits(db, idLimit.key)
  return { id: `password:${user.id}`, name: user.loginId, image: '' }
}
