# ログイン

ログインは Auth.js（next-auth v5）で、Sparklingstadt ID（OpenID Connect、v2.58.0 から）と GitHub（OAuth App）の2つです（開発用の `local` が手元だけにあります）。FFPF ID のログインは v2.54.0 で、iPad・Mac のアプリのログイン（`/api/auth/token`・アプリのトークン）は v2.55.0 で、ID とパスワードのログインは v2.59.0 でなくしました。ログイン後のリクエストの扱いは [認証](./README.md#認証) を見てください。

## Auth.js の経路（`/api/auth/*`）

`src/app/api/auth/[...nextauth]/route.ts` が Auth.js の `handlers` を出します。次のパスだけが答えで、ほかの `/api/auth/*` は `404 notFound` です。

| パス | 内容 |
|---|---|
| `GET /api/auth/session` | セッション。ログインしていなければ `null`、していれば `{ "user": { "id": "github:123", "name": "…", "image": "https://…" }, "expires": "…" }`（`expires` は中身の `exp` と同じ時刻） |
| `GET /api/auth/csrf` | CSRF トークン（`{ "csrfToken" }`）と、その Cookie |
| `GET /api/auth/providers` | 使えるプロバイダー。`sid`・`github`（設定があるとき）、手元では `local` |
| `POST /api/auth/signin/<provider>` | ログインを始める。CSRF のトークンを付けた `application/x-www-form-urlencoded` の POST。`github` は GitHub の、`sid` は Sparklingstadt ID の認可ページへの `302`。ログアウトのあとの `sid` には `prompt=login` を付けます（Cookie `typle-sid-relogin`） |
| `GET /api/auth/callback/<github・sid>`・`POST /api/auth/callback/local` | ログインから戻る先 |
| `POST /api/auth/signout` | ログアウト（この端末の Cookie を消す） |
| `GET /api/auth/error` | ログインの失敗（画面 `/signin?error=…` に移ります） |

- ログインの Cookie は `__Host-typle-session`（`AUTH_URL` が HTTPS のとき。HTTP なら `typle-session`）、`HttpOnly`・`SameSite=Lax`・`Path=/` で、中身は `{sub,name,image,iat,exp}` を HMAC-SHA256 で署名したものです。**ログインから30日で切れ、延長しません**。ブラウザーの Cookie の `Expires` は Auth.js がセッションを読むたびに「今から30日」に書き直しますが、切れるかどうかは中身の `exp` で決まります。
- アカウント ID は `github:<GitHub のユーザー番号>`・`password:<小文字の UUID>`（v2.58.0 までの ID とパスワードのアカウント。ひも付けた Sparklingstadt ID か、切れるまでのセッションで使います）・`sid:<Sparklingstadt ID の sub>`（ほかのアカウントにひも付けた ID はそのアカウント）・`ffpf:…`（v2.53.1 までのログインが切れるまで）です。開発用のログインは `github:0` です。
- 「すべての端末からログアウト」で無効にされたセッションは、`/api/auth/session` が `null` を返して Cookie を消します。この確認は1秒までしか待たず、間に合わなければ確かめずに答えます。
- 本番では環境変数 `AUTH_REDIRECT_PROXY_URL` を設定しないでください（Auth.js が読んで GitHub と Sparklingstadt ID の callback の向きを変えます）。

## `POST /api/account/signout-everywhere`

このアカウントのそれまでのすべてのログインを無効にし、この端末の Cookie も消します。`Origin` が `AUTH_URL` のオリジンと同じときだけ受け付けます（違えば `403 forbiddenRequest`）。答えは `204`、無効にされたあとのセッションからは `401 loginRequired`、DB に書けなければ `503 databaseUnavailable` です。エラーは `{ "error": "<キー>" }` です。

::: warning
`POST /api/account/signout-everywhere` は、盗まれたセッションを期限前に止める唯一の方法です。v2.54.0 までの `POST /api/auth/signout?everywhere=1` と `Authorization: Bearer` のアプリのトークンは、v2.55.0 でなくしました。
:::

ID とパスワードのアカウントの API（`signup`・`verify`・`resend-verification`・`forgot-password`・`reset-password`・`forgot-id`・`change-password`・`me`）は v2.59.0 でなくしました（`404`）。

## 開発用のログイン

`local`（Credentials）は `github:0`（「ローカル練習用」）としてログインします。Vercel の外（手元）で、`LOCAL_DEVELOPMENT_LOGIN=1` かつ `AUTH_URL` がこの機械への `http`（またはそれと同じ `LOCAL_DEVELOPMENT_LAN_HOST` のプライベートIPv4）のときだけ有効で、本番では `/api/auth/providers` にも出ません。以前の `POST /api/auth/local` はなくしました。
