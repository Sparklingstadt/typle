import { createHmac, randomBytes } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'

// The app's origin and Better Auth secret in the end-to-end setup (playwright.config.ts).
export const origin = 'http://127.0.0.1:3101'
export const secret = 'typle-e2e-only-better-auth-secret-32-bytes'
// Better Auth's session cookie over HTTP (no __Secure- prefix).
export const cookieName = 'better-auth.session_token'

/** A GitHub account id no other test uses. */
export const newAccountId = () => 'github:' + BigInt('0x' + randomBytes(16).toString('hex')).toString()

/**
 * A Better Auth session cookie value for the account: its user and a session row (valid for 30 days, or until expiresAt)
 * are written to the database, and the value is `<token>.<HMAC-SHA256(token) in base64>`, URL-encoded, as better-call's
 * signCookieValue makes it. No session_data cookie (the cookie cache) is set, so the server reads the database on every
 * request and a deleted or expired session is refused at once.
 */
export async function sessionFor(accountId: string, name = 'E2E User', expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)) {
  const token = randomBytes(24).toString('base64url')
  await withDatabase(async pool => {
    await pool.query(
      `INSERT INTO typle_auth_users (id, name, email, email_verified, image) VALUES ($1, $2, $3, true, '')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [accountId, name, `${accountId}@users.invalid`])
    await pool.query('INSERT INTO typle_auth_sessions (id, expires_at, token, user_id) VALUES ($1, $2, $3, $4)',
      [randomBytes(12).toString('hex'), expiresAt, token, accountId])
  })
  return encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
}

/** Signs the browser context in as the account. */
export async function signIn(context: BrowserContext, accountId: string, name = 'E2E User') {
  await context.addCookies([{ name: cookieName, value: await sessionFor(accountId, name), url: origin, httpOnly: true, sameSite: 'Lax' }])
}

/** Runs queries against the test database, closing the connection afterwards. */
export async function withDatabase<T>(run: (pool: import('pg').Pool) => Promise<T>): Promise<T> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try { return await run(pool) } finally { await pool.end() }
}

/** Deletes the account's saved workspace. */
export const deleteWorkspace = (accountId: string) =>
  withDatabase(async pool => {
    await pool.query('DELETE FROM typle_workspaces WHERE owner_id = $1', [accountId])
    await pool.query('DELETE FROM typle_records WHERE owner_id = $1', [accountId])
    // The account's user and, with it, its sessions (also of the made-up account whose id this one begins).
    await pool.query('DELETE FROM typle_auth_users WHERE starts_with(id, $1)', [accountId])
  })
