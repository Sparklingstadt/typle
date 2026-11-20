import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { withDatabase } from './account'

// Signing up, confirming the address, signing in, resetting a forgotten password and asking for a forgotten ID with
// an ID and a password, through the real screens. The mails go to the fake Resend (tests/e2e/fakeResend.cjs).

const resend = 'http://127.0.0.1:3198/emails'
const PASSWORD = 'first password 1'
const NEW_PASSWORD = 'second password 2'
const CHANGED_PASSWORD = 'third password 3'

let loginId = ''
let email = ''
let ip = ''
test.beforeEach(async ({ context }) => {
  loginId = `e2e${randomBytes(8).toString('hex')}`
  email = `${loginId}@example.test`
  // A client address of this test's own, so that the sign-up and mail limits (per IP) of other runs do not apply.
  ip = `e2e-${randomBytes(8).toString('hex')}`
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
})
test.afterEach(() => withDatabase(async pool => {
  const { rows } = await pool.query<{ id: string }>('DELETE FROM typle_users WHERE login_id = $1 RETURNING id', [loginId])
  const owners = rows.map(row => `password:${row.id}`)
  await pool.query('DELETE FROM typle_session_revocations WHERE owner_id = ANY($1)', [owners])
  await pool.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
  await pool.query('DELETE FROM typle_auth_limits WHERE key LIKE $1 OR key LIKE $2 OR key LIKE $3',
    [`%${ip}`, `%${loginId}`, `%${email}`])
}))

type Mail = { subject: string, text: string }

/** The mails the fake Resend received for the address, oldest first. */
async function mailsTo(address: string): Promise<Mail[]> {
  const response = await fetch(`${resend}?to=${encodeURIComponent(address)}`)
  return await response.json() as Mail[]
}

/** The link of the newest mail to the address whose text has path, waiting for it (some are sent after the answer). */
async function linkIn(address: string, path: string): Promise<string> {
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:3101${path}\\?token=[A-Za-z0-9_-]+`)
  let link = ''
  await expect.poll(async () => {
    const found = (await mailsTo(address)).map(mail => mail.text.match(pattern)?.[0]).filter(Boolean)
    link = found.at(-1) ?? ''
    return link
  }).not.toBe('')
  return link
}

const accountMenu = (page: Page) => page.getByRole('button', { name: 'アカウントメニュー', exact: true })

async function signOut(page: Page) {
  await accountMenu(page).click()
  await page.getByRole('menuitem', { name: 'ログアウト', exact: true }).click()
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible()
}

async function signInWith(page: Page, id: string, password: string) {
  await page.goto('/signin?returnTo=%2Fhome')
  await page.getByLabel('ID', { exact: true }).fill(id)
  await page.getByLabel('パスワード', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
}

async function signUp(page: Page) {
  await page.goto('/signup?returnTo=%2Fhome')
  await expect(page.getByRole('heading', { level: 1, name: '登録' })).toBeVisible()
  await page.getByLabel('ID', { exact: true }).fill(loginId)
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page.getByText(`確認のメールを ${email} に送りました。`)).toBeVisible()
  await expect(accountMenu(page)).toHaveAttribute('title', loginId)
}

test('signing up, confirming the address, signing in and resetting the password with an ID', async ({ page }) => {
  // 1. Signing up signs in: the top bar shows the ID, and the mail that confirms the address is sent.
  await signUp(page)
  await page.getByRole('link', { name: '続ける', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)

  // 2. The mailed link confirms the address, which the account section of the settings then says.
  await page.goto(await linkIn(email, '/verify-email'))
  await expect(page.getByText('メールアドレスを確認できました。')).toBeVisible()
  await page.goto('/settings')
  const account = page.getByRole('region', { name: 'アカウント', exact: true })
  await expect(account).toContainText(loginId)
  await expect(account).toContainText(email)
  await expect(account).toContainText('確認済み')

  // 3. After signing out, the ID signs in in upper case too.
  await signOut(page)
  await signInWith(page, loginId.toUpperCase(), PASSWORD)
  await expect(page).toHaveURL(/\/home$/)
  await expect(accountMenu(page)).toHaveAttribute('title', loginId)

  // 4. A wrong password is refused with the one message that does not tell which part was wrong.
  await signOut(page)
  await signInWith(page, loginId, 'not the password')
  await expect(page.getByRole('alert').filter({ hasText: 'ID かパスワードが違うか、しばらくログインできません。' })).toBeVisible()
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fhome$/)

  // 5. A forgotten password: the mailed link sets a new one and signs in; the old one no longer does.
  await page.getByRole('link', { name: 'パスワードを忘れた', exact: true }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await page.getByLabel('ID', { exact: true }).fill(loginId)
  await page.getByRole('button', { name: '送る', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '再設定のリンクを送りました' })).toBeVisible()
  await page.goto(await linkIn(email, '/reset-password'))
  await page.getByLabel('新しいパスワード', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '設定する', exact: true }).click()
  await expect(accountMenu(page)).toHaveAttribute('title', loginId)
  await signOut(page)
  await signInWith(page, loginId, PASSWORD)
  await expect(page.getByRole('alert').filter({ hasText: 'ID かパスワードが違うか、しばらくログインできません。' })).toBeVisible()
  await signInWith(page, loginId, NEW_PASSWORD)
  await expect(accountMenu(page)).toHaveAttribute('title', loginId)

  // The password can be changed in the settings, which keeps this browser signed in.
  await page.goto('/settings')
  await page.getByLabel('今のパスワード', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('新しいパスワード', { exact: true }).fill(CHANGED_PASSWORD)
  await page.getByRole('button', { name: 'パスワードを変更する', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'パスワードを変更しました' })).toBeVisible()
  await page.reload()
  await expect(accountMenu(page)).toHaveAttribute('title', loginId)

  // 6. A forgotten ID: the IDs of the address are mailed.
  await signOut(page)
  await page.goto('/signin')
  await page.getByRole('link', { name: 'ID を忘れた', exact: true }).click()
  await expect(page).toHaveURL(/\/forgot-id$/)
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByRole('button', { name: '送る', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'ID をメールで送りました' })).toBeVisible()
  await expect.poll(async () => (await mailsTo(email)).some(mail => mail.text.includes(loginId) && !mail.text.includes('token='))).toBe(true)
})

test('the sign-up form shows each field\'s problem, and /signin links to it', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible()
  await page.getByRole('link', { name: '新しく登録する', exact: true }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await page.getByLabel('ID', { exact: true }).fill('a!')
  await page.getByLabel('メールアドレス', { exact: true }).fill('not an address')
  await page.getByLabel('パスワード', { exact: true }).fill('short')
  await page.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page.getByText('ID は3〜32文字の半角英数字・「_」・「-」で入力してください。')).toBeVisible()
  await expect(page.getByText('パスワードは10〜128文字で入力してください。')).toBeVisible()
  await expect(page.getByText('メールアドレスの形式が正しくありません。')).toBeVisible()
  await expect(page.getByLabel('ID', { exact: true })).toHaveAttribute('aria-invalid', 'true')

  // A taken ID is told by the server, on its field.
  await signUp(page)
  await signOut(page)
  await page.goto('/signup')
  await page.getByLabel('ID', { exact: true }).fill(loginId.toUpperCase())
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page.getByText('この ID はすでに使われています。別の ID にしてください。')).toBeVisible()
})

test('/signin comes back only to a path of this site', async ({ page }) => {
  await signUp(page)
  await signOut(page)
  // Browsers drop the tab, so "/\t/evil.com" would be "//evil.com", another site: it is home instead.
  await page.goto('/signin?returnTo=%2F%09%2Fevil.com')
  await page.getByLabel('ID', { exact: true }).fill(loginId)
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:3101/home')
  await signOut(page)
  // Auth.js's callbackUrl of the app's own origin is taken when there is no returnTo, and kept on the account links.
  await page.goto('/signin?callbackUrl=http%3A%2F%2F127.0.0.1%3A3101%2Frecords')
  await expect(page.getByRole('link', { name: 'パスワードを忘れた', exact: true })).toHaveAttribute('href', '/forgot-password?returnTo=%2Frecords')
  await expect(page.getByRole('link', { name: 'ID を忘れた', exact: true })).toHaveAttribute('href', '/forgot-id?returnTo=%2Frecords')
  await page.goto('/signin?callbackUrl=https%3A%2F%2Fevil.com%2Frecords')
  await expect(page.getByRole('link', { name: '新しく登録する', exact: true })).toHaveAttribute('href', '/signup')
})

test('an Auth.js error sent to /signin is shown as a failed login', async ({ page }) => {
  await page.goto('/signin?error=Configuration')
  await expect(page.getByRole('alert').filter({ hasText: 'ログインできませんでした。もう一度お試しください。' })).toBeVisible()
})

test('a used or unknown link says it cannot be used', async ({ page }) => {
  await page.goto('/verify-email?token=unknown-token')
  await expect(page.getByRole('alert').filter({ hasText: 'このリンクは使えません。期限が切れたか、すでに使われています。' })).toBeVisible()
  await page.goto('/reset-password?token=unknown-token')
  await page.getByLabel('新しいパスワード', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '設定する', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'このリンクは使えません。期限が切れたか、すでに使われています。' })).toBeVisible()
})

test('the account pages are not indexed', async ({ page }) => {
  for (const path of ['/signin', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/forgot-id']) {
    expect((await page.goto(path))?.status(), path).toBe(200)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  }
  const sitemap = await (await page.request.get('/sitemap.xml')).text()
  for (const path of ['signin', 'signup', 'verify-email', 'forgot-password', 'reset-password', 'forgot-id']) {
    expect(sitemap).not.toContain(`/${path}<`)
  }
})
