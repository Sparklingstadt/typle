# デモアカウントでのログイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン画面のボタン1つで共有のデモアカウント `demo:shared` に入れるようにし、そのデータを毎日 4:00（日本時間）に見本へ戻す。

**Architecture:** 開発用ログイン（`src/server/localLogin.ts`）と同じ作りの Better Auth プラグインで `POST /api/auth/sign-in/demo` を足す。見本のワークスペースはコードで持ち、既存の `writeWorkspace` で書き直す（記録の入れ替えと revision の加算はそこに任せる）。Vercel Cron が `GET /api/demo/reset` を呼ぶ。

**Tech Stack:** Next.js 16 Route Handlers・Better Auth・Prisma・node:test・Playwright・next-intl

**Spec:** `docs/superpowers/specs/2026-11-28-demo-login-design.md`

## Global Constraints

- アカウント ID は `demo:shared`、保存する名前は `デモアカウント`、アドレスは `accountEmail('demo:shared')`。
- 有効になるのは環境変数 `DEMO_LOGIN=1` のときだけ。無効なら `/api/auth/sign-in/demo` と `/api/demo/reset` は 404、ボタンは出さない。
- cron は `Authorization: Bearer <CRON_SECRET>`。`CRON_SECRET` が空なら常に 401。`vercel.json` の schedule は `0 19 * * *`。
- `/sign-in/demo` の rate limit は 60 秒 20 回。
- 戻すときの revision は、今の値より大きくする（1 に戻さない）。デモのセッションは消さない。
- コードのコメントと識別子は英語、画面の文言・docs・コミットは日本語。文言は6言語（ja・en・fr・ru・zh-CN・zh-TW）すべてに足す（`tests/i18n.test.cjs` が揃っているかを見る）。

## Review Focus

1. 戻す処理と見学者の保存が同時に走る → 戻す側が Conflict になったら読み直してやり直す（3回まで）。見学者の側は 409 で読み直す。Task 3 のテストで、古い revision の保存が 409 になることを確かめる。
2. 見本の記録の日時が「今週」から外れる → `now` からの相対で作る。Task 2 のテストで、全記録が `now` の7日以内であることを確かめる。
3. デモが無効の本番で `/sign-in/demo` を叩く → 404。Task 1 のテスト。
4. デモアカウントが「すべての端末からログアウト」を呼ぶ → 403 `demoAccount`。Task 4 のテスト。
5. 公式パックのカタログが変わって、見本のフォロー先がなくなる → 見つからないパックは飛ばし、例外にしない。Task 2 のテスト（存在しない catalogId を渡して落ちない）。

---

### Task 1: デモのログイン（サーバー）

**Files:**
- Create: `src/server/demoLogin.ts`
- Modify: `src/server/authUser.ts`（`ACCOUNT_ID` に `demo:shared`）、`src/server/authPaths.ts`、`src/server/settings.ts`、`src/server/betterAuth.ts`、`.env.example`
- Test: `tests/authUser.test.cjs`、`tests/backendPaths.test.cjs` か `authPaths` を見ている既存のテスト、`tests/serverSettings.test.cjs`、`tests/betterAuth.test.cjs`

**Interfaces:**
- Produces: `DEMO_USER = { id: 'demo:shared', name: 'デモアカウント', image: '' }`、`DEMO_LOGIN_PATH = '/sign-in/demo'`（authPaths.ts）、`LoginSettings.demoLogin: boolean`（`env.DEMO_LOGIN === '1'`）、`authPathAllowed(method, pathname, { localLogin, demoLogin })`、`demoLogin(enabled: () => boolean): BetterAuthPlugin`。ユーザーを初めて作ったときに Task 3 の `onDemoUserCreated` を呼ぶフックの口は Task 3 で足す。

- [ ] Step 1: 失敗するテストを書く — `accountIdFromEmail('demo:shared@users.invalid') === 'demo:shared'`、`accountIdFromEmail('demo:x@users.invalid') === null`；`authPathAllowed('POST', '/api/auth/sign-in/demo', { localLogin: false, demoLogin: true }) === true`、`demoLogin: false` で `false`、`GET` で `false`；`readLoginSettings({ AUTH_URL: 'https://x.example', DEMO_LOGIN: '1' }).demoLogin === true`、`VERCEL: '1'` でも `true`、未設定で `false`；`auth.options.rateLimit.customRules['/sign-in/demo']` が `{ window: 60, max: 20 }`。
- [ ] Step 2: `npm test` で失敗を確かめる。
- [ ] Step 3: 実装する。`demoLogin` は `localLogin` と同じ形（`formCsrfMiddleware`、無効なら `APIError('NOT_FOUND')`、`findUserById ?? createUser`、`createSession`、`setSessionCookie`、`{ user }` を返す）。`betterAuth.ts` の plugins に `demoLogin(demoLoginOn)` を `localLogin` の次に足し、`authPaths` に `demoLoginOn` も渡す。`.env.example` に `DEMO_LOGIN=0` と `CRON_SECRET=` を説明付きで足す。
- [ ] Step 4: `npm test` で通るのを確かめる。
- [ ] Step 5: コミット「デモアカウントのログインをサーバーに足す」。

### Task 2: 見本のワークスペース

**Files:**
- Create: `src/server/demoWorkspace.ts`
- Test: `tests/demoWorkspace.test.cjs`

**Interfaces:**
- Consumes: `convertLibrary`（wordPacks.ts）、`followOfficialPack` と `officialPacks`（`src/lib/packs/catalog.ts`）、`DEFAULT_INTERESTS` か `INTEREST_OPTIONS` の id（interests.ts）、`decodeDocument`。
- Produces: `demoWorkspace(now: Date, catalogIds?: string[]): WorkspaceChange`（lists・packs・devices・interests をすべて持つ）。

- [ ] Step 1: 失敗するテストを書く — 戻り値が `decodeDocument` を通る；自分のリストが2件以上で、各リストに単語が5件以上；記録が10件以上あり、すべての `date` が `now - 7日` から `now` の間；フォローしたパックが2件（`origin.followed === true`）；`interests` が空でない；存在しない catalogId を混ぜても例外にならず、そのパックだけ飛ばす；同じ `now` で2回呼ぶと同じ結果（id がランダムでない）。
- [ ] Step 2: `node --test tests/demoWorkspace.test.cjs` で失敗を確かめる。
- [ ] Step 3: 実装する。自分のリストは `tests/e2e/snapshotData.ts` と同じ書き方（英単語・よく使う表現など、group 付き）で書き、`convertLibrary` でパックにする。フォローする既定の2件は `officialPacks()` から選んだ catalogId を定数にする（プログラミング1件・語学1件）。pack と list の id は `demo-` で始まる固定値。端末は1台（`{ id: 'demo', name: 'Demo', layout: 'US' }` のように `decodeDevices` が通す形）。
- [ ] Step 4: テストが通るのを確かめる。
- [ ] Step 5: コミット「デモアカウントの見本のデータを作る」。

### Task 3: 戻す処理と cron の API

**Files:**
- Create: `src/server/demoReset.ts`、`src/app/api/demo/reset/route.ts`
- Modify: `src/server/demoLogin.ts`（ユーザーを作ったら見本を書く）、`vercel.json`、`src/server/authPaths.ts` は触らない（/api/auth の外）
- Test: `tests/demoReset.test.cjs`（DB を使う。`tests/serverWorkspaceWrite.test.cjs` の準備の仕方に合わせる）

**Interfaces:**
- Consumes: `demoWorkspace`（Task 2）、`readWorkspace`・`writeWorkspace`・`Conflict`（workspace.ts）、`DEMO_USER`（Task 1）、`readLoginSettings().demoLogin`。
- Produces: `resetDemoWorkspace(db: Db, now?: Date): Promise<SavedWorkspace>`、`answerDemoReset(request: Request, open: () => Db, env?: Record<string, string | undefined>): Promise<Response>`。

- [ ] Step 1: 失敗するテストを書く — 何もない状態から `resetDemoWorkspace` で見本が入る；見学者がリストを1件消して保存したあと（revision n）に戻すと、見本のリストに戻り、revision が n より大きく、記録の件数が見本と同じ；戻したあと、古い revision n での `writeWorkspace` が `Conflict` になる；`answerDemoReset` は Bearer なしで 401、違う値で 401、`CRON_SECRET` 空で 401、`DEMO_LOGIN` が 1 でなければ 404、正しければ 200（`{ revision }` を返す）、GET 以外は 405。
- [ ] Step 2: テストが失敗するのを確かめる（`TYPLE_TEST_DATABASE_URL` を付けて）。
- [ ] Step 3: 実装する。`resetDemoWorkspace` は `readWorkspace` で今の revision（なければ 0）を読み、`writeWorkspace(db, 'demo:shared', revision, demoWorkspace(now))`。`Conflict` なら読み直して最大3回。Bearer の比較は `timingSafeEqual`。失敗は `reportFailure(request, error, 'demo.reset')` と 503 `databaseUnavailable`。route.ts は GET だけを受け、ほかは `methodNotAllowed(['GET'])`。`demoLogin` でユーザーを新しく作ったときは `resetDemoWorkspace(prisma)` を呼ぶ。`vercel.json` に `"crons": [{ "path": "/api/demo/reset", "schedule": "0 19 * * *" }]`。
- [ ] Step 4: テストが通るのを確かめる。
- [ ] Step 5: コミット「デモアカウントのデータを毎日見本に戻す」。

### Task 4: デモで「すべての端末からログアウト」を断る

**Files:**
- Modify: `src/server/accountApi.ts`、`src/components/Settings/SessionSettings.tsx`、`src/messages/*/errors.json`
- Test: `tests/serverAccount.test.cjs`

**Interfaces:**
- Consumes: `DEMO_USER.id`。
- Produces: エラーのキー `demoAccount`（403）。

- [ ] Step 1: 失敗するテストを書く — `demo:shared` のセッションで `answerSignOutEverywhere` が 403 で `error` が `demoAccount`、`revokeAll` が呼ばれない。
- [ ] Step 2: 失敗を確かめる。
- [ ] Step 3: `signedIn` のあとに `result.user.sub === DEMO_USER.id` なら `refuse(403, 'demoAccount')`。設定画面では `useSession()` のユーザー id が `demo:shared` のとき、そのボタンの代わりに「デモアカウントでは使えません」の一文を出す。6言語の文言を足す。
- [ ] Step 4: `npm test` と `npm run typecheck` が通るのを確かめる。
- [ ] Step 5: コミット「デモアカウントでは、すべての端末からのログアウトを断る」。

### Task 5: ログイン画面のボタンと E2E

**Files:**
- Modify: `src/lib/session.tsx`（`signInDemo`）、`src/app/signin/page.tsx`、`src/app/signin/signin-form.tsx`、`src/messages/*/account.json`、`playwright.config.ts`（`DEMO_LOGIN: '1'`、`CRON_SECRET: 'e2e-cron'`）
- Create: `tests/e2e/demo-login.spec.ts`
- Modify（必要なら）: `tests/e2e/aria-snapshots.spec.ts-snapshots`・`screenshots.spec.ts-snapshots` のログイン画面

**Interfaces:**
- Consumes: `POST /api/auth/sign-in/demo`、`GET /api/demo/reset`、`readLoginSettings().demoLogin`。
- Produces: `signInDemo(): Promise<void>`（`signInLocal` と同じ形、成功したら `location.assign(returnTo)`）。

- [ ] Step 1: 失敗する E2E を書く — `/signin` に「デモアカウントで試す」ボタンと、「毎日 4:00（日本時間）に元に戻ります」を含む注意がある；押すと `/home` に移り、ヘッダーにデモアカウントの名前、見本のリスト名、今週のまとめが見える；設定画面に「すべての端末からログアウト」ボタンがない；`/api/demo/reset` を `Bearer e2e-cron` で呼ぶと 200 で、リストを消したあとでも見本のリストに戻る。テストの最初に reset を呼んで状態を揃える。
- [ ] Step 2: `npm run build && npx playwright test tests/e2e/demo-login.spec.ts` で失敗を確かめる。
- [ ] Step 3: 実装する。`page.tsx` で `readLoginSettings()?.demoLogin` を読み `demo` を渡す。フォームのほかのボタンの下に区切り線、`variant="outline"` のボタン、注意文（`text-xs text-muted-foreground`）。文言キーは `account.signInDemo`・`account.demoNote`。ほかのログインがなくてもデモだけ出せるよう、`authUnavailable` の条件に `!demo` を足す。
- [ ] Step 4: E2E が通り、既存のスナップショットとの差がログイン画面のボタンだけであることを確かめてから、スナップショットを更新する（macOS で `--update-snapshots`）。
- [ ] Step 5: コミット「ログイン画面にデモアカウントのボタンを置く」。

### Task 6: ドキュメントとバージョン

**Files:**
- Modify: `README.md`（できること・ログインの行）、`docs/features.md`、`docs/production.md`（`DEMO_LOGIN`・`CRON_SECRET`・cron の時刻）、`CHANGELOG`/`docs/release-notes` の慣習に合わせた記録、`package.json`（`npm version minor --no-git-tag-version`、使われていない版であることを `git tag` と `gh release list` で確かめる）

- [ ] Step 1: 文書を書く。AWS へ移るときは EventBridge で同じ API を呼ぶ、と README か `docs/aws` に一言。
- [ ] Step 2: `npm run verify`（サンドボックスの外、フル）が通るのを確かめる。
- [ ] Step 3: コミット「デモアカウントの説明を書き、バージョンを上げる」。
