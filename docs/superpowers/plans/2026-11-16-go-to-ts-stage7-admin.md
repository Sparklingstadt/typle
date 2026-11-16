# Go から TS への移行・段階7（/api/admin/*）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面の API（`/api/admin/dashboard`・`users`・`gallery`・`gallery/hide`・`gallery/unhide`）を Go から Route Handler に移す。

**Architecture:** 管理者の Cookie（Go の `session.SealAdmin`、HKDF の info `typle admin v2`、`{email, sub, iat, exp}`）を
`src/server/session.ts` の `openAdmin` で開き、`src/server/admin.ts` で Go の `allowAdmin`・store の問い合わせ（`Admin`・`Overview`・
`Users`・`AdminGallery`・`SetHidden`）を同じ SQL で写す。正しさは、Go を本物の DB で動かした答えを fixture に固定して確かめる。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階7）

## Global Constraints

- 段階1〜6の Global Constraints はそのまま。
- `/api/auth/admin/signout` は段階8に回す（`/api/auth/:path*` の転送を段階8でまとめて外すため。ここで外すには両方の転送に否定の先読みが要る）。
- 管理者の Cookie：名前は `AUTH_URL` が HTTPS なら `__Host-typle-admin`、そうでなければ `typle-admin`。値は段階4と同じ形式
  （厳密な base64url、HMAC-SHA256）。開けるのは期限内（`now < exp`）で、`email` が空でなく、`sub` が `^[a-z0-9]{1,64}$` のもの。
- 確かめる順（Go の `databaseHandler` と mux）：405（`Allow: GET, HEAD` または `POST`）→ 設定がなければ 503 `authUnavailable`
  → DB が開けなければ 503 `databaseUnavailable` → Cookie がない・開けない 401 `adminRequired` → `typle_admins` を
  `UPDATE … SET ffpf_sub = $2, last_seen_at = now() WHERE email = lower($1) AND (ffpf_sub IS NULL OR ffpf_sub = $2) RETURNING 1`
  で問い（失敗は 503 `databaseUnavailable`、報告 `admin.check`）、なければ 403 `adminForbidden` と Cookie の削除
  （`Path=/; Max-Age=0; HttpOnly; SameSite=Strict`、HTTPS なら `Secure`）。
- `GET /api/admin/dashboard`：`{admin:{email,sub}, overview:{workspaces, activeDay, activeWeek, activeMonth, sharedPacks, recentShares:[{id,ownerId,name,updatedAt}], admins:[{email,ffpfSub,createdAt,lastSeenAt}]}}`。
  読み取り専用・REPEATABLE READ の1つのトランザクション。失敗は 503 `databaseUnavailable`（報告 `admin.overview`）。
- `GET /api/admin/users?page=`：`page` がなければ 0、Go の `strconv.Atoi` が読める整数（`^[+-]?\d+$`）で 0〜10000 でなければ 400
  `invalidPage`（管理者の確認の後）。`{page, pageSize: 50, total, users:[{ownerId,lists,packs,devices,shares,revision,updatedAt}]}`。
  失敗は 503（報告 `admin.users`）。
- `GET /api/admin/gallery`：`{packs:[{id,name,category?,added,listedAt,hiddenAt,reports,reasons}]}`（`category` は空なら省く、
  100件まで）。失敗は 503（報告 `admin.gallery`）。
- `POST /api/admin/gallery/hide`・`unhide`：管理者の確認 → `Origin` がアプリのものと完全に同じで `Content-Type` が JSON でなければ
  403 `forbiddenRequest`（アプリのトークンは通さない）→ 本文がちょうど `{id}`（4 KiB まで）でなければ 400 `invalidRequest`
  → UUID でない・ない共有は 404 `sharedPackNotFound` → 204（`Cache-Control: private, no-store`、`Vary: Cookie`）。
  失敗は 503（報告 `admin.hide`）。隠すときは最初の時刻を保つ。
- HEAD は GET と同じ答えで本文なし。OPTIONS も 405。
- 時刻は段階2・4と同じく `Date#toISOString()`（Go はマイクロ秒まで書いた。画面は `Date` で読むので変わらない）。

## Review Focus

1. Go が封じた管理者の Cookie を TS が開け、ほかの種類の値（ログインの Cookie）や期限切れ・`sub` の形が違うものを開かない。→ Task 1・2。
2. 管理者の行が消えた・別の `sub` に結び付いたときは 403 で Cookie を消す。最初のサインインで `sub` を結び付ける。→ Task 3。
3. 一覧の並び（報告の多い順 → 最後の報告の新しい順 → 公開の新しい順）と集計が Go と同じ。→ Task 1 の fixture。
4. 他のサイトからの隠す・戻すの要求、アプリのトークンでの要求は 403。→ Task 3。
5. ページの境（`-1`・`10001`・`1.5`・`+3`・空）。→ Task 3。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-admin`（main から）。計画をコミット：`git commit -m "Go から TS への移行の段階7の計画を書く"`

### Task 1: Go で管理画面の fixture を作る

- [ ] 一時的な Go のテスト（コミットしない、`TYPLE_TEST_DATABASE_URL`）：
  - 固定の秘密で `SealAdmin` した Cookie（正しいもの・期限切れ・`sub` が形に合わないもの・`email` が空のもの）と、同じ JSON を
    ログインの鍵で封じたものを `tests/fixtures/admin-cookies.json` に書く。
  - 種の行（作業場所・共有・通報・管理者。時刻は今からの相対）を入れ、`web.New` に本物の store を渡して各要求の答え（状態・
    `Set-Cookie`・JSON。時刻は消し、種の行だけに絞る）を `tests/fixtures/admin-answers.json` に書く。
- [ ] コミット `git commit -m "Go の管理画面の答えを、本物の DB で fixture に固定する"`

### Task 2: 管理者の Cookie を開く

**Files:** Modify `src/server/settings.ts`（`adminKey`）・`src/server/session.ts`（`openAdmin`・`adminCookieName`）。Test: `tests/serverSession.test.cjs`。

- [ ] 失敗するテスト（Task 1 の Cookie）→ FAIL → 実装 → PASS → コミット `git commit -m "Go の管理者の Cookie を TS で開く"`

### Task 3: /api/admin/* の Route Handler

**Files:** Create `src/server/admin.ts`・`src/app/api/admin/{dashboard,users,gallery,gallery/hide,gallery/unhide}/route.ts`。Test: `tests/apiAdmin.test.cjs`。

- [ ] 失敗するテスト：Task 1 の答えの場面を TS で流して同じ答え。Go の `TestAdmin`・`TestOverview`・`TestAdminGallery`・`TestSetHidden`・
  `TestAdminDashboard(Refuses)`・`TestAdminUsers`・`TestAdminGallery(Refused)` の事柄。確かめる順、405、HEAD。
- [ ] FAIL → 実装 → PASS・typecheck・lint → コミット `git commit -m "/api/admin/* を Route Handler で答える"`

### Task 4: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` から `/api/admin/:path*` を消し、`tests/backendPaths.test.cjs` の `nextRoutes` に足す。
- Go：`adminDashboard`・`adminUsers`・`adminGallery`・`adminHide`・`adminUnhide` と、それだけが使うもの・テストを消す。
  `finishAdmin`・`adminSignout`・`isAdmin` は段階8まで残す。store の関数は段階9まで残す。
- README・`docs/`・`src/app/admin/*` の注記・`server/vercel` の説明を直す。build のあと E2E を全部。
- コミット `git commit -m "/api/admin/* の転送をやめ、Go の該当する処理を消す"`

### Task 5: 版と PR

- [ ] v2.46.8（`git tag` と `gh release list` で確かめる）。`npm run verify`。PR タイトル
  `管理画面の API を Go から Next.js の Route Handler に移す (v2.46.8)`。リリース後に確かめること：本番で管理画面に入れる、
  ダッシュボード・ユーザー一覧・ギャラリーの一覧が出る、隠す・戻すができる、ログアウトできる。
