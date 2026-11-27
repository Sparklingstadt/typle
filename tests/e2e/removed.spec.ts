import { test, expect } from '@playwright/test'
import { openPacks } from './packRows'
import { guestWorkspace } from './guestData'
import { origin } from './account'
import { skipWelcome } from './welcome'

// /api/auth answers only the paths the logins use (src/server/authPaths.ts, tests/betterAuthProviders.test.cjs): every
// other one is not found, in the form of the app's other 404s, such as the app's token of the login before Auth.js,
// Auth.js's own paths, and the Better Auth endpoints the app does not use.
test('an /api/auth path that the logins do not use is not found', async ({ page }) => {
  for (const path of ['/api/auth/token', '/api/auth/signin/github', '/api/auth/callback/ffpf', '/api/auth/list-sessions',
    '/api/auth/list-accounts', '/api/auth/ok', '/api/auth/error']) {
    const response = await page.request.get(path)
    expect(response.status(), path).toBe(404)
    expect(await response.json(), path).toEqual({ error: 'notFound' })
  }
  for (const path of ['/api/auth/token', '/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/revoke-sessions',
    '/api/auth/update-user', '/api/auth/delete-user', '/api/auth/link-social', '/api/auth/get-session']) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data: {} })
    expect(response.status(), path).toBe(404)
  }
})

// The made-up login of development (src/app/local-login, POST /api/auth/sign-in/local) is only there when the app runs
// for development on this machine (src/lib/localDevelopment.ts, src/server/settings.ts): the production build with
// the production settings serves neither, nor the paths of Auth.js that listed the logins.
test('local login is not found in production', async ({ page }) => {
  expect((await page.goto('/local-login'))!.status()).toBe(404)
  expect((await page.request.post('/api/auth/sign-in/local', { headers: { Origin: origin } })).status()).toBe(404)
  for (const path of ['/api/auth/session', '/api/auth/providers', '/api/auth/csrf']) {
    expect((await page.request.get(path)).status(), path).toBe(404)
  }
})

// The top bar goes to /signin with the page being viewed, and /signin offers GitHub alone (no FFPF ID), coming back to
// that page.
test('/signin has the GitHub button, and the login comes back to the page', async ({ page }) => {
  await skipWelcome(page)
  await page.goto('/home')
  const signIn = page.getByRole('link', { name: 'ログイン', exact: true })
  await expect(signIn).toHaveAttribute('href', '/signin?returnTo=%2Fhome')
  await signIn.click()
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fhome$/)
  await expect(page.getByRole('heading', { level: 1, name: 'ログイン' })).toBeVisible()
  await expect(page.getByText('FFPF ID')).toHaveCount(0)
  const bodies: string[] = []
  // next-auth/react posts to /api/auth/signin/github? (with the provider's own query, empty here).
  await page.route(url => url.pathname === '/api/auth/signin/github', route => {
    bodies.push(route.request().postData() ?? '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${origin}/home` }) })
  })
  await page.getByRole('button', { name: 'GitHubでログイン' }).click()
  await expect.poll(() => bodies.length).toBe(1)
  const body = new URLSearchParams(bodies[0])
  expect(body.get('callbackUrl')).toBe('/home')
  expect(body.get('csrfToken')).toBeTruthy()
  await expect(page).toHaveURL(/\/home$/)
})

// A login that cannot start (Auth.js answers with an error) stays on /signin and says so, instead of going on as if it
// had worked.
test('a GitHub login that fails to start stays on /signin and says so', async ({ page }) => {
  await page.route(url => url.pathname === '/api/auth/signin/github', route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"There was a problem with the server configuration."}' }))
  await page.goto('/signin?returnTo=%2Fplay')
  await page.getByRole('button', { name: 'GitHubでログイン' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ログインできませんでした' })).toBeVisible()
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fplay$/)
  await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeEnabled()
})

test('a link to a shared pack says sharing has ended, and asks nothing of the server', async ({ page }) => {
  const asked: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/shared')) asked.push(request.url()) })
  for (const id of ['0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d', '0b1c']) {
    await page.goto(`/shared/${id}`)
    await expect(page.getByText('この共有は終了しました。')).toBeVisible()
    await expect(page.getByRole('banner', { name: 'トップバー' })).toBeVisible()
  }
  expect(asked).toEqual([])
})

test('the gallery goes to the catalog of the official packs', async ({ page }) => {
  await page.goto('/gallery?q=css')
  await expect(page).toHaveURL(/\/packs\/catalog$/)
})

// typle-session=stale is an unreadable cookie of the current format: it signs no one in.
test('an unreadable typle-session cookie falls back to the data in this browser', async ({ page, context }) => {
  await context.addCookies([{ name: 'typle-session', value: 'stale', url: 'http://127.0.0.1:3101' }])
  const key = 'typle-r:guest-workspace:v1'
  const lists = [{ id: 'kept', name: 'Kept in browser', createdAt: '2026-10-19', words: [{ display: 'a', input: 'a', annotation: '' }], records: [] }]
  await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) },
    [key, guestWorkspace(lists)])
  await page.goto('/edit')
  await openPacks(page)
  await expect(page.getByRole('button', { name: 'Kept in browser を編集', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible()
})
