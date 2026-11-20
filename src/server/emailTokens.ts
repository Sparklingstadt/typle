import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'

// One-time links sent by mail (typle_email_tokens): 'verify' confirms an address, 'reset' sets a new password. The
// token is 32 random bytes as base64url; the database keeps only its SHA-256 as hex.

type Db = Pick<Pool, 'query'>

export type TokenKind = 'verify' | 'reset'

const hash = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** Stores a new token and returns the raw value to put in the link. */
export async function issueToken(
  db: Db,
  { userId, kind, email, ttlSeconds }: { userId: string; kind: TokenKind; email: string; ttlSeconds: number },
): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  await db.query(
    "INSERT INTO typle_email_tokens (token_hash, user_id, kind, email, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::int))",
    [hash(raw), userId, kind, email, ttlSeconds],
  )
  return raw
}

/**
 * Uses a token once: the one UPDATE marks it used only while it is unused, unexpired and of the given kind, so
 * concurrent or repeated uses cannot both succeed. Null for an unknown, used, expired or other-kind token.
 */
export async function consumeToken(
  db: Db,
  raw: string,
  kind: TokenKind,
  now: Date = new Date(),
): Promise<{ userId: string; email: string } | null> {
  const { rows } = await db.query<{ user_id: string; email: string }>(
    `UPDATE typle_email_tokens SET used_at = $3::timestamptz
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3::timestamptz
     RETURNING user_id, email`,
    [hash(raw), kind, now],
  )
  return rows[0] ? { userId: rows[0].user_id, email: rows[0].email } : null
}
