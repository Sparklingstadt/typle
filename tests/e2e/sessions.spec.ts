import { test, expect } from '@playwright/test'
import { cookieName, deleteWorkspace, newAccountId, origin, sessionFor, signIn, withDatabase } from './account'

let accountId = ''
test.beforeEach(() => { accountId = newAccountId() })
test.afterEach(() => deleteWorkspace(accountId))

// The e2e login sets no session_data cookie (the cookie cache), so the server reads the database on every request and a
// session that ended is refused at once. A real browser may be served from the cache for up to its window (5 minutes)
// after its session ended; the last test goes through the cache, with the window shortened to 3 s (playwright.config.ts).
const sessionCount = () => withDatabase(async pool =>
  Number((await pool.query('SELECT count(*) FROM typle_auth_sessions WHERE user_id = $1', [accountId])).rows[0].count))

test('signout everywhere ends the other browser\'s session', async ({ browser }) => {
  const here = await browser.newContext()
  const elsewhere = await browser.newContext()
  try {
    await signIn(here, accountId)
    await signIn(elsewhere, accountId)
    expect(await sessionCount()).toBe(2)
    expect((await elsewhere.request.get('/api/workspace')).status()).toBe(200)

    const refused = await here.request.post('/api/account/signout-everywhere')
    expect(refused.status()).toBe(403)
    const done = await here.request.post('/api/account/signout-everywhere', { headers: { Origin: origin } })
    expect(done.status()).toBe(204)
    expect(await sessionCount()).toBe(0)
    // This browser's cookies are removed, and the sign-out leaves the cookie that makes the next Sparklingstadt ID login ask for the password.
    expect((await here.cookies(origin)).find(cookie => cookie.name === cookieName)).toBeUndefined()
    expect((await here.cookies(origin)).find(cookie => cookie.name === 'typle-sid-relogin')?.value).toBe('1')

    // The other browser still holds its cookie, but its session is gone.
    const gone = await elsewhere.request.get('/api/workspace')
    expect(gone.status()).toBe(401)
    expect(await gone.json()).toEqual({ error: 'loginRequired' })

    // A new login is let in.
    await signIn(elsewhere, accountId)
    expect((await elsewhere.request.get('/api/workspace')).status()).toBe(200)
    // Nor can it be done without a login.
    expect((await here.request.post('/api/account/signout-everywhere', { headers: { Origin: origin } })).status()).toBe(401)
  } finally {
    await here.close()
    await elsewhere.close()
  }
})

test('a deleted session is signed out', async ({ context }) => {
  await signIn(context, accountId)
  expect((await context.request.get('/api/workspace')).status()).toBe(200)
  await withDatabase(pool => pool.query('DELETE FROM typle_auth_sessions WHERE user_id = $1', [accountId]))
  expect((await context.request.get('/api/workspace')).status()).toBe(401)
})

test('a login ends 30 days after it was made', async ({ context }) => {
  const day = 24 * 3600 * 1000
  await context.addCookies([{ name: cookieName, value: await sessionFor(accountId, 'E2E User', new Date(Date.now() + day)), url: origin }])
  expect((await context.request.get('/api/workspace')).status()).toBe(200)
  await withDatabase(pool => pool.query(`UPDATE typle_auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [accountId]))
  expect((await context.request.get('/api/workspace')).status()).toBe(401)
})

test('signing out of every device from the settings page signs out the other browsers too', async ({ browser }) => {
  const here = await browser.newContext()
  const elsewhere = await browser.newContext()
  try {
    await signIn(here, accountId)
    await signIn(elsewhere, accountId)
    const other = await elsewhere.newPage()
    expect((await other.request.get('/api/workspace')).status()).toBe(200)

    const page = await here.newPage()
    await page.goto('/settings')
    const section = page.getByRole('region', { name: 'ログイン中の端末' })
    await section.getByRole('button', { name: 'すべての端末からログアウト' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'すべての端末からログアウトしますか？' })
    await dialog.getByRole('button', { name: 'ログアウトする' }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible()

    // The other browser still holds its cookie, but its session is gone and it no longer reaches the account's data.
    const refused = await other.request.get('/api/workspace')
    expect(refused.status()).toBe(401)
    expect(await refused.json()).toEqual({ error: 'loginRequired' })

    await signIn(elsewhere, accountId)
    expect((await other.request.get('/api/workspace')).status()).toBe(200)
  } finally {
    await here.close()
    await elsewhere.close()
  }
})

test('the section is only for a signed-in account', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '一般' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'ログイン中の端末' })).toHaveCount(0)
})

test('a failed sign-out of every device keeps the user signed in and says so', async ({ context, page }) => {
  await signIn(context, accountId)
  await page.route('**/api/account/signout-everywhere', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"databaseUnavailable"}' }))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'すべての端末からログアウト' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'ログアウトする' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('ログアウトできませんでした。もう一度お試しください。')
  await expect(page).toHaveURL(/\/settings$/)
  expect((await page.request.get('/api/workspace')).status()).toBe(200)
})

test('a browser with the cookie cache keeps its access until the cache window passes, then is signed out', async ({ context }) => {
  await signIn(context, accountId)
  // Reading the session through Better Auth's own endpoint gives the browser the session_data cookie (the cache).
  expect((await context.request.get('/api/auth/get-session')).status()).toBe(200)
  expect((await context.cookies(origin)).some(cookie => cookie.name === 'better-auth.session_data')).toBe(true)
  await withDatabase(pool => pool.query('DELETE FROM typle_auth_sessions WHERE user_id = $1', [accountId]))
  expect((await context.request.get('/api/workspace')).status()).toBe(200)
  // Signing out of every device is not served from the cache: the session is gone, so it is refused.
  expect((await context.request.post('/api/account/signout-everywhere', { headers: { Origin: origin } })).status()).toBe(401)
  await new Promise(resolve => setTimeout(resolve, 3500))
  expect((await context.request.get('/api/workspace')).status()).toBe(401)
})
