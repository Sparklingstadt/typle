# コードの構成としくみ

`src` のディレクトリー、ログイン、保存とアクセス制御、関連リポジトリとの合わせ方です。手元で動かす手順は [development.md](development.md)、本番の構成は [production.md](production.md) にあります。

## コードの構成

Next.js の App Router のアプリは1つで、`src` は Next.js でよく使うディレクトリーに分けています（v2.50.0 から。それまでは React・Next.js に依存しない処理を `src/core` に集め、ESLint で import の向きを縛っていました）。`eslint.config.mjs` が縛るのは、画面（`src/app`・`src/components`）から保存先（`src/lib/storage`）とサーバーのコード（`src/server`）への import だけです。画面はワークスペースと保存場所（`storage`：`browser` / `account`）を `useWordLists()` から受け取ります。

| 場所 | 内容 |
|---|---|
| `src/app` | ページ・レイアウト・Route Handler（App Router） |
| `src/components` | UI のコンポーネント（`ui/` は shadcn/ui） |
| `src/hooks` | React のフック。`useWordLists` は React の状態とブラウザーのイベント（フォーカス・他タブの変更）だけを受け持ち、読み込み・保存は `src/lib/workspaceSession.ts` の `createWorkspaceSession` に任せます |
| `src/lib` | フック以外の処理。単語リスト・入力判定・記録・集計・ワークスペースのモデルと検証、保存先の型 `WorkspaceStore`（`workspaceStore.ts`、保存場所 `location` を含む）、ワークスペースの読み込み・保存 `createWorkspaceSession`（`workspaceSession.ts`。アカウントの切り替え後に届いた結果の破棄、保存の直列化、409での再読み込み、古いクラウド読み込みの無視）、単語ファイルの CSV の読み書き（`wordFormat.ts`。TSV の読み込みは v2.44.0 でやめました）、ログインの状態（`session.tsx`）など。保存先は `src/lib/storage` で、`cloud.ts`（Next.js の Route Handler が答える `/api/workspace` と `/api/workspace/records`）と `guest.ts`（LocalStorage）を `workspaceStore(accountId)` がアカウントに応じて選びます。`packs/` は公式パック（v0.85.0 から sparklingstadt アカウントの67リストのコピーで、`commands/` に1リスト1ファイルで保存しています。それまではサンプル、国名193か国、コマンドと構文の25種類を初級・中級・上級に分けた85リスト）とそのカタログです |
| `src/i18n`・`src/messages` | 多言語化（next-intl）と各言語の文言 |
| `src/proxy.ts` | ページごとに nonce を作り、スクリプトの CSP（`Content-Security-Policy-Report-Only`。方針は `src/lib/contentSecurityPolicy.ts`）を付けます（v2.51.0 から）。今は報告だけです。止める CSP（フレーム・`base` 要素・`object` 要素）は `next.config.mjs` がページ以外にだけ送り、ページのフレームへの埋め込みは `X-Frame-Options` で止めます（v2.51.1 から。Next.js は proxy が付けたヘッダーを描画するリクエストにも写し、`script-src` のない CSP があるとそちらを読んで nonce を付けないため）。違反はブラウザーのコンソールに出るだけで、どこにも送りません（v2.53.0 から） |
| `src/server` | Next.js の Route Handler（`src/app/api/**/route.ts`）と、それが使う JSON の応答（`response.ts`）・DB の接続（`database.ts`。Prisma Client を `pg` の pool の上で使う）・失敗の報告（`report.ts`。Vercel の関数のログに出す）・ログインの設定（`settings.ts`）・書き込みの要求の確認（`request.ts`）・ログインの Cookie を封じて開く処理（`session.ts`。鍵と形式は v2.46.11 までの Go と同じ）と、それを Auth.js の JWT にする `authJwt.ts`・Auth.js のコールバック（`authOptions.ts`）・ログインの確認とすべての端末からのログアウトの失効（`account.ts`、API は `accountApi.ts`）・ワークスペースの読み込みと `revision` による保存と練習の記録の追加・削除（`workspace.ts`。記録は表 `typle_records` に分けて持つ（`records.ts`）。`TYPLE_MEASURE_SAVES=1` なら保存を計測する（`metrics.ts`））。`/api` のすべてのパスです（v2.46.10 から。それまでは一部が Go のバックエンドでした）。`src/lib` を使えますが、画面（`src/app`・`src/components`）からは import しません |

v2.43.2 まであったプラグインの層（`src/plugins`）と、ファイル形式を差し替えるための拡張口（`WordFormat` と形式の一覧）は v2.43.3 でやめました。読み書きする単語ファイルは CSV だけで、保存先は guest と cloud の2つです。

v2.46.11 まではバックエンドの一部が Go（`server/`、Vercel の Go の関数 `api/index.go`）でした。v2.46.10 で `/api` のすべてのパスを Next.js の Route Handler に移し、v2.47.0 で Go のコードを消しました（設計は `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`。Go と違うところもそこにあります）。

ログインの Cookie は `HttpOnly`・`SameSite=Lax` で、ログインから30日で切れます（延長しません）。名前は `AUTH_URL` が HTTPS なら `__Host-typle-session`、HTTP なら `typle-session` です。中身は `{sub,name,image,iat,exp}` を、`AUTH_SECRET` から HKDF（info `typle session v1`）で導いた鍵で HMAC-SHA256 署名したもので、v2.46.11 までの Go と同じ形です（`src/server/session.ts`・`settings.ts`）。v2.55.0 から Auth.js（next-auth v5）がこの Cookie を作ります（`src/auth.ts`、`jwt.encode`・`jwt.decode` を差し替えて同じ形にしています）。

### ログインのしくみ（Auth.js）

ログインは Auth.js（next-auth v5）で、`/api/auth/*` は `src/app/api/auth/[...nextauth]/route.ts` が答えます（知らないパスは 404。`authPathKnown`）。プロバイダーは次の3つです。ログイン画面（`/signin`）には Sparklingstadt ID と GitHub のボタンだけがあります。

- **Sparklingstadt ID**（OpenID Connect、id `sid`。`AUTH_SID_ISSUER`・`AUTH_SID_ID`・`AUTH_SID_SECRET` が揃っているとき。v2.58.0 から）：Sparklingstadt のサービスに共通のログイン（`https://id.sparklingstadt.com`）です。ログイン画面のいちばん上に出ます。アカウントは `sid:<sub>`ですが、表 `typle_sid_links` でほかのログインのアカウントにひも付けた ID は、そのアカウントとして入ります（下の「Sparklingstadt ID のひも付け」）。ID トークンの `email_verified` が true でなければ断ります。ログアウト（「すべての端末からログアウト」も）のあとの次のログインでは、Cookie `typle-sid-relogin` を置いて `prompt=login` を付け、ID サーバーでもパスワードを聞きます（`src/server/sidLogin.ts`）。
- **GitHub**（`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` が揃っているとき）：アカウントは `github:<GitHub のユーザー番号>`。
- **開発用**（Credentials、id `local`）：`github:0`。[development.md](development.md) の「開発用ログインで起動」の条件を満たすときだけ有効です。

セッションは JWT で、DB のセッションも adapter も使いません。API（workspace など）は Cookie を `signedIn`（`src/server/account.ts`）で読み、「すべての端末からログアウト」の表（`typle_session_revocations`）を確かめます。この操作は `POST /api/account/signout-everywhere` です（v2.54.0 までの `POST /api/auth/signout?everywhere=1` と、`Authorization: Bearer` のアプリのトークンは使えません。`Authorization` ヘッダーは読みません）。

- 注意：ブラウザーの Cookie の `Expires` は、Auth.js がセッションを読むたびに「今から30日」に書き直されます。切れるかどうかは Cookie の中身の `exp`（ログインから30日で固定）で決まるので、延長にはなりません。
- 注意：**本番では `AUTH_REDIRECT_PROXY_URL` を設定しないでください。** Auth.js はこの値があると、GitHub と Sparklingstadt ID のログインの callback をそのアドレスのプロキシへ向けます（`redirectProxyUrl` は手元の開発のときだけ値を決めますが、環境変数が残っていれば Auth.js が読みます）。

#### Sparklingstadt ID のひも付け

今のアカウント（GitHub か、v2.58.0 までの ID・パスワード）のデータを Sparklingstadt ID で使うには、その ID の `sub` をアカウントにひも付けます。画面はなく、手元から1回だけ行います（利用者が持ち主だけのため）。

1. ID サーバー（`sparklingstadt-id`）の `OIDC_CLIENTS` に typle-r を登録します（`pnpm run oidc:client typle-r`）。`redirectUris` は `https://typle.sparklingstadt.com/api/auth/callback/sid` と `https://typle-r-six.vercel.app/api/auth/callback/sid` です。出てきたシークレットを typle-r の `AUTH_SID_SECRET` に入れます。
2. typle-r で Sparklingstadt ID でログインし、**何も保存せずに** `/api/auth/session` を開いて `user.id`（`sid:<sub>`）を写します。
3. 本番の DB に向けて `DATABASE_URL=<本番の接続文字列> npm run sid:link -- sid:<sub> <アカウント ID>`（例 `github:219588180`）を実行します。`sub` は `sid:` なしでも受け付けます。
4. ログアウトしてもう一度 Sparklingstadt ID でログインすると、ひも付けたアカウントで入ります。

`sid:link` は次の場合に断ります（終了コード 1）：その ID かアカウントがもうひも付いている、ひも付け先が `github:`・`password:`・`ffpf:` のアカウントでない、ひも付け先に保存したデータ（`typle_workspaces`・`typle_records`）がない（打ち間違いの防止）、`sid:<sub>` のアカウントにもう保存したデータがある（ひも付けると読めなくなるため）。ひも付けの解除は SQL（`DELETE FROM typle_sid_links WHERE sub = '<sub>'`）で行います。

#### ID とパスワードのログイン（廃止）

ID とパスワードのログインは v2.59.0 でなくしました。登録・パスワードを忘れた・ID を忘れた・メールの確認とパスワードの再設定のリンク・設定の「アカウント」（メールの送り直しとパスワードの変更）の画面と、`/api/account/*` のうち `signout-everywhere` 以外の API、Auth.js の `password` のプロバイダー、メール（Resend）の送信もなくしています。

- `/signup`・`/forgot-password`・`/forgot-id`・`/reset-password`・`/verify-email` は 404、`/api/auth/callback/password` も 404 です。
- v2.58.0 までに ID とパスワードでログインしたセッション（アカウント ID が `password:` で始まる）は、ログインから30日で切れるまで使えます。
- そのアカウントのデータ（`typle_users` などの DB の行はそのまま残ります）は、上の「Sparklingstadt ID のひも付け」で `password:<UUID>` に Sparklingstadt ID をひも付ければ、そのまま使えます。
- 環境変数 `RESEND_API_KEY`・`TYPLE_MAIL_FROM` は読みません（Vercel から消してかまいません）。
- 「Typleについて」の「メールアドレスの扱い」と、ホーム・トップページ・使い方の「GitHub または ID とパスワード」の説明は v2.60.1 で直しました。`npm run check:production` も、`/api/auth/providers` が `sid` と `github` だけであることを確かめます。

#### iPad・Mac のアプリ

v2.55.0 から、iPad・Mac のアプリは Typle にログインできません。`/api/auth/token`・`/api/auth/signin?client=…&code_challenge=…`・アプリのトークンをなくしたためです。v2.54.0 までに発行したトークンは、`/api/workspace` などでもう通りません。

画面は `src/lib/session.tsx` の `useSession`・`signIn`・`signOut` で Auth.js の `/api/auth/*` を呼びます。ログイン状態は `/api/auth/session` の 200 の答えだけで決め、確認が失敗したとき（通信の失敗、200 以外の答え、読めない本文）は前の状態のままにします。最初の確認だけは 1・2・4 秒後にやり直し、すべて失敗したら未ログインとして扱います。`/api/*` はどれも Next.js の Route Handler が答えます。サーバーの失敗は Vercel の関数のログに出します（読めない・切れたログインの Cookie で Auth.js が出す `JWTSessionError` は、毎回ログに出ないよう `src/auth.ts` の `logger` で外しています）。エラーを外のサービスに送ることはしません（Sentry は v2.53.0 でやめました）。

## 保存とアクセス制御

`typle_workspaces` テーブルにユーザーごとのJSONBスナップショットとrevisionを保持します。APIとログインは Next.js の Route Handler（`src/app/api`・`src/server`）が提供し、所有者はサーバーがログインセッションのアカウントID（`github:…`・`password:…`）から決定します。APIは未認証アクセスを拒否し、書き込みでOrigin、アカウント一致、形式、最大1MiBのサイズを検証します。共有ランキングはありません。

次の段落は v2.0.0 より前の記録です（v2.0.0 でホームの「以前のデータを移行」をなくしました）。

旧形式のキーは `typle-r:word-lists:v1`、値は `{ version: 1, lists: [...] }` です。ホームの移行ボタンは現在のアカウントに追加し、同じ内容の再移行を重複させません。同名のリストは名前に移行番号を付けます。壊れた元データは変更しません。リスト削除はその記録も削除します。

## 関連リポジトリとの合わせ方

リポジトリの一覧は [README](../README.md) の「関連リポジトリ」にあります。

Web 版は `https://typle.sparklingstadt.com` の Next.js の Route Handler（`/api/*`）につながります。iPad・Mac 版は `https://typle-r-six.vercel.app` の `/api/workspace` などを呼びますが、**v2.55.0 からログインできません**（アプリのトークンと `/api/auth/token` をなくしたため。端末内の保存だけで使います。アプリ側の「ログイン」の表示を消すのは typle-ipad の別の作業です）。Vercel のドメインのページは、`vercel.json` で本番のドメインへ移します（`tests/domainRedirect.test.cjs`）。ほかのリポジトリは、このリポジトリのコードやデータの写しや対応する実装を持っています。ここを変えたら、合わせて直してください。

- 公式の単語リスト（`src/lib/packs`）：`commands/` の各 JSON が1リストです。並び順の原本は `commands/manifest.json` です。追加・削除時は JSON と manifest を更新して `npm run packs:generate` を実行すると、Web が読み込む `commands/index.ts` を生成します（v1.5.0 から。v2.46.11 までは Go のバックエンドの埋め込み用コピーも生成していました）。生成し忘れは単体テストで分かります。以前の `commands.json` 形式を使う他アプリには、`commands/manifest.json` の順に各 JSON を配列へまとめて渡してください。
- iPad 版と Mac 版：typle-ipad の `TypleCore/` は `src/lib` の規則の Swift 版で、`catalog.json` は公式の単語リストから作った写しです。公式の単語リストを変えたら、typle-ipad で `node scripts/catalog.cjs ../typle-r` を実行して作り直します。
- ログイン：v2.55.0 でアプリのログイン（`client=…`・トークン）をなくしました。アプリが必要とするなら、Auth.js の上で作り直します。
- アーカイブした typle-macos・typle-w・typle-a・typle-kotlin-backend は、このリポジトリを変えても直しません。
