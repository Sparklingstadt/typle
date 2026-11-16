# Go から TS への移行・段階8b（ログインの始まりと戻り）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go に残る最後の端点（`GET /api/auth/signin`・`/api/auth/callback/github`・`/api/auth/callback/ffpf`）を Route Handler に移し、Go への転送をなくす。

**Architecture:** `src/server/session.ts` に OAuth の Cookie・管理者の Cookie・アプリのコードを封じる関数を足す。GitHub の OAuth App（`src/server/github.ts`）と
FFPF ID の OpenID Connect（`src/server/ffpf.ts`、ES256 の ID トークンを JWKS で確かめる）を Go の `internal/auth` から写し、`src/server/signin.ts` で
Go の `web/auth.go`・`web/admin.go` を写す。正しさは、Go を固定の時刻・固定のポートの偽のログイン先・本物の DB で動かした答え（`Location`・
`Set-Cookie` の値・ログイン先へ送った要求）を fixture に固定して確かめる。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node:crypto`、`fetch`、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階8）

## Global Constraints

- 段階1〜8a の Global Constraints はそのまま。Cookie・トークン・コードの形式と鍵は変えない（ロールバックで Go に戻っても読める）。
- OAuth の Cookie `typle-oauth`：HKDF `typle oauth v1`、`{state,verifier,returnTo,exp[,challenge][,admin][,provider][,nonce]}`（空・false は省く）、
  `Path=/api/auth`、10分、`SameSite=Lax`。コールバックは何があっても最初に消す（`Max-Age=0`）。
- `signin`：GET だけ（ほかは 405 `Allow: GET`）。設定がなければ 503 `authUnavailable`、ログイン先が設定されていなければ 503 `authUnavailable`（ログだけ）。
  `admin=1` は必ず FFPF ID で `/admin` へ戻る。`provider=ffpf` は FFPF ID、それ以外は GitHub。`returnTo` は Go の `safeReturnTo`（1024バイトまで、
  `/` で始まり `//`・`/\` でない、Go の `url.Parse` が通す）でなければ `/home`。`client` が ipad・macos・android・windows で（admin でなく）、
  `code_challenge` が `^[A-Za-z0-9_-]{43}$` でなければ `typle-r://login?error=loginFailed`。state・verifier・nonce は32バイトの乱数の base64url。
  FFPF ID は `typle-ffpf-relogin` の Cookie があれば `prompt=login`。リダイレクトは 302、`Cache-Control: no-store`。
- URL のクエリは Go の `url.Values.Encode`（キーの順、`url.QueryEscape`）と同じ文字で書き、要求のクエリは Go の `url.ParseQuery` と同じく読む。
- コールバック：GET だけ → ログイン先の設定 → OAuth の Cookie を消す → 開けた Cookie が admin で GitHub に戻ったら `/admin?error=adminForbidden` →
  Cookie・ログイン先・`error`・`state`・`code`・state の一致を確かめ、だめなら戻り先（アプリのログインなら `typle-r://login?error=loginFailed`）。
  GitHub：トークンの交換と `GET /user`（失敗は `auth.callback` を報告）。名前は `name` の前後の空白（Go の `TrimSpace`）を除いたもの、空なら `login`。
  FFPF ID：トークンの交換と ID トークンの確かめ（拒否は報告しない、届かないのは `auth.callback`）。管理者は `typle_admins`（失敗は `admin.check` を報告して
  `/admin?error=adminUnavailable`、だめなら `/admin?error=adminForbidden`、通れば relogin を消し管理者の Cookie（12時間、`SameSite=Strict`）で `/admin`）。
  アプリのログインは `typle-r://login?code=<2分のコード>`（Cookie なし）。ブラウザーは、FFPF ID なら relogin を消し、セッションの Cookie で戻り先へ。
- ログイン先への要求は Go と同じ：10秒で切る、リダイレクトを辿らない、答えは 1 MiB まで。GitHub の交換はフォームに client_secret、FFPF ID は
  Basic 認証（`QueryEscape` した ID と秘密）。FFPF ID の JWKS は10分使い回し、知らない kid のときは取り直す（1つのトークンで1回まで）。

## Review Focus

1. Go が封じた OAuth の Cookie を TS のコールバックが開き、TS の signin が封じたものを Go が開く（ロールバックの途中のログイン）。→ Task 2・4。
2. ログイン先の答えの異常（GitHub の 200 の error、4xx・5xx、壊れた JSON、ID トークンの署名・iss・aud・exp・nonce・email_verified・sub）。→ Task 3。
3. 開いたリダイレクト（`returnTo` の `//host`・`/\host`・制御文字・長すぎ）とアプリの challenge の誤り。→ Task 4。
4. 管理者のログインで DB が答えない、管理者でない、GitHub から戻った。→ Task 4。
5. 秘密（client_secret・code・verifier・トークン）がログやエラーに出ない。→ Task 3。

---

### Task 0: 作業ブランチと計画

- [ ] `git switch -c go-to-ts-signin`。計画をコミット。

### Task 1: Go で答えを fixture にする

- [ ] 一時的な Go のテスト（コミットしない、`TYPLE_TEST_DATABASE_URL`）：固定のポート `127.0.0.1:38917` に偽の GitHub・FFPF ID（要求を記録し、
  `code` ごとに決まった答えを返す。ES256 の鍵は固定）を立て、`web.New` に本物の `auth.OAuth`・`auth.GitHub`・`auth.FFPF`・store と固定の `Now` を渡す。
  signin（乱数の部分は伏せる）とコールバックの場面の答え（状態・`Location`・`Set-Cookie`・本文・報告）と、ログイン先が受けた要求を
  `tests/fixtures/signin-answers.json` に書く。
- [ ] コミット `Go のログインの始まりと戻りの答えを fixture に固定する`

### Task 2: 封じる側と設定

**Files:** Modify `src/server/session.ts`・`src/server/settings.ts`。Test: `tests/serverSession.test.cjs`・`tests/serverSettings.test.cjs`。

- [ ] 失敗するテスト：Task 1 の OAuth の Cookie を開く・同じバイトで封じる、管理者の Cookie・アプリのコードを同じバイトで封じる、設定の `github`・`ffpf` → 実装 → コミット
  `OAuth・管理者の Cookie とアプリのコードを Go と同じバイトで封じる`

### Task 3: GitHub と FFPF ID のクライアント

**Files:** Create `src/server/github.ts`・`src/server/ffpf.ts`・`src/server/goUrl.ts`（`url.QueryEscape`・`Values.Encode`・`ParseQuery`・`TrimSpace`）。
Test: `tests/serverGithub.test.cjs`・`tests/serverFfpf.test.cjs`（Go の `auth/*_test.go` の場面を写す）。

- [ ] 失敗するテスト → 実装 → コミット `GitHub と FFPF ID のログインのクライアントを TS に写す`

### Task 4: Route Handler

**Files:** Create `src/server/signin.ts`、`src/app/api/auth/{signin,callback/github,callback/ffpf}/route.ts`。Test: `tests/apiSignin.test.cjs`。

- [ ] 失敗するテスト：Task 1 の場面を同じ順で流して同じ答えと同じ要求。管理者の確かめで DB が答えない。→ 実装 → コミット
  `/api/auth/signin とコールバックを Route Handler で答える`

### Task 5: 転送をなくす

- `vercel.json` の `rewrites`・`next.config.mjs` の `beforeFiles` を消す。`backendPaths` のテストを「Go へ送るパスはない」に替える。文書。
- Go のコードは段階9でまとめて消す（もう届かない）。build のあと E2E を全部。コミット `/api/auth の残りの転送をやめる`

### Task 6: 版と PR

- [ ] v2.46.10。`npm run verify`。PR `ログインの始まりと戻りを Go から Next.js の Route Handler に移す (v2.46.10)`。
  リリース後に確かめること：本番で GitHub と FFPF ID でログインできる、iPad／Mac でログインできる、管理画面にログインできる、ログアウトの後の FFPF ID がパスワードを聞く。
