# Go から TS への移行・段階1（土台と /api/health）Implementation Plan

> v2.50.0 で `src/core` は `src/lib` に（公式パックは `src/lib/packs`）、`src/lib` の React のフック（`use*`）は `src/hooks` に移りました。この文書のパスは書いた当時のものです。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/health` を Go から Next.js の Route Handler に移し、以降の段階が使う土台（応答の共通処理と DB の接続）を作る。

**Architecture:** `src/server/` に Route Handler から使う小さなモジュール（`response.ts`・`database.ts`・`health.ts`）を置き、
`src/app/api/health/route.ts` はそれを呼ぶだけにする。`/api/health` を `vercel.json` と `next.config.mjs` の転送から外し、
Go の health のハンドラーとテストを消す。セキュリティヘッダー4つは `next.config.mjs` の `headers` が Route Handler にも
付けるので、コードでは付けない（E2E で確かめる）。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node --test`（`tests/register.cjs` で TS を読む）、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`

## Global Constraints

- API は変えない：`GET /api/health` は DB に5秒以内に `SELECT 1` が通れば `200` と本文 `{"status":"ok"}\n`、通らなければ
  `503` と `{"error":"databaseUnavailable"}\n`。`HEAD` は同じ状態コードとヘッダーで本文なし。それ以外のメソッドは
  `405`、`Allow: GET, HEAD`、本文 `{"error":"methodNotAllowed"}\n`。
- JSON の応答はすべて `Content-Type: application/json; charset=utf-8`・`Cache-Control: private, no-store`・`Vary: Cookie`。
  本文は Go の `json.Encoder` と同じく末尾に `\n` を1つ付ける。
- セキュリティヘッダー：`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`・
  `X-Frame-Options: DENY`・`X-Content-Type-Options: nosniff`・`Referrer-Policy: strict-origin-when-cross-origin`。
- DB の接続先は `DATABASE_URL`、なければ `POSTGRES_URL`。`pg.Pool` の `max` は 5、`idleTimeoutMillis` は 30000。
- `src/server/` と `route.ts` の import は相対パスで書く（`tests/register.cjs` は `@/` を解決しない）。`src/server/` は
  `src/core` を import してよいが、`src/core` と画面（`src/components`・`src/app` のページ）は `src/server/` を import しない。
- Route Handler を書く前に `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` を読む
  （AGENTS.md）。`route.ts` は Next.js が認めるもの（HTTP メソッドの関数とルートの設定）だけを export する。
- 書き方：SQL はそのまま書く。ORM・独自の抽象・ラッパーの重ね掛けは入れない。コメントと識別子は英語、ドキュメントと
  コミットメッセージは日本語。PR の途中のコミットには `(vX.Y.Z)` を付けない。

## Review Focus

1. DB が止まっている・接続先が設定されていない：`/api/health` は例外で 500 にならず、503 `databaseUnavailable` を返す。
   → Task 3 のテスト「接続先がないと 503」。
2. DB が応答しない（接続はできるが返事がない）：5秒で打ち切って 503 を返す。リクエストがいつまでも終わらないのは失敗。
   → Task 2 のテスト「時間切れで reject」。
3. `HEAD /api/health`：本文なし、`GET` と同じヘッダー。デプロイの確認やモニタリングが HEAD を使う。→ Task 3。
4. 手元の E2E：Playwright は Go のサーバーの起動を `/api/health` で待っている。Go から health を消すと E2E が始まらない。
   → Task 4 で待ち先を変える。
5. 本番で `vercel.json` の転送を外し忘れる・残し忘れる：`/api/health` だけ TS、ほかは Go に届く。→ Task 4 の
   `tests/backendPaths.test.cjs` と `npm run check:production`。

---

### Task 0: 作業ブランチ

- [ ] **Step 1:** `git switch -c go-to-ts-health`（main から）。`git status` が clean であること。
- [ ] **Step 2:** 設計書と、この計画をコミットする。

```bash
git add docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md docs/superpowers/plans/2026-11-16-go-to-ts-stage1-health.md
git commit -m "Go のバックエンドを TS に移す設計と、段階1の計画を書く"
```

### Task 1: 応答の共通処理

**Files:**
- Create: `src/server/response.ts`
- Test: `tests/serverResponse.test.cjs`

**Interfaces:**
- Produces:
  - `reply(status: number, value: unknown): Response` — JSON の応答（ヘッダーは Global Constraints のとおり、本文は `JSON.stringify(value) + '\n'`）。
  - `refuse(status: number, key: string): Response` — `reply(status, { error: key })`。
  - `methodNotAllowed(allow: readonly string[]): Response` — `refuse(405, 'methodNotAllowed')` に `Allow: allow.join(', ')` を足す。
  - `withoutBody(response: Response): Response` — 同じ状態コードとヘッダーで本文のない応答（HEAD 用）。

- [ ] **Step 1: 失敗するテストを書く**

```js
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reply, refuse, methodNotAllowed, withoutBody } = require('../src/server/response.ts')

test('reply answers JSON that no cache keeps', async () => {
  const response = reply(200, { status: 'ok' })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '{"status":"ok"}\n')
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('refuse answers the error key', async () => {
  const response = refuse(503, 'databaseUnavailable')
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
})

test('methodNotAllowed lists the allowed methods', async () => {
  const response = methodNotAllowed(['GET', 'HEAD'])
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, HEAD')
  assert.equal(await response.text(), '{"error":"methodNotAllowed"}\n')
})

test('withoutBody keeps the status and headers', async () => {
  const response = withoutBody(reply(503, { error: 'databaseUnavailable' }))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(await response.text(), '')
})
```

- [ ] **Step 2:** `node --test --test-isolation=none tests/serverResponse.test.cjs` → FAIL（`Cannot find module '../src/server/response.ts'`）。
- [ ] **Step 3:** `src/server/response.ts` に上の4つを書く（標準の `Response` だけを使い、`next/server` は使わない）。
- [ ] **Step 4:** 同じコマンドで PASS。
- [ ] **Step 5:** コミット `git commit -m "Route Handler の JSON の応答を作る src/server/response.ts を足す"`

### Task 2: DB の接続

**Files:**
- Create: `src/server/database.ts`
- Modify: `scripts/verify.cjs`（`unit tests` の段に `env: { TYPLE_TEST_DATABASE_URL: testDatabaseUrl }`）
- Test: `tests/serverDatabase.test.cjs`

**Interfaces:**
- Produces:
  - `createPool(url: string): Pool` — `new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 })`。
  - `pool(): Pool` — `DATABASE_URL ?? POSTGRES_URL` から1度だけ作って使い回す。どちらもなければ `Error('DATABASE_URL is not set')` を投げる。
  - `ping(db: Pool, timeoutMs = 5_000): Promise<void>` — `SELECT 1`。`timeoutMs` 以内に終わらなければ reject。

- [ ] **Step 1: 失敗するテストを書く**

```js
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { createPool, ping } = require('../src/server/database.ts')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

test('ping succeeds on the database', database, async () => {
  const db = createPool(url)
  try { await ping(db) } finally { await db.end() }
})

test('ping fails when nothing listens', async () => {
  const db = createPool('postgres://user:pass@127.0.0.1:1/none')
  try { await assert.rejects(ping(db)) } finally { await db.end() }
})

// A server that accepts the connection and never answers: ping must give up on its own.
test('ping gives up after the timeout', async () => {
  const server = net.createServer(() => {}).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const db = createPool(`postgres://user:pass@127.0.0.1:${server.address().port}/none`)
  const started = Date.now()
  try {
    await assert.rejects(ping(db, 200))
    assert.ok(Date.now() - started < 2_000)
  } finally {
    server.close()
    await db.end().catch(() => {})
  }
})
```

- [ ] **Step 2:** `TYPLE_TEST_DATABASE_URL=<.env.local の DATABASE_URL> node --test --test-isolation=none tests/serverDatabase.test.cjs` → FAIL（モジュールがない）。
- [ ] **Step 3:** `src/server/database.ts` を書く。時間切れは `pool.connect()` の待ちも含めて `timeoutMs` で打ち切る
  （`connectionTimeoutMillis` だけでは接続後の無応答を止められないので、`Promise.race` とタイマーで切る）。
  接続を取れたら必ず `release()` し、時間切れのときは `release(true)` で捨てる。
- [ ] **Step 4:** 同じコマンドで PASS（3件）。`TYPLE_TEST_DATABASE_URL` なしでは1件目が skip になり、残り2件は PASS。
- [ ] **Step 5:** `scripts/verify.cjs` の `unit tests` の段に `env: { TYPLE_TEST_DATABASE_URL: testDatabaseUrl }` を足す。
- [ ] **Step 6:** コミット `git commit -m "DB の接続と疎通の確認を src/server/database.ts に足す"`

### Task 3: `/api/health` の Route Handler

**Files:**
- Create: `src/server/health.ts`、`src/app/api/health/route.ts`
- Test: `tests/apiHealth.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `reply`・`refuse`・`methodNotAllowed`・`withoutBody`、Task 2 の `pool`・`ping`。
- Produces:
  - `checkHealth(open: () => Pool): Promise<Response>` — `open()` が投げても `ping` が reject しても、`console.error` に
    `GET /api/health: <error>` を出して `refuse(503, 'databaseUnavailable')`。通れば `reply(200, { status: 'ok' })`。
  - `route.ts`：`GET = () => checkHealth(pool)`、`HEAD = async () => withoutBody(await checkHealth(pool))`、
    `POST`・`PUT`・`PATCH`・`DELETE` は `methodNotAllowed(['GET', 'HEAD'])`。`export const dynamic = 'force-dynamic'`
    （キャッシュさせない。route.md で 16.4 の書き方を確かめ、違えばそちらに合わせる）。

- [ ] **Step 1: 失敗するテストを書く**

```js
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPool } = require('../src/server/database.ts')
const { checkHealth } = require('../src/server/health.ts')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

test('200 when the database answers', database, async () => {
  const db = createPool(url)
  try {
    const response = await checkHealth(() => db)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '{"status":"ok"}\n')
  } finally { await db.end() }
})

test('503 when the database is down', async () => {
  const db = createPool('postgres://user:pass@127.0.0.1:1/none')
  try {
    const response = await checkHealth(() => db)
    assert.equal(response.status, 503)
    assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  } finally { await db.end() }
})

test('503 when no database is set', async () => {
  const response = await checkHealth(() => { throw new Error('DATABASE_URL is not set') })
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
})

test('the route answers other methods with 405', async () => {
  const route = require('../src/app/api/health/route.ts')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'GET, HEAD', method)
  }
})
```

- [ ] **Step 2:** `node --test --test-isolation=none tests/apiHealth.test.cjs` → FAIL（モジュールがない）。
- [ ] **Step 3:** `src/server/health.ts` と `src/app/api/health/route.ts` を書く。
- [ ] **Step 4:** Task 2 と同じく `TYPLE_TEST_DATABASE_URL` を付けて PASS（4件）。
- [ ] **Step 5:** `npm run typecheck` と `npm run lint` が通る。
- [ ] **Step 6:** コミット `git commit -m "/api/health を Route Handler で答える"`

### Task 4: 転送を切り替え、Go の health を消す

**Files:**
- Modify: `vercel.json`（`rewrites` から `/api/health` を消す）、`next.config.mjs`（`beforeFiles` から `'/api/health'` を消し、
  直前のコメントを「Go が答えるパス」に合わせる）
- Modify: `tests/backendPaths.test.cjs`（`routes.includes('/api/health')` の確認を `/api/workspace` に変え、
  「`/api/health` はどの転送にもない」テストを足す）
- Modify: `playwright.config.ts:40`（Go のサーバーの起動を待つ URL を `http://127.0.0.1:8081/api/auth/session` にし、
  28行目のコメントから `/api/health` を消す）
- Modify: `tests/e2e/security-headers.spec.ts`（`for` の一覧に `'/api/health'` を足し、冒頭のコメントを直す）
- Modify: `server/internal/web/web.go`（`mux.HandleFunc("/api/health", ...)` を消す）、`server/internal/web/health.go`（消す）、
  `server/internal/web/health_test.go`（health のテストを消す。`fakeStore`・`get`・`TestNotFound` はほかのテストが使うので、
  使われているものは残す）、`server/vercel/vercel.go`（health の枝と `Health` の組み立てを消し、`/api/health` は
  ほかのパスと同じ扱いで 404 になる）、`server/cmd/typle-web/main.go`（コメントとメッセージから `/api/health` を消す）
- Modify: `scripts/check-production.cjs:41`（説明を `the Route Handler reaches the production DB` に）
- Modify: `README.md`（71・127・130・148行目付近の `/api/health` の記述と「Next.js の `/api` は使いません」を、
  `/api/health` は `src/app/api/health/route.ts`、それ以外は Go、という今の状態に書き換え、`src/server/` を
  「コードの構成」の表に足す）、`.env.example:20`、`docs/release-workflow.md:73`、`CHANGELOG.md`（新しい版の項）

- [ ] **Step 1:** `tests/backendPaths.test.cjs` に `test('/api/health is answered by Next.js, not forwarded', ...)`
  を足す：`vercelSources` にも `nextSources()` にも `/api/health` を覆うもの（`covers`）がないこと。
  `node --test tests/backendPaths.test.cjs` → FAIL。
- [ ] **Step 2:** `vercel.json`・`next.config.mjs`・`tests/backendPaths.test.cjs` の既存の確認を直す → PASS。
- [ ] **Step 3:** Go の health を消す（上の Files のとおり）。`gofmt -l .` が空、`go vet ./...` と
  `TYPLE_TEST_DATABASE_URL=… go test ./...` が通る。
- [ ] **Step 4:** `playwright.config.ts` と `tests/e2e/security-headers.spec.ts` を直し、
  `npx playwright test tests/e2e/security-headers.spec.ts` が通る（`/api/health` にも4つのヘッダーが付く）。
- [ ] **Step 5:** `scripts/check-production.cjs` と README などのドキュメントを直す。
- [ ] **Step 6:** コミット `git commit -m "/api/health の転送をやめ、Go の health を消す"`

### Task 5: 版と PR

- [ ] **Step 1:** `git tag` と `gh release list` で使われていない版を確かめ、`npm version patch --no-git-tag-version`
  （v2.46.1 なら v2.46.2。取られていればもう1つ上げる）。CHANGELOG の項の版をそろえる。
- [ ] **Step 2:** `npm run verify` を最後まで通す（Docker の PostgreSQL・Go 1.25・Node.js 24 が要る）。
- [ ] **Step 3:** コミットして push し、PR を作る。タイトルは `/api/health を Go から Next.js の Route Handler に移す (vX.Y.Z)`。
  説明に、リリース後に確かめること（`npm run check:production` が通る、両ドメインの `GET /api/health` が 200）と、
  ほかのパスはまだ Go が答えることを書く。

---

段階2以降（ギャラリーの読み取り → … → 片付け）は、この PR の書き方を持ち主が確かめてから、段階ごとに別の計画を書く。
設計書の「段階1」にあった Sentry の土台は、Go の health が Sentry に送っていない（ログだけ）ので、ここでは作らず、
最初に Sentry へ送るエンドポイントの段階で作る。
