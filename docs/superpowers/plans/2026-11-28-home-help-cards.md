# ホームの「はじめての方へ」カード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** まだ練習していない /home で、「使い方」「Typleについて」を1行のリンクから、説明つきのカード2枚に変える。

**Architecture:** 新しい部品 `HelpCards` を `src/app/home/page.tsx` の練習前の分岐（`count` が 0）にだけ置き、
その分岐では今の `home.links` の1行を出さない。ダッシュボードの分岐は今のまま。文言は `home.welcome.help` に6言語で足す。

**Tech Stack:** Next.js（App Router）・next-intl・Tailwind・lucide-react・Playwright（aria スナップショットとスクリーンショット）

**Spec:** `docs/superpowers/specs/2026-11-28-home-help-cards-design.md`

## Global Constraints

- 対象は、まだ練習していないホームだけ。ダッシュボードの見た目は変えない（`home.links` の1行もダッシュボードでは残す）。
- 新しい依存は足さない。アイコンは lucide-react の `BookOpen`・`Info`・`ChevronRight`、四角は `IconTile`。
- 文言は ja・en・fr・ru・zh-CN・zh-TW の6言語すべてに入れる（`tests/i18n.test.cjs` が同じキーを求める）。
- カードは「練習する」のボタンより目立たせない（塗りのボタンを主役のまま、カードは枠線と `bg-card` だけ）。
- 識別子とコメントは英語、コミットメッセージは日本語で書く（`(vX.Y.Z)` は付けない）。

## Review Focus

- スマホの幅（390px）で、2枚が縦に並び、説明の行が折り返しても矢印が潰れない。→ Task 2 のスクリーンショットで、
  390px の `home-first` を見て確かめる（既存の phone のテストに足さず、目で見る）。
- ダークモードでカードの枠と文字が読める。→ Task 2 で `home-first` をダークでも撮って目で見る。
- キーボードの Tab でカードにフォーカスが移り、フォーカスの輪が見える。→ Task 1 の E2E で `focus()` して `toBeFocused()`。
- ログインしていて練習がまだないホームでも同じカードが出る（`storageAccount` の文の上）。分岐は `count` だけで決まるので
  追加のテストはしない。
- ダッシュボードの1行のリンクが残っている。→ 既存の `home.aria.yml`（ダッシュボード）がそのまま通ることで確かめる。

---

### Task 1: カードの部品と文言、練習前のホームへの組み込み

**Files:**
- Create: `src/components/Home/HelpCards.tsx`
- Modify: `src/app/home/page.tsx`（練習前の分岐の `<nav>` の後ろに `<HelpCards />`。`home.links` の `<p>` を `count` があるときだけ出す）
- Modify: `src/messages/{ja,en,fr,ru,zh-CN,zh-TW}/home.json`（`welcome.help` を足す）
- Test: `tests/e2e/aria-snapshots.spec.ts-snapshots/home-first.aria.yml`、`tests/e2e/guide.spec.ts`（末尾にテストを足す）

**Interfaces:**
- Produces: `export default function HelpCards(): JSX.Element`（引数なし。`useTranslations("home")` で `welcome.help.*` を読む）

- [ ] **Step 1: aria スナップショットを、期待する木に書き換える**

`home-first.aria.yml` の `navigation "はじめる"` の後ろに次を足し、最後の `paragraph`（使い方 ／ Typleについて のリンク）を消す。
保存先の `paragraph` はカードの下に残す。

```yaml
  - navigation "はじめての方へ":
    - heading "はじめての方へ" [level=2]
    - link "使い方 練習の始め方、単語リストの作り方、記録の見方":
      - /url: /guide
    - link "Typleについて できること、データの保存先、バージョン":
      - /url: /about
```

- [ ] **Step 2: E2E を足す**（`tests/e2e/guide.spec.ts` の末尾）

```ts
// import { skipWelcome } from './welcome' at the top: a new workspace is otherwise sent to /welcome.
test('the first home leads to the guide and about pages with cards', async ({ page }) => {
  await skipWelcome(page)
  await page.goto('/home')
  const help = page.getByRole('navigation', { name: 'はじめての方へ' })
  const guide = help.getByRole('link', { name: /^使い方/ })
  await guide.focus()
  await expect(guide).toBeFocused()
  await guide.click()
  await expect(page).toHaveURL(/\/guide$/)
  await page.goto('/home')
  await help.getByRole('link', { name: /^Typleについて/ }).click()
  await expect(page).toHaveURL(/\/about$/)
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx playwright test tests/e2e/aria-snapshots.spec.ts tests/e2e/guide.spec.ts -g "home introduces|leads to the guide"`
Expected: 2つとも FAIL（`はじめての方へ` の navigation がない）

- [ ] **Step 4: 文言を足す**（各 `home.json` の `welcome` の中に `help`）

| 言語 | title | guide.title | guide.text | about.title | about.text |
|---|---|---|---|---|---|
| ja | はじめての方へ | 使い方 | 練習の始め方、単語リストの作り方、記録の見方 | Typleについて | できること、データの保存先、バージョン |
| en | New to Typle | How to use | Starting a practice, making word lists, reading your records | About Typle | What it does, where your data is kept, the version |
| fr | Première visite | Mode d’emploi | Commencer un entraînement, créer des listes de mots, lire vos résultats | À propos de Typle | Ce que permet l’app, où sont gardées vos données, la version |
| ru | Впервые здесь | Как пользоваться | Как начать тренировку, создать список слов и смотреть результаты | О Typle | Возможности, где хранятся данные, версия |
| zh-CN | 初次使用 | 使用方法 | 如何开始练习、创建单词列表、查看记录 | 关于 Typle | 功能、数据保存位置、版本 |
| zh-TW | 初次使用 | 使用說明 | 如何開始練習、建立單字清單、查看紀錄 | 關於 Typle | 功能、資料儲存位置、版本 |

形: `"help": { "title": …, "guide": { "title": …, "text": … }, "about": { "title": …, "text": … } }`

- [ ] **Step 5: `HelpCards` を書いてホームに組み込む**

- `<nav aria-labelledby={id}>`（`useId()`）の中に `<h2 id={id}>`（`text-lg` 程度、h1 より小さく）と、2枚を並べる
  `grid gap-3 sm:grid-cols-2`。並びは `mt-8`。
- 1枚は `next/link` の `<Link>` 1つ。中に `IconTile`（`BookOpen`／`Info`）、見出しと説明の2行（説明は
  `text-sm text-muted-foreground`）、右端に `ChevronRight`（`aria-hidden`、`ms-auto shrink-0`）。
- `<Link>` のクラス: `flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`
  （`Card` 部品はリンクを包めないので、見た目だけそろえる。設計書の「`Card` を使う」からの Claude の判断）。
- `page.tsx`: `<HelpCards />` を練習前の分岐の `</nav>` の後ろに置き、`home.links` の `<p>` は `count > 0` のときだけ出す。

- [ ] **Step 6: 通ることを確かめる**

Run: `npx playwright test tests/e2e/aria-snapshots.spec.ts tests/e2e/guide.spec.ts && node --test tests/i18n.test.cjs && npm run typecheck && npm run lint`
Expected: すべて PASS。aria の木で、リンクの子の書き方だけが Step 1 と違う場合は `docs/snapshots.md` の手順で
書き直し、木が Step 1 と同じ中身（見出し・2つのリンクと URL・1行のリンクがないこと）か目で確かめる。

- [ ] **Step 7: コミット**

```bash
git add src/components/Home/HelpCards.tsx src/app/home/page.tsx src/messages/*/home.json tests/e2e/aria-snapshots.spec.ts-snapshots/home-first.aria.yml tests/e2e/guide.spec.ts
git commit -m "まだ練習していないホームに、使い方とTypleについてのカードを置く"
```

### Task 2: スクリーンショットの撮り直しと全体の確認（Mac）

**Files:**
- Modify: `tests/e2e/screenshots.spec.ts-snapshots/home-first*.png`

- [ ] **Step 1: 変わるスクリーンショットだけを撮り直す**

Run: `npx playwright test tests/e2e/screenshots.spec.ts -g "home introduces" --update-snapshots`
Expected: `home-first.png` だけが変わる。画像を開き、カードがボタンより控えめで、2枚が横に並んでいることを見る。

- [ ] **Step 2: スマホ幅とダークを目で見る**（Review Focus）

dev サーバーのプレビューで /home を 390px とダークで開き、縦並び・矢印・枠と文字の読みやすさを見る。

- [ ] **Step 3: 全体の確認**

Run: `npm run verify`（サンドボックスの外で）
Expected: 最後まで通る。ほかのスクリーンショットに差分が出ない。

- [ ] **Step 4: コミット**

```bash
git add tests/e2e/screenshots.spec.ts-snapshots
git commit -m "練習前のホームのスクリーンショットを撮り直す"
```
