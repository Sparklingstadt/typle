# Go から TS への移行・段階8a（セッション・トークン・ログアウト）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部のサービスを呼ばないログインの端点（`/api/auth/session`・`token`・`signout`・`local`・`admin/signout`）を Go から Route Handler に移す。

**Architecture:** 段階4の `src/server/session.ts`・`account.ts` に、封じる側（`sealSession`・`sealApp`）とアプリのコードを開く `openCode` を足し、
`src/server/auth.ts` で Go の `session.go`・`adminSignout` を写す。正しさは、Go を固定の時刻で動かした答え（`Set-Cookie` の値とトークンまで）を
fixture に固定して確かめる。段階8b で `signin`・`callback/*` を移す。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階8）

## Global Constraints

- 段階1〜7の Global Constraints はそのまま。Cookie・トークンの形式・鍵は変えない（Go の `signin`・`callback` が段階8bまで同じものを発行し、読む）。
- 封じる JSON は Go の `encode` と同じバイト：`JSON.stringify`（キーは Go の struct の順）のあと U+2028・U+2029 を ` `・` ` に書き換える。
- `Set-Cookie` は Go の `http.Cookie` と同じ並び：`name=value; Path=…; Max-Age=…; HttpOnly; Secure; SameSite=…`（`Max-Age` は消すとき 0）。
  セッション：`Path=/`、30日、`SameSite=Lax`。`typle-ffpf-relogin`：値 `1`、`Path=/api/auth`、30日、`SameSite=Lax`。管理者：`Path=/`、`SameSite=Strict`。
- `GET`・`HEAD /api/auth/session`：`{"user":{"id","name","image"}|null,"providers":[…]}`。`providers` は `github`（`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` が両方ある）、
  `ffpf`（`FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` が全部ある）の順。取り消されたログインは `user: null` で、ブラウザーなら Cookie を消す。
  取り消しを読めないとき（DB がない・失敗・時間切れ）は確かめずに答える（Go と同じく、セッションの答えは DB を待たない。待つのは最大1秒）。
- `POST /api/auth/token`：本文 4096 バイトまで、Go の `json.Unmarshal` と同じく `{code, verifier}`（キーの大文字小文字は問わない・ほかのキーは無視・`null` は空）。
  `verifier` が `^[A-Za-z0-9._~-]{43,128}$`、`code` が期限内のアプリのコード（HKDF `typle app code v1`、`{sub,name,image,challenge,exp}`）で、`challenge` が
  `verifier` の S256 と一致すれば `{"token","user"}`（トークンは今から30日）。どれかが違えば 400 `loginFailed`。
- `POST /api/auth/signout[?everywhere=1]`：アプリの `Origin`、または `everywhere=1` とアプリのトークンでなければ 403 `forbiddenRequest`。
  `everywhere=1` はログインが要り（401 `loginRequired`）、取り消されていれば Cookie を消して 401、取り消しの読み書きの失敗は 503 `databaseUnavailable`
  （報告 `session.revoke`）。ブラウザーには、セッションの Cookie を消し `typle-ffpf-relogin` を置く。204。
- `POST /api/auth/local`：手元（`VERCEL` が `1` でない）で、`LOCAL_DEVELOPMENT_LOGIN=1`、`AUTH_URL` が http のループバックか `LOCAL_DEVELOPMENT_LAN_HOST` と同じ
  プライベート IPv4 のときだけ。それ以外はどのメソッドでも 404 `notFound`。アプリの `Origin` でなければ 403。`github:0`「ローカル練習用」のセッションの Cookie。204。
- `POST /api/auth/admin/signout`：アプリの `Origin` でなければ 403。管理者の Cookie を消し `typle-ffpf-relogin` を置く。204。
- 設定（`AUTH_SECRET`・`AUTH_URL`）がなければ 503 `authUnavailable`。出していないメソッドは 405（`Allow`）。

## Review Focus

1. Go が封じた Cookie・トークン・コードを TS が開き、TS が封じたものを Go の `signin`・`callback` 側が開く（同じバイト）。→ Task 1・2。
2. 全端末ログアウトの後、古い Cookie・トークンは `user: null`、データの API は 401。→ Task 3。
3. 他のサイトからのログアウト・ローカルログイン、本番でのローカルログイン。→ Task 3。
4. アプリのトークンの交換の誤り（別の verifier・期限切れ・形の違う本文）。→ Task 3。
5. DB が落ちていてもセッションは答える。→ Task 3。

---

### Task 0: 作業ブランチと計画

- [ ] `git switch -c go-to-ts-auth`。計画をコミット：`git commit -m "Go から TS への移行の段階8aの計画を書く"`

### Task 1: Go で固定の時刻の答えを fixture にする

- [ ] 一時的な Go のテスト（コミットしない、`TYPLE_TEST_DATABASE_URL`）：`web.New` に本物の store と固定の `Now` を渡し、上の5つの端点の場面
  （http と https、設定の違い、取り消し）の答え（状態・`Allow`・`Set-Cookie`・本文）を `tests/fixtures/auth-answers.json` に書く。
- [ ] コミット `git commit -m "Go のセッション・トークン・ログアウトの答えを fixture に固定する"`

### Task 2: 封じる側とアプリのコード

**Files:** Modify `src/server/session.ts`・`src/server/settings.ts`。Test: `tests/serverSession.test.cjs`。

- [ ] 失敗するテスト：Task 1 の Cookie・トークンを TS が同じバイトで封じる（U+2028 を含む名前も）、Go のコードを開く → 実装 → コミット
  `git commit -m "Go と同じバイトでセッションを封じ、アプリのコードを開く"`

### Task 3: Route Handler

**Files:** Create `src/server/auth.ts`、`src/app/api/auth/{session,token,signout,local,admin/signout}/route.ts`。Test: `tests/apiAuth.test.cjs`。

- [ ] 失敗するテスト：Task 1 の場面を TS で流して同じ答え。DB が落ちているときのセッション、時間切れ。→ 実装 → コミット
  `git commit -m "/api/auth の session・token・signout・local・admin/signout を Route Handler で答える"`

### Task 4: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` の `/api/auth/:path*` を `/api/auth/signin`・`/api/auth/callback/:path*` に替える。`backendPaths` の `nextRoutes` に足す。
- `playwright.config` の Go の起動確認を Go に残るパスに替え、Next.js にも `AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` を渡す。
- Go：`session.go`・`account.go`・`adminSignout`・`LocalLogin`・`SessionSource`（`lazySessions`）・`sameOrigin`・`readLimited` と、それだけのテストを消す。
- 文書。build のあと E2E を全部。コミット `git commit -m "/api/auth の5つの転送をやめ、Go の該当する処理を消す"`

### Task 5: 版と PR

- [ ] v2.46.9。`npm run verify`。PR `ログインのセッション・トークン・ログアウトを Go から Next.js の Route Handler に移す (v2.46.9)`。
  リリース後に確かめること：本番で GitHub と FFPF ID でログインできる、ログアウト・全端末のログアウトができる、iPad／Mac でログインできる、管理画面のログアウト。
