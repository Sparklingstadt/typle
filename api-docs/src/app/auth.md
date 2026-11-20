# ログイン

ログインは GitHub（OAuth App）で、PKCE（S256）を使います。FFPF ID（OpenID Connect）でのログインは v2.54.0 でなくしました。ログイン後のリクエストの扱いは [認証](./README.md#認証) を見てください。

## 流れ

- Web版：`/api/auth/signin` → GitHub → `/api/auth/callback/github` → セッションの Cookie を発行して `returnTo` へ戻る。
- アプリ（iPad・Mac・Android・Windows）：`/api/auth/signin?client=…&code_challenge=…` → GitHub → `/api/auth/callback/github` → `typle-r://login?code=<コード>` → アプリが `POST /api/auth/token` でコードと verifier をトークンに換える。

## `GET /api/auth/signin`

| クエリ | 内容 |
|---|---|
| `returnTo` | ログイン後に戻るアプリ内のパス（既定 `/home`）。サイト内のパスでなければ既定にする |
| `client`・`code_challenge` | アプリのログイン。`client` は `ipad`・`macos`・`android`・`windows`（Android 版・Windows 版はアーカイブ済みですが、受け付けます）、`code_challenge` はアプリが作った S256 のチャレンジ（43文字） |

管理画面のログイン（`admin=1`）は v2.48.0 で、FFPF ID のログイン（`provider=ffpf`）は v2.54.0 でなくしました。今はどちらも読まず、ほかのクエリのとおりの GitHub のログインになります。

ログインの途中の状態（state・verifier・戻り先など）を署名した Cookie `typle-oauth`（`Path=/api/auth`、10分）に入れ、GitHub へリダイレクト（`302`）します。GitHub の設定がなければ `503 authUnavailable` です。

## ログインから戻る先

`GET /api/auth/callback/github` は、`typle-oauth` の Cookie を必ず消し、state が合い、GitHub がアカウントを確かめたときだけログインして、`returnTo` へリダイレクトします。失敗しても理由は見せずに `returnTo` へ戻ります。

- Web版：セッションの Cookie を発行します。
- アプリ：Cookie は発行せず、`typle-r://login?code=<コード>`（失敗は `typle-r://login?error=loginFailed`）へ戻ります。コードは2分で切れます。

## `POST /api/auth/token`

アプリがログインの最後に、コードと自分の verifier をトークンに換えます。Cookie を使わないため `Origin` は要りません。

```json
// 本文（4KiB まで）
{ "code": "…", "verifier": "…" }
// 応答
{ "token": "…", "user": { "id": "github:123", "name": "…", "image": "https://…" } }
```

コードが切れている、verifier がチャレンジと合わないなど、どんな誤りも `400 loginFailed` で、アプリはログインをやり直します。トークンはセッションと同じく30日で切れます。

## `GET /api/auth/session`

```json
{ "user": { "id": "github:123", "name": "…", "image": null }, "providers": ["github"] }
```

- ログインしていなければ `user` は `null` です。`providers` は設定のあるログイン方法で、今は `github` だけ（GitHub の設定がなければ空）です。
- 無効にされたセッションは `user: null` で、Cookie を消します。この応答は DB を待たないため、すぐ確かめられないときは確かめずに答えます（データの読み書きは `signedIn` で必ず確かめます）。

## `POST /api/auth/signout`

`204` で、セッションの Cookie を消します。アプリの `Origin` が必要です。

`?everywhere=1` を付けると、このアカウントのそれまでのすべてのログイン（Cookie もアプリのトークンも）を無効にします。アプリはトークンで、`Origin` なしで呼べます。すでに無効にされたセッションからは `401 loginRequired`、DB に読み書きできなければ `503 databaseUnavailable`（Cookie は残すのでやり直せます）です。

::: warning
`?everywhere=1` は、盗まれたセッションを期限前に止める唯一の方法です。
:::

## `POST /api/auth/local`

開発用に `github:0`（「ローカル練習用」）としてログインし、`204` を返します。アプリの `Origin` が必要です。

Vercel の外（手元）で、`LOCAL_DEVELOPMENT_LOGIN=1` かつ `AUTH_URL` がこの機械への `http`（またはそれと同じ `LOCAL_DEVELOPMENT_LAN_HOST` のプライベートIPv4）のときだけあり（`src/server/settings.ts` の `localLoginAllowed`）、本番を含むほかではどのメソッドでも `404 notFound` です。
