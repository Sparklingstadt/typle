import { test, expect } from '@playwright/test'

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
