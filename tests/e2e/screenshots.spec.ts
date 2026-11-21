import { test, expect, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'

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

// Practice: a list put in this browser before the page loads, so that every run shows the same words.
const words = [
  { display: 'typle', input: 'typle', annotation: 'タイピング' },
  { display: 'water', input: 'water', annotation: '水' },
  { display: 'experience', input: 'experience', annotation: '経験' },
]
// Practice times what is typed with Date.now(), and the result, the record and its date show it. The clock is installed
// and paused, and only moves when a test moves it, so that every run shows the same seconds, speed and day.
const startedAt = new Date('2026-11-01T10:00:00+09:00').getTime()
test.use({ timezoneId: 'Asia/Tokyo' })

async function practise(page: Page, colorScheme: 'light' | 'dark' = 'light') {
  await page.clock.install({ time: startedAt })
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace([{ id: 'shots', name: 'Screenshots', createdAt: '2026-09-06', records: [], words }])])
  await open(page, '/play', colorScheme)
  const input = page.getByRole('textbox', { name: '表示された文字を入力', exact: true })
  await expect(input).toBeFocused()
  await page.clock.pauseAt(startedAt + 60_000)
  return input
}

for (const colorScheme of ['light', 'dark'] as const) {
  const suffix = colorScheme === 'dark' ? '-dark' : ''

  test(`practice shows typed, next and pending letters (${colorScheme})`, async ({ page }) => {
    const input = await practise(page, colorScheme)
    await input.pressSequentially('t')
    await page.clock.runFor(1_500)
    await input.pressSequentially('y')
    await page.clock.runFor(1_500)
    await expect(page.locator('#wordDisplay [data-state="current"]')).toHaveText('p')
    await expect(page).toHaveScreenshot(`play${suffix}.png`, masks(page))
  })

  test(`practice shows a wrong letter (${colorScheme})`, async ({ page }) => {
    const input = await practise(page, colorScheme)
    await input.pressSequentially('ty')
    await page.clock.runFor(2_000)
    await input.pressSequentially('o')
    await page.clock.runFor(1_000)
    await expect(page.locator('#wordDisplay [data-state="current-error"]')).toHaveText('p')
    await expect(page).toHaveScreenshot(`play-error${suffix}.png`, masks(page))
  })

  test(`the result lists the missed words (${colorScheme})`, async ({ page }) => {
    const input = await practise(page, colorScheme)
    await input.pressSequentially('typle')
    await page.clock.runFor(2_000)
    await input.pressSequentially('wx')
    await page.clock.runFor(1_000)
    await input.pressSequentially('ater')
    await page.clock.runFor(3_000)
    await input.pressSequentially('experience')
    // Lets the save and its notification run their timers.
    await page.clock.runFor(10_000)
    const result = page.getByLabel('練習結果', { exact: true })
    await expect(result).toContainText('練習記録を保存しました。')
    await expect(page).toHaveScreenshot(`result${suffix}.png`, masks(page))
  })
}
