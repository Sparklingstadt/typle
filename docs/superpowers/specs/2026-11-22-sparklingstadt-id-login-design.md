# Sparklingstadt ID でのログイン 設計

## 目的

今後の Sparklingstadt のサービスは、ログインをすべて Sparklingstadt ID（`https://id.sparklingstadt.com`、OpenID Connect）にそろえる。typle-r もそこへ移る。ID サーバー側の設計（`sparklingstadt-id` の `docs/superpowers/specs/2026-11-21-sparklingstadt-id-design.md`）では、typle-r は移す順の2番目のクライアント（`typle-r`）になっている。

今の利用者は持ち主（Sparklingstadt）だけで、データは GitHub のアカウント `github:219588180` にある。Sparklingstadt ID でログインしたとき、このデータをそのまま使えるようにする。

## 目標・目標でないこと

- 目標：ログイン画面に「Sparklingstadt ID でログイン」を足す。ひも付けた ID でログインすると、今のアカウント（`github:219588180`）として入れる。
- 目標：ひも付けていない ID でログインすると、新しいアカウント `sid:<sub>` になる（ID サーバーの設計と同じ形）。
- 目標でないこと：GitHub と ID・パスワードのログインを外すこと。移り終えたら別の PR で外す。
- 目標でないこと：ひも付けの画面、ひも付けの解除、メールアドレスでの自動のひも付け。利用者が1人なので作らない。
- 目標でないこと：ID サーバーへの RP-Initiated Logout（typle でログアウトしても、ほかのサービスのログインは残す）。
- 失敗とみなすこと：ひも付けを調べられないときに `sid:<sub>` の空のアカウントでログインさせ、そこに保存させてしまうこと。

## 方法の候補（選んだのは A）

- **A. ひも付けの表を作り、手元のコマンドで1回だけひも付ける（採用）**。ID でログインしたとき、`sub` に対応するアカウントが表にあればそのアカウントに、なければ `sid:<sub>` にする。GitHub のアカウントもデータを動かさずに移れ、古いログインを外す時期も選べる。利用者が1人なので、「つなぐ」画面の代わりにコマンドにした（Claude の判断）。
- B. 確認済みのメールアドレスで自動的に合わせる。GitHub のアカウントはメールアドレスを取っていないので、持ち主のデータに届かない。
- C. ログインの手段を足すだけにする。データを引き継げない。

## 決めたこと

### ログイン

- Auth.js の OIDC プロバイダーを足す。id は `sid`（コールバックは `/api/auth/callback/sid`。ID サーバーのテストの `typle-r` クライアントと同じパス）、表示名は「Sparklingstadt ID」。discovery を使い、`checks` は PKCE（S256）・`state`・`nonce` にする。scope は `openid email profile`。
- 環境変数は `AUTH_SID_ISSUER`・`AUTH_SID_ID`・`AUTH_SID_SECRET`。3つそろったときだけ、プロバイダーとボタンを出す（`githubConfigured` と同じ考え方）。
- ID トークンの `email_verified` が true でなければ、ログインを断る（ID サーバーの設計のクライアントの約束）。
- ログイン画面では、Sparklingstadt ID のボタンをいちばん上に置く。GitHub と ID・パスワードはその下に残す。
- `jwtCallback` で、プロバイダーが `sid` のときは `typle_sid_links` を `sub` で引き、行があればその `account_id` を、なければ `sid:<sub>` をアカウント ID にする。表を読めないときは、ログインを失敗にする（`/signin?error=…` に戻る）。
- 名前は ID の `name`、なければ `email` の `@` の前（Claude の判断）。画像はない。
- ログアウトしたあとの次の Sparklingstadt ID のログインでは、`prompt=login` を付けてパスワードを聞く。FFPF ID のときの v2.6.4（#206）と同じ扱い（Claude の判断）。

### ひも付け

- マイグレーション `0040_sid_links` で `typle_sid_links`（`sub text PRIMARY KEY`、`account_id text NOT NULL UNIQUE`、`created_at timestamptz NOT NULL DEFAULT now()`）を作る。
- コマンド `npm run sid:link -- <sub> <account_id>` で1行足す（`DATABASE_URL` の DB に。本番には本番の接続文字列を渡す）。`sub` は `sid:<sub>` の形でも受け付ける。
  - 断るとき：その `sub` がもうひも付いている、そのアカウントにもう別の `sub` がある、そのアカウントに保存したデータがない（打ち間違いの防止）、`sid:<sub>` のアカウントにもう保存したデータがある（ひも付けるとそのデータに届かなくなるため）。
- 自分の `sub` の調べ方は README に書く（例：一度 Sparklingstadt ID でログインし、保存する前に `/api/auth/session` の `user.id` を読む）。
- ひも付けたあとは、どのログインで入っても同じアカウントになる。「すべての端末からログアウト」もアカウント ID ごとに効く。

### そのほか

- Cookie の形は変えない。Go・Rails・Laravel のバックエンドは Cookie のアカウント ID を読むだけなので、変更は要らないはず（実装のときに確かめる）。
- 本番の設定（ユーザーが行う）：ID サーバーの `OIDC_CLIENTS` に `typle-r` を登録する（`redirectUris` は `https://typle.sparklingstadt.com/api/auth/callback/sid` と `https://typle-r-six.vercel.app/api/auth/callback/sid`）。typle-r の Vercel に3つの環境変数を入れる。デプロイ後に `sid:link` を本番の DB に1回走らせる。
- テスト：単体テスト（プロフィールの変換、`email_verified`、`jwtCallback` の引き当て、`sid:link` の断る場合）。E2E は、`tests/e2e/fakeResend.cjs` と同じように、テストの中で小さな OIDC プロバイダーを立てて、ログイン・ひも付けたアカウントで入ること・ログアウト後の `prompt=login` を確かめる。`authPathKnown` の `sid` も確かめる。
- 文書：README、`api-docs/src/app/auth.md`、`.env.example`。バージョンは v2.58.0（ログインの手段を足すので minor）。

## 実装する人に任せること

- `prompt=login` を付ける仕組み（Cookie の印など。v2.6.4 の作りを参考に）。
- E2E の偽の OIDC プロバイダーの作り方と、`verify` の中での起動のしかた。
- ログイン画面のボタンの見た目（今の GitHub のボタンに合わせる）と、6言語の文言。
