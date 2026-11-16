# 概要と共通事項

Typle 本体（Web版と iPad・Mac・Android・Windows 版）が使う、アプリ自身のバックエンドです。v2.46.10 から、すべてのパスを Next.js の Route Handler（`src/app/api`・`src/server`）が答えます。v2.47.0 で消した Go のバックエンド（`server/`）と同じ答えを返します（違いは設計書 `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md` の「移した後も Go と違うところ」）。

Web版は v2.41.1 から、ワークスペース・記録を下の REST のパスで読み書きします（v2.14.0〜v2.41.0 は GraphQL）。iPad・Mac 版も 11/13 に REST へ戻りました。GraphQL（`POST /api/graphql`）は v2.43.0 で消しました。

## エンドポイント

| メソッドとパス | ログイン | 内容 |
|---|---|---|
| `GET /api/health` | 不要 | DB に5秒以内につながれば `200 { "status": "ok" }`、だめなら `503 databaseUnavailable` |
| [`GET /api/workspace`](./workspace.md#get-api-workspace) | 要 | ワークスペース全体 |
| [`PUT /api/workspace`](./workspace.md#put-api-workspace) | 要 | ワークスペースを保存する |
| [`POST /api/workspace/records`](./workspace.md#記録の追加と削除) | 要 | 記録を1件追加する |
| [`DELETE /api/workspace/records`](./workspace.md#記録の追加と削除) | 要 | 記録を1件削除する |
| [`GET /api/auth/session`](./auth.md#get-api-auth-session) | 任意 | ログイン中のユーザーと、使えるログイン方法 |
| [`GET /api/auth/signin`](./auth.md#get-api-auth-signin) | — | ログインを始める |
| [`GET /api/auth/callback/github`・`/api/auth/callback/ffpf`](./auth.md#ログインから戻る先) | — | ログインから戻る先 |
| [`POST /api/auth/token`](./auth.md#post-api-auth-token) | — | アプリのログインのコードをトークンに換える |
| [`POST /api/auth/signout`](./auth.md#post-api-auth-signout) | — | ログアウト |
| [`POST /api/auth/local`](./auth.md#post-api-auth-local) | — | 開発用のログイン（有効なときだけ） |

## 共通事項

- 本文はJSON（`Content-Type: application/json; charset=utf-8`）で、`Cache-Control: private, no-store`・`Vary: Cookie` を付けます。`/api/shared`・`/api/gallery`・`/api/gallery/categories`・`/api/gallery/added`・`/api/gallery/reports` は `Cache-Control: no-store` で、`X-Robots-Tag: noindex` も付けます。
- エラーは `{ "error": "<キー>" }` です。キーはアプリの `errors` のメッセージのキーで、画面が利用者の言語で表示します。
- すべての応答に `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`・`X-Frame-Options: DENY`・`X-Content-Type-Options: nosniff`・`Referrer-Policy: strict-origin-when-cross-origin` を付けます（`next.config.mjs`）。
- `HEAD` は `GET` と同じに答えます（本文なし）。

### エラー

| ステータス | キー | 状況 |
|---|---|---|
| 400 | `emptyRequest` | 書き込みに本文がない |
| 400 | `invalidWorkspace`・`invalidRecord`・`levelsConflict`・`listLimit`・`followLimit` など | 本文が不正（各エンドポイントを参照） |
| 401 | `loginRequired` | ログインしていない、またはセッションが無効にされた |
| 401 | `loginAccountChanged` | 本文の `accountId` がログイン中のアカウントと違う（別の画面で別のアカウントにログインした） |
| 403 | `forbiddenRequest` | 書き込みの `Origin` がアプリのものでない、または `Content-Type` が `application/json` でない |
| 404 | `notFound` | 未知のパス |
| 405 | `methodNotAllowed` | そのパスで使えないメソッド。`Allow` に使えるメソッドを付ける |
| 409 | `conflict` | 保存の `revision` が古い |
| 413 | `workspaceTooLarge` | 本文が 1MiB を超える、または保存後が大きすぎる |
| 503 | `databaseUnavailable` | DBの障害（読み取り） |
| 503 | `workspaceSaveFailed` | DBの障害（書き込み） |
| 503 | `authUnavailable` | ログインの設定がない、またはログインを始められない |

503 で答えた失敗は、操作名（`workspace.read` など）を付けて Sentry に送ります（[docs/sentry.md](https://github.com/Sparklingstadt/typle-r/blob/main/docs/sentry.md)）。

## 認証

アカウントは `github:<GitHubのユーザーID>`、または FFPF ID でログインしたときのアカウントです。ログインの流れは [ログイン](./auth.md) を見てください。

- `Authorization` ヘッダーがあるリクエストは、アプリ（iPad・Mac・Android・Windows）のものとして `Authorization: Bearer <トークン>` だけで判断し、Cookie は見ません。トークンは [`POST /api/auth/token`](./auth.md#post-api-auth-token) で受け取ります。
- ないリクエストはセッションの Cookie で判断します。名前は HTTPS では `__Host-` 付きで、`HttpOnly`・`SameSite=Lax`・`Path=/` です。セッションはログインから30日で切れ、使っても延びません。
- データを読み書きするリクエストは、そのたびにセッションが無効にされていないか（`POST /api/auth/signout?everywhere=1` の後のログインか）をDBで確かめます。無効なら `401 loginRequired` で、Cookie を消します。確かめられなければ `503 databaseUnavailable` です。

### 書き込みの制限（CSRF 対策）

Cookie で書き込むリクエストは、`Origin` がアプリの origin（`AUTH_URL`。小文字、既定のポートなし）と同じで、`Content-Type` の `;` より前が `application/json` のときだけ受け付けます。違えば `403 forbiddenRequest` です。

::: tip
ほかのサイトのフォームはこの `Content-Type` を送れないため、他サイトから Cookie で保存されることはありません。アプリのトークンはブラウザーが勝手に送らないため、トークンのリクエストに `Origin` は要りません（`Content-Type` は要ります）。
:::

## コードの構成

| 場所 | 内容 |
|---|---|
| `src/app/api`・`src/server` | Next.js の Route Handler。すべてのパス（記録の追加・削除は `src/server/workspace.ts` の `answerRecords` と `src/core/records.ts`、ログインの始まりと戻りは `src/server/signin.ts`・`github.ts`・`ffpf.ts`） |
