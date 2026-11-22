import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'
import { openPacks } from './packRows'
import { seedSaved } from './snapshotData'
import { deleteWorkspace, newAccountId, signIn } from './account'

// ARIA snapshots compare the accessibility tree (roles, names and their order), not pixels, so fonts and the OS do
// not change them. They catch a control that lost its label, a heading that changed level or a link that went missing.
// How to update them is in docs/snapshots.md: in short, the trees written in this file are rewritten with
// `npx playwright test tests/e2e/aria-snapshots.spec.ts --update-snapshots --update-source-method=overwrite`, and
// those kept in aria-snapshots.spec.ts-snapshots/ with TYPLE_ARIA_WRITE=1 (matchAriaFile below). Review the diff
// before committing it.

/**
 * Compares the locator's tree with aria-snapshots.spec.ts-snapshots/<name>. With TYPLE_ARIA_WRITE=1 it writes the
 * tree there instead, with the values as they are: --update-snapshots would turn every number, date and time into a
 * regular expression, while the data and the clock of these tests are fixed so that the values can be compared. Only
 * the app's version, which every PR changes, is written as a regular expression.
 */
async function matchAriaFile(locator: Locator, name: string) {
  if (process.env.TYPLE_ARIA_WRITE !== '1') return expect(locator).toMatchAriaSnapshot({ name })
  // A page may still change after it looks ready, so the tree is written once two readings half a second apart agree.
  let tree = await locator.ariaSnapshot()
  for (let tries = 0; tries < 10; tries++) {
    await locator.page().waitForTimeout(500)
    const next = await locator.ariaSnapshot()
    if (next === tree) break
    tree = next
  }
  tree = tree.replace(/^(\s*- [a-z]+: )v\d+\.\d+\.\d+$/gm, '$1/v\\d+\\.\\d+\\.\\d+/')
  writeFileSync(path.join(path.dirname(test.info().file), 'aria-snapshots.spec.ts-snapshots', name), tree + '\n')
}

test('the sign-in page has only the Sparklingstadt ID and GitHub buttons', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
    - main:
      - heading "ログイン" [level=1]
      - button "Sparklingstadt IDでログイン"
      - button "GitHubでログイン"
  `)
  // No ID or password, and no links to sign up or to recover either.
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('link')).toHaveCount(0)
})

test('the guide keeps its table of contents', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/guide')
  await expect(page.getByRole('navigation', { name: 'このページの内容' })).toMatchAriaSnapshot(`
    - navigation "このページの内容":
      - heading "このページの内容" [level=2]
      - list:
        - listitem:
          - link "練習する":
            - /url: "#practice"
        - listitem:
          - link "単語リストを作る":
            - /url: "#lists"
        - listitem:
          - link "結果と記録を見る":
            - /url: "#records"
        - listitem:
          - link "端末を登録する":
            - /url: "#devices"
        - listitem:
          - link "保存先とデータ":
            - /url: "#storage"
        - listitem:
          - link "キーボード操作":
            - /url: "#shortcuts"
  `)
})

test('the top bar keeps its links and menus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  await expect(page.getByRole('banner')).toMatchAriaSnapshot(`
    - banner "トップバー":
      - link "本文へスキップ":
        - /url: "#main-content"
      - link "Typle":
        - /url: /home
      - text: 保存先： このブラウザーに保存
      - button "ダークモード"
      - link "ログイン":
        - /url: /signin?returnTo=%2Fhome
  `)
})

// Screens after an action, on data put in this browser before the page loads. Practice times what is typed with
// Date.now(), so the clock is paused and moved by set steps: the result shows the same seconds on every run.
const startedAt = new Date('2026-11-01T10:00:00+09:00').getTime()
test.use({ timezoneId: 'Asia/Tokyo' })
const word = (input: string, annotation = '') => ({ input, display: input, annotation })
async function seed(page: Page) {
  await page.clock.install({ time: startedAt })
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace([{ id: 'basics', name: '基本の単語', group: '英単語', createdAt: '2026-09-01', records: [],
    words: [word('apple', 'りんご'), word('water', '水'), word('experience', '経験')] }])])
}

test('the practice result keeps its figures, actions and missed words', async ({ page }) => {
  await seed(page)
  await page.goto('/play')
  const input = page.getByRole('textbox', { name: '表示された文字を入力', exact: true })
  await expect(input).toBeFocused()
  await page.clock.pauseAt(startedAt + 60_000)
  await input.pressSequentially('apple')
  await page.clock.runFor(2_000)
  await input.pressSequentially('wx')
  await page.clock.runFor(1_000)
  await input.pressSequentially('ater')
  await page.clock.runFor(3_000)
  await input.pressSequentially('experience')
  await page.clock.runFor(10_000)
  const result = page.getByLabel('練習結果', { exact: true })
  await expect(result).toContainText('練習記録を保存しました。')
  await expect(result).toMatchAriaSnapshot(`
    - region "練習結果":
      - heading "おつかれさまでした！" [level=2]
      - paragraph: 練習完了：基本の単語
      - term: 所要時間
      - definition: 6.00秒
      - definition: このリストの最初の記録
      - term: 正確率
      - definition: 95.2%
      - definition: ミス 1 文字
      - term: 速度
      - definition: 200打/分
      - definition: 20 文字
      - term: 間違えた単語
      - definition: 1/ 3 語
      - definition: デフォルト
      - status: 練習記録を保存しました。このリストの 1 位です。
      - button "もう一度 Enter"
      - button "間違えた 1 語だけ練習する"
      - button "別のリストを選ぶ"
      - link "記録を見る":
        - /url: /records
      - link "X でシェア"
      - region "間違えた単語":
        - heading "間違えた単語" [level=3]
        - list:
          - listitem:
            - paragraph:
              - text: w
              - mark: a
              - text: ter
            - paragraph: 水
            - paragraph: 2文字目で x と打った
            - paragraph: 1回
  `)
})

test('the row menu of a list keeps its items', async ({ page }) => {
  await seed(page)
  await page.goto('/edit')
  await openPacks(page)
  await page.getByRole('button', { name: '基本の単語 のその他の操作', exact: true }).click()
  await expect(page.getByRole('menu')).toMatchAriaSnapshot(`
    - menu "基本の単語 のその他の操作":
      - menuitem "CSVエクスポート"
      - menuitem "複製"
      - separator
      - menuitem "削除"
  `)
})

test('the CSV import dialog keeps its preview and buttons', async ({ page }) => {
  await page.goto('/create')
  await page.getByRole('button', { name: 'CSVを読み込む', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'CSVから読み込む' })
  await dialog.getByLabel('CSVファイルを選択', { exact: true }).setInputFiles({ name: '国名.csv', mimeType: 'text/csv',
    buffer: Buffer.from('input,display,annotation\nJapan,日本,アジア\nFrance,フランス,ヨーロッパ') })
  await expect(dialog.getByRole('table', { name: '読み込む単語のプレビュー' })).toContainText('フランス')
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "CSVから読み込む":
      - heading "CSVから読み込む" [level=2]
      - paragraph: 1行目は列名です。input と display は必須、annotation と input_type は省略できます。input_type は command・code・word のいずれかです。列の順番は自由です。
      - button "CSVファイルを選択"
      - paragraph: 国名.csv
      - paragraph: /2語 ・ \\d+ B/
      - button "別のファイルを選ぶ"
      - table "読み込む単語のプレビュー":
        - rowgroup:
          - row "表示する単語 入力する文字 補足":
            - columnheader "表示する単語"
            - columnheader "入力する文字"
            - columnheader "補足"
        - rowgroup:
          - row "日本 Japan アジア":
            - cell "日本"
            - cell "Japan"
            - cell "アジア"
          - row "フランス France ヨーロッパ":
            - cell "フランス"
            - cell "France"
            - cell "ヨーロッパ"
      - status: 2語を読み込みました。
      - button "キャンセル"
      - button "2語を追加"
      - button "閉じる"
  `)
})

test('leaving the editor with changes asks with two choices', async ({ page }) => {
  await page.goto('/create')
  await page.getByRole('textbox', { name: '単語リスト名', exact: true }).fill('Draft')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toMatchAriaSnapshot(`
    - alertdialog "保存していない変更があります":
      - heading "保存していない変更があります" [level=2]
      - paragraph: このまま移動すると、入力した内容は失われます。
      - button "編集を続ける"
      - button "破棄して移動"
  `)
})


// The pages of saved data (snapshotData.ts), each as it first opens. These trees are long, so each is kept in its own
// file, aria-snapshots.spec.ts-snapshots/<name>.aria.yml.
const savedPages: { name: string, path: string, title: string, ready: (page: Page) => Promise<void> }[] = [
  { name: 'home', path: '/home', title: 'home sums up the week and suggests what to practise', ready: page => expect(page.getByRole('heading', { name: '練習の状況', level: 1 })).toBeVisible() },
  { name: 'records', path: '/records', title: 'the records page groups the records by day', ready: page => expect(page.locator('[data-record-key]')).toHaveCount(5) },
  { name: 'devices', path: '/devices', title: 'the devices page lists the devices and their use', ready: page => expect(page.getByRole('heading', { name: 'HHKB', exact: true })).toBeVisible() },
  { name: 'words', path: '/words?list=basics', title: 'the words page shows the words of the chosen list', ready: page => expect(page.getByText('experience', { exact: true }).first()).toBeVisible() },
  { name: 'settings', path: '/settings', title: 'the general settings keep the display languages', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'input', path: '/input', title: 'the input settings keep their switches', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'pack-create', path: '/packs/create', title: 'the pack form keeps its fields', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
  // Where the data is kept now is marked once this browser's storage is read.
  { name: 'about', path: '/about', title: 'the about page keeps its sections', ready: page => expect(page.getByText('今の保存先', { exact: true })).toBeVisible() },
]
for (const { name, path, title, ready } of savedPages) {
  test(title, async ({ page }) => {
    await seedSaved(page)
    await page.goto(path)
    await ready(page)
    await matchAriaFile(page.getByRole('main'), `${name}.aria.yml`)
  })
}

test('the best records page shows the chosen list', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/rankings')
  await matchAriaFile(page.getByRole('region', { name: '英単語 › 基本の単語', exact: true }), 'rankings.aria.yml')
})

test('the packs page shows a pack open with its lists', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/edit')
  await openPacks(page)
  await matchAriaFile(page.getByRole('main'), 'packs.aria.yml')
})

test('the list editor keeps its fields and the words', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/edit')
  await openPacks(page)
  await page.getByRole('button', { name: '基本の単語 を編集', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '表示する単語 3', exact: true })).toHaveValue('experience')
  await matchAriaFile(page.getByRole('main'), 'editor.aria.yml')
})

test('home introduces the app before the first record', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await matchAriaFile(page.getByRole('main'), 'home-first.aria.yml')
})

test('the sidebar keeps its groups of links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  await matchAriaFile(page.getByRole('navigation', { name: 'メインナビゲーション' }), 'sidebar.aria.yml')
  await matchAriaFile(page.getByRole('navigation', { name: 'ヘルプ' }), 'sidebar-help.aria.yml')
})

test('on a phone the menu opens as a dialog with the same links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home')
  await page.getByRole('button', { name: 'メニューを開く' }).click()
  await matchAriaFile(page.getByRole('dialog', { name: 'メニュー' }), 'phone-menu.aria.yml')
})

test('practice keeps its controls, the word and the stats', async ({ page }) => {
  await seed(page)
  await page.goto('/play')
  const input = page.getByRole('textbox', { name: '表示された文字を入力', exact: true })
  await expect(input).toBeFocused()
  await page.clock.pauseAt(startedAt + 60_000)
  await input.pressSequentially('a')
  await page.clock.runFor(1_000)
  await input.pressSequentially('p')
  await page.clock.runFor(1_000)
  await matchAriaFile(page.getByRole('main'), 'play.aria.yml')
})

// Practice in the other modes, on the list of seed() above.
test('recall hides the answer behind placeholders and keeps the reveal button', async ({ page }) => {
  await seed(page)
  await page.goto('/play')
  const input = page.getByRole('textbox', { name: '表示された文字を入力', exact: true })
  await expect(input).toBeFocused()
  await page.clock.pauseAt(startedAt + 60_000)
  await page.getByRole('button', { name: '思い出して打つ', exact: true }).click()
  await input.focus()
  await input.pressSequentially('ap')
  await page.clock.runFor(1_000)
  await matchAriaFile(page.getByRole('main'), 'play-recall.aria.yml')
})

test('handwriting keeps its mode switch, text field and buttons', async ({ page }) => {
  await page.clock.install({ time: startedAt })
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace([{ id: 'hand', name: '手書き', createdAt: '2026-09-01', records: [], writing: { language: 'en' },
    words: [word('apple', 'りんご'), word('water', '水')] }])])
  await page.goto('/play?list=hand')
  await page.getByRole('radio', { name: 'Handwriting', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'ここに手書きで入力', exact: true })).toBeVisible()
  await page.clock.pauseAt(startedAt + 60_000)
  await matchAriaFile(page.getByRole('main'), 'play-writing.aria.yml')
})

test('the pack editor keeps its fields and the lists of the pack', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/packs/edit?pack=pack-basics')
  await expect(page.getByRole('heading', { name: 'パックを編集', level: 1 })).toBeVisible()
  await matchAriaFile(page.getByRole('main'), 'pack-edit.aria.yml')
})

// Signed in: an account of its own for each test (account.ts), whose rows are deleted afterwards.
test.describe('signed in', () => {
  let accountId = ''
  test.beforeEach(async ({ context }) => {
    accountId = newAccountId()
    await signIn(context, accountId)
  })
  test.afterEach(() => deleteWorkspace(accountId))

  test('the top bar says the data is saved to the account, and the menu names the user', async ({ page }) => {
    await page.goto('/home')
    const menuButton = page.getByRole('button', { name: 'アカウントメニュー', exact: true })
    await expect(menuButton).toBeVisible()
    // An open menu hides the rest of the page from assistive technology, so the top bar is read before it opens.
    await matchAriaFile(page.getByRole('banner'), 'signed-in-banner.aria.yml')
    await menuButton.click()
    await expect(page.getByRole('menu')).toContainText('E2E User')
    await matchAriaFile(page.getByRole('menu'), 'signed-in-menu.aria.yml')
  })

  test('home tells a signed-in user where the data is kept', async ({ page }) => {
    await page.goto('/home')
    // The account's workspace is read from the server after the page loads.
    await expect(page.getByRole('heading', { name: '自分の単語で、タイピング練習。', level: 1 })).toBeVisible()
    await matchAriaFile(page.getByRole('main'), 'signed-in-home.aria.yml')
  })

  test('the general settings add the sign-out of every device', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('region', { name: 'ログイン中の端末', exact: true })).toBeVisible()
    await matchAriaFile(page.getByRole('main'), 'signed-in-settings.aria.yml')
  })
})

// Pages reached from outside the app: a shared result, a link to a shared pack (sharing has ended), and one official
// pack.
const linkedPages: { name: string, path: string, ready: (page: Page) => Promise<void> }[] = [
  { name: 'result-shared', path: `/result?n=${encodeURIComponent('基本の単語')}&t=6.00&a=95&w=3&s=200`, ready: page => expect(page.getByRole('heading', { level: 1, name: '「基本の単語」の練習記録' })).toBeVisible() },
  { name: 'shared-ended', path: '/shared/0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d', ready: page => expect(page.getByText('この共有は終了しました。')).toBeVisible() },
  // The button to practise is disabled until this browser's data is read.
  { name: 'official-pack', path: '/packs/english-basics', ready: page => expect(page.getByRole('button', { name: 'このパックで練習する', exact: true })).toBeEnabled() },
]
for (const { name, path, ready } of linkedPages) {
  test(`${name} keeps its tree`, async ({ page }) => {
    await page.goto(path)
    await ready(page)
    await matchAriaFile(page.getByRole('main'), `${name}.aria.yml`)
  })
}

// Errors: data in this browser that cannot be read, and a save that the browser refuses (its storage is full).
test('unreadable saved data shows an alert instead of the records', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/records')
  await page.evaluate(() => localStorage.setItem('typle-r:guest-workspace:v1', '{broken'))
  await page.reload()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('保存データを読み込めません')
  await matchAriaFile(page.getByRole('main'), 'error-unreadable.aria.yml')
})

test('a save the browser refuses keeps the draft and alerts in the save bar', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/create')
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
  await matchAriaFile(page.getByRole('main'), 'error-save-refused.aria.yml')
})

// Another display language: English, chosen on the general settings and kept in this browser.
async function useEnglish(page: Page) {
  await page.goto('/settings')
  await page.locator('label').filter({ has: page.locator('span[lang]', { hasText: 'English' }) }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
}
test('home keeps its tree in English', async ({ page }) => {
  await seedSaved(page)
  await useEnglish(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { level: 1, name: 'Practice overview' })).toBeVisible()
  await matchAriaFile(page.getByRole('main'), 'en-home.aria.yml')
  await matchAriaFile(page.getByRole('navigation', { name: 'Main navigation' }), 'en-sidebar.aria.yml')
})
test('the sign-in form keeps its tree in English', async ({ page }) => {
  await useEnglish(page)
  await page.goto('/signin')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await matchAriaFile(page.getByRole('main'), 'en-signin.aria.yml')
})

// Pages whose lists grow with the official packs or the app's dependencies. Their expected trees are written by hand
// and keep only what stays: the heading, the text and the controls. A tree matches when it contains the expected one,
// so packs or licenses added to the lists do not change the result.
const growingPages: { name: string, path: string, title: string }[] = [
  { name: 'catalog', path: '/packs/catalog', title: 'the official catalog keeps its heading, link and the parts of a pack' },
  { name: 'interests', path: '/interests', title: 'the interests page keeps its groups and the controls of the packs' },
  { name: 'landing', path: '/', title: 'the landing page keeps its hero, the try-out and its sections' },
  { name: 'licenses', path: '/about/licenses', title: 'the licenses page keeps its heading, search and the form of an entry' },
]
for (const { name, path, title } of growingPages) {
  test(title, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: `${name}.aria.yml` })
  })
}
