import { test, expect, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'
import { openPacks } from './packRows'

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

// Screens of saved data: a pack of two lists with records on two devices, dated from a fixed clock so that "today"
// and the days of the records are the same on every run.
const today = new Date('2026-11-01T12:00:00+09:00').getTime()
const minute = 60 * 1000
const day = 24 * 60 * minute
const mac = { id: 'mac', name: 'MacBook Air', layout: 'JIS' }
const hhkb = { id: 'hhkb', name: 'HHKB', layout: 'US' }
const word = (input: string, display = input, annotation = '') => ({ input, display, annotation })
const record = (id: string, time: number, accuracy: number, ago: number, device: typeof mac, wordCount = 3) =>
  ({ id, time, accuracy, mistakes: accuracy === 100 ? 0 : 1, wordCount, date: new Date(today - ago).toISOString(), device })
const library = [
  { id: 'basics', name: '基本の単語', group: '英単語', category: '語学', tags: ['英語'], createdAt: '2026-09-01',
    words: [word('apple', 'apple', 'りんご'), word('water', 'water', '水'), word('experience', 'experience', '経験')], records: [
      record('b1', 6.2, 100, 5 * minute, mac),
      record('b2', 7.8, 95.2, 2 * 60 * minute, hhkb),
      record('b3', 5.4, 100, day, mac),
      record('b4', 9.1, 90.5, 3 * day, hhkb),
    ] },
  { id: 'phrases', name: 'よく使う表現', group: '英単語', createdAt: '2026-09-02',
    words: [word('thank you', 'thank you', 'ありがとう'), word('good morning', 'good morning', 'おはよう')], records: [
      record('p1', 8.5, 100, 30 * minute, mac, 2),
    ] },
]

async function openSaved(page: Page, path: string, colorScheme: 'light' | 'dark' = 'light') {
  await page.clock.setFixedTime(today)
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace(library, { devices: [mac, hhkb] })])
  await open(page, path, colorScheme)
}
const editButton = (page: Page, name: string) => page.getByRole('button', { name: `${name} を編集`, exact: true })

test('the packs page shows a pack open with its lists and a menu', async ({ page }) => {
  await openSaved(page, '/edit')
  await openPacks(page)
  await page.getByRole('button', { name: '基本の単語 のその他の操作', exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page).toHaveScreenshot('packs-menu.png', masks(page))
})

test('the list editor shows the words of a list', async ({ page }) => {
  await openSaved(page, '/edit')
  await openPacks(page)
  await editButton(page, '基本の単語').click()
  await expect(page.getByRole('textbox', { name: '表示する単語 3', exact: true })).toHaveValue('experience')
  // The words are below the fold of 800px; a taller window shows them above the save bar, which stays at the bottom.
  await page.setViewportSize({ width: 1280, height: 1200 })
  await expect(page).toHaveScreenshot('editor.png', masks(page))
})

test('the list editor shows errors on the fields and in the save bar', async ({ page }) => {
  await openSaved(page, '/create')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '2件のエラーがあります' })).toBeVisible()
  await expect(page).toHaveScreenshot('editor-errors.png', masks(page))
})

test('leaving the editor with changes asks first', async ({ page }) => {
  await openSaved(page, '/create')
  await page.getByRole('textbox', { name: '単語リスト名', exact: true }).fill('Draft')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('保存していない変更があります')
  await expect(page).toHaveScreenshot('editor-discard.png', masks(page))
})

test('the CSV import previews the words before adding them', async ({ page }) => {
  await openSaved(page, '/create')
  await page.getByRole('button', { name: 'CSVを読み込む', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'CSVから読み込む' })
  await dialog.getByLabel('CSVファイルを選択', { exact: true }).setInputFiles({ name: '国名.csv', mimeType: 'text/csv',
    buffer: Buffer.from('input,display,annotation\nJapan,日本,アジア\nFrance,フランス,ヨーロッパ\nBrazil,ブラジル,南アメリカ') })
  await expect(dialog.getByRole('table', { name: '読み込む単語のプレビュー' })).toContainText('ブラジル')
  await expect(page).toHaveScreenshot('csv-import.png', masks(page))
})

for (const colorScheme of ['light', 'dark'] as const) {
  const suffix = colorScheme === 'dark' ? '-dark' : ''

  test(`the records page groups the records by day (${colorScheme})`, async ({ page }) => {
    await openSaved(page, '/records', colorScheme)
    await expect(page.locator('[data-record-key]')).toHaveCount(5)
    await expect(page).toHaveScreenshot(`records${suffix}.png`, masks(page))
  })

  test(`the best records page ranks each list (${colorScheme})`, async ({ page }) => {
    await openSaved(page, '/rankings', colorScheme)
    await expect(page.getByRole('region', { name: '英単語 › 基本の単語', exact: true })).toBeVisible()
    await expect(page).toHaveScreenshot(`rankings${suffix}.png`, masks(page))
  })
}
