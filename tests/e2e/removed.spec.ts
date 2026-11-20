import { test, expect } from '@playwright/test'
import { openPacks } from './packRows'
import { guestWorkspace } from './guestData'

test('removed server routes answer 404', async ({ page }) => {
  for (const path of ['/api/v1/lists', '/api/tokens', '/api/admin/dashboard', '/api/admin/users', '/api/admin/gallery',
    '/api/shares', '/api/shared?id=0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d', '/api/gallery', '/api/gallery/categories',
    // The login with FFPF ID was removed in v2.54.0.
    '/api/auth/callback/ffpf?code=c&state=s']) {
    expect((await page.request.get(path)).status(), path).toBe(404)
  }
  // The administrator's dashboard and its API were removed in v2.48.0, sharing a pack and the gallery in v2.49.0.
  for (const path of ['/api/admin/gallery/hide', '/api/admin/gallery/unhide', '/api/auth/admin/signout', '/api/shares', '/api/gallery/added', '/api/gallery/reports']) {
    expect((await page.request.post(path)).status(), path).toBe(404)
  }
  expect((await page.goto('/admin'))!.status()).toBe(404)
})

// An answer that still lists FFPF ID (an older deployment) offers GitHub alone, and the login asks for no provider.
test('the sign-in is GitHub alone', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, providers: ['github', 'ffpf'] }) }))
  const urls: string[] = []
  await page.route('**/api/auth/signin?**', route => { urls.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }) })
  await page.goto('/home')
  await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible()
  await expect(page.getByText('FFPF ID')).toHaveCount(0)
  await page.getByRole('button', { name: 'GitHubでログイン' }).click()
  await expect.poll(() => urls.length).toBe(1)
  const url = new URL(urls[0])
  expect(url.pathname).toBe('/api/auth/signin')
  expect(url.searchParams.get('returnTo')).toBe('/home')
  expect(url.searchParams.has('provider')).toBe(false)
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

// authjs.session-token is what a browser that used the app before the Go backend still holds; typle-session=stale is an
// unreadable cookie of the current format. Neither signs anyone in.
for (const name of ['authjs.session-token', 'typle-session']) {
  test(`an unreadable ${name} cookie falls back to the data in this browser`, async ({ page, context }) => {
    await context.addCookies([{ name, value: 'stale', url: 'http://127.0.0.1:3101' }])
    const key = 'typle-r:guest-workspace:v1'
    const lists = [{ id: 'kept', name: 'Kept in browser', createdAt: '2026-10-19', words: [{ display: 'a', input: 'a', annotation: '' }], records: [] }]
    await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) },
      [key, guestWorkspace(lists)])
    await page.goto('/edit')
    await openPacks(page)
    await expect(page.getByRole('button', { name: 'Kept in browser を編集', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible()
  })
}
