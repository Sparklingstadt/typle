# Go から TS への移行・段階2（ギャラリーの読み取りと /api/shared）Implementation Plan

> v2.50.0 で `src/core` は `src/lib` に（公式パックは `src/lib/packs`）、`src/lib` の React のフック（`use*`）は `src/hooks` に移りました。この文書のパスは書いた当時のものです。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン不要の読み取り `GET /api/gallery`・`GET /api/gallery/categories`・`GET /api/shared` を Go から Route Handler に移す。

**Architecture:** 段階1の `src/server/response.ts`・`database.ts` の上に、失敗の報告（`report.ts`）、ギャラリーの読み取り（`gallery.ts`）、
共有パックの読み取り（`shared.ts`）を足す。それぞれ「DB を読む関数」と「リクエストに答える関数（`answer…(request, open)`）」を持ち、
`route.ts` は段階1と同じく `pool` を渡して呼ぶだけにする。転送からこの3つのパスを外し、Go の対応するハンドラー・Store の関数・
`server/vercel` の公開の部分（`publicHandler`）とそのテストを消す。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`@sentry/nextjs`、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階1の計画：`docs/superpowers/plans/2026-11-16-go-to-ts-stage1-health.md`）

## Global Constraints

- 段階1の Global Constraints はすべてそのまま（API は変えない、本文末尾の `\n`、相対 import、`src/server` は画面から import しない、
  SQL はそのまま書く、コメントと識別子は英語・文書とコミットは日本語、途中のコミットに版を付けない）。
- **ギャラリー**（`/api/gallery`・`/api/gallery/categories`）の応答は、エラーと 405 を含めてすべて `X-Robots-Tag: noindex` と
  `Cache-Control: no-store`（`private, no-store` を上書き）。`Content-Type` と `Vary: Cookie` は `reply` のまま。
- **`/api/shared`** の応答は、エラーと 405 を含めてすべて `X-Robots-Tag: noindex`。200 だけは `reply` を使わず、
  `Content-Type: application/json; charset=utf-8`・`Cache-Control: no-store`（`Vary` なし）で、本文は共有パックのファイルの文字列。
  エラーは `reply` の形（`private, no-store`・`Vary: Cookie`）のまま。
- メソッド：3つとも GET と HEAD だけ。HEAD は GET と同じ状態コード・ヘッダーで本文なし。POST・PUT・PATCH・DELETE・OPTIONS は
  `405`・`Allow: GET, HEAD`・`{"error":"methodNotAllowed"}\n`（各パスのヘッダー付き）。
- DB の失敗は `503 databaseUnavailable`（各パスのヘッダー付き）。そのとき `reportFailure` で、ログと Sentry に操作名
  （`gallery.read`・`gallery.categories`・`shared.read`）を付けて送る。
- `updatedAt` は `Date#toISOString()`（Go の `2006-01-02T15:04:05.000Z` と同じ形）。
- 定数：1ページ20件（`GALLERY_PAGE_SIZE = 20`）、検索文字列は最大200文字（コードポイント、`MAX_GALLERY_QUERY = 200`）、
  ページは1〜10000（`MAX_GALLERY_PAGE = 10000`）。

## Review Focus

1. 壊れたクエリ文字列：`q=%FF`（UTF-8 でない）・`q=a%00b`（NUL）は 400 `invalidQuery`。`URLSearchParams` は `%FF` を U+FFFD に
   置き換えて通してしまうので、生のクエリから読む。`%zz` のような壊れたエスケープは、Go と同じくその組を無視する（既定値で答える）。
   → Task 2 の `parseGalleryQuery` のテスト。
2. `page` の書き方：Go の `strconv.Atoi` と同じく `+2`・`007` は数として読み、`1.0`・` 1`・`abc` は 400。→ Task 2。
3. 共有パックの書き出し：DB の JSON のキーの順や空白が違っても、Go と1バイトも違わない文字列を返す（空の `description`・
   `category`・`tags`・`levels` は書かない、`writing` は `{ language }` だけ）。→ Task 3 のテスト（`tests/fixtures/pack-file` を使う）。
4. 分類の並び：件数の多い順、同じ件数は日本語の照合順（`Intl.Collator('ja')`）。→ Task 2 の DB テスト。
5. 隠されたパック（`hidden_at`）と掲載していないパック（`listed_at` が NULL）は、ギャラリーにも分類の件数にも出ない。
   隠されたパックは `/api/shared` でも 404。→ Task 2・3 の DB テスト。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-public-reads`（最新の main から）。この計画をコミットする：
  `git commit -m "Go から TS への移行の段階2の計画を書く"`

### Task 1: 失敗の報告と、ギャラリー・共有の応答ヘッダー

**Files:**
- Create: `src/server/report.ts`
- Modify: `src/server/response.ts`
- Test: `tests/serverResponse.test.cjs`（追記）

**Interfaces:**
- Produces:
  - `reportFailure(request: Request, error: unknown, operation: string): void` — `console.error` に
    `${method} ${pathname}: ${operation}:` と error を出し、`Sentry.captureException(error, { tags: { operation } })`。
    Sentry が初期化されていなければ（DSN なし・テスト）何も送らない（SDK の既定のまま）。
  - `forGallery(response: Response): Response` — `X-Robots-Tag: noindex` と `Cache-Control: no-store` を付けて返す（同じオブジェクトを変えてよい）。
  - `notForSearch(response: Response): Response` — `X-Robots-Tag: noindex` だけを付けて返す。

- [ ] **Step 1: 失敗するテストを書く**（`tests/serverResponse.test.cjs` に追記）

```js
const { forGallery, notForSearch } = require('../src/server/response.ts')

test('forGallery keeps the answer from search engines and caches', () => {
  const response = forGallery(refuse(400, 'invalidQuery'))
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('notForSearch only keeps the answer from search engines', () => {
  const response = notForSearch(refuse(404, 'sharedPackNotFound'))
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('reportFailure logs the method, path and operation', () => {
  const { reportFailure } = require('../src/server/report.ts')
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args.join(' '))
  try {
    reportFailure(new Request('http://localhost/api/gallery?q=x'), new Error('down'), 'gallery.read')
  } finally { console.error = original }
  assert.match(logged[0], /^GET \/api\/gallery: gallery\.read: .*down/)
})
```

- [ ] **Step 2:** `node --test --test-isolation=none tests/serverResponse.test.cjs` → FAIL（`forGallery is not a function`）。
- [ ] **Step 3:** `response.ts` に `forGallery`・`notForSearch`、`src/server/report.ts` に `reportFailure` を書く。
  `report.ts` は `@sentry/nextjs` を import する。`tests/register.cjs` で読めない（ESM だけ等）なら、`@sentry/node` ではなく
  `require` できる形を確かめ、無理なら `reportFailure` の Sentry の呼び出しを `src/server/sentry.ts` に分けてテストではそれを差し替える
  （その場合は ledger に Ruling を残す）。
- [ ] **Step 4:** 同じコマンドで PASS。
- [ ] **Step 5:** コミット `git commit -m "失敗の報告と、ギャラリー・共有の応答ヘッダーを足す"`

### Task 2: ギャラリーの読み取り（`/api/gallery`・`/api/gallery/categories`）

**Files:**
- Create: `src/server/gallery.ts`、`src/app/api/gallery/route.ts`、`src/app/api/gallery/categories/route.ts`
- Test: `tests/serverGallery.test.cjs`（DB なしのクエリの読み取り）、`tests/apiGallery.test.cjs`（DB を使う）

**Interfaces:**
- Consumes: 段階1の `reply`・`refuse`・`methodNotAllowed`・`withoutBody`・`pool`、Task 1 の `forGallery`・`reportFailure`。
- Produces（`src/server/gallery.ts`）:
  - `type GallerySort = 'new' | 'popular'`、`type GalleryQuery = { text: string, category: string, sort: GallerySort, page: number }`
  - `parseGalleryQuery(url: URL): GalleryQuery | null` — `?q=&category=&sort=&page=` を Go の `galleryQuery` と同じ規則で読む。
    `null` は 400 `invalidQuery`。`text` は Go の `strings.TrimSpace` と同じ空白（`\t\n\v\f\r `・U+0085・U+00A0・U+1680・U+2000〜U+200A・
    U+2028・U+2029・U+202F・U+205F・U+3000）を両端から除き、200コードポイントで切る。
  - `readGallery(db: Pool, query: GalleryQuery): Promise<{ packs: GalleryPack[], more: boolean }>` — SQL は
    `server/internal/store/gallery.go` の `Gallery` をそのまま写す（`LIMIT 21 OFFSET (page-1)*20`、LIKE のエスケープ `\`・`%`・`_`）。
  - `readGalleryCategories(db: Pool): Promise<{ name: string, count: number }[]>` — `GalleryCategories` の SQL を写し、件数の多い順、
    同じ件数は `new Intl.Collator('ja').compare` で並べる。
  - `answerGallery(request: Request, open: () => Pool): Promise<Response>`、`answerGalleryCategories(request: Request, open: () => Pool): Promise<Response>`
    — 応答はすべて `forGallery` を通す。`open()` が投げても DB が失敗しても `reportFailure` して 503 `databaseUnavailable`。
  - `GalleryPack` の JSON は `{ id, name, description?, category?, tags?, lists, words, added, updatedAt }` の順。空の `description`・
    `category` と、空かない `tags` は書かない。分類の答えは `{ "categories": [{ "name", "count" }] }`、パックの答えは `{ "packs": [...], "more": bool }`。
- `route.ts` は2つとも段階1の `src/app/api/health/route.ts` と同じ形（`GET`・`HEAD`、ほかは `methodNotAllowed` を `forGallery` で包む）。

- [ ] **Step 1: クエリの読み取りの失敗するテストを書く**（`tests/serverGallery.test.cjs`、Go の `TestGalleryQuery`・`TestGalleryInvalid` を写す）

```js
const read = query => parseGalleryQuery(new URL(`http://localhost/api/gallery${query}`))

test('the query is read as the Go backend read it', () => {
  assert.deepEqual(read('?q=%20abc%20&category=%E8%AA%9E%E5%AD%A6&sort=popular&page=2'), { text: 'abc', category: '語学', sort: 'popular', page: 2 })
  assert.deepEqual(read(''), { text: '', category: '', sort: 'new', page: 1 })
  assert.equal(read('?q=' + '%E3%81%82'.repeat(201)).text, 'あ'.repeat(200))
  assert.equal(read('?page=%2B2').page, 2)
  assert.equal(read('?page=007').page, 7)
  assert.equal(read('?q=a+b').text, 'a b')
  assert.equal(read('?q=%E3%80%80x%C2%85').text, 'x')
  assert.deepEqual(read('?q=%zz'), { text: '', category: '', sort: 'new', page: 1 })
})

test('a bad query is refused', () => {
  for (const query of ['sort=old', 'page=0', 'page=abc', 'page=10001', 'page=-1', 'page=1.0', 'page=%201', 'q=%FF', 'q=a%00b', 'category=%C3', 'category=a%00b']) {
    assert.equal(read('?' + query), null, query)
  }
})
```

- [ ] **Step 2:** `node --test --test-isolation=none tests/serverGallery.test.cjs` → FAIL（モジュールがない）。
- [ ] **Step 3:** `parseGalleryQuery` を書く。生の `url.search` を `&` で分け、名前の一致する最初の組を読む。値に `%` の後が16進2桁でない
  ところがあればその組を飛ばす。`+` を空白にしてから `decodeURIComponent` し、例外なら `null`（UTF-8 でない）。NUL を含めば `null`。
- [ ] **Step 4:** PASS を確かめる。
- [ ] **Step 5: DB を使う失敗するテストを書く**（`tests/apiGallery.test.cjs`、`TYPLE_TEST_DATABASE_URL` がなければ skip）。
  テストごとにランダムな印（`crypto.randomUUID()`）を名前・分類に入れた行を `typle_shared_packs` に入れ、検索をその印で絞り、
  最後に `owner_id` で消す。行の `data` は `{ format: 'typle-pack', version: 1, pack, lists }`。確かめること：
  - `answerGallery` の200：印で検索すると、掲載中で隠されていないものだけが新しい順に出る。各項目のキーの順と値（`lists`・`words`・
    `added`・`updatedAt` の形 `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/`）、`sort=popular` は `add_count` の多い順。
  - 21件入れると1ページ目は20件で `more: true`、2ページ目は1件で `more: false`。
  - `%`・`_` を含む検索文字列はワイルドカードにならない（Go の `TestGalleryEscapesWildcards`）。
  - 分類なし・ラベルなしのパックは `description`・`category`・`tags` のキーを持たない（Go の `TestGalleryPackWithoutLabels`）。
  - `answerGalleryCategories`：印の付いた分類 `多い…` 2件・`少ない…` 1件が件数の順に出て、未掲載・非公開・空の分類は出ない。
  - DB が落ちているとき（`createPool('postgres://user:pass@127.0.0.1:1/none')`）と `open` が投げるとき、どちらも 503
    `{"error":"databaseUnavailable"}\n` と `X-Robots-Tag: noindex`・`Cache-Control: no-store`。
  - 400 の応答にも `X-Robots-Tag: noindex`・`Cache-Control: no-store`。
  - route の `POST`・`PUT`・`PATCH`・`DELETE`・`OPTIONS` が 405、`Allow: GET, HEAD`、`X-Robots-Tag: noindex`（2つの route とも）。
- [ ] **Step 6:** `TYPLE_TEST_DATABASE_URL=… node --test --test-isolation=none tests/apiGallery.test.cjs` → FAIL。
- [ ] **Step 7:** `readGallery`・`readGalleryCategories`・`answerGallery`・`answerGalleryCategories` と2つの `route.ts` を書く。
- [ ] **Step 8:** PASS。`npm run typecheck`・`npm run lint` が通る。
- [ ] **Step 9:** コミット `git commit -m "ギャラリーの一覧と分類を Route Handler で答える"`

### Task 3: 共有パックの読み取り（`/api/shared`）

**Files:**
- Create: `src/server/shared.ts`、`src/app/api/shared/route.ts`
- Test: `tests/apiShared.test.cjs`

**Interfaces:**
- Consumes: 段階1の応答と DB、Task 1 の `notForSearch`・`reportFailure`、`src/core/packFile.ts` の `decodePackFile(text: string): PackFile`。
- Produces（`src/server/shared.ts`）:
  - `encodeSharedPack(text: string): string` — `decodePackFile` で読み、Go の `PackFile.Encode` と同じ形にして
    `JSON.stringify(file, null, 2) + '\n'`。Go に合わせて、空文字の `description`・`category`、空の `tags`・`levels` を書かず、
    `writing` は `{ language }` だけにし、単語の空の `input_type` を書かない。読めなければ `decodePackFile` の `AppError` をそのまま投げる。
  - `readSharedPack(db: Pool, id: string): Promise<string | null>` — `id` が UUID の形（8-4-4-4-12 の16進）でなければ DB を読まずに `null`。
    `SELECT data::text FROM typle_shared_packs WHERE id = $1 AND hidden_at IS NULL`。行がなければ `null`、あれば `encodeSharedPack`。
  - `answerShared(request: Request, open: () => Pool): Promise<Response>` — `?id=` を読む（`URLSearchParams` でよい：UUID の形の検査で
    壊れた値は弾かれる）。`null` は 404 `sharedPackNotFound`。DB の失敗と読めない共有パックは `reportFailure(…, 'shared.read')` して 503。
- `route.ts` は Task 2 と同じ形で、`forGallery` の代わりに `notForSearch`。

- [ ] **Step 1: 失敗するテストを書く**（`tests/apiShared.test.cjs`）。確かめること：
  - `tests/fixtures/pack-file/*.json` の各 `file` について `encodeSharedPack(file) === file`。キーの順を逆にし、空白を詰めた
    `JSON.stringify(reversed)` を渡しても `file` に戻る。
  - `encodeSharedPack` に `pack.description: ''`・`pack.tags: []`・`levels: []`・`writing: { language: 'ja', extra: 1 }` を含む
    ファイルを渡すと、それらのキーがない（`writing` は `{"language":"ja"}`）。
  - DB（skip 可）：入れた行の id で 200、本文が `encodeSharedPack` の結果、`Content-Type: application/json; charset=utf-8`・
    `Cache-Control: no-store`・`X-Robots-Tag: noindex`、`Vary` なし。HEAD は本文なしで同じヘッダー。
  - 隠された行・ない id・UUID でない id（`abc`、空）は 404 `{"error":"sharedPackNotFound"}\n` と `X-Robots-Tag: noindex`・
    `Cache-Control: private, no-store`。
  - DB が落ちているときは 503 `databaseUnavailable`・`X-Robots-Tag: noindex`。
  - route の `POST`…`OPTIONS` は 405 と `X-Robots-Tag: noindex`。
- [ ] **Step 2:** `TYPLE_TEST_DATABASE_URL=… node --test --test-isolation=none tests/apiShared.test.cjs` → FAIL。
- [ ] **Step 3:** `src/server/shared.ts` と `src/app/api/shared/route.ts` を書く。
- [ ] **Step 4:** PASS。typecheck・lint が通る。
- [ ] **Step 5:** コミット `git commit -m "/api/shared を Route Handler で答える"`

### Task 4: 転送を切り替え、Go の公開の読み取りを消す

**Files:**
- Modify: `vercel.json`・`next.config.mjs` — `/api/shared` を消し、`/api/gallery` と `/api/gallery/:path*` を
  `/api/gallery/added` と `/api/gallery/reports` に置き換える（コメントの「Route Handler に移したパス」の例も直す）。
- Modify: `tests/backendPaths.test.cjs` — 段階1の `/api/health` のテストを、Next.js が答えるパスの一覧
  `['/api/health', '/api/gallery', '/api/gallery/categories', '/api/shared']` のそれぞれについて、転送になく `src/app<path>/route.ts`
  があることを確かめるテストに直す。先に直して FAIL を見てから、`vercel.json`・`next.config.mjs` を直す。
- Go を消す：`server/internal/web` の `gallery`・`galleryCategories`・`shared` のハンドラーと mux の登録、`Public`・`NoIndex`、
  それらだけが使う補助（`galleryQuery`・`checkGalleryQuery`・`queryPage`・`galleryPackJSON` など、まだ使われるものは残す）、
  `server/internal/store` の `Gallery`・`GalleryCategories`・`SharedPack` と、`web.Store` のそれらのメソッド、各 fake の同じメソッド、
  これらのテスト。`server/vercel` の `publicHandler`・`public` と、そのテスト。段階1で `vercel_test.go` の探り先にした
  `/api/gallery/categories` は、ログインの設定のある DB の部分（`/api/workspace` の未ログインの 401 など）に替え、
  ログインの設定なしで DB の部分を確かめていたテストは、その部分がなくなるので消す。
  `gofmt -l .` が空、`go vet ./...`・staticcheck・`go test ./...` が通るまで、使われなくなったものを消す。
- Modify: `tests/e2e/security-headers.spec.ts` — 一覧に `'/api/gallery'` と `'/api/shared?id=00000000-0000-0000-0000-000000000000'` を足す。
- Modify: `README.md`（「コードの構成」の `src/server` の行と Go の表から、移した3つのパスを書き換える）、`api/index.go`・
  `server/cmd/typle-web/main.go`・`server/vercel/vercel.go` のコメント。

- [ ] **Step 1:** `tests/backendPaths.test.cjs` を直して FAIL を見る → 転送を直して PASS。
- [ ] **Step 2:** Go を消し、`gofmt -l .`（空）・`go vet ./...`・`TYPLE_TEST_DATABASE_URL=… go test ./...` が通る。
- [ ] **Step 3:** `npm run build` のあと、`npx playwright test tests/e2e/security-headers.spec.ts tests/e2e/gallery.spec.ts tests/e2e/shares.spec.ts`
  が通る（ギャラリーと共有の画面が TS の答えで動く）。
- [ ] **Step 4:** README などを直す。`npm test`（DB あり）・typecheck・lint・knip が通る。
- [ ] **Step 5:** コミット `git commit -m "ギャラリーの読み取りと /api/shared の転送をやめ、Go の該当する処理を消す"`

### Task 5: 版と PR

- [ ] **Step 1:** `git tag` と `gh release list` で確かめ、`npm version patch --no-git-tag-version`（v2.46.2 の次は v2.46.3）。
- [ ] **Step 2:** `npm run verify` を最後まで通す（staticcheck と `gh` はサンドボックスの外で）。
- [ ] **Step 3:** push して PR を作る。タイトル `ギャラリーの読み取りと /api/shared を Go から Next.js の Route Handler に移す (v2.46.3)`。
  説明に、リリース後に確かめること（本番のギャラリーの画面が一覧・検索・分類・2ページ目を出す、共有リンクを開ける）を書く。

---

Sentry：Go は DB を開けなかったとき（`server/vercel` の `database()` が nil）はログだけで、クエリの失敗を Sentry に送っていた。
TS には「開く」段がないので、DB の失敗はすべて `reportFailure` で送る。報告が増えることがあるが、応答は変わらない。
`@sentry/nextjs` はリクエストの情報を足すことがあるが、この3つのパスのクエリには秘密がない（ログインの段階8では送る内容を見直す）。
