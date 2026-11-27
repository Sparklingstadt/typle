# ログイン画面の「打っている途中の単語」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/signin` の見出しの上に、練習画面と同じ見た目で単語が自動で打たれていく飾りを置き、デモアカウントの部分を灰色の面に入れる。

**Architecture:** 何文字目まで打ったかを「step」という1つの数で表し、step から表示する単語と打ち終えた部分を返す純粋な関数を `src/lib/signinDemo.ts` に置く。クライアント部品 `TypingDemo` は step をタイマーで進め、`compareInput` と `TargetText` で描く。単語はサーバーの `page.tsx` が `account.json` から読んで渡す。

**Tech Stack:** Next.js（App Router）、React、next-intl、Tailwind、node:test（`tests/*.test.cjs`）、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-28-signin-typing-design.md`

## Global Constraints

- ログインの方法・順番・文言（Sparklingstadt ID → GitHub → デモアカウント）は変えない。
- 打/分・正確率・ミスなどの数字は出さない。
- 飾りは `aria-hidden` で、フォーカスを受けない。`/signin` の aria スナップショットは変わらない。
- `prefers-reduced-motion: reduce` では動かさず、途中まで打った状態を1つ見せる。
- 文言は6言語（ja・en・fr・ru・zh-CN・zh-TW）すべてに同じキーで入れる（`tests/i18n.test.cjs` が値を文字列だけに限る）。
- コードのコメントと識別子は英語、コミットメッセージは日本語。途中のコミットに `(vX.Y.Z)` は付けない。
- 作業は origin/main から作った worktree（ブランチ `signin-typing`）で行い、共有のチェックアウトでは `git switch` しない。

## Review Focus

- 動きを減らす設定の人：画面を開いてから時間がたっても表示が変わらないこと → Task 2 の e2e テスト。
- サーバーで描いた最初の表示とブラウザーでの最初の表示が同じ（hydration の警告が出ない）こと → step の初期値を `stillStep` に固定し、タイマーは effect の中でだけ始める（Task 2）。
- 画面を離れたあとにタイマーが残らないこと → effect の後片付けで `clearInterval`（Task 2）。
- かな・漢字・キリル文字など、1文字が複数のコード単位になる語でも1文字ずつ進むこと → Task 1 の単体テスト（`Array.from` で数える）。
- スクリーンショットの比較が動きで揺れないこと → Task 3 で sign-in の3枚を reduced motion で撮る。

---

### Task 0: worktree を用意して設計書と計画をコミットする

**Files:**
- Create（コピー）: `docs/superpowers/specs/2026-11-28-signin-typing-design.md`, `docs/superpowers/plans/2026-11-28-signin-typing.md`

- [ ] **Step 1:** サンドボックスの外で `git fetch origin && git worktree add -b signin-typing .claude/worktrees/signin-typing origin/main --no-track` を実行する。
- [ ] **Step 2:** 共有のチェックアウトにある上の2つのファイルを worktree の同じ場所にコピーし、元の2つは消す（共有のチェックアウトに未追跡のファイルを残さない）。
- [ ] **Step 3:** worktree で `npm ci` を実行し、`.vercel` が要る場面ではつなぎ直す（メモリーの「worktree からのデプロイ」参照）。
- [ ] **Step 4:** コミット：`git add docs/superpowers && git commit -m "ログイン画面に打っている途中の単語を飾る設計と計画を加える"`

### Task 1: step から表示を決める関数

**Files:**
- Create: `src/lib/signinDemo.ts`
- Test: `tests/signinDemo.test.cjs`

**Interfaces:**
- Produces:
  - `export type DemoWord = { input: string; meaning: string }`
  - `export const STEP_MS = 160`（1文字の間隔）
  - `export const HOLD_STEPS = 6`（打ち終えたあとに止まる step 数）
  - `export function demoFrame(words: DemoWord[], step: number): { word: DemoWord; typed: string }`
  - `export function stillStep(words: DemoWord[]): number`

各語は `文字数 + 1 + HOLD_STEPS` 個の step を持つ（打ち終えた部分が0文字〜全部、そのあと全部のまま HOLD_STEPS）。最後の語のあとは最初に戻る（step は全体の長さで割った余り）。文字数は `Array.from(input).length`。`stillStep` は最初の語を `Math.ceil(文字数 * 2 / 3)` 文字打った step（youkoso なら5、つまり `youko`）。

- [ ] **Step 1: 失敗するテストを書く**

```js
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { demoFrame, stillStep, HOLD_STEPS } = require('../src/lib/signinDemo.ts')

const words = [{ input: 'abc', meaning: 'A' }, { input: 'あい', meaning: 'B' }]

test('a word is typed one character a step, held, then the next word starts', () => {
  assert.deepEqual(demoFrame(words, 0), { word: words[0], typed: '' })
  assert.deepEqual(demoFrame(words, 2), { word: words[0], typed: 'ab' })
  assert.deepEqual(demoFrame(words, 3), { word: words[0], typed: 'abc' })
  assert.deepEqual(demoFrame(words, 3 + HOLD_STEPS), { word: words[0], typed: 'abc' })
  assert.deepEqual(demoFrame(words, 4 + HOLD_STEPS), { word: words[1], typed: '' })
})

test('characters are counted as code points, and the last word goes back to the first', () => {
  const second = 4 + HOLD_STEPS
  assert.deepEqual(demoFrame(words, second + 1), { word: words[1], typed: 'あ' })
  const total = second + 3 + HOLD_STEPS
  assert.deepEqual(demoFrame(words, total), demoFrame(words, 0))
  assert.deepEqual(demoFrame([{ input: '😀😀', meaning: '' }], 1).typed, '😀')
})

test('the still frame is the first word two thirds typed', () => {
  assert.equal(stillStep([{ input: 'youkoso', meaning: 'ようこそ' }]), 5)
  assert.deepEqual(demoFrame(words, stillStep(words)), { word: words[0], typed: 'ab' })
})
```

- [ ] **Step 2:** `node --test --test-isolation=none tests/signinDemo.test.cjs` → モジュールがなくて FAIL。
- [ ] **Step 3:** `src/lib/signinDemo.ts` に上の Interfaces を実装する。
- [ ] **Step 4:** 同じコマンドで PASS。
- [ ] **Step 5:** コミット：`git add src/lib/signinDemo.ts tests/signinDemo.test.cjs && git commit -m "ログイン画面の飾りの単語を、何文字目まで打ったかで決める関数を加える"`

### Task 2: TypingDemo を作り、ログイン画面に置く

**Files:**
- Create: `src/components/SignIn/TypingDemo.tsx`
- Modify: `src/app/signin/page.tsx`, `src/app/signin/signin-form.tsx`
- Modify: `src/messages/{ja,en,fr,ru,zh-CN,zh-TW}/account.json`
- Test: `tests/e2e/signin-demo.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `DemoWord`, `STEP_MS`, `demoFrame`, `stillStep`。`compareInput(target, typed)`（`src/lib/typing.ts`）、`TargetText`（`src/components/Practice/TargetText.tsx`）。
- Produces: `export default function TypingDemo({ words }: { words: DemoWord[] })`

**文言**（`account.json` の最上位に `typingDemo` を足す。値はすべて文字列）:

| 言語 | word1 input / meaning | word2 | word3 |
|---|---|---|---|
| ja | youkoso / ようこそ | renshuu / 練習 | taipingu / タイピング |
| en | welcome / Glad you're here | practice / A little every day | keyboard / Ten fingers, one rhythm |
| fr | bienvenue / Ravi de vous voir | pratique / Un peu chaque jour | clavier / Dix doigts, un rythme |
| ru | привет / Рады вас видеть | практика / Понемногу каждый день | клавиатура / Десять пальцев, один ритм |
| zh-CN | huanying / 欢迎 | lianxi / 练习 | jianpan / 键盘 |
| zh-TW | huanying / 歡迎 | lianxi / 練習 | jianpan / 鍵盤 |

形：`"typingDemo": { "word1": { "input": "youkoso", "meaning": "ようこそ" }, "word2": {…}, "word3": {…} }`

- [ ] **Step 1: 失敗する e2e テストを書く**（`tests/e2e/signin-demo.spec.ts`）

```ts
import { test, expect, type Page } from '@playwright/test'

const demo = (page: Page) => page.getByTestId('typing-demo')

const typed = (page: Page) => demo(page).locator('[data-state="done"]').count()

test('the word on the sign-in page types itself', async ({ page }) => {
  await page.goto('/signin')
  const before = await typed(page)
  await expect.poll(() => typed(page), { timeout: 3000 }).not.toBe(before)
})

test('with reduced motion the word stays still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/signin')
  const before = await typed(page)
  await page.waitForTimeout(1000)
  expect(await typed(page)).toBe(before)
})

test('the word is hidden from assistive technology and takes no focus', async ({ page }) => {
  await page.goto('/signin')
  await expect(demo(page)).toHaveAttribute('aria-hidden', 'true')
  await expect(demo(page).locator('[tabindex], input, button, a')).toHaveCount(0)
})
```

（`TargetText` はまだ打っていない文字も描くので、文字が打たれても文章は変わらない。そのため打ち終えた文字（`data-state="done"`）の数を比べる。）

- [ ] **Step 2:** `npx playwright test tests/e2e/signin-demo.spec.ts` → `typing-demo` がなくて FAIL。
- [ ] **Step 3: 文言を6言語に足す**（上の表どおり）。`npm test -- ` ではなく `node --test --test-isolation=none tests/i18n.test.cjs` で PASS を確かめる。
- [ ] **Step 4: `TypingDemo` を実装する**
  - `"use client"`。`const [step, setStep] = useState(() => stillStep(words))`。
  - `useEffect` で `window.matchMedia('(prefers-reduced-motion: reduce)').matches` なら何もしない。そうでなければ `setInterval(() => setStep(s => s + 1), STEP_MS)` を始め、後片付けで `clearInterval`。
  - `const { word, typed } = demoFrame(words, step)`、`const { characters, states, extra } = compareInput(word.input, typed)`。
  - 外側：`<div data-testid="typing-demo" aria-hidden="true" className="max-w-sm rounded-2xl border bg-card px-6 py-5 text-center shadow-xs">`。中に `TargetText`（`className="text-[32px] leading-tight sm:text-[40px]"`、`id` は渡さない）と、`<p className="text-sm text-muted-foreground">{word.meaning}</p>`。
- [ ] **Step 5: `page.tsx` に置く**：`t('typingDemo.word1.input')` などで3語の `DemoWord[]` を作り、`<header>` の前に `<TypingDemo words={words} />` を置く（`mb-6` 程度の間をあける）。
- [ ] **Step 6: デモアカウントを灰色の面に入れる**（`signin-form.tsx`）：デモの `<div>` の className を、ほかのボタンがあるとき `'space-y-2 border-t pt-4'` だったものから、常に `'space-y-2 rounded-lg bg-muted p-4'` にする。ボタンの `variant="outline"` はそのまま。
- [ ] **Step 7:** `npx playwright test tests/e2e/signin-demo.spec.ts tests/e2e/aria-snapshots.spec.ts tests/e2e/demo-login.spec.ts` → すべて PASS（aria スナップショットは変わらない）。
- [ ] **Step 8:** `npm run typecheck && npm run lint && npm run knip` → エラーなし。
- [ ] **Step 9:** コミット：`git add src tests/e2e/signin-demo.spec.ts && git commit -m "ログイン画面の見出しの上に、自動で打たれていく単語を置く"`

### Task 3: スクリーンショットを撮り直し、バージョンを上げる

**Files:**
- Modify: `tests/e2e/screenshots.spec.ts`
- Modify: `tests/e2e/screenshots.spec.ts-snapshots/signin-darwin.png`, `signin-dark-darwin.png`, `signin-phone-darwin.png`, `en-signin-darwin.png`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1:** `screenshots.spec.ts` の `open()` に `reducedMotion?: 'reduce'` を受ける引数を足し、`page.emulateMedia({ colorScheme, reducedMotion })` で `goto` の前に渡す。sign-in の3つのテストには `'reduce'` を渡す。英語の sign-in のテスト（`en-signin.png`、`open()` を使わない）には `page.goto` の前に `await page.emulateMedia({ reducedMotion: 'reduce' })` を足す。
- [ ] **Step 2:** Mac で `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots` を実行し、変わった画像が sign-in の4枚（`signin`・`signin-dark`・`signin-phone`・`en-signin`）だけであることを `git status` で確かめ、4枚を開いて見る（日本語は単語が `youko`、英語は `welc` まで打たれた状態、デモが灰色の面）。
- [ ] **Step 3:** `git tag` と GitHub Releases（`gh release list --limit 5`）で使われていない番号を確かめ、新しい機能なので minor を上げる（今の最新が v2.65.1 なら `npm version 2.66.0 --no-git-tag-version`）。
- [ ] **Step 4:** サンドボックスの外で `npm run verify` を最後まで実行して PASS。
- [ ] **Step 5:** コミット：`git add tests/e2e package.json package-lock.json && git commit -m "ログイン画面のスクリーンショットを撮り直し、バージョンを上げる"`
- [ ] **Step 6:** push して PR を作る。タイトルは「ログイン画面に、自動で打たれていく単語を飾る (v2.66.0)」。マージはユーザーの確認を取ってから。
