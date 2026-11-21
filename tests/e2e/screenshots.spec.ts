import { test, expect, type Page } from '@playwright/test'

// Screenshot snapshots compare what a screen looks like with an image taken before
// (tests/e2e/screenshots.spec.ts-snapshots/). Fonts and anti-aliasing differ between systems, so the images are taken
// on macOS (their names end in -darwin) and only match there: npm run verify runs on the Mac. When a screen is meant
// to look different, take the images again with
// `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots`
// and look at each changed image before committing it.

async function open(page: Page, path: string, colorScheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(path)
  // Noto Sans JP comes from next/font; wait for it so that no image is taken with the fallback font.
  await page.evaluate(() => document.fonts.ready)
}

// The sidebar shows the app's version, which every PR changes: it is painted over so that the images stay the same.
const masks = (page: Page) => ({ mask: [page.getByText(/^v\d+\.\d+\.\d+$/)] })

test('the sign-in page looks the same', async ({ page }) => {
  await open(page, '/signin')
  await expect(page).toHaveScreenshot('signin.png', masks(page))
})

test('the sign-in page looks the same in dark mode', async ({ page }) => {
  await open(page, '/signin', 'dark')
  await expect(page).toHaveScreenshot('signin-dark.png', masks(page))
})

test('the sign-up page looks the same', async ({ page }) => {
  await open(page, '/signup')
  await expect(page).toHaveScreenshot('signup.png', masks(page))
})

test('the top of the guide looks the same', async ({ page }) => {
  await open(page, '/guide')
  await expect(page).toHaveScreenshot('guide.png', masks(page))
})

test('the sign-in page looks the same on a phone', async ({ page }) => {
  await open(page, '/signin')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page).toHaveScreenshot('signin-phone.png', masks(page))
})
