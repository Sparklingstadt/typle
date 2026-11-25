import type { Tx } from './database'

// The Sparklingstadt ID accounts linked to an account of another login (typle_sid_links), as the login reads them.
// The rows are added by npm run sid:link (scripts/sid-link.cjs).

/** The account the Sparklingstadt ID sub is linked to, or null when it has none. A failed query throws. */
export async function linkedAccount(db: Tx, sub: string): Promise<string | null> {
  const link = await db.sidLink.findUnique({ where: { sub } })
  return link?.accountId ?? null
}
