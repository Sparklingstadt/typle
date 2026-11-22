# Sparklingstadt ID でのログイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auth.js に Sparklingstadt ID（OIDC、id `sid`）のログインを足し、`typle_sid_links` でひも付けた ID は今のアカウントとして入れるようにする。

**Architecture:** プロバイダーの設定と判断は `src/server/sidLogin.ts`（純粋な関数）に置き、`src/auth.ts` が組み込む。ひも付けは DB の表 `typle_sid_links` を `jwtCallback` が引き、行を足すのは `scripts/sid-link.cjs`。ログアウト後の `prompt=login` は `/api/auth/[...nextauth]/route.ts` の包みで、Cookie `typle-sid-relogin` を置く・読む・消す。

**Tech Stack:** Next.js 16、next-auth 5.0.0-beta.32（`@auth/core`）、pg、node:test（`tests/*.test.cjs`）、Playwright、Go（`server/`）

**Spec:** `docs/superpowers/specs/2026-11-22-sparklingstadt-id-login-design.md`

## Global Constraints

- プロバイダー id は `sid`、表示名は `Sparklingstadt ID`、コールバックは `/api/auth/callback/sid`。
- ひも付けのないアカウント ID は `sid:<sub>`。`sub` は `^[a-z0-9]{1,64}$`（ID サーバーは cuid）。
- 環境変数は `AUTH_SID_ISSUER`・`AUTH_SID_ID`・`AUTH_SID_SECRET`。3つそろったときだけプロバイダーとボタンを出す。
- `checks: ['pkce', 'state', 'nonce']`、scope `openid email profile`、`email_verified === true` でなければ断る。
- ひも付けを読めないときは、ログインを失敗にする（`sid:<sub>` で入れない）。
- GitHub と ID・パスワードのログインは変えない。Cookie の形も変えない。
- 文書・PR・コミットは日本語、コードのコメントと識別子は英語（CLAUDE.md）。バージョンは v2.58.0（作る前に `git tag` と GitHub Releases で空きを確かめる）。

## Review Focus

- `jwtCallback` で DB が落ちている：ログインは `/signin?error=…` に戻り、`sid:<sub>` のセッションはできない（Task 3 のテスト）。
- ひも付け済みの ID で入ったあとの「すべての端末からログアウト」：ひも付け先のアカウント ID で失効する（Task 3 のテストで `token.sub` がひも付け先になることを確かめれば足りる）。
- `sid-link` の打ち間違い：`sid:` 付き・なしの `sub`、存在しないアカウント、`sid:` のアカウントをひも付け先にする、をすべて断る（Task 2）。
- ログアウトしたあと、ログインを途中でやめた：Cookie は残り、次のログインでもパスワードを聞く（Task 4：消すのはコールバックが成功したときだけ）。
- Go のバックエンドが `sid:` の Cookie を読めない：Task 1 で Go の正規表現も直す。

---

### Task 1: `sid:` のアカウント ID を受け付ける

**Files:**
- Modify: `src/server/session.ts:14`（`ACCOUNT_SUB`）
- Modify: `server/internal/session/session.go:32`（`accountSub`）
- Test: `tests/serverSession.test.cjs`、`server/internal/session/session_test.go`

**Interfaces:**
- Produces: `openSession` が `sid:[a-z0-9]{1,64}` のセッションを開く（TS・Go とも）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/serverSession.test.cjs` に `test('a Sparklingstadt ID account sid:<sub> opens, and a sub of another form does not')`：`newSession('sid:cm3abc123', …)` を封じて `openSession` が同じ `sub` を返す。`sid:`、`sid:ABC`、`sid:a-b`、`sid:` + 'a'.repeat(65) は `null`。Go にも同じ表の `TestOpenSidSubject` を足す。
- [ ] **Step 2: 失敗を確かめる** — `node --test --test-isolation=none tests/serverSession.test.cjs`、`(cd server && go test ./internal/session/)` が FAIL。
- [ ] **Step 3: 実装** — 両方の正規表現に `|sid:[a-z0-9]{1,64}` を足し、コメントに Sparklingstadt ID を書く。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンドが PASS。
- [ ] **Step 5: コミット** — `git commit -m "Sparklingstadt ID のアカウント sid:<sub> のセッションを受け付ける"`

### Task 2: ひも付けの表とコマンド

**Files:**
- Create: `db/migrations/0040_sid_links/migration.sql`
- Create: `src/server/sidLinks.ts`
- Create: `scripts/sid-link.cjs`
- Modify: `package.json`（`"sid:link": "node scripts/sid-link.cjs"`）
- Test: `tests/sidLinks.test.cjs`（DB のテスト。`TYPLE_TEST_DATABASE_URL` がなければ skip、`tests/authRevocation.test.cjs` と同じ形）

**Interfaces:**
- Produces: 表 `typle_sid_links(sub text PRIMARY KEY, account_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`。
- Produces: `linkedAccount(db: Pick<Pool, 'query'>, sub: string): Promise<string | null>`（`src/server/sidLinks.ts`）。DB のエラーはそのまま投げる。
- Produces: `scripts/sid-link.cjs` が `module.exports = { linkSid, parseSub }` を出す。`parseSub(text: string): string | null`（`sid:` を外し、`^[a-z0-9]{1,64}$` でなければ null）。`linkSid(db, sub, accountId): Promise<'linked' | 'subLinked' | 'accountLinked' | 'accountInvalid' | 'accountEmpty' | 'sidHasData'>`。

- [ ] **Step 1: 失敗するテストを書く** — 乱数の `sub` とアカウントで、後始末に行を消す。
  - `parseSub('sid:cm3abc')` と `parseSub('cm3abc')` は `'cm3abc'`、`parseSub('SID:x')`・`parseSub('')`・`parseSub('a b')` は `null`。
  - `typle_workspaces` に行のある `github:<乱数>` へ `linkSid` → `'linked'`、`linkedAccount(db, sub)` がそのアカウントを返す。ひも付けのない `sub` は `null`。
  - 同じ `sub` をもう一度 → `'subLinked'`。別の `sub` を同じアカウントへ → `'accountLinked'`。
  - `typle_workspaces` にも `typle_records` にも行のないアカウント → `'accountEmpty'`。
  - `sid:<sub>` が `typle_workspaces` に行を持つ → `'sidHasData'`。
  - ひも付け先が `sid:…`、または `openSession` の `ACCOUNT_SUB` に合わない文字列 → `'accountInvalid'`。
- [ ] **Step 2: 失敗を確かめる** — `npm run db:migrate && TYPLE_TEST_DATABASE_URL=$DATABASE_URL node --test --test-isolation=none tests/sidLinks.test.cjs` が FAIL。
- [ ] **Step 3: 実装** — マイグレーションは `CREATE TABLE IF NOT EXISTS`、先頭に他と同じ説明のコメント。`linkSid` は1つのトランザクションで確かめて `INSERT`、一意制約の違反（`23505`）は `subLinked`／`accountLinked` に読み替える。コマンドとして動かしたときは `DATABASE_URL`（`.env.local` を `@next/env` で読む）につなぎ、結果を日本語で1行出し、`linked` 以外は終了コード 1。
- [ ] **Step 4: 通ることを確かめる** — Step 2 のコマンドが PASS、`node --test tests/migrate.test.cjs` も PASS。
- [ ] **Step 5: コミット** — `git commit -m "Sparklingstadt ID とアカウントのひも付けの表と sid:link を足す"`

### Task 3: プロバイダーとひも付けの引き当て

**Files:**
- Create: `src/lib/sidLogin.ts`
- Create: `src/server/sidLogin.ts`
- Modify: `src/server/authOptions.ts`（`jwtCallback`）
- Modify: `src/auth.ts`
- Test: `tests/authOptions.test.cjs`

**Interfaces:**
- Consumes: `linkedAccount`（Task 2）。
- Produces: `sidConfigured(env?: Record<string, string | undefined>): boolean`（`src/lib/sidLogin.ts`）。
- Produces: `SID_PROVIDER_ID = 'sid'`、`sidProfile(profile: { sub: string, email?: string, email_verified?: boolean, name?: string | null }): { id: string, name: string, image: '' }`（`src/server/sidLogin.ts`）。`email_verified !== true`、または `sub` が `^[a-z0-9]{1,64}$` でないときは `Error` を投げる。名前は `name` の前後の空白を除いたもの、空なら `email` の `@` の前。
- Produces: `jwtCallback(revoked, linked: (sub: string) => Promise<string | null>)`。`account` の型に `provider: string` を足す。

- [ ] **Step 1: 失敗するテストを書く**（`tests/authOptions.test.cjs`）
  - `sidConfigured` は3つそろったときだけ true（`githubConfigured` のテストと同じ形）。
  - `sidProfile({ sub: 'cm3abc', email: 'a@example.test', email_verified: true, name: ' Ann ' })` → `{ id: 'sid:cm3abc', name: 'Ann', image: '' }`。`name` が空なら `name: 'a'`。`email_verified: false`／なし、`sub: 'A!'` は throw。
  - `jwtCallback(revoked, async sub => sub === 'cm3abc' ? 'github:42' : null)` に `account: { provider: 'sid', providerAccountId: 'sid:cm3abc' }` → `token.sub === 'github:42'`。ひも付けのない `sid:cm3xyz` → `'sid:cm3xyz'`。`linked` が reject → `jwtCallback` も reject。`provider: 'github'` では `linked` を呼ばない。
  - `authPathKnown('/api/auth/signin/sid', ['sid'])` と `/api/auth/callback/sid` は true、`['github']` のときは false。
- [ ] **Step 2: 失敗を確かめる** — `node --test --test-isolation=none tests/authOptions.test.cjs` が FAIL。
- [ ] **Step 3: 実装** — `src/auth.ts` で `sidConfigured()` のとき、`{ id: 'sid', name: 'Sparklingstadt ID', type: 'oidc', issuer, clientId, clientSecret, checks: ['pkce', 'state', 'nonce'], authorization: { params: { scope: 'openid email profile' } }, profile: sidProfile }` を足し、`providerIds.push('sid')`。`jwtCallback` には `sub => linkedAccount(pool(), sub)` を渡す。
- [ ] **Step 4: 通ることを確かめる** — Step 2 のコマンドと `npm run typecheck` が PASS。
- [ ] **Step 5: コミット** — `git commit -m "Sparklingstadt ID の OIDC プロバイダーを足し、ひも付けたアカウントで入れる"`

### Task 4: ログアウトのあとはパスワードを聞く

**Files:**
- Modify: `src/server/sidLogin.ts`
- Modify: `src/app/api/auth/[...nextauth]/route.ts`
- Modify: `src/app/api/account/signout-everywhere/route.ts`
- Test: `tests/sidLogin.test.cjs`

**Interfaces:**
- Produces: `SID_RELOGIN_COOKIE = 'typle-sid-relogin'`。
- Produces: `sidSignInRequest(request: Request): Request`：`/api/auth/signin/sid` で Cookie があれば、URL に `prompt=login` を足した Request を返す。それ以外は同じ request。
- Produces: `withSidRelogin(request: Request, response: Response, secure: boolean): Response`：`POST /api/auth/signout` と `POST /api/account/signout-everywhere` が成功（2xx、または `error` のない URL を返す）なら Cookie を置く（`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`、`secure` のとき `Secure`）。`/api/auth/callback/sid` が `/signin` 以外へ redirect したら Cookie を消す（`Max-Age=0`）。それ以外は手を付けない。

- [ ] **Step 1: 失敗するテストを書く** — 上の各場合を Request／Response を作って確かめる。Cookie なしの signin、`/signin?error=…` への callback、失敗した signout では何も変わらないこと。
- [ ] **Step 2: 失敗を確かめる** — `node --test --test-isolation=none tests/sidLogin.test.cjs` が FAIL。
- [ ] **Step 3: 実装** — 2つの route で `withSidRelogin(request, await handler(sidSignInRequest(request)), secure)` の形に包む。
- [ ] **Step 4: 通ることを確かめる** — Step 2 のコマンドが PASS。
- [ ] **Step 5: コミット** — `git commit -m "ログアウトしたあとの Sparklingstadt ID のログインでパスワードを聞く"`

### Task 5: ログイン画面のボタン

**Files:**
- Modify: `src/lib/session.tsx`（`signInWithSid(returnTo: string): Promise<void>`、`signInWithGitHub` と同じ作り）
- Modify: `src/app/signin/page.tsx`、`src/app/signin/signin-form.tsx`（`sid` prop。ボタンはいちばん上）
- Modify: `src/messages/{ja,en,fr,ru,zh-CN,zh-TW}/account.json`（`signInWithSid`。ja は「Sparklingstadt ID でログイン」）
- Test: `tests/e2e/aria-snapshots.spec.ts-snapshots`（更新）

- [ ] **Step 1: 実装** — GitHub のボタンと同じ見た目・同じ失敗の扱い。
- [ ] **Step 2: 確かめる** — `npm run typecheck && npm run lint`。スナップショットは Task 6 の E2E の環境で `docs/snapshots.md` の手順で更新する。
- [ ] **Step 3: コミット** — `git commit -m "ログイン画面に Sparklingstadt ID のボタンを足す"`

### Task 6: E2E

**Files:**
- Create: `tests/e2e/fakeSid.cjs`（127.0.0.1:3197 の偽の OIDC プロバイダー：discovery、`/authorize` は `prompt` を記録してすぐコードを返す、`/token` は ES256 の ID トークン、`/jwks`、`GET /requests` で受けた authorize のクエリを返す。`sub` と `email_verified` は authorize の `login_hint` で選べる）
- Modify: `playwright.config.ts`（webServer を足し、`AUTH_SID_ISSUER=http://127.0.0.1:3197`・`AUTH_SID_ID=e2e`・`AUTH_SID_SECRET=e2e`）
- Create: `tests/e2e/sid-login.spec.ts`

- [ ] **Step 1: テストを書く**
  - ひも付けのない `sub` でログイン → `/api/auth/session` の `user.id` が `sid:<sub>`。
  - DB に `typle_sid_links` の行を入れた `sub` でログイン → `user.id` がひも付け先。
  - `email_verified: false` → `/signin?error=…` に戻り、ログインしていない。
  - ログアウトのあとのログイン → 偽のプロバイダーが受けた `prompt` が `login`。そのあとのもう1回は `prompt` なし。
- [ ] **Step 2: 確かめる** — `npm run build && npx playwright test tests/e2e/sid-login.spec.ts` が PASS（サンドボックスの外で）。
- [ ] **Step 3: コミット** — `git commit -m "Sparklingstadt ID のログインを E2E で確かめる"`

### Task 7: 文書・版・検証

**Files:**
- Modify: `README.md`（ログインの節：環境変数、ID サーバーへの `typle-r` の登録と `redirectUris`、`sid:link` と自分の `sub` の調べ方）、`api-docs/src/app/auth.md`、`.env.example`、`package.json`・`package-lock.json`（v2.58.0）

- [ ] **Step 1: 文書を書く**。
- [ ] **Step 2: 版を上げる** — `git tag -l 'v2.58.0'` と `gh release list` で空きを確かめ、`npm version 2.58.0 --no-git-tag-version`。
- [ ] **Step 3: 検証** — `npm run verify`（全部）が通る。Go は `(cd server && go test ./...)`。
- [ ] **Step 4: コミットして PR** — PR のタイトルは「Sparklingstadt ID でログインできるようにする (v2.58.0)」。
