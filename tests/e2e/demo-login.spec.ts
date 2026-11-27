import { test, expect, type APIRequestContext } from '@playwright/test'
import { origin } from './account'

// The shared demo account: the sign-in page's button signs in as demo:shared, whose data is the sample
// (src/server/demoWorkspace.ts) and is put back by the daily reset (GET /api/demo/reset with the cron's secret, which
// playwright.config.ts sets to e2e-cron). The tests share that one account, so they run one after another.
test.describe.configure({ mode: 'serial' })

const reset = (request: APIRequestContext) => request.get('/api/demo/reset', { headers: { Authorization: 'Bearer e2e-cron' } })

test.beforeEach(async ({ request }) => {
  expect((await reset(request)).status()).toBe(200)
})

test('the demo button signs in to the shared account and shows its sample', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByText('毎日 4:00（日本時間）に元に戻ります', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'デモアカウントで試す' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('region', { name: '今週のまとめ' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'ITの英単語' }).getByRole('heading', { name: 'ITの英単語' })).toBeVisible()
  await expect(page.getByRole('region', { name: '苦手な単語' }).getByText('idempotent')).toBeVisible()
  await page.goto('/edit')
  await expect(page.getByRole('heading', { name: 'Git', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '英単語', exact: true })).toBeVisible()
})

test('the demo account is not offered signing out of every device', async ({ page }) => {
  await page.goto('/signin')
  await page.getByRole('button', { name: 'デモアカウントで試す' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/settings')
  await expect(page.getByText('すべての端末からのログアウトはできません', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'すべての端末からログアウト' })).toHaveCount(0)
})

test('the reset puts back what a visitor changed', async ({ page, request }) => {
  const signIn = await page.request.post('/api/auth/sign-in/demo', { headers: { Origin: origin } })
  expect(signIn.status()).toBe(200)
  const saved = await (await page.request.get('/api/workspace')).json() as { lists: unknown[], packs: unknown[], revision: number }
  const emptied = await page.request.put('/api/workspace', {
    headers: { Origin: origin },
    data: { accountId: 'demo:shared', revision: saved.revision, lists: [], packs: [] },
  })
  expect(emptied.status()).toBe(200)
  expect((await (await page.request.get('/api/workspace')).json()).lists).toHaveLength(0)
  expect((await reset(request)).status()).toBe(200)
  const after = await (await page.request.get('/api/workspace')).json() as { lists: unknown[], revision: number }
  expect(after.lists.length).toBe(saved.lists.length)
  expect(after.revision).toBeGreaterThan(saved.revision)
})

test('the reset refuses a request without the cron\'s secret', async ({ request }) => {
  expect((await request.get('/api/demo/reset')).status()).toBe(401)
  expect((await request.get('/api/demo/reset', { headers: { Authorization: 'Bearer wrong' } })).status()).toBe(401)
})
