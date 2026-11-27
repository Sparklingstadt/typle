import { test, expect, type Locator, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'
import { openPacks } from './packRows'
import { seedSaved } from './snapshotData'
import { deleteWorkspace, newAccountId, signIn } from './account'
import { skipWelcome } from './welcome'

// Screenshot snapshots compare what a screen looks like with an image taken before
// (tests/e2e/screenshots.spec.ts-snapshots/). Fonts and anti-aliasing differ between systems, so the images are taken
// on macOS (their names end in -darwin) and only match there: npm run verify runs on the Mac. When a screen is meant
// to look different, take the images again with
// `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots`
// and look at each changed image before committing it.

// Anywhere else (the CI runs on Linux) there is no image to compare with, so the whole file is skipped.
test.skip(process.platform !== 'darwin', 'The screenshot snapshots are taken on macOS and only match there.')

// The sign-in page's word types itself: reduced motion keeps it on one frame, so its images stay the same.
async function open(page: Page, path: string, colorScheme: 'light' | 'dark' = 'light', reducedMotion?: 'reduce') {
  // A new workspace is sent to /welcome; the tour has its own test.
  await skipWelcome(page)
  await page.emulateMedia({ colorScheme, reducedMotion })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(path)
  // Noto Sans JP comes from next/font; wait for it so that no image is taken with the fallback font.
  await page.evaluate(() => document.fonts.ready)
}

// The sidebar shows the app's version, which every PR changes: it is painted over so that the images stay the same.
const masks = (page: Page) => ({ mask: [page.getByText(/^v\d+\.\d+\.\d+$/)] })

test('the sign-in page looks the same', async ({ page }) => {
  await open(page, '/signin', 'light', 'reduce')
  await expect(page).toHaveScreenshot('signin.png', masks(page))
})

test('the sign-in page looks the same in dark mode', async ({ page }) => {
  await open(page, '/signin', 'dark', 'reduce')
  await expect(page).toHaveScreenshot('signin-dark.png', masks(page))
})

test('the top of the guide looks the same', async ({ page }) => {
  await open(page, '/guide')
  await expect(page).toHaveScreenshot('guide.png', masks(page))
})

test('the sign-in page looks the same on a phone', async ({ page }) => {
  await open(page, '/signin', 'light', 'reduce')
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

// Screens of saved data (snapshotData.ts): a pack of two lists with records on two devices, on a fixed clock.
async function openSaved(page: Page, path: string, colorScheme: 'light' | 'dark' = 'light') {
  await seedSaved(page)
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

// More pages of the saved data above, each as it first opens. The official catalog and the interests page list the
// official packs, which grow with every pack added, so they are left out.
const pages: { name: string, path: string, ready: (page: Page) => Promise<void>, dark?: boolean, mask?: (page: Page) => Locator[] }[] = [
  { name: 'home', path: '/home', dark: true, ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'words', path: '/words?list=basics', ready: page => expect(page.getByText('experience', { exact: true }).first()).toBeVisible() },
  { name: 'devices', path: '/devices', ready: page => expect(page.getByRole('heading', { name: 'HHKB', exact: true })).toBeVisible() },
  { name: 'settings', path: '/settings', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'input', path: '/input', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'pack-create', path: '/packs/create', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'landing', path: '/', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
    // The numbers of official lists grow with every pack added; they are painted over.
    mask: page => [page.getByText(/\d+件の公式リスト/), page.getByText(/^\d+リスト$/)] },
  // Where the data is kept now is marked once this browser's storage is read.
  { name: 'about', path: '/about', ready: page => expect(page.getByText('今の保存先', { exact: true })).toBeVisible() },
]
for (const { name, path, ready, dark, mask } of pages) {
  for (const colorScheme of dark ? ['light', 'dark'] as const : ['light'] as const) {
    const suffix = colorScheme === 'dark' ? '-dark' : ''
    test(`${path} looks the same (${colorScheme})`, async ({ page }) => {
      await openSaved(page, path, colorScheme)
      await ready(page)
      await expect(page).toHaveScreenshot(`${name}${suffix}.png`, { mask: [...masks(page).mask, ...(mask?.(page) ?? [])] })
    })
  }
}

test('home introduces the app before the first record', async ({ page }) => {
  await open(page, '/home')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveScreenshot('home-first.png', masks(page))
})

// On a phone the sidebar is a drawer behind the menu button, and practice and its result fit 390px.
test('on a phone the menu opens as a drawer', async ({ page }) => {
  await openSaved(page, '/home')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'メニューを開く' }).click()
  await expect(page.getByRole('dialog', { name: 'メニュー' })).toBeVisible()
  await expect(page).toHaveScreenshot('phone-menu.png', masks(page))
})

test('on a phone practice shows the word and the stats', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const input = await practise(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await input.pressSequentially('ty')
  await page.clock.runFor(1_500)
  await expect(page.locator('#wordDisplay [data-state="current"]')).toHaveText('p')
  await expect(page).toHaveScreenshot('phone-play.png', masks(page))
})

test('on a phone the result fits the width', async ({ page }) => {
  const input = await practise(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await input.pressSequentially('typle')
  await page.clock.runFor(2_000)
  await input.pressSequentially('wx')
  await page.clock.runFor(1_000)
  await input.pressSequentially('ater')
  await page.clock.runFor(3_000)
  await input.pressSequentially('experience')
  await page.clock.runFor(10_000)
  await expect(page.getByLabel('練習結果', { exact: true })).toContainText('練習記録を保存しました。')
  await expect(page).toHaveScreenshot('phone-result.png', masks(page))
})

// Practice in the other modes: recall hides the answer, and Handwriting is typed into its text field here (the pad
// loads the recognition model, which takes long and is checked in writing-pad.spec.ts).
for (const colorScheme of ['light', 'dark'] as const) {
  test(`recall hides the answer and shows the hint (${colorScheme})`, async ({ page }) => {
    const input = await practise(page, colorScheme)
    await page.getByRole('button', { name: '思い出して打つ', exact: true }).click()
    await expect(page.locator('#wordDisplay')).toHaveText('＿＿＿＿＿')
    await input.focus()
    await input.pressSequentially('ty')
    await page.clock.runFor(1_500)
    await expect(page).toHaveScreenshot(`play-recall${colorScheme === 'dark' ? '-dark' : ''}.png`, masks(page))
  })
}

test('handwriting shows the word and its text field', async ({ page }) => {
  await page.clock.install({ time: startedAt })
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace([{ id: 'hand', name: '手書き', createdAt: '2026-09-06', records: [], writing: { language: 'en' }, words }])])
  await open(page, '/play?list=hand')
  await page.getByRole('radio', { name: 'Handwriting', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'ここに手書きで入力', exact: true })).toBeVisible()
  await page.clock.pauseAt(startedAt + 60_000)
  await expect(page).toHaveScreenshot('play-writing.png', masks(page))
})

test('the pack editor shows the fields and the lists of the pack', async ({ page }) => {
  await openSaved(page, '/packs/edit?pack=pack-basics')
  await expect(page.getByRole('heading', { name: 'パックを編集', level: 1 })).toBeVisible()
  // The lists are below the fold of 800px; a taller window shows them above the save bar.
  await page.setViewportSize({ width: 1280, height: 1200 })
  await expect(page).toHaveScreenshot('pack-edit.png', masks(page))
})

// Signed in: an account of its own for each test (account.ts), whose rows are deleted afterwards. Its id is random,
// and the name is always E2E User.
test.describe('signed in', () => {
  let accountId = ''
  test.beforeEach(async ({ context, page }) => {
    accountId = newAccountId()
    await signIn(context, accountId)
    await skipWelcome(page, accountId)
  })
  test.afterEach(() => deleteWorkspace(accountId))

  test('the top bar shows the account menu and where the data is saved', async ({ page }) => {
    await open(page, '/home')
    // The account's workspace is read from the server after the page loads.
    await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click()
    await expect(page.getByRole('menu')).toContainText('E2E User')
    await expect(page).toHaveScreenshot('signed-in-menu.png', masks(page))
  })

  test('the general settings show the account', async ({ page }) => {
    await open(page, '/settings')
    // The account's section comes once the session is read.
    await expect(page.getByRole('region', { name: 'ログイン中の端末', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'アカウントメニュー', exact: true })).toBeVisible()
    await expect(page).toHaveScreenshot('signed-in-settings.png', masks(page))
  })
})

// Pages reached from outside the app: a shared result and a link to a shared pack (sharing has ended).
// The page of one official pack shows only that pack, unlike the catalog.
const linkedPages: { name: string, path: string, ready: (page: Page) => Promise<void> }[] = [
  { name: 'result-shared', path: `/result?n=${encodeURIComponent('基本の単語')}&t=6.00&a=95&w=3&s=200`, ready: page => expect(page.getByRole('heading', { level: 1, name: '「基本の単語」の練習記録' })).toBeVisible() },
  { name: 'shared-ended', path: '/shared/0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d', ready: page => expect(page.getByText('この共有は終了しました。')).toBeVisible() },
  // The button to practise is disabled until this browser's data is read.
  { name: 'official-pack', path: '/packs/english-basics', ready: page => expect(page.getByRole('button', { name: 'このパックで練習する', exact: true })).toBeEnabled() },
]
for (const { name, path, ready } of linkedPages) {
  test(`${name} looks the same`, async ({ page }) => {
    await open(page, path)
    await ready(page)
    await expect(page).toHaveScreenshot(`${name}.png`, masks(page))
  })
}

// Errors: data in this browser that cannot be read, and a save that the browser refuses (its storage is full).
test('unreadable saved data shows the error instead of the records', async ({ page }) => {
  await openSaved(page, '/records')
  await page.evaluate(() => localStorage.setItem('typle-r:guest-workspace:v1', '{broken'))
  await page.reload()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('保存データを読み込めません')
  await expect(page).toHaveScreenshot('error-unreadable.png', masks(page))
})

test('a save the browser refuses keeps the draft and says why', async ({ page }) => {
  await openSaved(page, '/create')
  await page.getByRole('textbox', { name: '単語リスト名', exact: true }).fill('下書き')
  await page.getByRole('textbox', { name: '表示する単語 1', exact: true }).fill('apple')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === 'typle-r:guest-workspace:v1') { Storage.prototype.setItem = original; throw new DOMException('Full', 'QuotaExceededError') }
      return original.call(this, name, value)
    }
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ブラウザーに保存できません' })).toBeVisible()
  await expect(page).toHaveScreenshot('error-save-refused.png', masks(page))
})

// Another display language: English, chosen on the general settings and kept in this browser.
async function useEnglish(page: Page) {
  await open(page, '/settings')
  await page.locator('label').filter({ has: page.locator('span[lang]', { hasText: 'English' }) }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
}
test('home looks the same in English', async ({ page }) => {
  await seedSaved(page)
  await useEnglish(page)
  await page.goto('/home')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveScreenshot('en-home.png', masks(page))
})
test('the sign-in page looks the same in English', async ({ page }) => {
  await useEnglish(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/signin')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveScreenshot('en-signin.png', masks(page))
})

// The tour, with reduced motion so that the typed headings and the typing demo hold still.
async function openTour(page: Page, colorScheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/welcome')
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('checkbox', { name: '中国語', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Go', exact: true }).check()
}

test('the tour looks the same', async ({ page }) => {
  await openTour(page)
  await expect(page).toHaveScreenshot('welcome-interests.png', masks(page))
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByRole('region', { name: 'パックをフォローする' })).toBeVisible()
  await expect(page).toHaveScreenshot('welcome-packs.png', masks(page))
  await page.getByRole('button', { name: 'フォローする', exact: true }).click()
  await expect(page.getByRole('region', { name: '練習を始める' })).toBeVisible()
  await expect(page).toHaveScreenshot('welcome-start.png', masks(page))
})

test('the tour looks the same in dark mode', async ({ page }) => {
  await openTour(page, 'dark')
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByRole('region', { name: 'パックをフォローする' })).toBeVisible()
  await expect(page).toHaveScreenshot('welcome-packs-dark.png', masks(page))
})
