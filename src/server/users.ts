import type { Pool } from 'pg'

// The accounts that sign in with an ID and a password (typle_users). The callers pass the ID and the address already
// normalized (src/lib/accountRules.ts).

type Db = Pick<Pool, 'query'>

export type UserRow = {
  id: string
  loginId: string
  email: string
  emailVerifiedAt: Date | null
  passwordHash: string
  locale: string
}

type Row = { id: string; login_id: string; email: string; email_verified_at: Date | null; password_hash: string; locale: string }

const COLUMNS = 'id, login_id, email, email_verified_at, password_hash, locale'

const toUser = (row: Row): UserRow => ({
  id: row.id,
  loginId: row.login_id,
  email: row.email,
  emailVerifiedAt: row.email_verified_at,
  passwordHash: row.password_hash,
  locale: row.locale,
})

/** Adds an account; 'taken' when the ID is already used. */
export async function createUser(
  db: Db,
  user: { loginId: string; email: string; passwordHash: string; locale: string },
): Promise<{ id: string } | 'taken'> {
  try {
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO typle_users (login_id, email, password_hash, locale) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.loginId, user.email, user.passwordHash, user.locale],
    )
    return { id: rows[0].id }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return 'taken'
    throw error
  }
}

export async function findUserByLoginId(db: Db, loginId: string): Promise<UserRow | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM typle_users WHERE login_id = $1`, [loginId])
  return rows[0] ? toUser(rows[0]) : null
}

/**
 * The account a sign-in with loginId is checked against, and issuedAt, the time (Unix seconds) the login starts at if
 * the password is right. Both come from one statement, so that a reset or a change of the password revokes every login
 * that was checked against the old password:
 * - The row is locked FOR SHARE. A change of the password updates it first, so this either reads the old hash before
 *   that update, or waits for the change and reads the new one.
 * - issuedAt is the database's time when the statement started, in whole seconds, which is then earlier than the
 *   revoked_at the change writes after its update (revokeLogins in src/server/account.ts, by the same clock), not the
 *   time the cookie is sealed, after scrypt, when the change may be over.
 * - After a revocation, issuedAt is its next whole second, so that a sign-in right after it, in the same second, is not
 *   revoked by it. That second can be ahead of the clock.
 */
export async function findUserForLogin(db: Db, loginId: string): Promise<{ user: UserRow, issuedAt: number } | null> {
  const columns = COLUMNS.split(', ').map(column => `u.${column}`).join(', ')
  const { rows } = await db.query<Row & { issued_at: number }>(`SELECT ${columns},
      GREATEST(floor(extract(epoch FROM now())), floor(extract(epoch FROM r.revoked_at)) + 1)::float8 AS issued_at
    FROM typle_users u LEFT JOIN typle_session_revocations r ON r.owner_id = 'password:' || u.id::text
    WHERE u.login_id = $1 FOR SHARE OF u`, [loginId])
  return rows[0] ? { user: toUser(rows[0]), issuedAt: rows[0].issued_at } : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The typle_users.id of an account ID password:<uuid>, or null for any other kind of account (github:, ffpf:). */
export function accountIdOf(sub: string): string | null {
  const id = sub.startsWith('password:') ? sub.slice('password:'.length) : ''
  return UUID.test(id) ? id : null
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  // A malformed id is no account; casting it would make the database throw.
  if (!UUID.test(id)) return null
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM typle_users WHERE id = $1`, [id])
  return rows[0] ? toUser(rows[0]) : null
}

export async function setPassword(db: Db, id: string, passwordHash: string): Promise<void> {
  await db.query('UPDATE typle_users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, passwordHash])
}

/**
 * Marks the address verified, only while it is still the account's current address. A future change-email flow must
 * reset email_verified_at when it changes the address.
 */
export async function markEmailVerified(db: Db, id: string, email: string): Promise<void> {
  await db.query(
    'UPDATE typle_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1 AND email = $2',
    [id, email],
  )
}

/** The IDs of the accounts whose verified address is email. */
export async function findVerifiedLoginIdsByEmail(db: Db, email: string): Promise<string[]> {
  const { rows } = await db.query<{ login_id: string }>(
    'SELECT login_id FROM typle_users WHERE email = $1 AND email_verified_at IS NOT NULL ORDER BY login_id',
    [email],
  )
  return rows.map(row => row.login_id)
}
