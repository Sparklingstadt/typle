# ログインの Better Auth への移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** typle-r のログインを Auth.js（next-auth v5 beta）から Better Auth 1.7.28 に移す。ログインの方法は Sparklingstadt ID・GitHub・開発用の 3 つのまま、データの持ち主のアカウント ID も変えない。

**Architecture:**
- Better Auth のインスタンスを `src/server/betterAuth.ts` に置く。セッションは Postgres（今の Prisma）に持ち、Cookie に 5 分以内キャッシュする。
- ユーザーの ID は今のアカウント ID（`github:<番号>` など）にする。メールアドレスは `<ID>@users.invalid` の仮のアドレスにする。
- 今のデータの取り込み（ユーザー・ログイン方法・ひも付け）はマイグレーションの SQL で行う。
- Auth.js、自前の Cookie、失効の表を読むコードは最後のタスクで消す。古い表そのものは残す。

**Tech Stack:** Next.js 16.4.6、Prisma 7.10（`db/migrations`、`prisma migrate deploy`）、better-auth 1.7.28、Node 24、node:test（`tests/*.test.cjs`）、Playwright（`tests/e2e`）。

**Spec:** `docs/superpowers/specs/2026-11-27-better-auth-design.md`

## Global Constraints

**バージョンと名前**
- `better-auth` は `1.7.28` に固定する（`^` なし）。
- シークレットは `BETTER_AUTH_SECRET`（Better Auth の標準）。アプリは `AUTH_SECRET` を読まなくなる。`baseURL` は `AUTH_URL`。

**ユーザーとアカウント**
- ユーザー ID は今のアカウント ID：GitHub は `github:<GitHub のユーザー番号>`、Sparklingstadt ID は `sid:<sub>`、開発用は `github:0`。
- メールアドレスは `<アカウント ID>@users.invalid`、`emailVerified` は true。本物のアドレスはプロフィールから写さない。GitHub は scope なしのまま。
- メールアドレスによる自動のひも付け（`accountLinking`）は使わない。

**セッション**
- ログインから 30 日で切れ、延長しない（`expiresIn` は 30 日、`updateAge` で延ばさない）。
- `session.cookieCache` は 5 分以内。

**表**
- 名前は `typle_auth_users`・`typle_auth_sessions`・`typle_auth_accounts`・`typle_auth_verifications`（DB のレート制限を使うなら `typle_auth_rate_limits`）。カラムは snake_case。
- マイグレーションは `db/migrations/0042_…` から順に作る。`prisma/schema.prisma` を DB と一致させる（`verify` が確かめる）。
- 古い表 `typle_session_revocations`・`typle_sid_links` は消さない。

**callback と API**
- GitHub の callback は `/api/auth/callback/github`（今と同じ）。
- Sparklingstadt ID は `genericOAuth` の provider id `sid`、callback は `/api/auth/callback/sid`（今と同じ。訂正：実装で確かめた。ログインの開始は `POST /api/auth/sign-in/social`、provider `sid`）。転送する仕組みは作らない。
- Sparklingstadt ID は scope `openid email profile`、PKCE S256。`email_verified !== true` の ID と、`sub` が `/^[a-z0-9]{1,64}$/` でない ID は断る。
- `/api/auth/*` は使うものだけを許可リストで通し、ほかは 404。

**決まりごと**
- 画面の文言は今の日本語のまま（i18n のキーは `src/lib/i18n` の既存のものを使う）。
- コミット：途中のコミットは内容だけを日本語の 1 文で書き、`(vX.Y.Z)` を付けない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_01QKzq5TUbCMBpR7AZX8X21w` を付ける。
- 検証：`npm run verify`（Docker と Node 24 が要る）は、持ち主の Mac と CI で通す。このクラウドの環境では Node 22 とローカルの PostgreSQL で、`npm test`・`npm run typecheck`・`npm run lint`・`npm run build`・対象の E2E を実行する。

## Review Focus

1. **取り込み済みの持ち主が Sparklingstadt ID でログインしたとき**：ひも付けた `github:` のユーザー（同じデータ）で入り、`sid:<sub>` の新しいユーザーができないこと。→ Task 3 のテスト `sid login of a linked sub opens the github account`。
2. **GitHub でアドレスを非公開にしているアカウント**：プロフィールの `email` が null でもログインでき、`email_not_found` にならないこと。→ Task 3 のテスト `github login works without an email`。
3. **ログアウトのあとの Sparklingstadt ID のログイン**：`prompt=login` が付き、ID サーバーでパスワードを聞かれること。ログインが成功したら Cookie が消えること。→ Task 3 のテスト `sid login after sign-out asks for the password again`。
4. **本番の設定（`NODE_ENV=production`）での開発用ログイン**：エンドポイントが 404 で、`github:0` のセッションを作れないこと。→ Task 3 のテスト `local login is not found in production`。
5. **取り込みのマイグレーションを 2 回当てたとき**：ユーザーと account の行が増えず、エラーにならないこと。→ Task 2 のテスト `import migration is idempotent`。

---

### Task 1: Better Auth の土台（設定・表・シークレット）

**Files:**
- Modify: `package.json`（`better-auth@1.7.28`）
- Create: `src/server/betterAuth.ts`（`betterAuth(...)` の設定。providers と自前のプラグインは Task 3 で足す。この Task ではまだどこにも mount しない）
- Create: `src/server/authUser.ts`
- Modify: `prisma/schema.prisma`、Create: `db/migrations/0042_better_auth/migration.sql`
- Modify: `.env.example`、`scripts/setup-local.cjs`、`src/lib/localDevelopment.ts`（`AUTH_SECRET` を `BETTER_AUTH_SECRET` に）
- Modify: `infra/lib/app.ts`、`infra/test/full.test.ts`（Secrets Manager の `typle/BETTER_AUTH_SECRET` を足す。`AUTH_SECRET` は残す）
- Test: `tests/authUser.test.cjs`、`tests/migrate.test.cjs`（今のテストが新しいマイグレーションでも通ること）

**Interfaces:**
- Produces:
  - `export const auth`（`src/server/betterAuth.ts`）。
  - `accountEmail(accountId: string): string` は `${accountId}@users.invalid` を返す。
  - `betterAuthSettings(env: Record<string, string | undefined>): { secret: string, baseURL: string } | null` は、`BETTER_AUTH_SECRET` が空か `AUTH_URL` が http(s) の URL でないとき null を返す。
  - Prisma のモデル名は `AuthUser`・`AuthSession`・`AuthAccount`・`AuthVerification`（`@@map` で `typle_auth_*`）。Better Auth の `modelName` で対応させる。

- [ ] **Step 1: 失敗するテストを書く。** `tests/authUser.test.cjs`：
  - `accountEmail('github:219588180') === 'github:219588180@users.invalid'`。
  - `betterAuthSettings({ BETTER_AUTH_SECRET: 'x'.repeat(32), AUTH_URL: 'https://typle.sparklingstadt.com' })` が `{ secret: 'x'.repeat(32), baseURL: 'https://typle.sparklingstadt.com' }`。
  - `BETTER_AUTH_SECRET` が空なら null。
  - `AUTH_SECRET` だけがあっても null。
- [ ] **Step 2: 失敗を確かめる。** `node --test --test-isolation=none tests/authUser.test.cjs` が FAIL。
- [ ] **Step 3: 実装する。**
  - `src/server/authUser.ts` と `src/server/betterAuth.ts` を書く。`prismaAdapter` は `src/server/database.ts` の Prisma を使う。
  - session の設定：`expiresIn: 30*24*3600`、延長しない `updateAge`、`cookieCache: { enabled: true, maxAge: 300 }`。
  - `account.accountLinking.enabled: false`。`emailAndPassword` は使わない。
  - `databaseHooks.user.create.before`：Task 3 の provider が渡す `id` をそのまま使い（`forceAllowId`）、`email` を `accountEmail(id)`、`emailVerified` を true にする。
  - モデル、`0042_better_auth` マイグレーション、環境変数の名前の置き換え、infra を書く。
- [ ] **Step 4: 通ることを確かめる。** `npm test`、`npm run typecheck`、`npm run lint`、`npm run db:migrate`（ローカル）、`cd infra && npm test`、`npm run build` がすべて通る。
- [ ] **Step 5: コミットする。** `git commit -m "Better Auth の設定と表を足し、シークレットを BETTER_AUTH_SECRET にする"`

### Task 2: 今のアカウントとひも付けの取り込み（マイグレーション）

**Files:**
- Create: `db/migrations/0043_import_auth_accounts/migration.sql`
- Test: `tests/importAuthAccounts.test.cjs`（DB を使うテスト。今の `tests/api*.test.cjs` と同じく `TYPLE_TEST_DATABASE_URL` を使う）

**Interfaces:**
- Consumes: Task 1 の `typle_auth_users`・`typle_auth_accounts` と、`accountEmail` と同じ形の仮のアドレス。
- Produces: 取り込みの規則。
  - `typle_workspaces.owner_id` と `typle_records.owner_id` に現れるすべての ID について、`typle_auth_users`（`id`、`email = id || '@users.invalid'`、`email_verified = true`、`name = ''`）を作る。
  - `id` が `github:<数字>` のユーザーには、`provider_id = 'github'`、`account_id = <数字>` の account を作る。
  - `typle_sid_links` の各行 (`sub`, `account_id`) について、`user_id = account_id` のユーザーに `provider_id = 'sid'`、`account_id = sub` の account を作る。
  - `id` が `sid:<sub>` のユーザー（ひも付けのない ID）には、`provider_id = 'sid'`、`account_id = <sub>` の account を作る。
  - すべて `ON CONFLICT DO NOTHING`。account の id は `gen_random_uuid()::text`。

- [ ] **Step 1: 失敗するテストを書く。** `tests/importAuthAccounts.test.cjs`：
  - `import migration creates users and accounts`：次の行を入れてから migration.sql を当てる。
    - `github:111` のワークスペース
    - `sid:abc` の記録
    - ひも付け `('zzz', 'github:111')`
  - 当てたあと、次の 4 行がちょうどあること。
    - ユーザー `github:111`（email `github:111@users.invalid`）
    - ユーザー `sid:abc`
    - account `('github','111')` → `github:111`
    - account `('sid','zzz')` → `github:111`
    - account `('sid','abc')` → `sid:abc`
  - `import migration is idempotent`：2 回当てても行の数が同じ。
- [ ] **Step 2: 失敗を確かめる。** `node --test --test-isolation=none tests/importAuthAccounts.test.cjs` が FAIL。
- [ ] **Step 3: SQL を書く。**
- [ ] **Step 4: 通ることを確かめる。** 上のテスト、`npm test`、`npm run db:migrate` が通る。
- [ ] **Step 5: コミットする。** `git commit -m "今のアカウントと Sparklingstadt ID のひも付けを Better Auth の表に取り込むマイグレーションを足す"`

### Task 3: ログインの方法と /api/auth（GitHub・Sparklingstadt ID・開発用）

**Files:**
- Modify: `src/server/betterAuth.ts`（`socialProviders.github`、`genericOAuth`、自前のプラグイン）
- Rewrite: `src/server/sidLogin.ts`（`sidProfile` は残す。`typle-sid-relogin` の仕組みを Better Auth の sign-out と sign-in につなぐ）
- Create: `src/server/localLogin.ts`（開発用ログインのプラグイン）
- Create: `src/server/authPaths.ts`（許可リスト）
- Create: `src/app/api/auth/[...all]/route.ts`。Delete: `src/app/api/auth/[...nextauth]/route.ts`。`src/auth.ts` は Task 6 で消す。この Task では `[...all]` のほうが答えるようにする。
- Modify: `tests/e2e/fakeSid.cjs`（callback の URL は今と同じ `/api/auth/callback/sid`）
- Test: `tests/betterAuthProviders.test.cjs`、`tests/e2e/sid-login.spec.ts`、`tests/e2e/github-login.spec.ts`（新規）、`tests/e2e/removed.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `auth`・`accountEmail`。
- Produces:
  - `githubUser(profile: { id: number|string, login: string, name?: string|null, avatar_url: string }): { id: string, name: string, image: string, email: string, emailVerified: true }`。名前の決め方は今の `githubProfile` と同じ。
  - `sidUser(claims: SidClaims): { id: string, name: string, image: '', email: string, emailVerified: true }`。今の `sidProfile` の確かめを含み、合わなければ throw。
  - `authPathAllowed(method: string, pathname: string, settings: { localLogin: boolean }): boolean`。
  - 許可リスト：
    - `GET /api/auth/get-session`
    - `POST /api/auth/sign-out`
    - `POST /api/auth/sign-in/social`（GitHub）
    - `GET /api/auth/callback/github`
    - `POST /api/auth/sign-in/oauth2`（sid）
    - `GET /api/auth/callback/sid`（訂正：`/oauth2/` は付かない）
    - 開発用ログインのエンドポイント（`localLogin` のときだけ）
    - ほかは 404。
  - ログインしているユーザーは、`account` の行の `user_id` で決まる。`sid` の `sub` がひも付いていれば、そのユーザーで入る。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/betterAuthProviders.test.cjs`：
    - `githubUser({ id: 219588180, login: 'x', name: ' ', avatar_url: 'a' })` が `{ id: 'github:219588180', name: 'x', image: 'a', email: 'github:219588180@users.invalid', emailVerified: true }`。
    - `sidUser({ sub: 'abc', email_verified: false })` が throw。
    - `sidUser({ sub: 'ABC', email_verified: true })` が throw。
    - `authPathAllowed('GET', '/api/auth/session', { localLogin: false }) === false`。
    - `authPathAllowed('GET', '/api/auth/callback/sid', …) === true`。
  - E2E（偽の ID サーバー `fakeSid.cjs` を使う）：
    - `sid login of a linked sub opens the github account`：`github:<n>` のユーザーとワークスペースと sid の account を DB に入れる。その sub でログインすると、`/api/auth/get-session` の `user.id` が `github:<n>`。
    - `sid login of a new sub makes sid:<sub>`。
    - `sid login with an unverified address is refused`：`/signin?error=` に戻り、セッションはない。
    - `sid login after sign-out asks for the password again`：sign-out のあとの次のログインで、ID サーバーへの authorize に `prompt=login` が付く。ログインが成功したあとは付かない。
    - `github login works without an email`：ログイン開始の POST が `https://github.com/login/oauth/authorize?` へ向かい、`redirect_uri` が `<AUTH_URL>/api/auth/callback/github`、scope が空。callback 側は、偽の GitHub のトークンと user の API を `page.route` で答えるか、`githubUser` の単体テストで、作る人が決める。email が null のプロフィールでユーザーが作られることを確かめる。
    - `local login is not found in production`（`removed.spec.ts`）：本番の設定のサーバーで、開発用ログインのパスと `/api/auth/session`・`/api/auth/providers`・`/api/auth/csrf` が 404。
- [ ] **Step 2: 失敗を確かめる。** `npm test` と `npx playwright test tests/e2e/sid-login.spec.ts tests/e2e/github-login.spec.ts tests/e2e/removed.spec.ts` が FAIL。
- [ ] **Step 3: 実装する。**
  - GitHub：`socialProviders.github` に `scope: []`（scope なし）と `mapProfileToUser` で `githubUser`。email がないときに断る動きは、`getUserInfo` か `mapProfileToUser` で避ける。
  - Sparklingstadt ID：`genericOAuth` で `providerId: 'sid'`、`discoveryUrl: <AUTH_SID_ISSUER>/.well-known/openid-configuration`、`scopes`、`pkce: true`。ID トークンの claims を `sidUser` に通す。
  - `user.id` を `account` から決める：`databaseHooks` か provider の `mapProfileToUser` で、新しいユーザーの id を `github:`／`sid:` にする。既存の account はそのユーザーにつながる。
  - 許可リストの before フック、開発用ログインのプラグイン、relogin の Cookie を書く。`readLoginSettings` の `localLogin` の条件は今と同じ。
- [ ] **Step 4: 通ることを確かめる。** 上のテスト、`npm test`、`npm run typecheck`、`npm run lint`、`npm run build` が通る。
- [ ] **Step 5: コミットする。** `git commit -m "GitHub・Sparklingstadt ID・開発用のログインを Better Auth で答える"`

### Task 4: サーバーのセッションの読み取りと「すべての端末からログアウト」

**Files:**
- Rewrite: `src/server/account.ts`（`signedIn` を Better Auth の `getSession` で書き直す。`revokedSoon`・`revokeLogins`・`readRevokedAt`・`currentUser`・`cookieValue` を消す）
- Modify: `src/server/accountApi.ts`（`signout-everywhere` は `auth.api.revokeUserSessions`／ユーザーのセッションの削除と、このブラウザーの Cookie の削除。Origin の確かめは残す）
- Modify: `src/server/workspace.ts`（`signedIn` の新しい形を使う）
- Rewrite: `tests/e2e/account.ts`（`signIn(context, accountId, name?)`：DB に `typle_auth_users`・`typle_auth_sessions` の行を作り、Better Auth の署名付き Cookie を置く）、Delete: `tests/e2e/sessionCookie.ts`
- Test: `tests/serverAccount.test.cjs`（書き直す）、`tests/e2e/sessions.spec.ts`、`tests/e2e/account.spec.ts`、ほか `signIn` を使う E2E 全部

**Interfaces:**
- Consumes: Task 1 の `auth`。
- Produces:
  - `signedIn(request: Request, db: Db): Promise<{ ok: true, user: { id: string, name: string, image: string } } | { ok: false, response: Response }>`。今の呼び出し側が使う形に合わせる。ログインしていなければ 401、DB に届かなければ 503（`databaseUnavailable`）。
  - E2E の `signIn(context: BrowserContext, accountId: string, name?: string): Promise<void>`。名前と引数は今のヘルパーと同じなので、呼び出し側は変えない。Cookie の値は Better Auth の形式（`<token>.<HMAC-SHA256(token, BETTER_AUTH_SECRET) base64>`）。作り方は Better Auth のソース（`better-call` の `signCookieValue`）に合わせる。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/e2e/sessions.spec.ts`：
    - `signout everywhere ends the other browser's session`：2 つのブラウザーで同じユーザーにログインし、片方で「すべての端末からログアウト」。もう片方は、Cookie のキャッシュの時間（設定値）を過ぎたあと `/api/workspace` が 401。
    - `a deleted session is signed out`：DB からセッションの行を消すと、キャッシュの時間のあとに 401。
    - `a login ends 30 days after it was made`：セッションの `expires_at` を過去にすると 401。
  - 今の `tests/e2e/account.spec.ts` などは、新しい `signIn` ヘルパーで通ること。
- [ ] **Step 2: 失敗を確かめる。** 上の E2E が FAIL。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4: 通ることを確かめる。** `npm test`、`npm run typecheck`、`npm run build`、E2E の全体（`npm run test:e2e`）が通る（macOS の screenshots は skip される）。
- [ ] **Step 5: コミットする。** `git commit -m "API のセッションの読み取りと、すべての端末からのログアウトを Better Auth のセッションにする"`

### Task 5: 画面のセッションとログインの画面

**Files:**
- Rewrite: `src/lib/session.tsx`（`next-auth/react` をやめ、`/api/auth/get-session` と Better Auth のクライアント（`better-auth/react` の `createAuthClient`、`genericOAuthClient`）を使う。export の名前と形 `SessionProvider`・`useSession`・`signInWithSid`・`signInWithGitHub`・`signOut`・`signOutEverywhere` は変えない）
- Modify: `src/app/signin/signin-form.tsx`・`page.tsx`（Better Auth のエラーを今の `?error=` の表示に対応させる）、`src/app/local-login/local-login-form.tsx`
- Test: `tests/e2e/account.spec.ts`・`welcome.spec.ts`・`guest.spec.ts` などログインの画面を通るもの、`tests/e2e/aria-snapshots.spec.ts`

**Interfaces:**
- Consumes: Task 3 の `/api/auth/*`。
- Produces：画面のコンポーネントから見た `@/lib/session` の API は変えない。
  - `useSession(): { data: { user: { id, name, image } } | null, status, update }`
  - `signInWithSid(returnTo)`・`signInWithGitHub(returnTo)`：開始できなければ reject。
  - `signOut()`：失敗なら reject、成功で `/home` に移る。
  - `signOutEverywhere()`

- [ ] **Step 1: 失敗するテストを書く。**
  - `session read failure keeps the app usable as a guest`：`/api/auth/get-session` を `page.route` で 500 にしても、再試行のあとゲストとして使える。今の動きのテストがあればそれを使う。
  - `sign-out returns home and the session is gone`。
  - `signin page shows the error for a refused login`：`/signin?error=…` で、今と同じ文言が出る。
- [ ] **Step 2: 失敗を確かめる。** 上の E2E が FAIL。
- [ ] **Step 3: 実装する。** 読み取りの再試行（`RETRY_DELAYS_MS`）とタイムアウト（`SESSION_TIMEOUT_MS`）は今の値のまま残す。
- [ ] **Step 4: 通ることを確かめる。** `npm run test:e2e`、`npm run lint`、`npm run build` が通る。
- [ ] **Step 5: コミットする。** `git commit -m "画面のセッションの読み取りとログイン・ログアウトを Better Auth のクライアントにする"`

### Task 6: Auth.js と自前の Cookie の削除、ひも付けのスクリプト、本番の確認、ドキュメント、バージョン

**Files:**
- Delete:
  - `src/auth.ts`、`src/server/authJwt.ts`
  - `src/server/session.ts` の Cookie の封と開封（ほかに使うものがなければファイルごと）
  - `src/server/authOptions.ts`（残す関数は Task 3 のファイルへ移したもの以外）、`src/server/sidLinks.ts`
  - `src/server/settings.ts` の `AUTH_SECRET` と鍵の導出
  - `next-auth` の依存
  - それらの単体テスト（`tests/authJwt.test.cjs`・`serverSession.test.cjs`・`authRevocation.test.cjs`・`authOptions.test.cjs` のうち消したもの）
  - Go の Cookie の fixtures を読むテスト（`tests/fixtures/sessions.json` を読むもの）
- Rewrite: `scripts/sid-link.cjs`（`npm run sid:link -- sid:<sub> <アカウント ID>`：`typle_auth_accounts` に `('sid', sub)` → アカウント ID の行を足す。今の安全の確かめは同じ）
- Modify: `scripts/check-production.cjs`（匿名の `/api/auth/get-session` が null、GitHub のログイン開始が本番の callback で GitHub へ、Sparklingstadt ID のログイン開始が ID サーバーへ向かう）と `tests/checkProduction.test.cjs`
- Modify:
  - `docs/architecture.md`（ログインのしくみ、Cookie、ひも付け）
  - `docs/development.md`（`BETTER_AUTH_SECRET`、開発用ログイン）
  - `docs/production.md`（環境変数。ID サーバーの登録は変わらない（訂正））
  - `docs/release-workflow.md` に関係があれば
  - `README.md`、`CHANGELOG.md`
- Modify: `package.json`・`package-lock.json`（`npm version minor` で `2.62.0`。その前に `git tag` と GitHub Releases でまだ使われていないことを確かめる）
- Test: `tests/sidLinks.test.cjs`（書き直す。今の同名のファイル）、`tests/checkProduction.test.cjs`

**Interfaces:**
- Consumes: Task 1〜5 の全部。
- Produces: リリースできる PR。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/sidLinks.test.cjs`：
    - `sid:link adds the sid account to the github user`。
    - `sid:link refuses a sub already linked`。
    - `sid:link refuses a target without saved data`。
    - `sid:link refuses when sid:<sub> already has data`。
  - `tests/checkProduction.test.cjs`：新しい確かめの成功と失敗。
- [ ] **Step 2: 失敗を確かめる。** `npm test` が FAIL。
- [ ] **Step 3: 実装する。** 消すものを消し、スクリプトと `check-production` を書き直し、ドキュメントを直す。`rg -n "next-auth|AUTH_SECRET[^_]|typle-session|authJwt" src scripts` が 0 件になること（`docs/` の歴史の記述は除く）。
- [ ] **Step 4: 通ることを確かめる。** `npm test`、`npm run typecheck`、`npm run lint`、`npm run knip`、`npm run build`、`cd infra && npm test`、`npm run test:e2e` が通る。
- [ ] **Step 5: バージョンを上げる。** `npm version minor --no-git-tag-version` で `2.62.0`。CHANGELOG に v2.62.0 を足す。
- [ ] **Step 6: コミットする。** `git commit -m "Auth.js と自前のログインの Cookie をなくし、ひも付けのスクリプトと本番の確認を Better Auth に合わせる"`
- [ ] **Step 7: 持ち主に渡す。** `npm run verify`（Node 24・Docker）は持ち主の Mac で通してもらう。ID サーバーの登録は変わらない（訂正：callback は今と同じ URL）。マージの前に、Vercel と AWS に `BETTER_AUTH_SECRET` を足してもらう（設計書 5 章）。
