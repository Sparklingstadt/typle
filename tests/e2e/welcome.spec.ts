import { test, expect, type Page } from '@playwright/test'
import { deleteWorkspace, newAccountId, signIn, withDatabase } from './account'
import { guestWorkspace } from './guestData'
import { skipWelcome } from './welcome'

const key = 'typle-r:guest-workspace:v1'
const firstStep = (page: Page) => page.getByRole('region', { name: '関心を選ぶ' })
const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Picks 中国語 and Go on the first step and moves on to the packs. */
async function pickInterests(page: Page) {
  const next = page.getByRole('button', { name: '次へ', exact: true })
  await expect(next).toBeDisabled()
  await chip(page, '語学').click()
  await expect(next).toBeDisabled()
  await chip(page, '中国語').click()
  await chip(page, 'プログラミング').click()
  await chip(page, 'Go').click()
  await expect(next).toBeEnabled()
  await next.click()
  await expect(page.getByRole('region', { name: 'パックをフォローする' })).toBeVisible()
}

test('a new guest opening /home is sent to the tour', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(firstStep(page)).toBeVisible()
})

test('a new guest opening /play is sent to the tour', async ({ page }) => {
  await page.goto('/play')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(firstStep(page)).toBeVisible()
})

test('a guest with data stays on /home and /play', async ({ page }) => {
  const word = { display: 'ab', input: 'ab', annotation: '' }
  const lists = [{ id: 'first', name: 'First list', createdAt: '2026-09-01', words: [word], records: [] }]
  await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, [key, guestWorkspace(lists)])
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。' })).toBeVisible()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/play')
  await expect(page.getByRole('button', { name: '単語リストを切り替える（現在: First list）' })).toBeVisible()
  await expect(page).toHaveURL(/\/play$/)
})

test('a guest who dismissed it stays', async ({ page }) => {
  await skipWelcome(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。' })).toBeVisible()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/play')
  await expect(page.getByText('どれから練習しますか？')).toBeVisible()
  await expect(page).toHaveURL(/\/play$/)
})

test('a new guest picks interests, follows and starts practice', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByText('ステップ 1 / 3')).toBeVisible()
  await pickInterests(page)
  const chinese = page.getByRole('checkbox', { name: '中国語：基礎単語・基礎構文 を選ぶ', exact: true })
  const go = page.getByRole('checkbox', { name: 'Go構文 を選ぶ', exact: true })
  await expect(chinese).toBeChecked()
  await expect(go).toBeChecked()
  await expect(page.getByRole('link', { name: 'カタログでもっと見る', exact: true })).toHaveAttribute('href', '/packs/catalog')
  await go.uncheck()
  await page.getByRole('button', { name: 'フォローする', exact: true }).click()

  const start = page.getByRole('region', { name: '練習を始める' })
  await expect(start).toBeVisible()
  await expect(start.getByText('最初のリスト：中国語：基礎単語・基礎構文')).toBeVisible()
  await expect(start.getByText('我是学生。')).toBeVisible()
  await start.getByRole('button', { name: '練習を始める', exact: true }).click()
  await expect(page).toHaveURL(/\/play\?list=/)
  await expect(page.getByRole('textbox', { name: '表示された文字を入力', exact: true })).toBeVisible()

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), key)
  expect(saved.packs.map((pack: { origin?: { catalogId?: string } }) => pack.origin?.catalogId)).toEqual(['pack-chinese-basics'])
  expect(saved.interests).toEqual(['language', 'language/zh', 'programming', 'programming/go'])
})

test('later leaves the tour for good on this browser', async ({ page }) => {
  await page.goto('/welcome')
  await expect(firstStep(page)).toBeVisible()
  await page.getByRole('button', { name: 'あとで', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。' })).toBeVisible()
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。' })).toBeVisible()
  await expect(page).toHaveURL(/\/home$/)
})

test('someone with data opening /welcome goes home', async ({ page }) => {
  const word = { display: 'ab', input: 'ab', annotation: '' }
  const lists = [{ id: 'first', name: 'First list', createdAt: '2026-09-01', words: [word], records: [] }]
  await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, [key, guestWorkspace(lists)])
  await page.goto('/welcome')
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。' })).toBeVisible()
})

test('a new account is toured too, and a failed interests save can be retried', async ({ page, context }) => {
  const accountId = newAccountId()
  await signIn(context, accountId)
  try {
    await page.goto('/home')
    await expect(page).toHaveURL(/\/welcome$/)
    await pickInterests(page)
    // The follow is the first save and passes; the interests are the second and fail.
    let puts = 0
    const failInterests = (route: import('@playwright/test').Route) => route.request().method() === 'PUT' && ++puts === 2
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"saveFailed"}' })
      : route.continue()
    await page.route('**/api/workspace', failInterests)
    await page.getByRole('button', { name: 'フォローする', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    const retry = page.getByRole('button', { name: '関心をもう一度保存', exact: true })
    await expect(retry).toBeVisible()
    expect(puts).toBe(2)
    await page.unroute('**/api/workspace', failInterests)
    await retry.click()
    await expect(page.getByRole('region', { name: '練習を始める' })).toBeVisible()
    const row = await withDatabase(pool => pool.query('SELECT interests FROM typle_workspaces WHERE owner_id = $1', [accountId]))
    expect(row.rows[0].interests).toEqual(['language', 'language/zh', 'programming', 'programming/go'])
  } finally {
    await deleteWorkspace(accountId)
  }
})
