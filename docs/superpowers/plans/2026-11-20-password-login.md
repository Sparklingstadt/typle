# ID とパスワードでの登録・ログイン（Auth.js に移す）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログインを Auth.js（next-auth v5）に移し、ID・メールアドレス・パスワードでの登録、ログイン、メール（Resend）での再設定を足す。

**Architecture:** Auth.js の JWT セッションを使う。ただし `jwt.encode`・`decode` と Cookie の名前を差し替えて、今と同じ `typle-session` の形（`src/server/session.ts` の `sealSession`・`openSession`）を保つ。こうすると、今ログインしている人も、Go・Kotlin も、E2E の偽の Cookie（`tests/e2e/sessionCookie.ts`）もそのまま通る。登録・確認・再設定・回数の制限は、`src/server` の自前のモジュールと `/api/account/*` の Route Handler で書く。

**Tech Stack:** Next.js 16.4、next-auth@5（beta）、PostgreSQL（`pg`）、Node.js の `crypto.scrypt`、Resend の REST API（fetch）、node --test、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-20-password-login-design.md`（実装の前に読む）。リポジトリの `AGENTS.md` のとおり、Next.js のコードを書く前に `node_modules/next/dist/docs/` の該当する文書を読む。

## Global Constraints

- バージョンは `2.55.0`。元にするのは `remove-ffpf-login`（v2.54.0）の上の `password-login` ブランチ。
- コードのコメントと識別子は英語、文書・コミット・PR は日本語（`CLAUDE.md`）。
- **セッションの Cookie**:
  - 名前は `AUTH_URL` が HTTPS なら `__Host-typle-session`、それ以外は `typle-session`。
  - `HttpOnly`・`SameSite=Lax`・`Path=/`。
  - 中身は `{sub,name,image,iat,exp}` を HMAC-SHA256 で署名したもの（鍵は `AUTH_SECRET` から HKDF、info `typle session v1`）。
  - `exp = iat + 2592000`（30日）で、延長しない。
- **アカウント ID**: `github:\d+`・`password:<UUID 小文字>`・`ffpf:[a-z0-9]{1,64}`（`ffpf:` は v2.53.1 までのログインが切れるまで）。開発用のログインは `github:0`。
- **ID**: `^[a-z0-9_-]{3,32}$`（小文字にしてから判定）。大文字と小文字は区別しない。
- **パスワード**: 10〜128文字。小文字にした ID と同じものは不可。
- **メールのリンク**: 確認は24時間、再設定は30分で切れる。どちらも1回だけ使える。トークンは32バイトの乱数を base64url にしたもの。DB には SHA-256 の hex を持つ。
- **回数の制限**:

  | 操作 | 単位 | 回数 | 期間 |
  |---|---|---|---|
  | ログインの失敗 | ID | 5回で15分止める | 15分 |
  | ログインの失敗 | IP | 30回で止める | 15分 |
  | 登録 | IP | 5件まで | 1時間 |
  | メール（再設定・ID の通知・確認の送り直し） | ID かアドレス | 3通まで | 1時間 |
  | メール（同上） | IP | 10回まで | 1時間 |

  IP は `x-forwarded-for` の最初の値で数える。
- **環境変数**:
  - `RESEND_API_KEY`・`TYPLE_MAIL_FROM` を新しく使う。
  - `TYPLE_RESEND_URL`（既定 `https://api.resend.com/emails`）は、テストのための差し替え口。
  - Auth.js は `AUTH_SECRET`・`AUTH_URL`・`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` を読む（今の名前のまま）。
- **書き込みの API**:
  - `/api/account/*` は Origin が `AUTH_URL` のオリジンと同じで、JSON のものだけ受け付ける（`src/server/request.ts` の `jsonContent`、今の workspace と同じ）。
  - 答えのエラーは `{"error":"<key>"}`（`src/server/response.ts` の `refuse`）。
- 画面の文言は6言語（ja・en・zh-CN・zh-TW・ru・fr）。新しい名前空間は `src/i18n/messages.ts` の一覧と `messageTypes` に足す。
- 失敗の報告は `src/server/report.ts` の `reportFailure(request, error, operation)`。

## Review Focus

1. **すでにログインしている GitHub の人**: 移したあとも、同じ Cookie でワークスペースが開け、ログアウトされない。期待どおりの動きは「そのまま使える」。→ Task 1 のテストで `tests/fixtures/sessions.json` の Cookie を decode する。
2. **パスワードの誤りと存在しない ID**: 答えの文言も、かかる時間の桁も同じになる。→ Task 6 のテストで、両方とも `null` を返し、存在しない ID でも scrypt を1回動かす（呼び出しを数える）。
3. **大文字の ID・前後の空白**: `Alice` で登録したあと `alice ` でログインできる。ID の前後の空白は落とし、パスワードの空白は落とさない。→ Task 3 と Task 6 のテスト。
4. **同じ ID の同時登録**: 一意の制約にぶつかったら `409 loginIdTaken` を返す。500 にはしない。→ Task 7 のテスト。
5. **使い終わった・期限切れの・別の種類のリンク**: 再設定のリンクを確認に使う、などのとき。どれも同じ `400 invalidToken` を返し、DB を変えない。→ Task 5 と Task 8 のテスト。

---

## File Structure

| ファイル | 役目 |
|---|---|
| `src/auth.ts`（新） | `NextAuth({...})`。プロバイダー・Cookie・jwt の差し替え・コールバック。`handlers, auth, signIn, signOut` を出す |
| `src/server/authJwt.ts`（新） | Auth.js の token と今のセッションの形を行き来する `encodeSession`・`decodeSession` |
| `src/app/api/auth/[...nextauth]/route.ts`（新） | `export const { GET, POST } = handlers` |
| `src/server/session.ts`（直す） | セッションの部分だけ残す。アプリのコードと OAuth の Cookie（`AppCode`・`PendingLogin` ほか）は消す。`ACCOUNT_SUB` に `password:` を足す |
| `src/server/account.ts`（直す） | `currentUser` から Bearer をなくす |
| `src/server/request.ts`（直す） | `fromApp`・`fromAppOrOrigin` をなくし、Origin だけで判定する |
| `src/server/password.ts`（新） | scrypt でのハッシュ化と照合 |
| `src/lib/accountRules.ts`（新） | ID・パスワード・メールアドレスの決まり（画面とサーバーで共有） |
| `src/server/users.ts`（新） | `typle_users` の読み書き |
| `src/server/limits.ts`（新） | `typle_auth_limits` での回数の制限 |
| `src/server/emailTokens.ts`（新） | `typle_email_tokens` の発行と消費 |
| `src/server/mail.ts`（新） | Resend への送信と、3種類のメールの本文 |
| `src/server/accountApi.ts`（新） | `/api/account/*` の答え |
| `src/app/api/account/<op>/route.ts`（新） | signup・verify・resend-verification・forgot-password・reset-password・forgot-id・change-password・signout-everywhere |
| `db/migrations/0039_password_accounts/migration.sql`（新） | 3つの表 |
| `src/lib/session.tsx`（直す） | `/api/auth/session`（Auth.js の答え）を読む。signIn・signOut は `next-auth/react` に任せる |
| `src/app/signin`・`signup`・`verify-email`・`forgot-password`・`reset-password`・`forgot-id`（新） | 画面 |
| `src/components/Settings/AccountSettings.tsx`（新） | 設定の「アカウント」の節 |
| 消すもの | `src/server/{signin,auth,github,provider,goUrl}.ts`、`src/app/api/auth/{signin,callback,session,signout,token,local}/`、`tests/{apiSignin,apiAuth,serverSettings の login 部分,...}` のうち消したコードのテスト |

---

### Task 1: Auth.js を入れ、セッションを今の形のまま Auth.js に任せる（GitHub）

**Files:**
- Create: `src/auth.ts`, `src/server/authJwt.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `tests/authJwt.test.cjs`
- Modify: `package.json`（`next-auth@5` の beta を固定の版で入れる）, `src/server/session.ts`, `src/server/settings.ts`
- Delete: `src/server/{signin,auth,github,provider,goUrl}.ts`、`src/app/api/auth/{signin,callback,session,signout,token,local}/`、それらのテスト（`tests/apiSignin.test.cjs`・`tests/apiAuth.test.cjs`・`tests/serverGithub*`・`tests/goUrl*` など、消したモジュールを読むもの）。fixture の `signin-answers.json`・`auth-answers.json` は記録として残す。

**Interfaces:**
- Produces:
  - `encodeSession(token: JWT, key: Buffer, now?: number): string`
    - `token.sub`・`name`・`picture`（→ image）・`iat`・`exp` から `sealSession` で作る。
    - `token.iat`・`exp` があればそのまま使う（延長しない）。なければ `newSession` で作る。
  - `decodeSession(value: string, key: Buffer, now?: number): JWT | null`
    - `openSession` の結果を `{ sub, name, picture: image, iat: issuedAt, exp: expires }` にする。
  - `src/auth.ts` は `export const { handlers, auth, signIn, signOut } = NextAuth(config)` を出す。
    - `config.session = { strategy: 'jwt', maxAge: 2592000 }`
    - `config.cookies.sessionToken.name` は `sessionCookieName(secure)`。
    - `trustHost: true`
    - GitHub のプロバイダーの `profile()` で `id: 'github:' + profile.id` にし、`name` は名前が空白だけなら login にする。
    - jwt コールバックで `token.sub = user.id`。
    - session コールバックで、`session.user.id = token.sub` にし、`session.expires` を `exp` から作る。
  - `readLoginSettings` から `appKey`・`codeKey`・`oauthKey`・`github` をなくす。`sessionKey`・`origin`・`secure`・`localLogin` は残す。

- [ ] **Step 1: 失敗するテストを書く**（`tests/authJwt.test.cjs`）
  - `decodeSession` が `tests/fixtures/sessions.json` の有効な Cookie をすべて開き、`sub` が fixture と同じになる。
  - `encodeSession(decodeSession(v))` が `v` と同じ文字列になる（形が変わらない、延長しない）。
  - `iat`・`exp` のない token を `encodeSession` すると、`exp - iat === 2592000` になる。
  - 期限切れや署名違いの値は `null` になる。
- [ ] **Step 2:** `npm test` を流し、`authJwt` が `Cannot find module` で落ちることを確かめる。
- [ ] **Step 3:** `next-auth` を入れる。`src/server/authJwt.ts`・`src/auth.ts`・route を書く。古いログインのファイルを消し、`session.ts`・`settings.ts` から使わなくなったものを消す。
- [ ] **Step 4:** `npm run verify -- --fast` を流し、PASS することを確かめる。
  - typecheck で古い生成物の型の誤りが出たら、`.next-production/types` を消して流し直す。
  - knip が使われていない export を挙げたら消す。
- [ ] **Step 5: コミットする**: 「ログインを Auth.js に移し、セッションの Cookie は今の形のままにする」

### Task 2: 失効・すべての端末からのログアウト・Bearer をなくす

**Files:**
- Create: `src/app/api/account/signout-everywhere/route.ts`, `tests/authRevocation.test.cjs`
- Modify: `src/auth.ts`（jwt コールバック）, `src/server/account.ts`, `src/server/request.ts`, `src/server/workspace.ts`（`fromApp` を使うところ）
- Create: `src/server/accountApi.ts`（`answerSignOutEverywhere(request, open, settings, now)` から始める）

**Interfaces:**
- Produces:
  - `revokedSoon(open: () => Pool, sub: string, issuedAt: number): Promise<boolean | null>`（`src/server/account.ts`）
    - 失効の表を最大1000ミリ秒待って読む。間に合わないか失敗したら `null` を返し、`console.warn` に `session.check:` を書く。今の `auth.ts` の `revokedSoon` を移したもの。
  - jwt コールバック: 既存の token のとき、`revokedSoon(...) === true` なら `null` を返す（Auth.js がセッションと Cookie を消す）。
  - `POST /api/account/signout-everywhere`
    - Origin を確かめる → `signedIn` → 失効の表に upsert → `204` と、Cookie を消す `Set-Cookie`。
    - 失敗したら `503 databaseUnavailable`。答えと SQL は、今の `auth.ts` の signout（everywhere）と同じ。
  - `fromAppOrOrigin` は `sameOrigin(request: Request, origin: string): boolean` に置き換える。

- [ ] **Step 1: 失敗するテストを書く**
  - `revokedSoon` は、失効の前の `iat` なら `true`、後なら `false`、DB が止まっていれば1000ミリ秒あまりで `null`。
  - signout-everywhere は、Origin がなければ `403 forbiddenRequest`、Cookie がなければ `401 loginRequired`、成功すると `204` で `typle-session=; ... Max-Age=0` を返す。
  - `currentUser` は、`Authorization: Bearer <有効なトークン>` があっても `null` を返す（DB のテストは今の `TYPLE_TEST_DATABASE_URL` で skip の扱いを合わせる）。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。workspace・records の Route Handler が `fromApp` に頼っていたところ（Origin の確認と Cookie の削除の判断）を、Origin だけの判定に直す。
- [ ] **Step 4:** `npm run verify -- --fast` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「すべての端末からのログアウトを /api/account に移し、アプリのトークンをやめる」

### Task 3: 画面のセッションと開発用のログインを Auth.js につなぐ

**Files:**
- Modify: `src/lib/session.tsx`, `src/components/AccountBar.tsx`, `src/components/Settings/SessionSettings.tsx`, `src/app/local-login/local-login-form.tsx`, `src/auth.ts`（Credentials `local`）, `src/app/layout.tsx` など `SessionProvider` を置くところ
- Create: `src/app/signin/page.tsx`（この段階では GitHub のボタンだけ）
- Test: `tests/e2e/account.spec.ts`・`sessions.spec.ts`・`removed.spec.ts` を直す

**Interfaces:**
- Consumes: Task 1・2 の `/api/auth/session`（`{ user: { id, name, image } | null, expires }`、ログインしていなければ `null` か `{}`）、`/api/account/signout-everywhere`。
- Produces:
  - `src/lib/session.tsx` は、`useSession(): { data, status, update }`・`SessionProvider`・`signOut(): Promise<void>`・`signOutEverywhere(): Promise<void>`・`signInWithGitHub(returnTo: string): Promise<void>` を出す。
  - 読み込み、やり直し（1・2・4秒）、失敗のときに前の状態を保つ動きは、今の実装のまま残す。
  - 答えの読み方だけを Auth.js の形に直す。本文が `null` か `user` のないものは「未ログイン」として扱う。
  - signIn・signOut は `next-auth/react` の `signIn('github', { redirectTo })`・`signOut({ redirect: false })` を呼ぶ。失敗したら reject する。
  - Credentials `local`:
    - `authorize` は `readLoginSettings().localLogin` が真のときだけ `{ id: 'github:0', name: 'ローカル練習用', image: '' }` を返す。
    - フォームは `signIn('local', { redirect: false })` を呼ぶ。
  - トップバーの「ログイン」は `/signin?returnTo=<今のパス>` へ行く。

- [ ] **Step 1: E2E を直して、落ちることを確かめる**
  - `removed.spec.ts` の「the sign-in is GitHub alone」を、「`/signin` に GitHub のボタンがある」という確認に直す。
  - `/api/auth/token`・`/api/auth/local` が 404 であることを足す。
  - `account.spec.ts` のログアウトの失敗を偽装するテストは、`**/api/auth/signout` を 500 にしたときに、ログインしたまま「ログアウトできませんでした」が出ることを確かめる。
- [ ] **Step 2:** `npx playwright test tests/e2e/account.spec.ts tests/e2e/removed.spec.ts` を流し、FAIL することを確かめる。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm run verify` を流す（E2E も含めた full）。PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「画面のセッションと開発用のログインを Auth.js につなぐ」

### Task 4: アカウントの表、ID とパスワードの決まり、パスワードのハッシュ化

**Files:**
- Create: `db/migrations/0039_password_accounts/migration.sql`, `src/lib/accountRules.ts`, `src/server/password.ts`, `src/server/users.ts`, `tests/accountRules.test.cjs`, `tests/password.test.cjs`, `tests/users.test.cjs`

**Interfaces:**
- Produces:
  - SQL:
    - `typle_users(id uuid PK DEFAULT gen_random_uuid(), login_id text NOT NULL UNIQUE, email text NOT NULL, email_verified_at timestamptz, password_hash text NOT NULL, locale text NOT NULL, created_at/updated_at timestamptz NOT NULL DEFAULT now())`
    - `typle_email_tokens(token_hash text PK, user_id uuid NOT NULL REFERENCES typle_users ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('verify','reset')), email text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz)`
    - `typle_auth_limits(key text PK, count integer NOT NULL, window_start timestamptz NOT NULL, blocked_until timestamptz)`
  - `normalizeLoginId(raw: string): string`（前後の空白を落として小文字にする）
  - `loginIdProblem(id: string): 'loginIdFormat' | null`
  - `passwordProblem(password: string, loginId: string): 'passwordLength' | 'passwordSameAsId' | null`
  - `emailProblem(email: string): 'emailFormat' | null`（`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`、254文字まで）
  - `normalizeEmail(raw: string): string`
  - `hashPassword(password: string): Promise<string>`
    - 形は `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`。N=32768、r=8、p=1、塩16バイト、長さ64、`maxmem: 64 * 1024 * 1024`。
  - `verifyPassword(password: string, stored: string | null): Promise<boolean>`
    - `stored` が `null` のときも、固定のダミーで scrypt を1回動かしてから `false` を返す。比べるときは `timingSafeEqual` を使う。
  - `createUser(db, { loginId, email, passwordHash, locale }): Promise<{ id: string } | 'taken'>`（一意の違反 `23505` のとき `'taken'`）
  - `findUserByLoginId(db, loginId)`・`findUserById(db, id)`: `Promise<UserRow | null>`
    - `UserRow = { id, loginId, email, emailVerifiedAt: Date | null, passwordHash, locale }`
  - `setPassword(db, id, passwordHash)`、`markEmailVerified(db, id, email)`（そのときのアドレスが `email` と同じときだけ）
  - `findVerifiedLoginIdsByEmail(db, email): Promise<string[]>`

- [ ] **Step 1: 失敗するテストを書く**
  - `normalizeLoginId(' Alice ') === 'alice'`。
  - `loginIdProblem` は `'ab'`・33文字・`'a b'`・`'あいう'` で `'loginIdFormat'`。
  - `passwordProblem('short', 'x') === 'passwordLength'`、129文字でも `'passwordLength'`。
  - `passwordProblem('alice12345', 'alice12345') === 'passwordSameAsId'`。
  - `verifyPassword` は、正しいもので `true`、違うもので `false`、`stored = null` でも `false`。どの場合も scrypt を1回呼ぶ。
  - `createUser` は、同じ ID の2回目で `'taken'`。
  - 確認していないアドレスの ID は、`findVerifiedLoginIdsByEmail` に出ない。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。`tests/migrate.test.cjs` が新しいマイグレーションを数えていれば、合わせる。
- [ ] **Step 4:** `npm run verify -- --fast` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「ID とパスワードのアカウントの表と、パスワードのハッシュ化を足す」

### Task 5: 回数の制限とメールのトークン

**Files:**
- Create: `src/server/limits.ts`, `src/server/emailTokens.ts`, `tests/limits.test.cjs`, `tests/emailTokens.test.cjs`

**Interfaces:**
- Produces:
  - `type Limit = { key: string, max: number, windowSeconds: number, blockSeconds?: number }`
  - `isBlocked(db, key, now?): Promise<boolean>`
  - `countHit(db, limit, now?): Promise<{ blocked: boolean }>`
    - 1つの SQL で upsert する。期間が過ぎていれば1からやり直す。`max` に届いたら `blocked_until = now + (blockSeconds ?? windowSeconds)` にする。
  - `clearHits(db, key)`: ログインに成功したら、その ID の失敗の記録を消す。
  - `clientIp(request: Request): string`: `x-forwarded-for` の最初の値の前後の空白を落としたもの。なければ `'unknown'`。
  - 制限の決まりは `LIMITS` として1か所にまとめる。値は Global Constraints の表のとおり。
    - `loginFailId(id)`・`loginFailIp(ip)`・`signupIp(ip)`・`mailTarget(idOrEmail)`・`mailIp(ip)`
  - `issueToken(db, { userId, kind, email, ttlSeconds }): Promise<string>`: 生のトークンを返し、DB にはハッシュだけを持つ。
  - `consumeToken(db, raw, kind, now?): Promise<{ userId: string, email: string } | null>`
    - 1つの `UPDATE ... SET used_at = now() WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at > now() RETURNING ...` でする。

- [ ] **Step 1: 失敗するテストを書く**
  - ID の失敗を5回数えると `isBlocked` が真になる。15分と1秒後には偽になる（`now` を渡して確かめる）。
  - `clientIp` は `'1.2.3.4, 5.6.7.8'` で `'1.2.3.4'`。
  - トークンは1回目の `consumeToken` で行を返し、2回目は `null`。
  - kind を違えると `null`、期限切れも `null`。
  - DB の `token_hash` は生のトークンと違い、長さ64の hex。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「ログインとメールの回数の制限と、メールのトークンを足す」

### Task 6: ID とパスワードのログイン（Credentials `password`）

**Files:**
- Modify: `src/auth.ts`, `src/server/session.ts`（`ACCOUNT_SUB` に `password:[0-9a-f-]{36}` を足す）
- Create: `src/server/passwordLogin.ts`, `tests/passwordLogin.test.cjs`

**Interfaces:**
- Consumes: Task 4 の `findUserByLoginId`・`verifyPassword`・`normalizeLoginId`、Task 5 の `isBlocked`・`countHit`・`clearHits`・`clientIp`・`LIMITS`。
- Produces:
  - `authorizePassword(db, credentials: { loginId?: unknown, password?: unknown }, ip: string, now?): Promise<{ id: string, name: string, image: '' } | null>`
  - 順番:
    1. 形が違えば `null`。
    2. ID か IP が止まっていれば、`verifyPassword(password, null)` を動かしてから `null`。
    3. 照合する。失敗したら、ID と IP の失敗を数えて `null`。
    4. 成功したら、ID の失敗を消して `{ id: 'password:' + user.id, name: user.loginId, image: '' }` を返す。
  - `src/auth.ts` の Credentials `password` は、`authorize` で `authorizePassword(pool(), credentials, clientIp(request))` を呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**
  - 正しい ID とパスワード（大文字、前後の空白つき）で `password:<uuid>` が返る。
  - パスワードの誤りと存在しない ID はどちらも `null`。どちらも scrypt を1回呼ぶ。
  - 5回失敗すると、正しいパスワードでも `null` になる。
  - 成功すると、その ID の失敗の記録が消える。
  - `openSession` が `password:` の sub を受け付ける。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「ID とパスワードでログインできるようにする」

### Task 7: メールの送信と登録

**Files:**
- Create: `src/server/mail.ts`, `src/messages/<6言語>/mail.json`, `src/app/api/account/signup/route.ts`, `tests/mail.test.cjs`, `tests/accountSignup.test.cjs`
- Modify: `src/server/accountApi.ts`, `src/i18n/messages.ts`・`messageTypes`（`mail` はサーバーだけで使うので `clientMessages` から外す）

**Interfaces:**
- Produces:
  - `sendMail(to: string, subject: string, text: string): Promise<void>`
    - `POST ${TYPLE_RESEND_URL ?? 'https://api.resend.com/emails'}` に、`Authorization: Bearer ${RESEND_API_KEY}` と JSON `{ from: TYPLE_MAIL_FROM, to: [to], subject, text }` を送る。
    - 2xx でなければ throw する。キーか送信元がなければ `Error('mail is not configured')` を throw する。
  - `verifyMail(locale, link)`・`resetMail(locale, link)`・`loginIdsMail(locale, ids: string[])`: `{ subject, text }` を返す。
    - リンクは `${origin}/verify-email?token=…`・`${origin}/reset-password?token=…`。
  - `POST /api/account/signup`、本文 `{ loginId, email, password }`:
    1. Origin と JSON を確かめる。
    2. 形が違えば `400 <loginIdFormat|passwordLength|passwordSameAsId|emailFormat>`。
    3. IP の登録数が上限なら `429 tooManyRequests`。
    4. `createUser` が `'taken'` なら `409 loginIdTaken`。
    5. 確認のトークンを発行し、`sendMail` する。送れなくても登録は成功にし、答えの `mailSent` を `false` にする。
    6. `201 { loginId, mailSent: boolean }` を返す。
  - 画面はこの答えのあと、`signIn('password', { loginId, password, redirect: false })` でログインする。
  - locale は Cookie（`LOCALE_COOKIE`）から読む。

- [ ] **Step 1: 失敗するテストを書く**
  - `sendMail` が、偽の Resend（`node:http` を 127.0.0.1 で立てる）に、期待どおりの本文とヘッダーを送る。
  - 偽の Resend が 500 を返すと throw する。
  - signup は、成功で `201`・`mailSent: true`、メールの本文に `/verify-email?token=` が入る。
  - 同じ ID（大文字違い）で `409 loginIdTaken`。
  - 6件目の登録が `429`。
  - Origin がなければ `403 forbiddenRequest`。
  - 偽の Resend が 500 を返すと、`201`・`mailSent: false` で、ユーザーはできている。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「登録と、Resend でのメールの送信を足す」

### Task 8: 確認・再設定・ID の通知・パスワードの変更の API

**Files:**
- Create: `src/app/api/account/{verify,resend-verification,forgot-password,reset-password,forgot-id,change-password}/route.ts`, `tests/accountRecovery.test.cjs`
- Modify: `src/server/accountApi.ts`

**Interfaces:**
- Consumes: Task 4〜7。
- Produces: どれも POST で JSON を受け、Origin を確かめる。
  - `verify { token }`:
    - `consumeToken(..., 'verify')` して `markEmailVerified` し、`200 {}` を返す。
    - 使えないトークンは `400 invalidToken`。
  - `resend-verification {}`:
    - ログインが要る（`signedIn`。`password:` のアカウントだけ。ほかは `400 notPasswordAccount`）。
    - 確認済みなら `200 { alreadyVerified: true }`。
    - 制限を超えたら `429`。
    - 送ったら `200 { mailSent }`。
  - `forgot-password { loginId }`:
    - いつも `200 {}` を返す。
    - ID があり、確認済みのアドレスがあり、制限の内なら、再設定のトークン（30分）を送る。
  - `reset-password { token, password }`:
    1. パスワードの形を確かめる（ID はトークンの持ち主のもの）。
    2. `consumeToken(..., 'reset')` で `setPassword` し、`markEmailVerified` する。
    3. 失効の表に書く（`revoked_at = now()`）。
    4. `200 { loginId }` を返す。画面はこのあと `signIn('password', …)` でログインし直す。
    - 使えないトークンは `400 invalidToken`。
    - 発行し直すセッションの `iat` が `revoked_at` と同じ秒にならないように、失効の時刻は `now() - interval '1 second'` で書く。こうしても、ほかの端末のログインは消える。理由をコメントに書く。
  - `forgot-id { email }`:
    - いつも `200 {}` を返す。
    - そのアドレスで確認済みの ID があり、制限の内なら、一覧を送る（入力したときの表示言語で）。
  - `change-password { currentPassword, newPassword }`:
    1. ログインが要る。今のパスワードが違えば `400 wrongPassword`。違ったときも、ログインの失敗として数える。
    2. `setPassword` し、失効の表に書く（reset と同じく1秒前）。
    3. `200 { loginId }` を返す。画面はこのあと `signIn` し直す。
  - `signedIn` は、`password:` の sub から `typle_users.id` を取り出すときに `accountIdOf(sub): string | null` を使う（`src/server/users.ts` に足す）。

- [ ] **Step 1: 失敗するテストを書く**
  - verify の成功で `email_verified_at` が入る。2回目は `400 invalidToken`。
  - 再設定のトークンを verify に使うと `400`。
  - forgot-password は、ない ID・確認していない ID・確認済みの ID のどれも `200 {}`。メールが飛ぶのは確認済みのときだけ（偽の Resend で数える）。
  - 4回目のリクエストではメールが飛ばない。
  - reset のあと、古いパスワードは `authorizePassword` で `null`、新しいものは通る。
  - reset の前に作った Cookie は `revokedSoon` で `true`、reset のあとに作ったものは `false`。
  - forgot-id は、確認済みのアドレスにだけ ID の一覧を送る。
  - change-password は、今のパスワードが違うと `400 wrongPassword`。
- [ ] **Step 2:** テストを流し、落ちることを確かめる。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「メールの確認、パスワードの再設定と変更、ID の通知を足す」

### Task 9: 画面（6言語）と E2E

**Files:**
- Create: `src/app/{signin,signup,verify-email,forgot-password,reset-password,forgot-id}/page.tsx`（とフォームの部品）, `src/components/Settings/AccountSettings.tsx`, `src/messages/<6言語>/auth.json`, `tests/e2e/password-login.spec.ts`, `tests/e2e/fakeResend.cjs`
- Modify: `src/app/settings/page.tsx`, `playwright.config.ts`, `src/i18n/messages.ts`・`messageTypes`, `src/app/sitemap.ts`・`robots.ts`（新しい画面は noindex にし、sitemap に入れない）

**Interfaces:**
- Consumes: Task 3 の `signInWithGitHub`、Task 6・7・8 の API と `signIn('password', …)`。
- Produces:
  - `/signin?returnTo=`:
    - GitHub のボタンと、ID・パスワードの欄。
    - 失敗のときは「ID かパスワードが違うか、しばらくログインできません」と1つの文言で出す。
    - 「登録」「パスワードを忘れた」「ID を忘れた」へのリンク。
  - `/signup`: 欄ごとにエラーを出す（`loginIdFormat` などのキーを文言に写す）。成功したらログインして `returnTo` へ戻り、メールを送ったかどうかを知らせる。
  - 設定の「アカウント」の節（`password:` のときだけ）: ID、メールアドレスと確認したかどうか、「確認のメールを送り直す」、パスワードの変更。
    - 確認したかどうかは、`GET /api/account/me` で `{ loginId, email, emailVerified }` として返す。この API は Task 8 の `accountApi.ts` に足す。
  - `tests/e2e/fakeResend.cjs`:
    - 127.0.0.1:3199 で、`POST /emails` を受けて覚える。
    - `GET /emails?to=<addr>` で、覚えた本文を JSON で返す。
    - playwright の webServer に足し、アプリの env に次を渡す。
      - `RESEND_API_KEY=e2e`
      - `TYPLE_MAIL_FROM=Typle <e2e@example.test>`
      - `TYPLE_RESEND_URL=http://127.0.0.1:3199/emails`

- [ ] **Step 1: 失敗する E2E を書く**（`password-login.spec.ts`。ID は毎回ランダムにする）
  1. `/signup` で登録すると、トップバーにその ID が出る。偽の Resend に確認のメールが届く。
  2. メールのリンクを開くと「確認できました」と出る。設定の「アカウント」に「確認済み」と出る。
  3. ログアウトしたあと、`/signin` で大文字の ID でログインできる。
  4. 間違ったパスワードでは、1つの文言の失敗が出る。
  5. `/forgot-password` で再設定のメールが届き、リンクから新しいパスワードを決めるとログインした状態になる。古いパスワードでは入れない。
  6. `/forgot-id` で ID のメールが届く。
- [ ] **Step 2:** `npx playwright test tests/e2e/password-login.spec.ts` を流し、FAIL することを確かめる。
- [ ] **Step 3:** 画面と文言を実装する。
- [ ] **Step 4:** `npm run verify`（full）を流し、PASS することを確かめる。
- [ ] **Step 5: コミットする**: 「ID とパスワードの登録・ログイン・再設定の画面を足す」

### Task 10: Go・Kotlin・文書・本番の確認・バージョン

**Files:**
- Modify:
  - Go と Kotlin: `server/internal/session/session.go`、`kotlin/src/main/kotlin/typle/server/Session.kt`（アカウント ID に `password:<UUID>`）
  - fixture: `tests/fixtures/sessions.json`（`password:` の有効なセッションを1件足す）
  - スクリプト: `scripts/check-production.cjs`
  - 文書: README、`api-docs/src/app/{README,auth}.md`、`.env.example`、`docs/release-workflow.md`、`docs/backend-switch.md`
  - 画面の文言: `src/messages/<6言語>/about.json`（メールアドレスの扱い）
  - バージョン: `package.json`（2.55.0）

- [ ] **Step 1:** `sessions.json` にケースを足し、`go test ./server/...` を流して FAIL することを確かめる。
- [ ] **Step 2:** Go と Kotlin の決まりを直す。`go test ./server/...` と、Kotlin のテスト（`kotlin/README.md` の Docker の手順）を流して PASS することを確かめる。
- [ ] **Step 3:** `check-production.cjs` を直す。
  - `/api/auth/session` が200で、`user` がないこと。
  - `/api/auth/providers` が `github`・`password` を含むこと。
  - `/api/auth/signin/github` は Auth.js の作法（CSRF のトークンを付けた POST）で302になり、`Location` が `https://github.com/login/oauth/authorize?` で始まって、本番の `redirect_uri` を含むこと。
  - 旧ドメインの `/api/auth/token` と、`client=ipad` の確認は消す。
- [ ] **Step 4:** 文書を書く。
  - README: ログインのしくみ、新しい環境変数、Resend の準備（ドメインと API キー）、アプリのログインをやめたこと。
  - api-docs: `/api/account/*` と Auth.js の経路。
  - `backend-switch.md`: Go に切り替えたときだけ、発行済みのアプリのトークンが通ること。
  - 「Typleについて」: メールアドレスは確認・再設定・ID の通知にだけ使うこと（6言語）。
- [ ] **Step 5:** `npm version 2.55.0 --no-git-tag-version` を実行し、`npm run verify`（full）が PASS することを確かめる。
- [ ] **Step 6: コミットする**: 「Go・Kotlin・文書・本番の確認を ID とパスワードのアカウントに合わせる」
