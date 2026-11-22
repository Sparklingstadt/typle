import type { Pool } from 'pg'

// The Sparklingstadt ID accounts linked to an account of another login (typle_sid_links), as the login reads them.
// The rows are added by npm run sid:link (scripts/sid-link.cjs).

/** The account the Sparklingstadt ID sub is linked to, or null when it has none. A failed query throws. */
export async function linkedAccount(db: Pick<Pool, 'query'>, sub: string): Promise<string | null> {
  const { rows } = await db.query<{ account_id: string }>('SELECT account_id FROM typle_sid_links WHERE sub = $1', [sub])
  return rows[0]?.account_id ?? null
}
