# Go から TS への移行・段階4と5（ログインの読み取りと /api/shares）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログインの Cookie とアプリのトークンを TS で読めるようにし、それを使う最初のエンドポイント `/api/shares`（共有の一覧・作成・停止）を Go から移す。

**Architecture:** 設計書の段階4（セッションの読み取り）と段階5（`/api/shares`）を1つの PR にする。セッションの読み取りだけでは使う場所がなく、
knip が使われないコードとして止めるため。`src/server/session.ts` が Go の `server/internal/session` と同じ鍵・同じ形式の Cookie と
トークンを開き、`src/server/account.ts` がログインとすべての端末からのログアウトを確かめる。`src/server/shares.ts` が共有を読み書きし、
保存データの読み取りとパックのファイルの書き出しは `src/core` の `decodeDocument`・`followed`・`encodePackFile` を使う。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node:crypto`、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（前の段階の計画：`docs/superpowers/plans/2026-11-16-go-to-ts-stage{1-health,2-public-reads,3-gallery-writes}.md`）

## Global Constraints

- 段階1〜3の Global Constraints はそのまま（API は変えない、本文末尾の `\n`、相対 import、`src/server` は画面から import しない、SQL はそのまま、
  識別子とコメントは英語・文書とコミットは日本語、途中のコミットに版を付けない）。
- **Go と TS が互いのセッションを読めること**（設計書の「失敗とみなすこと」）。鍵は `HKDF-SHA256(AUTH_SECRET, salt なし, info, 32)` で、
  Cookie は info `typle session v1`、アプリのトークンは `typle app session v1`。値は `base64url(JSON) + "." + base64url(HMAC-SHA256(鍵, base64url(JSON) の文字列))`
  （パディングなし）。JSON は `{"sub","name","image","iat","exp"}`（`iat`・`exp` は Unix 秒の整数）。
- セッションを開く条件（Go の `openSession`）：`.` で2つに分かれる、署名が base64url の厳密な形（パディングなし、`[A-Za-z0-9_-]` だけ、
  使われないビットが0）で HMAC と一致する（`timingSafeEqual`）、本文も厳密な base64url で JSON のオブジェクト、`sub`・`name`・`image` が文字列、
  `iat`・`exp` が整数、`now < exp`、`sub` が `^(github:\d+|ffpf:[a-z0-9]{1,64})$`。
- Cookie の名前は `AUTH_URL` が https なら `__Host-typle-session`、http なら `typle-session`。
- ログインの決め方（Go の `owner`）：`Authorization` ヘッダーが空でなければトークンだけで決める（`Bearer ` の後が空でなく、空白・タブを含まないこと。
  開けなければ未ログイン。Cookie は見ない）。なければ Cookie。
- すべての端末からのログアウト（Go の `revoked`）：`SELECT revoked_at FROM typle_session_revocations WHERE owner_id = $1` があり、
  セッションの `iat`（秒）が `revoked_at` 以下なら取り消し済み。取り消し済みは 401 `loginRequired` で、ブラウザー（`Authorization` なし）なら
  Cookie を消す `Set-Cookie: <名前>=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`（http なら `Secure` なし）。読めなければ
  503 `databaseUnavailable`（報告は `session.check`）。
- `/api/shares` のメソッド：`GET`・`HEAD`（一覧）・`PUT`（共有・再コピー）・`DELETE`（停止）。ほかは 405、`Allow: GET, HEAD, PUT, DELETE`。
  `/api/shares` の応答に `X-Robots-Tag` は付けない（Go と同じ）。
- 204 は `Cache-Control: private, no-store`・`Vary: Cookie`（Go の `noContent`）。
- 共有の JSON：`{"id","packId","name","updatedAt","listed","hidden"}` の順。一覧は `{"shares":[…]}`（`updated_at DESC, id` の順）。
- `PUT`：`fromAppOrOrigin` と `jsonContent`（403 `forbiddenRequest`）→ ログイン → 本文（4096 バイトまで、`packId` は空でない文字列、
  `listed` は省略か真偽値（`null` は不可）、ほかのメンバーなし。違えば 400 `invalidWorkspace`）→ トランザクションで
  `SELECT pg_advisory_xact_lock(hashtext('typle_workspaces:' || $1))`、`SELECT lists::text, packs::text, devices::text FROM typle_workspaces WHERE owner_id = $1 FOR UPDATE`
  （行がなければ空のワークスペース）→ パックのファイルを書き出す（パックがなければ 404 `packNotFound`、1 MiB（1048576 バイト）を超えれば
  400 `invalidWorkspace`）→ `listed` があれば `SELECT hidden_at IS NOT NULL FROM typle_shared_packs WHERE owner_id = $1 AND pack_id = $2 FOR UPDATE`
  が真なら 409 `sharedPackHidden` → Go と同じ `INSERT … ON CONFLICT … RETURNING` → 200 と共有の JSON。DB などの失敗は 503 `workspaceSaveFailed`（報告は `shares.write`）。
- `DELETE ?pack=`：`fromAppOrOrigin`（403）→ ログイン → `pack` が空なら 400 `invalidWorkspace` → `DELETE` → 204（共有していなくても 204）。
  失敗は 503 `workspaceSaveFailed`（`shares.write`）。
- `GET`：ログイン → 一覧。失敗は 503 `databaseUnavailable`（`shares.read`）。
- Go の保存（段階6まで Go に残る）と同じ持ち主のロック（`pg_advisory_xact_lock` の式と、`typle_workspaces` の `FOR UPDATE`）を使い、
  保存がパックを消すのと共有が同時に起きても、消えたパックの共有が残らないようにする。

## Review Focus

1. Go が作った Cookie とトークンを TS が開ける（名前に U+2028・`<>&`・絵文字、FFPF の `sub`）。期限切れ・別の種類の鍵（トークンを Cookie として）・
   署名の書き換え・パディング付き・本文の書き換えは開けない。→ Task 1（Go で作った fixture）。
2. すべての端末からのログアウトの後に、それ以前のログインの Cookie は 401 になり、Cookie が消される。同じ秒のログインも取り消し済み。→ Task 2。
3. 共有したパックのファイルが Go の `EncodePackFile` と1バイトも違わない（公式パックを追いかけているパック、ラベル・難易度・手書きの印・入力の種類のあるリスト）。
   → Task 3（Go で作った fixture）。
4. 隠されたパックの掲載の切り替えは 409、`listed` なしの再コピーは通る。掲載の時刻は再掲載で変わらない。→ Task 4。
5. 他のサイトからの書き込み（`Origin` が違う・ない、`text/plain`）は 403。アプリの `Authorization` で `Origin` なしでも通る。→ Task 4。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-sessions-shares`（最新の main から）。この計画をコミット：`git commit -m "Go から TS への移行の段階4と5の計画を書く"`

### Task 1: セッションを開く

**Files:**
- Create: `src/server/session.ts`、`tests/fixtures/sessions.json`
- Modify: `src/server/settings.ts`（`LoginSettings` に `sessionKey: Buffer`・`appKey: Buffer`・`secure: boolean` を足す。`secure` は `AUTH_URL` が https）
- Test: `tests/serverSession.test.cjs`

**Interfaces:**
- Produces:
  - `type Session = { sub: string, name: string, image: string, issuedAt: number, expires: number }`（秒）
  - `openSession(key: Buffer, value: string, now: number = Date.now() / 1000): Session | null`
  - `sessionCookieName(secure: boolean): string`

- [ ] **Step 1: fixture を Go で作る。** `server/internal/session` に一時的なテスト（コミットしない）を書き、`NewKeys("typle-fixture-secret")` で
  `Seal` と `SealApp` した値を `tests/fixtures/sessions.json` に保存する。`exp` は 4102444800（2100年）、`iat` は 1790000000。入れるもの：
  `github:1`（名前 `Taro`）、`ffpf:abc123`（名前に `<a&b>`・U+2028・絵文字）、期限切れ（`exp` 1000）、`sub` が `x:1`、それぞれの Cookie とトークン。
  形は `{ "secret", "now", "cookies": [{ "value", "session": {sub,name,image,iat,exp} | null }], "tokens": [...] }`。一時的なテストは消す。
- [ ] **Step 2: 失敗するテストを書く。** fixture のすべてについて、Cookie は `sessionKey`、トークンは `appKey` で開くと `session` と一致する（`null` は開けない）。
  加えて、トークンを `sessionKey` で開くと `null`、署名の最後の文字を変えると `null`、本文の1文字を変えると `null`、署名に `=` を付けると `null`、
  `.` のない値・空文字は `null`。`sessionCookieName(true)` は `__Host-typle-session`、`false` は `typle-session`。
- [ ] **Step 3:** FAIL を確かめる → **Step 4:** 実装（厳密な base64url は、正規表現で文字を確かめ、`Buffer.from(…, 'base64url').toString('base64url')` が元と同じことで確かめる）
  → **Step 5:** PASS → **Step 6:** コミット `git commit -m "Go と同じログインの Cookie とトークンを TS で開く"`

### Task 2: ログインの確認

**Files:**
- Create: `src/server/account.ts`
- Test: `tests/serverAccount.test.cjs`（DB を使う部分は skip 可）

**Interfaces:**
- Consumes: Task 1、段階3の `LoginSettings`・`readLoginSettings`、段階2の `reportFailure`・`refuse`。
- Produces:
  - `currentUser(request: Request, settings: LoginSettings, now?: number): Session | null` — Global Constraints のログインの決め方。
  - `signedIn(request: Request, db: Pool, settings: LoginSettings): Promise<{ user: Session } | { refusal: Response }>` — 未ログインと取り消し済みは
    401 `loginRequired`（取り消し済みのブラウザーは Cookie を消す `Set-Cookie` 付き）、取り消しが読めなければ `reportFailure(…, 'session.check')` して
    503 `databaseUnavailable`。

- [ ] **Step 1: 失敗するテストを書く。** `tests/e2e/sessionCookie.ts` の `sealSession` と同じ作り方で Cookie を作る小さな補助をテストに置く（トークンは info を
  `typle app session v1` に替える）。確かめること：
  - Cookie だけ・トークンだけで同じ利用者になる。`Authorization: Bearer <壊れた値>` と正しい Cookie があれば未ログイン（Cookie を見ない）。
    `Authorization: Basic x`・`Bearer `（空）・`Bearer a b` は未ログイン。Cookie の名前は `secure` で変わる。
  - DB（skip 可）：ランダムな `github:<数字>` について、取り消しがなければ通る。`typle_session_revocations` に `revoked_at = iat` を入れると 401 で、
    ブラウザーの答えには `Set-Cookie: typle-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`（http の設定）、トークンの答えには `Set-Cookie` なし。
    `revoked_at = iat - 1` なら通る。行は最後に消す。
  - DB が落ちていれば 503 `databaseUnavailable`。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS → **Step 5:** コミット `git commit -m "ログインと、すべての端末からのログアウトを TS で確かめる"`

### Task 3: 共有するパックのファイルを、保存データから書き出す

**Files:**
- Create: `src/server/shares.ts`（この Task では `sharedPackFile` まで）、`tests/fixtures/share-snapshots.json`
- Test: `tests/serverShares.test.cjs`

**Interfaces:**
- Consumes: `src/core/workspaceDocument.ts` の `decodeDocument`、`src/core/packs/catalog.ts` の `followed`、`src/core/packFile.ts` の `encodePackFile`。
- Produces:
  - `sharedPackFile(saved: { lists: string, packs: string | null, devices: string } | null, packId: string): string | null` — 保存された列
    （`::text`）を、アプリが読むのと同じ手順（`src/lib/storage/cloud.ts` の読み取りと同じく `decodeDocument` してから `followed`）で読み、
    `encodePackFile`。行がない（`null`）なら空のワークスペース。パックがなければ `null`。

- [ ] **Step 1: fixture を Go で作る。** `server/internal/store` か `workspace` に一時的なテスト（コミットしない）を書き、いくつかの保存データ
  （`lists`・`packs`・`devices` の JSON の文字列）について `workspace.Decode` してから `EncodePackFile` した結果を `tests/fixtures/share-snapshots.json`
  に `{ "cases": [{ "name", "saved": {lists,packs,devices}, "packId", "file" | null }] }` で保存する。入れる保存データ：公式パックを追いかけているパック
  （単語が保存されていないもの）、ラベル（説明・カテゴリ・タグ）と難易度と手書きの印と入力の種類のあるパック、`packs` が NULL の古い形のデータ、
  ないパック。保存データは `tests/fixtures/workspace-put.json` や `tests/fixtures/follow` の中身から取ってよい。一時的なテストは消す。
- [ ] **Step 2: 失敗するテストを書く。** fixture のすべてで `sharedPackFile(saved, packId) === file`。
- [ ] **Step 3:** FAIL → **Step 4:** 実装 → **Step 5:** PASS。**違いが出たら**、設計書の決まり（`src/core` と Go の検証の違いは、そのたびに持ち主に聞く）に従い、
  どの保存データでどう違うかを ledger に書いてから止まって聞く。 → **Step 6:** コミット `git commit -m "共有するパックのファイルを、保存データから TS で書き出す"`

### Task 4: `/api/shares` の Route Handler

**Files:**
- Modify: `src/server/shares.ts`
- Create: `src/app/api/shares/route.ts`
- Test: `tests/apiShares.test.cjs`

**Interfaces:**
- Consumes: Task 1〜3、段階3の `fromAppOrOrigin`・`jsonContent`・`readLoginSettings`。
- Produces:
  - `answerShares(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response>` — メソッドで分ける。
    設定がなければ 503 `authUnavailable`（Go の `server/vercel` と同じく、DB を開かない）。
- `route.ts` は `GET`・`HEAD`（本文なし）・`PUT`・`DELETE` を `answerShares` に、`POST`・`PATCH`・`OPTIONS` は `methodNotAllowed(['GET', 'HEAD', 'PUT', 'DELETE'])`。

- [ ] **Step 1: 失敗するテストを書く**（DB を使う。ランダムな `github:<数字>` の持ち主の `typle_workspaces` の行を、パックを1つ持つ保存データで入れ、最後に
  `typle_shared_packs`・`typle_workspaces` の行を消す）。確かめること：
  - `PUT {"packId"}` で 200、答えの JSON のキーの順、`hidden: false`・`listed: false`。`GET` の一覧に出る。`/api/shared` 相当の
    `readSharedPack(db, id)`（段階2）が `sharedPackFile` と同じ文字列を返す。
  - `PUT {"packId","listed":true}` で掲載。もう一度 `listed: true` でも `listed_at` は変わらない。`listed: false` で外れる。
  - `hidden_at` を立てた共有に `listed: true` は 409 `sharedPackHidden`、`listed` なしの再コピーは 200。
  - ないパックは 404 `packNotFound`。本文の誤り（`{}`・`{"packId":""}`・`{"packId":"p","listed":null}`・`{"packId":"p","x":1}`・`[]`・`x`）は 400 `invalidWorkspace`。
  - `Origin` が違う・ない、`text/plain` は 403。`Authorization: Bearer <トークン>` なら `Origin` なしで通る。
  - 未ログインは 401 `loginRequired`（`GET`・`PUT`・`DELETE` とも）。
  - `DELETE ?pack=` で 204（`Cache-Control: private, no-store`・`Vary: Cookie`）、一覧から消える。共有していないパックも 204。`pack` なしは 400。
  - 設定が `null` なら 503 `authUnavailable`。DB が落ちていれば `GET` は 503 `databaseUnavailable`、`PUT` は（ログインの確認で落ちるので）503 `databaseUnavailable`。
  - route の `POST`・`PATCH`・`OPTIONS` は 405、`Allow: GET, HEAD, PUT, DELETE`。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS・typecheck・lint → **Step 5:** コミット `git commit -m "/api/shares を Route Handler で答える"`

### Task 5: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` から `/api/shares` を消し、`tests/backendPaths.test.cjs` の `nextRoutes` に足す（先に足して FAIL を見る）。
- Go を消す：`shares.go`（`shares`・`listShares`・`putShare`・`sharePack`・`deleteShare`・`stopSharing`・`readShareBody`・`shareJSON` など）と mux の登録、
  `store` の `ListShares`（`PutShare`・`DeleteShare` は Go の保存と管理画面のテストが使っていれば残す。使われなくなったものだけ消す）、
  `web.Store` の該当するメソッド、fake、テスト。セッションの Go（`server/internal/session`）は、ログイン（段階8）まで Go が Cookie を作るので消さない。
  `gofmt -l .`（空）・`go vet ./...`・staticcheck・`go test ./...` が通るまで。
- README の表（`src/server`・Go）を今の形に直す。
- `npm run build` のあと、`tests/e2e/shares.spec.ts`・`tests/e2e/gallery.spec.ts`・`tests/e2e/sessions.spec.ts`・`tests/e2e/security-headers.spec.ts` を流す
  （サンドボックスの外で）。E2E は `tests/e2e/sessionCookie.ts` で作った Cookie を使うので、TS がそれを開けることもここで確かめられる。
- コミット `git commit -m "/api/shares の転送をやめ、Go の該当する処理を消す"`

### Task 6: 版と PR

- [ ] `git tag` と `gh release list` で確かめて `npm version patch --no-git-tag-version`（v2.46.5）。`npm run verify` を最後まで通す。push して PR。
  タイトル `ログインの読み取りと /api/shares を Go から Next.js の Route Handler に移す (v2.46.5)`。リリース後に確かめること：本番でログインしたまま
  共有の一覧が出る（ログインし直しにならない）、パックを共有してリンクを開ける、ギャラリーへの掲載を切り替えられる、iPad／Mac アプリで共有の一覧が出る。
