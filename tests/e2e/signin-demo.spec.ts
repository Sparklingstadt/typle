import { test, expect, type Page } from '@playwright/test'

// The word above the sign-in heading types itself: a decoration, kept still for reduced motion and out of the way of
// screen readers and the keyboard.
const demo = (page: Page) => page.getByTestId('typing-demo')
// TargetText draws the characters not yet typed too, so the text stays the same while it types: count the typed ones.
const typed = (page: Page) => demo(page).locator('[data-state="done"]').count()

test('the word on the sign-in page types itself', async ({ page }) => {
  await page.goto('/signin')
  const before = await typed(page)
  await expect.poll(() => typed(page), { timeout: 3000 }).not.toBe(before)
})

test('with reduced motion the word stays still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/signin')
  await expect(demo(page)).toBeVisible()
  const before = await typed(page)
  await page.waitForTimeout(1000)
  expect(await typed(page)).toBe(before)
})

test('the word is hidden from assistive technology and takes no focus', async ({ page }) => {
  await page.goto('/signin')
  await expect(demo(page)).toHaveAttribute('aria-hidden', 'true')
  await expect(demo(page).locator('[tabindex], input, button, a')).toHaveCount(0)
})
