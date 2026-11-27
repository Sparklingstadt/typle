# ログイン

ログインは Better Auth（v1.7.28。v2.62.0 から。それまでは Auth.js）で、Sparklingstadt ID（OpenID Connect、v2.58.0 から）と GitHub（OAuth App）の2つです（開発用の `local` が手元だけにあります）。FFPF ID のログインは v2.54.0 で、iPad・Mac のアプリのログイン（`/api/auth/token`・アプリのトークン）は v2.55.0 で、ID とパスワードのログインは v2.59.0 でなくしました。ログイン後のリクエストの扱いは [認証](./README.md#認証) を見てください。

## Better Auth の経路（`/api/auth/*`）

`src/app/api/auth/[...all]/route.ts` が Better Auth の `auth` に渡します。次のパスだけが答えで、ほかの `/api/auth/*` は `404 notFound` です（Auth.js の `/api/auth/session`・`/api/auth/csrf`・`/api/auth/providers` も 404 です）。

| パス | 内容 |
|---|---|
| `GET /api/auth/get-session` | セッション。ログインしていなければ `null`、していれば `{ "session": { … }, "user": { "id": "github:123", "name": "…", "image": "https://…", … } }` |
| `POST /api/auth/sign-in/social` | ログインを始める。`Origin` が `AUTH_URL` のオリジンの JSON の POST で、本文は `{ "provider": "github" or "sid", "callbackURL": "/home", "errorCallbackURL": "/signin" }`。答えは `{ "url": "<認可ページ>", "redirect": true }`（`github` は GitHub の、`sid` は Sparklingstadt ID の認可ページ）。ログアウトのあとの `sid` には `prompt=login` を付けます（Cookie `typle-sid-relogin`） |
| `GET /api/auth/callback/<github・sid>` | ログインから戻る先（Auth.js のときと同じ URL） |
| `POST /api/auth/sign-in/local` | 開発用のログイン（手元だけ。本番は 404） |
| `POST /api/auth/sign-out` | ログアウト（この端末のセッションを消す） |

- ログインの Cookie は `__Secure-better-auth.session_token`（`AUTH_URL` が HTTPS のとき。HTTP なら `better-auth.session_token`）、`HttpOnly`・`SameSite=Lax`・`Path=/` で、署名した値です。セッションは DB（`typle_auth_sessions`）にあり、**ログインから30日で切れ、延長しません**。Cookie に最大300秒（5分）キャッシュするので、「すべての端末からログアウト」のあと、ほかの端末は最大5分ログインしたままに見えます。
- アカウント ID（ユーザーの `id`）は `github:<GitHub のユーザー番号>`・`password:<小文字の UUID>`（v2.58.0 までの ID とパスワードのアカウント。ひも付けた Sparklingstadt ID で使います）・`sid:<Sparklingstadt ID の sub>`（ほかのアカウントにひも付けた ID はそのアカウント）・`ffpf:…`（取り込んだ古いアカウント）です。開発用のログインは `github:0` です。
- 「すべての端末からログアウト」で消されたセッションは、キャッシュの切れたあと `get-session` が `null` を返します。

## `POST /api/account/signout-everywhere`

このアカウントのそれまでのすべてのログインを無効にし、この端末の Cookie も消します。`Origin` が `AUTH_URL` のオリジンと同じときだけ受け付けます（違えば `403 forbiddenRequest`）。答えは `204`、無効にされたあとのセッションからは `401 loginRequired`、DB に書けなければ `503 databaseUnavailable` です。エラーは `{ "error": "<キー>" }` です。

::: warning
`POST /api/account/signout-everywhere` は、盗まれたセッションを期限前に止める唯一の方法です。v2.54.0 までの `POST /api/auth/signout?everywhere=1` と `Authorization: Bearer` のアプリのトークンは、v2.55.0 でなくしました。
:::

ID とパスワードのアカウントの API（`signup`・`verify`・`resend-verification`・`forgot-password`・`reset-password`・`forgot-id`・`change-password`・`me`）は v2.59.0 でなくしました（`404`）。

## 開発用のログイン

`local`（Credentials）は `github:0`（「ローカル練習用」）としてログインします。Vercel の外（手元）で、`LOCAL_DEVELOPMENT_LOGIN=1` かつ `AUTH_URL` がこの機械への `http`（またはそれと同じ `LOCAL_DEVELOPMENT_LAN_HOST` のプライベートIPv4）のときだけ有効で、本番では `/api/auth/providers` にも出ません。以前の `POST /api/auth/local` はなくしました。
