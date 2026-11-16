# Go から TS への移行・段階3（ギャラリーの書き込み）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/gallery/added` と `POST /api/gallery/reports` を Go から Route Handler に移し、ギャラリーをすべて TS で答える。

**Architecture:** ログインの設定（`AUTH_URL` と `AUTH_SECRET` から導く回数制限の鍵）を読む `settings.ts`、リクエストの確認（`Origin`・
`Content-Type`・JSON の本文）の `request.ts`、IP ごとの回数制限の `rateLimit.ts` を `src/server` に足す。2つの書き込みは
`galleryWrites.ts` の `answer…(request, open, settings)` に置き、`route.ts` は段階1・2と同じく呼ぶだけ。最後に転送から外し、Go の
該当する処理（`ratelimit.go`、`Keys.ClientMAC` など）を消す。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node:crypto`（HKDF・HMAC）、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階1・2の計画：`docs/superpowers/plans/2026-11-16-go-to-ts-stage1-health.md`・`…-stage2-public-reads.md`）

## Global Constraints

- 段階1・2の Global Constraints はそのまま（API は変えない、本文末尾の `\n`、相対 import、`src/server` は画面から import しない、
  SQL はそのまま書く、識別子とコメントは英語・文書とコミットは日本語、途中のコミットに版を付けない）。
- 2つのパスの応答は、エラー・405・204 を含めてすべて `forGallery`（`X-Robots-Tag: noindex`・`Cache-Control: no-store`）を通す。
- メソッド：`POST` だけ。`GET`・`HEAD`・`PUT`・`PATCH`・`DELETE`・`OPTIONS` は `405`・`Allow: POST`・`{"error":"methodNotAllowed"}\n`。
- 成功は `204`（本文なし）。
- ログインの設定：`AUTH_SECRET` と `AUTH_URL` がどちらも空でなく、`AUTH_URL` が http か https でホストのある URL のときだけ使える。
  使えなければ 503 `authUnavailable`（DB を開かない）。
- `Origin` の確認：`Authorization` ヘッダーがあれば（中身は見ない）通す。なければ `Origin` が `new URL(AUTH_URL).origin` と完全に一致すること。
  違えば 403 `forbiddenRequest`。
- 通報だけは、さらに `Content-Type` の `;` の前を空白で切ったものが、ちょうど `application/json`（大文字小文字も区別）であること。
  違えば 403 `forbiddenRequest`。
- 通報の本文：4096 バイトまでの JSON のオブジェクトで、メンバーはちょうど `id` と `reason` の2つ、どちらも空でない文字列。
  `reason` は `inappropriate`・`spam`・`personalInfo`・`other` のどれか。そうでなければ 400 `invalidReport`。
- 回数制限：1分の固定の窓で、`added` は60回、`reports` は10回まで（確認がすべて通った後に数える）。超えたら 429 `tooManyRequests` と
  `Retry-After`（窓の終わりまでの秒数を切り上げ、1以上）。数えるのは `typle_gallery_hits` で、10分より古い行はそのとき消す。
- 回数制限の鍵：`HKDF-SHA256(AUTH_SECRET, salt なし, info "typle gallery-rate-limit v1", 32 バイト)`。クライアントは
  `HMAC-SHA256(鍵, IP)` の先頭16バイト。Go と同じ値にする（ロールバックしても数え方が変わらないように）。
- IP：Vercel（`process.env.VERCEL === '1'`）では `X-Vercel-Forwarded-For`・`X-Forwarded-For`・`X-Real-Ip` の順に、カンマの前の最初の
  値を空白を除いて読み、IP として読めた最初のものを正規の形（IPv6 は小文字の RFC 5952、IPv4 射影は IPv4）で使う。どれもなければ
  `unknown` として数え、`reportFailure(…, 'gallery.limit.ip')` する。Vercel 以外ではヘッダーは信じず、すべて `local` という1つの
  クライアントとして数える。
- DB の失敗は 503 `databaseUnavailable`。報告の操作名は、数えるところが `gallery.limit`、追加数が `gallery.added`、通報が `gallery.report`。
- 追加数（`added`）：`?id=` が UUID の形で、掲載中かつ隠されていない共有パックなら `add_count` を1増やす。それ以外も同じ 204
  （どの共有が掲載中かを答えから分からないようにする）。
- 通報（`reports`）：掲載中かつ隠されていない共有パックなら `typle_gallery_reports` に1行入れて 204。そうでない（UUID でない・ない・
  掲載していない・隠されている・同時に消された外部キー違反 `23503`）なら 404 `notInGallery`。

## Review Focus

1. 回数制限の境目：60回目の追加は 204、61回目は 429。窓が変わればまた数えられる。→ Task 3 の DB テスト。
2. `Retry-After` の丸め：窓の終わりまで 29.5 秒なら 30、ちょうど 30 秒なら 30、0.2 秒・0 秒・過去なら 1。→ Task 3。
3. IP の読み取り：`X-Vercel-Forwarded-For` が読めなければ次のヘッダーへ進む、`2001:DB8::1` と `2001:db8::1` は同じクライアント、
   Vercel 以外では偽のヘッダーを無視する。→ Task 3。
4. 回数制限の鍵とクライアントの値が Go と同じ。→ Task 1 の fixture（Go で作った値を固定する）。
5. 他のサイトからの書き込み：`Origin` が違う・ない、`Content-Type` が `text/plain`（通報）は 403。アプリの `Authorization` があれば
   `Origin` なしでも通る。→ Task 4。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-gallery-writes`（最新の main から）。この計画をコミット：`git commit -m "Go から TS への移行の段階3の計画を書く"`

### Task 1: ログインの設定と、回数制限の鍵

**Files:**
- Create: `src/server/settings.ts`、`tests/fixtures/client-mac.json`
- Test: `tests/serverSettings.test.cjs`

**Interfaces:**
- Produces:
  - `type LoginSettings = { origin: string, rateLimitKey: Buffer, onVercel: boolean }`
  - `readLoginSettings(env: Record<string, string | undefined> = process.env): LoginSettings | null` — Global Constraints の条件を満たさなければ
    `null`。`origin` は `new URL(AUTH_URL).origin`、`onVercel` は `env.VERCEL === '1'`。
  - `clientMac(key: Buffer, ip: string): Buffer` — `HMAC-SHA256(key, ip)` の先頭16バイト。

- [ ] **Step 1: fixture を Go で作る。** `server/internal/session` に一時的なテスト（コミットしない）を書き、`NewKeys("typle-fixture-secret")` の
  `ClientMAC` を `203.0.113.1`・`2001:db8::1`・`unknown`・`local` について hex で出し、`tests/fixtures/client-mac.json` に
  `{ "secret": "typle-fixture-secret", "macs": { "<ip>": "<hex>" } }` として保存する。一時的なテストは消す。
- [ ] **Step 2: 失敗するテストを書く。**

```js
test('the rate limit key and client MAC are the Go backend\'s', () => {
  const { secret, macs } = require('./fixtures/client-mac.json')
  const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: 'https://typle.example' })
  for (const [ip, hex] of Object.entries(macs)) assert.equal(clientMac(settings.rateLimitKey, ip).toString('hex'), hex, ip)
})

test('the settings need a secret and an http or https AUTH_URL', () => {
  const ok = { AUTH_SECRET: 's', AUTH_URL: 'https://Typle.Example:443/api/auth' }
  assert.equal(readLoginSettings(ok).origin, 'https://typle.example')
  assert.equal(readLoginSettings({ ...ok, AUTH_URL: 'http://127.0.0.1:3101' }).origin, 'http://127.0.0.1:3101')
  assert.equal(readLoginSettings({ ...ok, VERCEL: '1' }).onVercel, true)
  for (const env of [{ ...ok, AUTH_SECRET: '' }, { ...ok, AUTH_URL: '' }, { ...ok, AUTH_URL: 'ftp://x' }, { ...ok, AUTH_URL: 'not a url' }, { AUTH_URL: ok.AUTH_URL }]) {
    assert.equal(readLoginSettings(env), null, JSON.stringify(env))
  }
})
```

- [ ] **Step 3:** `node --test --test-isolation=none tests/serverSettings.test.cjs` → FAIL（モジュールがない）。
- [ ] **Step 4:** `src/server/settings.ts` を書く（`crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'typle gallery-rate-limit v1', 32)`）。
- [ ] **Step 5:** PASS。コミット `git commit -m "ログインの設定と、ギャラリーの回数制限の鍵を TS で読む"`

### Task 2: リクエストの確認

**Files:**
- Create: `src/server/request.ts`
- Test: `tests/serverRequest.test.cjs`

**Interfaces:**
- Produces:
  - `fromAppOrOrigin(request: Request, origin: string): boolean`
  - `jsonContent(request: Request): boolean`
  - `readStringFields(request: Request, limit: number, names: readonly string[]): Promise<Record<string, string> | null>` — 本文を
    `limit` バイトまで読み（超えたら `null`、本文なしも `null`）、JSON のオブジェクトで、メンバーの数が `names` と同じで、それぞれが
    空でない文字列のときだけ返す。同じ名前が重なれば最後のものを使う（`JSON.parse` と Go の `json.Unmarshal` で同じ）。

- [ ] **Step 1: 失敗するテストを書く**（Go の `TestGalleryReport` の本文の一覧を写す）

```js
const post = (body, headers = {}) => new Request('http://localhost/api/gallery/reports', { method: 'POST', body, headers })
const id = '0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d'

test('the report body has exactly a non-empty id and reason', async () => {
  assert.deepEqual(await readStringFields(post(`{"id":"${id}","reason":"spam"}`), 4096, ['id', 'reason']), { id, reason: 'spam' })
  for (const body of [`{"id":"${id}"}`, '{"reason":"spam"}', `{"id":"","reason":"spam"}`, `{"id":"${id}","reason":null}`,
    `{"id":"${id}","reason":"spam","x":1}`, '[]', 'x', '{"id":1,"reason":"spam"}', '', 'null']) {
    assert.equal(await readStringFields(post(body), 4096, ['id', 'reason']), null, body)
  }
  assert.equal(await readStringFields(post(`{"id":"${'a'.repeat(5000)}","reason":"spam"}`), 4096, ['id', 'reason']), null)
})

test('only the app or the app\'s own origin may write', () => {
  const origin = 'https://typle.example'
  assert.equal(fromAppOrOrigin(post('', { Origin: origin }), origin), true)
  assert.equal(fromAppOrOrigin(post('', { Origin: 'https://evil.example' }), origin), false)
  assert.equal(fromAppOrOrigin(post(''), origin), false)
  assert.equal(fromAppOrOrigin(post('', { Authorization: 'Bearer x' }), origin), true)
})

test('the body must be declared as JSON, exactly', () => {
  assert.equal(jsonContent(post('', { 'Content-Type': 'application/json; charset=utf-8' })), true)
  assert.equal(jsonContent(post('', { 'Content-Type': ' application/json ' })), true)
  for (const type of ['text/plain', 'Application/JSON', '']) assert.equal(jsonContent(post('', type ? { 'Content-Type': type } : {})), false, type)
})
```

- [ ] **Step 2:** FAIL を確かめる → **Step 3:** `src/server/request.ts` を書く（本文は `request.arrayBuffer()` を読んでから長さを見る；
  ストリームを途中で止める必要はない）→ **Step 4:** PASS → **Step 5:** コミット `git commit -m "書き込みのリクエストの確認を TS に移す"`

### Task 3: IP ごとの回数制限

**Files:**
- Create: `src/server/rateLimit.ts`
- Test: `tests/serverRateLimit.test.cjs`（DB を使う部分は skip 可）

**Interfaces:**
- Consumes: Task 1 の `LoginSettings`・`clientMac`、段階2の `reportFailure`・`forGallery`・`refuse`。
- Produces:
  - `clientIp(request: Request, onVercel: boolean): { ip: string, known: boolean }` — Global Constraints の規則。`canonicalIp` は
    IPv4 は `net.isIPv4`、IPv6 は `new URL('http://[' + text + ']').hostname` から角括弧を除いたもので正規化し、`::ffff:` の射影は IPv4 に戻す。
  - `retryAfter(windowEnd: Date, now: Date): number`
  - `countHit(db: Pool, action: string, client: Buffer): Promise<{ hits: number, windowEnd: Date }>` — 1つのトランザクションで
    `DELETE FROM typle_gallery_hits WHERE window_start < now() - interval '10 minutes'` と
    `INSERT … VALUES ($1, $2, date_trunc('minute', now()), 1) ON CONFLICT (action, client, window_start) DO UPDATE SET hits = typle_gallery_hits.hits + 1 RETURNING hits, window_start`。
    `windowEnd` は `window_start` の1分後。
  - `overLimit(request: Request, db: Pool, settings: LoginSettings, action: 'added' | 'reports', limit: number): Promise<Response | null>`
    — 超えていれば 429 の `forGallery` 応答（`Retry-After` 付き）、超えていなければ `null`。数えるのに失敗したら投げる（呼ぶ側が
    `gallery.limit` で報告して 503）。IP が分からなければ `reportFailure(request, new Error('no client IP in the forwarding headers'), 'gallery.limit.ip')` してから数える。

- [ ] **Step 1: 失敗するテストを書く。**
  - `clientIp`：Go の `TestClientIP` の Vercel の8つの場合をそのまま写す（期待値も同じ）。Vercel 以外は、偽のヘッダーがあっても
    `{ ip: 'local', known: true }`。加えて `::ffff:203.0.113.1` は `203.0.113.1`。
  - `retryAfter`：Go の `TestRetryAfter` の5つ（`now = 2026-11-02T12:00:30.500Z`、29.5秒後→30、30秒後→30、0.2秒後→1、今→1、1分前→1）。
  - DB（skip 可）：ランダムな `action`（`test-${randomUUID()}`）で `countHit` を3回呼ぶと `hits` が 1・2・3、`windowEnd` は分の境目。
    `overLimit` を `limit: 2` で3回呼ぶと、3回目だけ 429・`Retry-After` は 1〜60・`X-Robots-Tag: noindex`。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS → **Step 5:** コミット `git commit -m "ギャラリーの IP ごとの回数制限を TS に移す"`

### Task 4: 追加数と通報の Route Handler

**Files:**
- Create: `src/server/galleryWrites.ts`、`src/app/api/gallery/added/route.ts`、`src/app/api/gallery/reports/route.ts`
- Modify: `src/server/shared.ts`（`isLinkId` を export して使い回す）
- Test: `tests/apiGalleryWrites.test.cjs`

**Interfaces:**
- Consumes: Task 1〜3、段階2の `forGallery`・`reportFailure`・`isLinkId`。
- Produces:
  - `answerGalleryAdded(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response>`
  - `answerGalleryReport(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response>`
  - 順番（Go と同じ）：設定がなければ 503 `authUnavailable` → `fromAppOrOrigin`（通報は `jsonContent` も）が通らなければ 403 →
    （通報は）本文と `reason` を確かめて 400 `invalidReport` → `overLimit` → DB に書く → 204。
- `route.ts` は `POST` だけを `answer…(request, pool)` に渡し、ほかのメソッドは `forGallery(methodNotAllowed(['POST']))`。

- [ ] **Step 1: 失敗するテストを書く**（DB を使う。テストごとにランダムな owner の掲載中の共有を入れ、`X-Vercel-Forwarded-For` に
  ランダムな IP を入れ `onVercel: true` の設定で呼ぶので、ほかのテストの回数と混ざらない）。確かめること：
  - 追加：掲載中のパックで 204・本文なし・`add_count` が1増える。掲載していない・隠された・UUID でない id も 204 で、数は変わらない。
    同じ IP の61回目は 429（`added` の上限60）。`Origin` が違えば 403 `forbiddenRequest`、`Authorization: Bearer x` なら `Origin` なしで 204。
    設定が `null` なら 503 `authUnavailable`。
  - 通報：正しい本文で 204、`typle_gallery_reports` に `reason` 付きで1行。Task 2 の誤った本文はすべて 400 `invalidReport`、`reason: "bad"`
    も 400。`Content-Type: text/plain` は 403。掲載していない・隠された・ない id は 404 `notInGallery`。同じ IP の11回目は 429。
  - DB が落ちていれば（`createPool('postgres://user:pass@127.0.0.1:1/none')`）どちらも 503 `databaseUnavailable`。
  - すべての応答に `X-Robots-Tag: noindex`・`Cache-Control: no-store`。
  - 2つの route の `GET`・`HEAD`・`PUT`・`PATCH`・`DELETE`・`OPTIONS` は 405 と `Allow: POST`。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS・typecheck・lint → **Step 5:** コミット `git commit -m "ギャラリーの追加数と通報を Route Handler で受け付ける"`

### Task 5: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` から `/api/gallery/added` と `/api/gallery/reports` を消す。`tests/backendPaths.test.cjs` の `nextRoutes`
  に2つを足す（先に足して FAIL を見る）。
- Go を消す：`galleryAdded`・`countAdded`・`galleryReport`・`reportPack`・`readStringFields`・`maxIDBodyBytes`・`galleryHeaders`・`noStore`
  と mux の登録、`ratelimit.go`（`clientIP`・`overLimit`・`retryAfter`・定数）、`Config.OnVercel` とそれを設定するところ、
  `store` の `CountAdded`・`Report`・`ReportReasons`・`CountGalleryHit`（`ratelimit.go`）と `web.Store` のメソッド、各 fake、
  `session.Keys` の回数制限の鍵と `ClientMAC`、これらのテスト。`isUUID` など、まだ使われるものは残す。`gofmt -l .`（空）・
  `go vet ./...`・staticcheck・`go test ./...` が通るまで、使われなくなったものを消す。
- `README.md` の「ギャラリーのレート制限」の節と、`src/server`・Go の表を今の形に直す。`api/index.go`・`server/cmd/typle-web/main.go`・
  `server/vercel/vercel.go` のコメントからギャラリーを消す。
- `npm run build` のあと、`tests/e2e/gallery.spec.ts`・`tests/e2e/security-headers.spec.ts` を流す（ブラウザーを使うのでサンドボックスの外で）。
- コミット `git commit -m "ギャラリーの書き込みの転送をやめ、Go の該当する処理を消す"`

### Task 6: 版と PR

- [ ] `git tag` と `gh release list` で確かめて `npm version patch --no-git-tag-version`（v2.46.4）。`npm run verify` を最後まで通す
  （staticcheck・`gh`・E2E はサンドボックスの外）。push して PR を作る。タイトル
  `ギャラリーの追加数と通報を Go から Next.js の Route Handler に移す (v2.46.4)`。リリース後に確かめること：ギャラリーのパックを
  「追加」すると追加数が増える、通報できる、管理画面に通報が出る。

---

Go と変わる点（PR と設計書に書く）：Go はログインの設定がないときと DB が開けないときの 503 に `X-Robots-Tag`・`no-store` を
付けていなかった（`server/vercel` の `Unavailable`）。TS ではすべての応答に付ける。また Go は DB を先に開いてから `Origin` を見たので、
DB が落ちていると他のサイトからの書き込みにも 503 を返したが、TS は先に 403 を返す。どちらも正しい書き込みの答えは変わらない。
