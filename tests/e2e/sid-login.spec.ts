import { randomInt } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { withDatabase } from './account'

// Signing in with Sparklingstadt ID, through the sign-in page and the fake ID server (tests/e2e/fakeSid.cjs): an ID
// without a link is its own account sid:<sub>, a linked one opens the account it is linked to (typle_sid_links), an
// unconfirmed address is refused, and after a sign-out the next login asks the ID server for the password.

const sid = 'http://127.0.0.1:3197'
// The fake ID server signs in as one identity at a time, set before each login.
test.describe.configure({ mode: 'serial' })

let sub = ''
let linkedTo = ''
test.beforeEach(() => {
  sub = `e2e${randomInt(1e9, 2e9)}`
  linkedTo = `github:${randomInt(1e9, 2e9)}`
})
test.afterEach(() => withDatabase(async pool => {
  await pool.query('DELETE FROM typle_sid_links WHERE sub = $1', [sub])
  await pool.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [[`sid:${sub}`, linkedTo]])
  await pool.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [[`sid:${sub}`, linkedTo]])
}))

/** Makes the fake ID server sign in as sub next. */
async function nextIdentity(identity: { email_verified?: boolean } = {}) {
  await fetch(`${sid}/next`, {
    method: 'POST',
    body: JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true, name: 'Ann', ...identity }),
  })
}

/** The query of the newest authorization request the fake ID server received. */
async function lastAuthorization(): Promise<Record<string, string>> {
  return (await (await fetch(`${sid}/requests`)).json() as Record<string, string>[]).at(-1) ?? {}
}

async function signInWithSid(page: Page) {
  await page.goto('/signin')
  await page.getByRole('button', { name: 'Sparklingstadt IDでログイン', exact: true }).click()
  await page.waitForURL(/\/home$/)
}

const sessionId = async (page: Page) =>
  (await (await page.request.get('/api/auth/session')).json() as { user?: { id: string } } | null)?.user?.id ?? null

test('an ID without a link signs in as its own account sid:<sub>', async ({ page }) => {
  await nextIdentity()
  await signInWithSid(page)
  expect(await sessionId(page)).toBe(`sid:${sub}`)
  await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click()
  await expect(page.getByText('Sparklingstadt IDでログイン中', { exact: true })).toBeVisible()
  // Signing in and landing on the home page saves nothing, so npm run sid:link can still link this ID afterwards (it
  // refuses an ID whose own account has saved data), as docs/architecture.md tells.
  await page.waitForLoadState('networkidle')
  const saved = await withDatabase(async pool => (await pool.query(
    'SELECT 1 FROM typle_workspaces WHERE owner_id = $1 UNION ALL SELECT 1 FROM typle_records WHERE owner_id = $1',
    [`sid:${sub}`])).rowCount)
  expect(saved).toBe(0)
})

test('a linked ID opens the account it is linked to', async ({ page }) => {
  await withDatabase(async pool => {
    await pool.query('INSERT INTO typle_sid_links (sub, account_id) VALUES ($1, $2)', [sub, linkedTo])
  })
  await nextIdentity()
  await signInWithSid(page)
  expect(await sessionId(page)).toBe(linkedTo)
})

test('an ID whose address is not confirmed is refused', async ({ page }) => {
  await nextIdentity({ email_verified: false })
  await page.goto('/signin')
  await page.getByRole('button', { name: 'Sparklingstadt IDでログイン', exact: true }).click()
  await page.waitForURL(/\/signin\?.*error=/)
  await expect(page.getByText('ログインできませんでした。もう一度お試しください。', { exact: true })).toBeVisible()
  expect(await sessionId(page)).toBeNull()
})

test('after a sign-out, the next login asks for the password, and the one after it does not', async ({ page }) => {
  await nextIdentity()
  await signInWithSid(page)
  expect((await lastAuthorization()).prompt).toBeUndefined()
  await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click()
  await page.getByRole('menuitem', { name: 'ログアウト', exact: true }).click()
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible()

  await signInWithSid(page)
  expect((await lastAuthorization()).prompt).toBe('login')
  expect(await sessionId(page)).toBe(`sid:${sub}`)

  await page.context().clearCookies({ name: 'typle-session' })
  await signInWithSid(page)
  expect((await lastAuthorization()).prompt).toBeUndefined()
})
