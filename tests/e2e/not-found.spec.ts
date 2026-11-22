import { test, expect } from '@playwright/test'

// src/app/not-found.tsx answers every URL the app has no page for, inside the usual layout, with status 404.
test('an unknown URL shows the 404 page with links back', async ({ page }) => {
  const response = await page.goto('/no-such-page')
  expect(response!.status()).toBe(404)
  await expect(page).toHaveTitle('ページが見つかりません | Typle')
  await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible()
  const main = page.locator('#main-content')
  await expect(main.getByRole('link', { name: '練習する', exact: true })).toHaveAttribute('href', '/play')
  await main.getByRole('link', { name: 'ホームへ戻る', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
})

// notFound() from a page (an official pack that does not exist) shows the same page.
test('a missing official pack shows the 404 page', async ({ page }) => {
  expect((await page.goto('/packs/no-such-pack'))!.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible()
})
