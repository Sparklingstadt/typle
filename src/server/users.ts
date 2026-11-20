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

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  // A malformed id is no account; casting it would make the database throw.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
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
