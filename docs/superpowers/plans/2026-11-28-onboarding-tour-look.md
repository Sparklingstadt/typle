# はじめての人のツアーの見た目 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/welcome` のツアーを、キーキャップと打たれる見出しの「A の雰囲気」に、選ぶと右に練習が組み上がる「C の右側」を合わせた見た目に作り直す。

**Architecture:** 流れ・保存・出す条件（`WelcomeTour` の `follow` / `saveInterests` / `admitted`）は変えず、見た目の部品を `src/components/Welcome/` に足して差し替える。純粋な規則（ツアーの関心の切り替え、キーの割り当て、見本の進み方）は `src/lib/welcome.ts` に置いて単体テストする。動きは `motion`（`LazyMotion` + `domMax` + `m`）で、右のパネルのカードを `layoutId` でステップの間につなぐ。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 / next-intl / motion（`motion/react`）/ node:test / Playwright

**Spec:** `docs/superpowers/specs/2026-11-28-onboarding-tour-look-design.md`（前提：`docs/superpowers/specs/2026-11-26-onboarding-tour-design.md`）

## Global Constraints

- 流れ・保存の順番（フォロー → 関心）・出す条件・対応表 `WELCOME_PACKS` は変えない。
- `motion` はツアーの部品（`src/components/Welcome/`）からだけ import する。`LazyMotion features={domMax}` と `m.*` を使い、`motion.*` は使わない。
- `prefers-reduced-motion` のとき：見出しは最初から全部、カーソルは点滅しない、カードは動かさない（`MotionConfig reducedMotion="user"`）、見本は打ち終わった状態で止める。
- 動きの途中でもボタンとキーは効く。見出しを打つのは1文字 40ms 前後、全体で1秒以内。
- 色はアプリのトークン（`primary`・`muted`・`border`・`card` など）だけ。ダークモードで読めること。
- 文言は ja・en・fr・ru・zh-CN・zh-TW の `src/messages/*/home.json` の `tour` に足す。コードのコメントと識別子は英語。
- セクションの読み上げ名「関心を選ぶ」「パックをフォローする」「練習を始める」と、ボタン名「次へ」「フォローする」「練習を始める」「あとで」「関心をもう一度保存」は保つ。
- `toggleInterest` と `InterestSettings`（/interests）は変えない。
- コミットのタイトルは日本語の1文、途中のコミットに `(vX.Y.Z)` は付けない。

## Review Focus

1. 日本語入力の変換中の Enter（`isComposing`）で次へ進んでしまう → 進まないこと（Task 1 の `welcomeKey` のテスト）。
2. 「カタログでもっと見る」や「あとで」にフォーカスがあるときの Enter がステップを進めてしまう → リンク／ボタン自身の動作になること（Task 1 のテスト、Task 4 の E2E）。
3. ステップ2で `←` で戻り、関心を変えて戻ってきたときのチェック → 新しい関心のパックは全部チェックされ、まだあるパックは前のチェックを保つこと（Task 1 の `carryChecks`）。
4. フォローの保存中・保存後の `←`・数字キー → 何も起きないこと（Task 4 の E2E）。
5. スマホ幅（375px）で関心をたくさん選んだとき「次へ」が画面の外に出る → 下に固定されて見えること（Task 4 の E2E）。

---

### Task 1: ツアーの規則（関心の切り替え、キー、チェックの引き継ぎ、見本の進み方）と motion の追加

**Files:**
- Modify: `src/lib/welcome.ts`
- Modify: `package.json`, `package-lock.json`（`npm install motion`）
- Test: `tests/welcome.test.cjs`

**Interfaces:**
- Produces:
  - `toggleWelcomeInterest(interests: string[], childId: string): string[]` — 子を入れる／外す。入れるときは親も入れ、外してその親の子が0になれば親も外す。結果は `normalizeInterests` を通す。
  - `NATIVE_LANGUAGE_NAMES: Readonly<Record<string, string>>` — `language/*` の子 → その言語の文字での名前。
  - `type WelcomeStep = 'interests' | 'packs' | 'start'`
  - `type WelcomeKeyAction = { kind: 'primary' } | { kind: 'later' } | { kind: 'back' } | { kind: 'toggle', index: number } | null`
  - `welcomeKey(key: { key: string, isComposing: boolean, ctrlKey: boolean, metaKey: boolean, altKey: boolean, targetKind: 'link' | 'otherButton' | 'none' }, step: WelcomeStep, packCount: number, busy: boolean): WelcomeKeyAction`
  - `carryChecks(previous: ReadonlySet<string>, before: string[], after: string[]): Set<string>` — 引数はカタログ ID の並び。
  - `demoProgress(input: string, elapsedMs: number, msPerChar: number): string` — 見本で打ち終わった部分（`Array.from` の単位で切る）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/welcome.test.cjs` に足す）

```js
test('toggleWelcomeInterest adds and drops the parent with its children', () => {
  assert.deepEqual(toggleWelcomeInterest([], 'language/zh'), ['language', 'language/zh'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh'], 'programming/go'), ['language', 'language/zh', 'programming', 'programming/go'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh', 'language/ru'], 'language/zh'), ['language', 'language/ru'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh'], 'language/zh'), [])
})

test('every language child has a native name', () => {
  const language = INTEREST_OPTIONS.find(o => o.id === 'language')
  assert.deepEqual(Object.keys(NATIVE_LANGUAGE_NAMES).sort(), language.children.map(c => c.id).sort())
  assert.equal(NATIVE_LANGUAGE_NAMES['language/zh'], '中文')
  assert.equal(NATIVE_LANGUAGE_NAMES['language/cs'], 'Čeština')
})

const k = (key, extra = {}) => ({ key, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, targetKind: 'none', ...extra })
test('welcomeKey', () => {
  assert.deepEqual(welcomeKey(k('Enter'), 'interests', 0, false), { kind: 'primary' })
  assert.equal(welcomeKey(k('Enter', { isComposing: true }), 'interests', 0, false), null)
  assert.equal(welcomeKey(k('Enter', { targetKind: 'link' }), 'packs', 2, false), null)
  assert.equal(welcomeKey(k('Enter', { targetKind: 'otherButton' }), 'packs', 2, false), null)
  assert.equal(welcomeKey(k('Enter', { metaKey: true }), 'interests', 0, false), null)
  assert.deepEqual(welcomeKey(k('Escape'), 'packs', 2, false), { kind: 'later' })
  assert.equal(welcomeKey(k('Escape'), 'start', 1, false), null)
  assert.deepEqual(welcomeKey(k('ArrowLeft'), 'packs', 2, false), { kind: 'back' })
  assert.equal(welcomeKey(k('ArrowLeft'), 'interests', 0, false), null)
  assert.deepEqual(welcomeKey(k('2'), 'packs', 2, false), { kind: 'toggle', index: 1 })
  assert.equal(welcomeKey(k('3'), 'packs', 2, false), null)
  assert.equal(welcomeKey(k('1'), 'interests', 0, false), null)
  assert.equal(welcomeKey(k('0'), 'packs', 12, false), null)
  assert.equal(welcomeKey(k('Enter'), 'packs', 2, true), null)
  assert.equal(welcomeKey(k('ArrowLeft'), 'packs', 2, true), null)
})

test('carryChecks keeps old choices and checks new packs', () => {
  assert.deepEqual([...carryChecks(new Set(['a']), ['a', 'b'], ['a', 'b', 'c'])].sort(), ['a', 'c'])
  assert.deepEqual([...carryChecks(new Set(['a', 'b']), ['a', 'b'], ['b'])], ['b'])
})

test('demoProgress types by code point and stops at the end', () => {
  assert.equal(demoProgress('nihao', 0, 100), '')
  assert.equal(demoProgress('nihao', 250, 100), 'ni')
  assert.equal(demoProgress('nihao', 10_000, 100), 'nihao')
  assert.equal(demoProgress('привет', 300, 100), 'при')
})
```

- [ ] **Step 2: 落ちることを確かめる**
Run: `node --test tests/welcome.test.cjs`
Expected: FAIL（`toggleWelcomeInterest is not a function` など）

- [ ] **Step 3: `src/lib/welcome.ts` に上の Interfaces を実装する**
`welcomeKey`：修飾キー付き・`isComposing`・`busy` は `null`。`Enter` は `targetKind === 'none'` のときだけ `primary`。Escape・数字・← は `targetKind` を見ない。`Escape` は `interests`・`packs` だけ `later`。`ArrowLeft` は `packs` だけ `back`。数字 `'1'`〜`'9'` は `packs` で `index < packCount` のときだけ `toggle`。
`NATIVE_LANGUAGE_NAMES`：zh 中文・ru Русский・ko 한국어・en English・es Español・fr Français・de Deutsch・cs Čeština。

- [ ] **Step 4: 通ることを確かめる**
Run: `node --test tests/welcome.test.cjs`
Expected: PASS

- [ ] **Step 5: motion を入れる**
Run: `npm install motion`
Expected: `package.json` の dependencies に `motion` が入る。`npm run typecheck` が通る。

- [ ] **Step 6: コミット**

```bash
git add src/lib/welcome.ts tests/welcome.test.cjs package.json package-lock.json
git commit -m "ツアーの関心の切り替え・キー・見本の進み方の規則を足し、motion を入れる"
```

---

### Task 2: 見た目の部品

**Files:**
- Create: `src/components/Welcome/KeyToggle.tsx`
- Create: `src/components/Welcome/TypedHeading.tsx`
- Create: `src/components/Welcome/PracticePanel.tsx`
- Create: `src/components/Welcome/TypingDemo.tsx`
- Create: `src/components/Welcome/StepDots.tsx`

**Interfaces:**
- Consumes: `demoProgress`（Task 1）、`compareInput`（`src/lib/typing.ts`）、`TargetText`・`PracticeText`（`src/components/Practice/`）、`Kbd`、`OfficialPack`。
- Produces:
  - `KeyToggle({ checked, onChange, label, sub, mono, accessibleName, disabled, shortcut }: { checked: boolean, onChange: (value: boolean) => void, label: string, sub?: string, mono?: boolean, accessibleName: string, disabled?: boolean, shortcut?: string })` — 隠した `<input type="checkbox" aria-label={accessibleName}>` と、キーキャップの形の `<label>`（下の縁を太くし、`checked` で `bg-primary text-primary-foreground` の押し込まれた形、`peer-focus-visible` でリング）。
  - `TypedHeading({ id, text }: { id: string, text: string })` — `<h2 id tabIndex={-1}>`。読み上げ用に全文を `sr-only` で持ち、見た目は `aria-hidden` の部分を1文字ずつ増やす（`useReducedMotion()` が真なら全文）。末尾に点滅するカーソル（`motion-safe:animate-pulse` 相当）。
  - `PracticePanel({ entries, mode, checked, onCheck, disabled, title, empty, stats, select }: { entries: OfficialPack[], mode: 'preview' | 'choose', checked: ReadonlySet<string>, onCheck: (catalogId: string, value: boolean) => void, disabled: boolean, title: string, empty: string, stats: (lists: number, words: number) => string, select: (name: string) => string })` — `m.ul` の各カードに `layout` と `layoutId={catalogId}`、`AnimatePresence` で出入り。`preview` は名前＋最初のリストの単語2〜3語（`·` 区切り、等幅）。`choose` は名前＋`stats`＋`KeyToggle`（`shortcut` は 1〜9、10個目以降はなし、`accessibleName={select(name)}`）で、外したカードは `opacity-45`。`entries` が空なら `empty` を出す。スマホ幅（`sm` 未満）の `preview` は名前だけの1行。
  - `TypingDemo({ word }: { word: Word })` — 表示と入力が同じ（または `input_type === 'code'`）なら `TargetText` の1段、違えば `PracticeText` で表示＋`TargetText guide` で入力の2段（`WordPrompt` と同じ）。`requestAnimationFrame` で `demoProgress(word.input, elapsed, 120)` を `compareInput` に渡す。打ち終わったら 1.2秒止まって最初から（reduced motion なら打ち終わった状態で止める）。全体は `aria-hidden`。
  - `StepDots({ current, total, label }: { current: number, total: number, label: string })` — 短い棒3本（済みは `bg-primary`、ほかは `bg-border`）と、`sr-only` の `label`（「ステップ 1 / 3」）。

- [ ] **Step 1: 5つの部品を書く**（上の Interfaces のとおり。`"use client"`。`motion/react` の `m`・`AnimatePresence`・`useReducedMotion` だけを使う）

- [ ] **Step 2: 型と lint を確かめる**
Run: `npm run typecheck && npm run lint && npm run knip`
Expected: エラーなし（knip が未使用の export を出すなら、Task 3 で使うまでの間はこのコミットを Task 3 とまとめてよい）

- [ ] **Step 3: コミット**

```bash
git add src/components/Welcome/
git commit -m "ツアーのキーキャップ・打たれる見出し・右のパネル・入力の見本の部品を作る"
```

---

### Task 3: ツアーの画面を組み替える（2列、キーボード、戻る、文言）

**Files:**
- Modify: `src/components/Welcome/WelcomeTour.tsx`
- Modify: `src/components/Welcome/PackStep.tsx`
- Modify: `src/components/Welcome/StartStep.tsx`
- Modify: `src/messages/{ja,en,fr,ru,zh-CN,zh-TW}/home.json`（`tour`）

**Interfaces:**
- Consumes: Task 1 の `toggleWelcomeInterest`・`NATIVE_LANGUAGE_NAMES`・`welcomeKey`・`carryChecks`・`WelcomeStep`、Task 2 の部品すべて。
- Produces: なし（画面）。

- [ ] **Step 1: 文言を足す**（6言語。ja は下のとおり、ほかはその訳）

```json
"interests": { "title": "関心を選ぶ", "heading": "何を打てるようになりたい？", "text": "選ぶたびに、右に最初の練習が並びます。あとから「関心」で変えられます。" },
"panel": { "title": "あなたの最初の練習", "empty": "関心を選ぶと、ここに練習が並びます。" },
"packs": { "heading": "{count, plural, other {この#つから始めよう}}", "keys": "<key>1</key>〜<key>{last}</key> で切り替え、<key>←</key> で関心に戻る", "back": "戻る" },
"start": { "heading": "準備ができました", "text": "「{pack}」の最初の単語から打ってみましょう。ほかのパックは「練習する」の画面から選べます。" }
```
今ある `step`・`later`・`next`・`packs.*`・`start.title`・`start.button` は残す（`interests.title`・`packs.title`・`start.title` はセクションの読み上げ名に使う）。使わなくなったキー（`packs.text` など）は消す。

- [ ] **Step 2: `WelcomeTour` を組み替える**
- 全体を `<LazyMotion features={domMax} strict><MotionConfig reducedMotion="user">` で包む。
- ヘッダー：`StepDots`（`label={t('step', …)}`）と、右に「あとで」ボタン＋`Kbd`「Esc」。`h1`「はじめに」は `sr-only` にする。
- `interests`・`packs` は `grid gap-6 sm:grid-cols-[1.15fr_1fr]`：左に `section`（`aria-label` に `interests.title` / `packs.title`、中に `TypedHeading`）、右に `PracticePanel`（`interests` では `mode="preview"`、`packs` では `mode="choose"`）。`start` は1列。
- ステップ1の左：親ごとに `h3`（`interests` の `parents.*`）の下に子の `KeyToggle`。語学は `label=NATIVE_LANGUAGE_NAMES[id]`・`sub`＝今の訳（`interests.children.*`）、プログラミングは `label`＝今の訳・`mono`。`accessibleName` は今の訳（E2E は「中国語」「Go」で探す）。`onChange` は `setChosen(current => toggleWelcomeInterest(current, id))`。
- 「次へ ↵」で `setChecked(carryChecks(checked, previousEntryIds, entryIds))` してから `packs` へ（はじめて来たときは前が空なので全部チェックになる）。
- ステップ2の左：`TypedHeading`（`packs.heading`）、カタログのリンク、`packs.keys`（`Kbd` で包む）、「戻る」ボタン（`ArrowLeft` アイコン、保存中・`interestsFailed` のときは出さない）、主ボタン。
- キー：`useEffect` で `document` の `keydown` を聞き、`welcomeKey({ key, isComposing, ctrlKey, metaKey, altKey, targetKind }, step, entries.length, saving || interestsFailed)` で動きを決める。`targetKind` は `event.target` が `a[href]` なら `'link'`、`checkbox` 以外の `button`/`input`/`select`/`textarea` なら `'otherButton'`、ほかは `'none'`。`primary` は今の画面の主ボタンと同じ処理（押せない状態なら何もしない）、`toggle` は `entries[index]` のチェックを反転、`back` は `interests` へ、`later` は今の `later()`。動いたら `preventDefault()`。
- 主ボタンの文言の後ろに `↵` を `aria-hidden` で付ける（読み上げ名は「次へ」などのまま）。
- 保存の処理（`follow`・`saveInterests`・`admitted`）は変えない。
- `start`：`StartStep` で、上に「パック名・最初のリスト」、まんなかに `TypingDemo`（`firstList.words[0]`）、`start.heading`・`start.text`、「練習を始める ↵」。
- スマホ（`sm` 未満）：主ボタンの行を `sticky bottom-0` に、背景つきで置く。

- [ ] **Step 3: 型・lint・単体テスト**
Run: `npm run typecheck && npm run lint && npm run knip && npm test`
Expected: エラーなし

- [ ] **Step 4: 画面で確かめる**
`npm run dev` を `preview_start` で開き、新しいゲストで `/welcome` を3ステップ通す。ライトとダーク、375px と 1280px、`prefers-reduced-motion: reduce`（DevTools のエミュレーション）で見る。

- [ ] **Step 5: コミット**

```bash
git add src/components/Welcome/ src/messages/
git commit -m "ツアーを、キーキャップと右の練習のパネルの2列の画面に組み替える"
```

---

### Task 4: E2E とスナップショット

**Files:**
- Modify: `tests/e2e/welcome.spec.ts`
- Modify: `tests/e2e/screenshots.spec.ts`（ツアーの3枚を足す）
- Modify: `tests/e2e/aria-snapshots.spec.ts`（ツアーのスナップショットがあれば更新）

**Interfaces:**
- Consumes: Task 3 の画面（ボタン名・セクション名は Global Constraints のとおり）。

- [ ] **Step 1: 今の E2E を新しい作りに合わせる**
`pickInterests` から「語学」「プログラミング」を押す手順を消し、`chip` を `page.getByRole('checkbox', { name, exact: true })` にする（`check()` で選ぶ）。「中国語」と「Go」を選ぶと `next` が押せる。保存される関心が `['language', 'language/zh', 'programming', 'programming/go']` のままであることは今のテストが確かめる。

- [ ] **Step 2: キーボードで最後まで進める E2E を足す**

```ts
test('the tour can be done with the keyboard', async ({ page }) => {
  await page.goto('/welcome')
  await expect(firstStep(page)).toBeVisible()
  await chip(page, '中国語').focus(); await page.keyboard.press('Space')
  await chip(page, 'Go').focus(); await page.keyboard.press('Space')
  await page.keyboard.press('Enter')
  const packs = page.getByRole('region', { name: 'パックをフォローする' })
  await expect(packs).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(firstStep(page)).toBeVisible()
  await expect(chip(page, '中国語')).toBeChecked()
  await page.keyboard.press('Enter')
  await page.keyboard.press('2')
  await expect(page.getByRole('checkbox', { name: 'Go構文 を選ぶ', exact: true })).not.toBeChecked()
  await page.getByRole('link', { name: 'カタログでもっと見る', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/packs\/catalog$/)
})
```
と、もう1つ：ステップ2で Enter → `練習を始める` のセクションが出る → Enter で `/play?list=` に入る。フォローの後に `ArrowLeft` と `1` を押しても何も変わらない（セクションは「練習を始める」のまま）。Escape で `/home` に移り、もう一度 `/home` を開いても送られない。

- [ ] **Step 3: スマホ幅の E2E を足す**
375×667 で「中国語」「ロシア語」「韓国語」「英語」「Go」「TypeScript」を選んだとき、「次へ」が `toBeInViewport()`。

- [ ] **Step 4: スクリーンショットを足す**
`screenshots.spec.ts` に、`page.emulateMedia({ reducedMotion: 'reduce' })` をしたうえで、新しいゲスト（`skipWelcome` なし）の `/welcome` の3ステップ（中国語と Go を選んだ状態、ステップ2、ステップ3）を `welcome-interests.png`・`welcome-packs.png`・`welcome-start.png` で撮る。ステップ2はダークでも1枚（`welcome-packs-dark.png`）。
Run: `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots -g welcome`
撮れた画像を目で見てから足す。

- [ ] **Step 5: E2E を流す**
Run: `npx playwright test tests/e2e/welcome.spec.ts tests/e2e/screenshots.spec.ts tests/e2e/aria-snapshots.spec.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add tests/e2e/
git commit -m "ツアーの新しい見た目とキーボードの操作の E2E とスナップショットを足す"
```

---

### Task 5: 版とドキュメント、verify、PR

**Files:**
- Modify: `package.json`, `package-lock.json`（版）
- Modify: `docs/features.md`（「はじめての人向けのツアー」の節）

- [ ] **Step 1: `docs/features.md` のツアーの節に、見た目（2列、右のパネル、キーボードの操作：Enter・Esc・数字・←、戻る、入力の見本、動きを減らす設定）を書き足す**（v2.63.0 から）

- [ ] **Step 2: 版を決める**
Run: `git fetch --tags && git tag --list 'v2.6*' | sort -V | tail -3 && gh release list --limit 3`
新しい機能の見た目なので minor を上げる（今 2.62.2 → `v2.63.0`。使われていたらさらに上げる）。
Run: `npm version 2.63.0 --no-git-tag-version`

- [ ] **Step 3: verify を全部流す**（サンドボックスの外で。Docker と Node.js 24 が要る）
Run: `npm run verify`
Expected: 最後まで通る（スクリーンショットの比較を含む）

- [ ] **Step 4: コミットして PR**

```bash
git add package.json package-lock.json docs/features.md
git commit -m "ツアーの見た目を書き足し、版を 2.63.0 にする"
git push -u origin tour-look
gh pr create --title "はじめての人のツアーを、キーキャップと右に練習が組み上がる見た目にする (v2.63.0)" --body "…"
```
マージはユーザーの確認を取ってから（CLAUDE.md の Release workflow）。
