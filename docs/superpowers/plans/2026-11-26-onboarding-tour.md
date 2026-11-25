# はじめての人のツアー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ワークスペースの版が 0 の人（ゲスト・アカウントとも）を /home・/play から専用の /welcome に送り、関心を選ぶ → 入りやすい公式パックをフォローする → 練習を始める、の3ステップで案内する。

**Architecture:** 判定と対応表は React に依存しない `src/lib/welcome.ts` に置く。`useWordLists` が `revision` を返すようにし、/home と /play は共通のフック `useWelcomeRedirect` で /welcome に送る。/welcome は `(workspace)` の下のクライアントページで、関心はステップ2まで画面の中だけに持ち、「フォローする」でフォロー → 関心の順に保存する。

**Tech Stack:** Next.js 16 / React 19 / TypeScript、next-intl（6言語）、node:test（`tests/*.test.cjs`、`tests/register.cjs` で .ts を読む）、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-26-onboarding-tour-design.md`

## Global Constraints

- 「はじめて来た人」は**ワークスペースの版（`revision`）が 0** の人。新しい保存先・列・API は作らない。
- 送るのは **/home と /play** だけ。トップページ（/）は変えない。
- 「あとで」の印は localStorage に**アカウント ID ごと**（ゲストは `guest:local`）。ワークスペースは変えない。
- ツアーははじめての1回だけ。/guide などに入口は作らない。版が 0 でない人が /welcome を開いたら /home に送る。
- 保存は「フォローする」の1回だけ。**フォローを先に**、関心をあとに。フォローが失敗したら関心は保存しない。
- 6言語（ja・en・fr・ru・zh-CN・zh-TW）に文言を足す（`tests/i18n.test.cjs` が全言語のキーと引数をそろえる）。
- コミットとPRのタイトルは日本語の1文。途中のコミットに `(vX.Y.Z)` は付けない。コードのコメントと識別子は英語。
- PR は新しいバージョン（今の package.json は 2.60.9。`git tag` と GitHub Releases を見て未使用の版にする。新機能なので 2.61.0 を候補にする）。
- `npm run verify` の完走（Docker・Node 24・macOS のスクリーンショット比較）は持ち主の Mac で行う。クラウドのセッションではできないので、そう伝えて渡す。

## Review Focus

1. **読み込みに失敗した人**（ネットワークエラーで `ready` だが中身がない）：版が分からないので送らない。→ Task 1 の `shouldWelcome` と Task 3 で `revision === null` を送らない。
2. **ツアーの途中で版が 1 になる**（フォローの保存直後）：/welcome の「版が 0 でなければ /home へ」が途中で効いて、ステップ3が出ないまま飛ばされる。→ Task 4 で判定は最初に読めたときの1回だけ。E2E で最後まで進むことを確かめる。
3. **localStorage が使えないブラウザー**（プライベートモードの例外など）：印の読み書きで落ちない。読めなければ「印なし」、書けなければ黙って諦める。→ Task 1 のテスト。
4. **shell と Linux を両方選ぶなど、同じパックが2つの子から出る／すでにフォロー済みのパック**：重複して並べず、フォロー済みは二重にフォローしない（`applyCatalogChoices` はフォロー済みを飛ばす）。→ Task 1 の `welcomePacks` の重複のテスト。
5. **関心の保存だけ失敗**：フォローは残り、エラーを出して関心をもう一度保存できる。ステップ3には進める。→ Task 4 の手順で扱い、E2E では `/api/workspace` の2回目の PUT を `page.route` で 500 にして確かめる（アカウントのテストで）。

---

## ファイルの構成

| ファイル | 役割 |
|---|---|
| `src/lib/welcome.ts`（新規） | 対応表 `WELCOME_PACKS`、`welcomePacks`、`hasChildInterest`、`shouldWelcome`、印の読み書き |
| `tests/welcome.test.cjs`（新規） | 上の単体テスト |
| `src/lib/workspaceSession.ts` | `WorkspaceShown` に `revision` |
| `src/hooks/useWordLists.tsx` | `revision: number \| null` を返す |
| `src/hooks/useWelcomeRedirect.ts`（新規） | /home・/play から /welcome に送る |
| `src/app/home/page.tsx`、`src/app/(workspace)/play/page.tsx` | フックを使う |
| `src/app/(workspace)/welcome/layout.tsx`・`page.tsx`（新規） | ページとメタデータ |
| `src/components/Welcome/WelcomeTour.tsx`（新規） | 3ステップの状態と保存 |
| `src/components/Welcome/PackStep.tsx`・`StartStep.tsx`（新規） | ステップ2・3の表示 |
| `src/lib/pageMetadata.ts` | `welcome` の題 |
| `src/messages/*/home.json`（6言語） | `tour` の文言 |
| `tests/e2e/welcome.ts`（新規） | E2E の補助 `skipWelcome` |
| `tests/e2e/welcome.spec.ts`（新規） | ツアーの E2E |
| 既存の `tests/e2e/*.spec.ts` | はじめてのゲスト・アカウントで /home・/play を開くものに `skipWelcome` |

---

### Task 1: 判定と対応表（`src/lib/welcome.ts`）

**Files:**
- Create: `src/lib/welcome.ts`
- Test: `tests/welcome.test.cjs`

**Interfaces:**
- Consumes: `INTEREST_OPTIONS`・`matchesInterests`（`src/lib/interests.ts`）、`officialPacks`・`OfficialPack`（`src/lib/packs/catalog.ts`）
- Produces:
  - `export const WELCOME_PACKS: Readonly<Record<string, string>>` 子の関心 ID → カタログ ID
  - `export function welcomePacks(interests: string[]): OfficialPack[]` 選んだ子の順（`INTEREST_OPTIONS` の順）に、重複なし
  - `export function hasChildInterest(interests: string[]): boolean`
  - `export function shouldWelcome(state: { revision: number | null; dismissed: boolean }): boolean`
  - `export const WELCOME_DISMISSED_KEY = 'typle-r:welcome-dismissed'`（値はアカウント ID の JSON 配列）
  - `export function isWelcomeDismissed(accountId: string, storage?: Storage): boolean`
  - `export function dismissWelcome(accountId: string, storage?: Storage): void`

- [ ] **Step 1: ブランチを作り、設計書と計画をコミットする**

```bash
git switch main && git pull --ff-only && git switch -c onboarding-tour
git add docs/superpowers/specs/2026-11-26-onboarding-tour-design.md docs/superpowers/plans/2026-11-26-onboarding-tour.md
git commit -m "はじめての人のツアーの設計と計画を書く"
```

- [ ] **Step 2: 失敗するテストを書く** — `tests/welcome.test.cjs`（`require('./register.cjs')` から始める、`tests/interests.test.cjs` と同じ形）

```js
test('every child interest has a welcome pack that exists and fits it', () => {
  for (const option of INTEREST_OPTIONS) for (const child of option.children) {
    const catalogId = WELCOME_PACKS[child.id]
    assert.ok(catalogId, child.id)
    const entry = officialPacks().find(item => item.catalogId === catalogId)
    assert.ok(entry, catalogId)
    assert.equal(matchesInterests(entry.pack, [option.id, child.id]), true, child.id)
  }
  assert.deepEqual(Object.keys(WELCOME_PACKS).sort(), INTEREST_OPTIONS.flatMap(o => o.children.map(c => c.id)).sort())
})
test('the table is the spec table', () => {
  assert.equal(WELCOME_PACKS['language/zh'], 'pack-chinese-basics')
  assert.equal(WELCOME_PACKS['programming/shell'], 'pack-8f3cf116-1f9f-4579-a071-e600094b104d')
  assert.equal(WELCOME_PACKS['programming/linux'], 'pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe')
})
test('welcomePacks: children in option order, parents ignored, no duplicates', () => {
  const ids = interests => welcomePacks(interests).map(entry => entry.catalogId)
  assert.deepEqual(ids(['programming', 'programming/go', 'language', 'language/zh']), ['pack-chinese-basics', 'pack-go-syntax-beginner'])
  assert.deepEqual(ids(['language']), [])
  assert.deepEqual(ids([]), [])
})
test('hasChildInterest', () => {
  assert.equal(hasChildInterest(['language']), false)
  assert.equal(hasChildInterest(['language', 'language/en']), true)
})
test('shouldWelcome only for revision 0 without the mark', () => {
  assert.equal(shouldWelcome({ revision: 0, dismissed: false }), true)
  assert.equal(shouldWelcome({ revision: 0, dismissed: true }), false)
  assert.equal(shouldWelcome({ revision: 1, dismissed: false }), false)
  assert.equal(shouldWelcome({ revision: null, dismissed: false }), false)
})
test('the mark is kept per account', () => {
  const storage = memoryStorage()   // a Map-backed getItem/setItem defined in the test
  assert.equal(isWelcomeDismissed('guest:local', storage), false)
  dismissWelcome('guest:local', storage)
  dismissWelcome('guest:local', storage)
  assert.equal(isWelcomeDismissed('guest:local', storage), true)
  assert.equal(isWelcomeDismissed('github:1', storage), false)
  assert.deepEqual(JSON.parse(storage.getItem(WELCOME_DISMISSED_KEY)), ['guest:local'])
})
test('a broken or unavailable storage never throws', () => {
  const storage = memoryStorage(); storage.setItem(WELCOME_DISMISSED_KEY, '{oops')
  assert.equal(isWelcomeDismissed('guest:local', storage), false)
  const failing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(isWelcomeDismissed('guest:local', failing), false)
  assert.doesNotThrow(() => dismissWelcome('guest:local', failing))
})
```

- [ ] **Step 3: 失敗を確かめる** — `node --test --test-isolation=none tests/welcome.test.cjs` → モジュールがなくて FAIL。

- [ ] **Step 4: `src/lib/welcome.ts` を書く**

対応表は設計書の「関心ごとの入りやすいパック」の表をそのまま写す（21行）。`welcomePacks` は `INTEREST_OPTIONS` の子を順に見て、選ばれていれば対応のカタログ ID を、まだ出していなければ `officialPacks()` から足す。`storage` の既定は `globalThis.localStorage`。読み書きは try/catch で囲み、配列でない値は「印なし」として扱う。

- [ ] **Step 5: 通ることを確かめる** — 同じコマンドで PASS。続けて `npm test` と `npm run typecheck` が通る。

- [ ] **Step 6: コミット** — `git add src/lib/welcome.ts tests/welcome.test.cjs && git commit -m "はじめての人のツアーの判定とパックの対応表を足す"`

---

### Task 2: 版を画面に渡す

**Files:**
- Modify: `src/lib/workspaceSession.ts`（`WorkspaceShown`、`display`）
- Modify: `src/hooks/useWordLists.tsx`（状態と戻り値）
- Test: `tests/workspaceSession.test.cjs`

**Interfaces:**
- Produces: `WorkspaceShown` に `revision: number`。`useWordLists()` の戻り値に `revision: number | null`（読み込みが一度も成功していない間とアカウントが変わった直後は `null`）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/workspaceSession.test.cjs` に `test('show passes the revision', ...)`：版 0 を返す store と版 3 を返す store で `load()` し、`show` に渡った値の `revision` がそれぞれ 0・3。保存（`updateInterests`）のあとは保存結果の版。
- [ ] **Step 2: 失敗を確かめる** — `node --test --test-isolation=none tests/workspaceSession.test.cjs` → `revision` が undefined で FAIL。
- [ ] **Step 3: 実装** — `display` が `show` に `revision: data.revision` を渡す。`useWorkspace` に `const [revision, setRevision] = useState<number | null>(null)`、アカウントが変わるときのリセットで `null`、`show` で設定、戻り値に足す。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンドと `npm test`、`npm run typecheck` が PASS。
- [ ] **Step 5: コミット** — `git commit -am "ワークスペースの版を画面から読めるようにする"`

---

### Task 3: /home・/play から送る

**Files:**
- Create: `src/hooks/useWelcomeRedirect.ts`
- Modify: `src/app/home/page.tsx`、`src/app/(workspace)/play/page.tsx`
- Create: `tests/e2e/welcome.ts`
- Test: `tests/e2e/welcome.spec.ts`

**Interfaces:**
- Consumes: `shouldWelcome`・`isWelcomeDismissed`（Task 1）、`useWordLists().revision`・`accountId`・`error`（Task 2）
- Produces:
  - `export function useWelcomeRedirect(): boolean` — 送るときは `router.replace('/welcome')` を呼び、`true` を返す（呼ぶ側はその間、読み込み中の表示のまま）。
  - `tests/e2e/welcome.ts`: `export function skipWelcome(page: Page, accountId = 'guest:local'): Promise<void>`（`addInitScript` で印を置く）

- [ ] **Step 1: 失敗する E2E を書く** — `tests/e2e/welcome.spec.ts`
  - `'a new guest opening /home is sent to the tour'`：何も置かずに `/home` → `toHaveURL(/\/welcome$/)`。`/play` でも同じ。
  - `'a guest with data stays on /home and /play'`：`guestWorkspace([...])`（`tests/e2e/guestData.ts`、版 1）を置いて /home・/play → URL が変わらない。
  - `'a guest who dismissed it stays'`：`skipWelcome(page)` のあと /home → `/home` のまま、/play → 「どれから練習しますか？」が見える。
- [ ] **Step 2: 失敗を確かめる** — `npm run build && npx playwright test tests/e2e/welcome.spec.ts` → 送られずに FAIL。
- [ ] **Step 3: 実装** — フックは `ready` かつ `accountId` があり、`!error` で、`shouldWelcome({ revision, dismissed: isWelcomeDismissed(accountId) })` のとき送る。/home は `!ready || redirecting` のとき今の読み込み中の表示、/play は `<Loading />` を出す（ちらつかせない）。/welcome はまだないので、この時点の E2E は URL だけを確かめる。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンドで PASS。
- [ ] **Step 5: コミット** — `git commit -m "はじめての人を /home と /play からツアーに送る"`（新しいファイルを add してから）

---

### Task 4: ツアーの画面（/welcome）

**Files:**
- Create: `src/app/(workspace)/welcome/layout.tsx`（`pageMetadata("welcome", { personal: true })`）、`src/app/(workspace)/welcome/page.tsx`
- Create: `src/components/Welcome/WelcomeTour.tsx`、`PackStep.tsx`、`StartStep.tsx`
- Modify: `src/lib/pageMetadata.ts`（`PAGE_TITLES.welcome = "home.tour.title"`）
- Modify: `src/messages/{ja,en,fr,ru,zh-CN,zh-TW}/home.json`（`tour` のブロック）
- Test: `tests/e2e/welcome.spec.ts`、`tests/pageMetadata.test.cjs`（`/welcome` を personal のページの一覧に足す）

**Interfaces:**
- Consumes: `welcomePacks`・`hasChildInterest`・`dismissWelcome`（Task 1）、`useWordLists()` の `revision`・`updateLibrary`・`updateInterests`・`saving`・`error`（Task 2）、`InterestSettings`（今の部品。`updateInterests` に画面の中の状態を変える関数を、`saving` に保存中を渡して再利用する）、`applyCatalogChoices`・`normalizeInterests`・`randomId`・`practicePath`
- Produces: ページ `/welcome`。`home.tour.*` の文言のキー。

- [ ] **Step 1: 失敗する E2E を書く**（`tests/e2e/welcome.spec.ts` に足す）
  - `'a new guest picks interests, follows and starts practice'`：/home → /welcome。「次へ」は子を選ぶまで無効。「語学」→「中国語」、「プログラミング」→「Go」で「次へ」。ステップ2に「中国語：基礎単語・基礎構文」「Go構文」がチェック済みで並ぶ。「Go構文」のチェックを外して「フォローする」。ステップ3に「中国語：基礎単語・基礎構文」の最初のリストが出る。「練習を始める」で `/play?list=` に入り、入力欄が見える。localStorage の `typle-r:guest-workspace:v1` を読み、パックは `pack-chinese-basics` を元にした1つだけ、`interests` は `['language', 'language/zh', 'programming', 'programming/go']`。
  - `'later leaves the tour for good on this browser'`：/welcome で「あとで」→ /home に戻り、もう一度 /home を開いても /welcome に送られない。
  - `'someone with data opening /welcome goes home'`：版 1 のゲストで /welcome → `/home`。
  - `'a new account is toured too, and a failed interests save can be retried'`：`signIn(context, newAccountId())` で /home → /welcome。関心を選んでステップ2へ。`page.route('**/api/workspace', ...)` で2回目の PUT だけ 500 を返す。「フォローする」→ エラーが出て、「関心をもう一度保存」のボタンが出る。route を外して押す → ステップ3へ。DB の `typle_workspaces` の interests が選んだものになる（`withDatabase`）。終わったら `deleteWorkspace`。
- [ ] **Step 2: 失敗を確かめる** — `npm run build && npx playwright test tests/e2e/welcome.spec.ts` → /welcome がなくて FAIL。
- [ ] **Step 3: 文言を足す** — `home.json` の `tour` に、少なくとも `title`・`later`・`next`・`interests.title`・`interests.text`・`packs.title`・`packs.text`・`packs.follow`・`packs.following`・`packs.more`（`<catalog>` のリッチテキスト）・`packs.select`（`{name}`）・`packs.stats`（`{lists}`・`{words}`）・`packs.retryInterests`・`start.title`・`start.text`（`{pack}`）・`start.button` を6言語で。ステップの位置の表示（例：`step`、`{current}`・`{total}`）。
- [ ] **Step 4: 画面を作る**
  - `WelcomeTour` は `step: 'interests' | 'packs' | 'start'`、`chosen: string[]`（初期は `[]`。保存済みの既定＝全部は使わない）、`checked: Set<string>`、`followedCatalogId: string | null`、`interestsSaved: boolean` を持つ。
  - **入れるかの判定は最初に `ready` になったときの1回だけ**（`useRef`）：そのとき `revision !== 0` なら `router.replace('/home')`。以後、版が変わっても送らない（Review Focus 2）。
  - ステップ1：`<InterestSettings interests={chosen} saving={false} updateInterests={async change => { setChosen(change); return true }} />`。「次へ」は `hasChildInterest(chosen)` のときだけ。進むとき `checked` を `welcomePacks(chosen)` 全部にする。
  - ステップ2（`PackStep`）：`welcomePacks(chosen)` を、チェックボックス・名前・`officialPack.stats` と同じ数・最初のリストの3語（`StarterPacks` と同じ見せ方）で並べる。「カタログでもっと見る」は `/packs/catalog`。「フォローする」は `checked` が空なら無効。
  - 「フォローする」：`updateLibrary(library => applyCatalogChoices(library, choices, entry => ({ pack: randomId(), lists: entry.lists.map(() => randomId()) })))`（`choices` は並び順の `checked`）。失敗なら終わり（エラーは `useWordLists().error` が出す）。成功したら、並び順で最初の `checked` を `followedCatalogId` にし、`updateInterests(() => normalizeInterests(chosen))`。成功ならステップ3、失敗なら `packs.retryInterests` のボタンを出す（押すと関心だけ保存し直し、成功でステップ3）。
  - ステップ3（`StartStep`）：`packs` から `origin.catalogId === followedCatalogId` のパックを探し、その最初のリスト（`lists` の `packId` で最初のもの）の名前と3語を出す。「練習を始める」で `router.push(practicePath(list.id))`。
  - 「あとで」はどのステップにも置き、`dismissWelcome(accountId)` してから `router.replace('/home')`。
- [ ] **Step 5: 通ることを確かめる** — `npm run typecheck && npm test && npm run lint && npm run build && npx playwright test tests/e2e/welcome.spec.ts` が PASS。
- [ ] **Step 6: コミット** — `git add` で新しいファイルを足して `git commit -m "はじめての人のツアーの画面を作る"`

---

### Task 5: 今ある E2E を直す

**Files:**
- Modify: はじめてのゲスト・アカウントで /home・/play を開く `tests/e2e/*.spec.ts`（`interests.spec.ts`、`play.spec.ts` のおすすめパックのテスト、`guest.spec.ts`、`account.spec.ts`、`screenshots.spec.ts`、`aria-snapshots.spec.ts` などが候補。実際は Step 1 の結果で決める）

**Interfaces:**
- Consumes: `skipWelcome`（Task 3）

- [ ] **Step 1: 全体を流して、送られて落ちるテストを洗い出す** — `npx playwright test`。落ちたテストのうち、原因が /welcome に送られたことのものを一覧にする。
- [ ] **Step 2: それぞれに `skipWelcome` を入れる** — ゲストは `await skipWelcome(page)`、アカウントは `await skipWelcome(page, accountId)` を `goto` の前に。テストの意図（はじめての人の /play のおすすめパック、/home の「ようこそ」など）はそのまま確かめる。
- [ ] **Step 3: 全体が通ることを確かめる** — `npx playwright test` が PASS（Linux ではスクリーンショットは飛ばされる）。
- [ ] **Step 4: コミット** — `git commit -am "ツアーに送られないよう、はじめての人の画面を開く E2E に印を置く"`

---

### Task 6: 文書・バージョン・PR の準備

**Files:**
- Modify: `src/messages/*/guide.json` の `interests.p1`（「はじめはすべてのチップが選ばれていて」の説明に、ツアーで選ぶとその関心だけになることを足す。6言語）
- Modify: `package.json`・`package-lock.json`（バージョン）

- [ ] **Step 1: ガイドの文言を直す**（6言語）。`npm test`（i18n）が PASS。
- [ ] **Step 2: バージョンを決める** — `git fetch --tags && git tag --sort=-v:refname | head -3` と `gh release list --limit 3` で使われていない版を確かめ、`npm version 2.61.0 --no-git-tag-version`（使われていれば次の版）。
- [ ] **Step 3: 速い検査** — `npm run verify -- --fast` が通る（Docker が要る。クラウドのセッションならここで持ち主に渡す）。
- [ ] **Step 4: コミット** — `git commit -am "はじめての人に関心を選んでパックをフォローするツアーを出す"`
- [ ] **Step 5: 持ち主の Mac で `npm run verify` を完走** — スクリーンショットの比較を含む。新しい画面のスクリーンショットを足すなら、`screenshots.spec.ts` に /welcome のステップ1を足して更新する。
- [ ] **Step 6: PR を作る**（持ち主の確認のあと）— タイトル「はじめての人に関心を選んでパックをフォローするツアーを出す (v2.61.0)」、説明は日本語で変更と確認を書く。マージは持ち主の確認を取ってから（マージ＝本番公開）。
