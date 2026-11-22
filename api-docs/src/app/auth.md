# ログイン

ログインは Auth.js（next-auth v5）で、Sparklingstadt ID（OpenID Connect、v2.58.0 から）、GitHub（OAuth App）、ID とパスワードの3つです（開発用の `local` が手元だけにあります）。FFPF ID のログインは v2.54.0 で、iPad・Mac のアプリのログイン（`/api/auth/token`・アプリのトークン）は v2.55.0 でなくしました。ログイン後のリクエストの扱いは [認証](./README.md#認証) を見てください。

## Auth.js の経路（`/api/auth/*`）

`src/app/api/auth/[...nextauth]/route.ts` が Auth.js の `handlers` を出します。次のパスだけが答えで、ほかの `/api/auth/*` は `404 notFound` です。

| パス | 内容 |
|---|---|
| `GET /api/auth/session` | セッション。ログインしていなければ `null`、していれば `{ "user": { "id": "github:123", "name": "…", "image": "https://…" }, "expires": "…" }`（`expires` は中身の `exp` と同じ時刻） |
| `GET /api/auth/csrf` | CSRF トークン（`{ "csrfToken" }`）と、その Cookie |
| `GET /api/auth/providers` | 使えるプロバイダー。`sid`・`github`（設定があるとき）と `password`、手元では `local` |
| `POST /api/auth/signin/<provider>` | ログインを始める。CSRF のトークンを付けた `application/x-www-form-urlencoded` の POST。`github` は GitHub の、`sid` は Sparklingstadt ID の認可ページへの `302`。ログアウトのあとの `sid` には `prompt=login` を付けます（Cookie `typle-sid-relogin`） |
| `GET /api/auth/callback/<github・sid>`・`POST /api/auth/callback/<password・local>` | ログインから戻る先 |
| `POST /api/auth/signout` | ログアウト（この端末の Cookie を消す） |
| `GET /api/auth/error` | ログインの失敗（画面 `/signin?error=…` に移ります） |

- ログインの Cookie は `__Host-typle-session`（`AUTH_URL` が HTTPS のとき。HTTP なら `typle-session`）、`HttpOnly`・`SameSite=Lax`・`Path=/` で、中身は `{sub,name,image,iat,exp}` を HMAC-SHA256 で署名したものです。**ログインから30日で切れ、延長しません**。ブラウザーの Cookie の `Expires` は Auth.js がセッションを読むたびに「今から30日」に書き直しますが、切れるかどうかは中身の `exp` で決まります。
- アカウント ID は `github:<GitHub のユーザー番号>`・`password:<小文字の UUID>`・`sid:<Sparklingstadt ID の sub>`（ほかのアカウントにひも付けた ID はそのアカウント）・`ffpf:…`（v2.53.1 までのログインが切れるまで）です。開発用のログインは `github:0` です。
- 「すべての端末からログアウト」で無効にされたセッションは、`/api/auth/session` が `null` を返して Cookie を消します。この確認は1秒までしか待たず、間に合わなければ確かめずに答えます。
- 本番では環境変数 `AUTH_REDIRECT_PROXY_URL` を設定しないでください（Auth.js が読んで GitHub と Sparklingstadt ID の callback の向きを変えます）。
- パスワードの間違いは、Auth.js が `/signin?error=CredentialsSignin` へ戻します（サーバーのログには出しません）。

## `POST /api/account/*`

ID とパスワードのアカウントの API です。書き込みは `Origin` が `AUTH_URL` のオリジンと同じで、`Content-Type` が `application/json` のときだけ受け付けます（違えば `403 forbiddenRequest`）。エラーは `{ "error": "<キー>" }` です。

| パス | 本文 | 内容 |
|---|---|---|
| `POST /api/account/signup` | `{ loginId, email, password }` | アカウントを作り、確認のメールを送る。`201 { loginId, mailSent }`（`mailSent` が `false` でもアカウントはできている）。`400` は `loginIdFormat`・`passwordLength`・`passwordSameAsId`・`emailFormat`・`invalidRequest`、`409 loginIdTaken`、`429 tooManyRequests`。画面は続けて同じ ID とパスワードでログインする |
| `POST /api/account/verify` | `{ token }` | メールのリンクのトークンでアドレスを確認済みにする（24時間・1回だけ）。`200 {}`、誤りは `400 invalidToken` |
| `POST /api/account/resend-verification` | `{}` | ログイン中のアカウントに確認のメールを送り直す。`200 { mailSent }`（確認済みなら `{ alreadyVerified: true }`）、`429 tooManyRequests` |
| `POST /api/account/forgot-password` | `{ loginId }` | 確認済みのアドレスがあれば再設定のリンク（30分・1回だけ）を送る。ID があってもなくても、形が正しければ `200 {}` |
| `POST /api/account/reset-password` | `{ token, password }` | 新しいパスワードを決める。アドレスを確認済みにし、そのアカウントの以前のログインと、ほかの再設定のリンクを無効にし、その ID のログインの失敗の数を消す。`200 { loginId }`（画面は続けてログインする）、`400 invalidToken`・`passwordLength`・`passwordSameAsId` |
| `POST /api/account/forgot-id` | `{ email }` | そのアドレスで確認済みのアカウントの ID を送る。あってもなくても、形が正しければ `200 {}` |
| `POST /api/account/change-password` | `{ currentPassword, newPassword }` | ログイン中のアカウントのパスワードを変え、以前のログインと再設定のリンクを無効にする。`200 { loginId }`、`400 wrongPassword`・`passwordLength`・`passwordSameAsId`・`notPasswordAccount`、ID か IP のログインが止まっていれば `429 tooManyRequests` |
| `GET /api/account/me` | — | ログイン中のアカウント。`200 { loginId, email, emailVerified }`、`401 loginRequired`、GitHub のログインには `400 notPasswordAccount` |
| `POST /api/account/signout-everywhere` | — | このアカウントのそれまでのすべてのログインを無効にし、この端末の Cookie も消す。`204`。`Origin` が必要。無効にされたあとのセッションからは `401 loginRequired`、DB に書けなければ `503 databaseUnavailable` |

::: warning
`POST /api/account/signout-everywhere` は、盗まれたセッションを期限前に止める唯一の方法です。v2.54.0 までの `POST /api/auth/signout?everywhere=1` と `Authorization: Bearer` のアプリのトークンは、v2.55.0 でなくしました。
:::

- ID は `^[a-z0-9_-]{3,32}$`（小文字にしてから判定し、大文字小文字は区別しない）、パスワードは10〜128文字で、小文字にした ID と同じものは使えません。メールアドレスは形だけ確かめます。
- `forgot-password`・`forgot-id` のメールは、答えを返したあとに送ります（`after()`）。答えだけでは、ID やアドレスが登録されているかは分かりません。
- 回数の制限（超えると `429 tooManyRequests`、ただし `forgot-*` は同じ `200 {}`）：

  | 操作 | 単位 | 回数 | 期間 |
  |---|---|---|---|
  | ログインの失敗 | ID | 5回で止める | 15分 |
  | ログインの失敗 | IP | 30回で止める | 15分 |
  | 登録 | IP | 5件まで | 1時間 |
  | メール（再設定・ID の通知・確認の送り直し） | ID かアドレス | 3通まで | 1時間 |
  | メール（同上） | IP | 10回まで | 1時間 |
  | すべてのメール（登録の確認も含む） | 全体 | 80通まで | UTC の1日 |

  登録とメールは、仕事の前に1回分を数えてから進めるので、同時に送った要求もこの数を超えません。1日の上限を超えたメールは送らず、登録は `201 { mailSent: false }`、確認の送り直しは `429`、`forgot-*` は `200 {}` で答えます。IP は `x-forwarded-for` の最初の値で、IPv6 は /64 ごとに数えます。止まっている間は、正しいパスワードでもログインの失敗と同じ答えになります。

## 開発用のログイン

`local`（Credentials）は `github:0`（「ローカル練習用」）としてログインします。Vercel の外（手元）で、`LOCAL_DEVELOPMENT_LOGIN=1` かつ `AUTH_URL` がこの機械への `http`（またはそれと同じ `LOCAL_DEVELOPMENT_LAN_HOST` のプライベートIPv4）のときだけ有効で、本番では `/api/auth/providers` にも出ません。以前の `POST /api/auth/local` はなくしました。
