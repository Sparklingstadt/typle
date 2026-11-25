import { test, expect } from '@playwright/test'
import { guestWorkspace } from './guestData'
import { skipWelcome } from './welcome'

const key = 'typle-r:guest-workspace:v1'

test('a new guest opening /home is sent to the tour', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/welcome$/)
})

test('a new guest opening /play is sent to the tour', async ({ page }) => {
  await page.goto('/play')
  await expect(page).toHaveURL(/\/welcome$/)
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
