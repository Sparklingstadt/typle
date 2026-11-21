import { test, expect, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'
import { openPacks } from './packRows'
import { seedSaved } from './snapshotData'

// ARIA snapshots compare the accessibility tree (roles, names and their order), not pixels, so fonts and the OS do
// not change them. They catch a control that lost its label, a heading that changed level or a link that went missing.
// When a screen is meant to change, rewrite the expected trees with
// `npx playwright test tests/e2e/aria-snapshots.spec.ts --update-snapshots --update-source-method=overwrite`
// and review the diff before committing it.

test('the sign-in form keeps its fields, buttons and links', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
    - main:
      - heading "ログイン" [level=1]
      - text: ID
      - textbox "ID"
      - text: パスワード
      - textbox "パスワード"
      - button "ログイン" [disabled]
      - list:
        - listitem:
          - link "新しく登録する":
            - /url: /signup
        - listitem:
          - link "パスワードを忘れた":
            - /url: /forgot-password
        - listitem:
          - link "ID を忘れた":
            - /url: /forgot-id
      - paragraph: GitHub のアカウントでもログインできます。
      - button "GitHubでログイン"
  `)
})

test('the sign-up form keeps its fields, buttons and links', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
    - main:
      - heading "登録" [level=1]
      - paragraph: ID とパスワードで Typle のアカウントを作ります。
      - text: ID
      - textbox "ID"
      - paragraph: /半角英数字・「_」・「-」で3〜\\d+文字。大文字と小文字は区別しません。あとから変えられません。/
      - text: メールアドレス
      - textbox "メールアドレス"
      - paragraph: 確認のメールと、ID やパスワードを忘れたときのメールを送ります。
      - text: パスワード
      - textbox "パスワード"
      - paragraph: /\\d+〜\\d+文字。ID と同じものは使えません。/
      - button "登録する"
      - paragraph:
        - link "登録済みの方は、こちらからログイン":
          - /url: /signin?returnTo=%2Fhome
  `)
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
  { name: 'about', path: '/about', title: 'the about page keeps its sections', ready: page => expect(page.getByRole('heading', { level: 1 })).toBeVisible() },
]
for (const { name, path, title, ready } of savedPages) {
  test(title, async ({ page }) => {
    await seedSaved(page)
    await page.goto(path)
    await ready(page)
    await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: `${name}.aria.yml` })
  })
}

test('the best records page shows the chosen list', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/rankings')
  await expect(page.getByRole('region', { name: '英単語 › 基本の単語', exact: true })).toMatchAriaSnapshot({ name: 'rankings.aria.yml' })
})

test('the packs page shows a pack open with its lists', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/edit')
  await openPacks(page)
  await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: 'packs.aria.yml' })
})

test('the list editor keeps its fields and the words', async ({ page }) => {
  await seedSaved(page)
  await page.goto('/edit')
  await openPacks(page)
  await page.getByRole('button', { name: '基本の単語 を編集', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '表示する単語 3', exact: true })).toHaveValue('experience')
  await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: 'editor.aria.yml' })
})

test('home introduces the app before the first record', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: 'home-first.aria.yml' })
})

test('the sidebar keeps its groups of links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toMatchAriaSnapshot({ name: 'sidebar.aria.yml' })
  await expect(page.getByRole('navigation', { name: 'ヘルプ' })).toMatchAriaSnapshot({ name: 'sidebar-help.aria.yml' })
})

test('on a phone the menu opens as a dialog with the same links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home')
  await page.getByRole('button', { name: 'メニューを開く' }).click()
  await expect(page.getByRole('dialog', { name: 'メニュー' })).toMatchAriaSnapshot({ name: 'phone-menu.aria.yml' })
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
  await expect(page.getByRole('main')).toMatchAriaSnapshot({ name: 'play.aria.yml' })
})
