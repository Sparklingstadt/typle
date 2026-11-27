# 本番の構成とリリース

本番（Vercel・Neon）の構成、コンテナのイメージ、なくした機能の扱い、リリースの順序です。リリースの手順そのものは [release-workflow.md](release-workflow.md) にあります。

## 本番の構成

### Neon / Vercelの構成

Vercel MarketplaceでNeonを接続し、サーバー用の環境変数を設定します。

- `DATABASE_URL`: NeonのPostgreSQL接続URL（pooled接続可、`POSTGRES_URL`も代替として利用可能）
- `DIRECT_URL`: マイグレーション用の直接接続URL（任意、未指定時はDATABASE_URL）。DATABASE_DRIVERは不要です。
- `BETTER_AUTH_SECRET`: 暗号学的にランダムな秘密値（Better Auth が Cookie とトークンの署名・暗号化に使います。`openssl rand -base64 32` など）。v2.62.1 で `AUTH_SECRET` から替えました。`AUTH_SECRET` はもう読まないので、Vercel と AWS（Secrets Manager の `typle/AUTH_SECRET`）からは持ち主が後日消します
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`: 本番用OAuth Appの認証情報
- `AUTH_SID_ISSUER`, `AUTH_SID_ID`, `AUTH_SID_SECRET`: Sparklingstadt ID の issuer（`https://id.sparklingstadt.com`）、クライアント ID（`typle-r`）とシークレット。callback は `<本番URL>/api/auth/callback/sid`（Auth.js のときと同じなので、ID サーバーの登録は変わりません。起動時に ID サーバーの discovery を読み、失敗するとそのインスタンスは再起動まで Sparklingstadt ID でログインできません。`npm run check:production` で気づけます。[architecture.md](architecture.md) の「Sparklingstadt ID のひも付け」）
- `AUTH_URL`: 本番URL。本番OAuth callbackは `<本番URL>/api/auth/callback/github`（v0.55.0 でも変わりません）。この値のオリジンだけを使います
- `AUTH_REDIRECT_PROXY_URL`: 使いません（Auth.js の設定で、v2.62.1 から読みません。残っていれば消してかまいません）
- `DEMO_LOGIN`: `1` でデモアカウント（ログイン画面の「デモアカウントで試す」）を出します。ほかの値か未設定なら出しません（v2.63.0 から。[features.md](features.md) の「デモアカウント」）
- `CRON_SECRET`: Vercel Cron が `GET /api/demo/reset` に付ける秘密値（`openssl rand -base64 32` など）。`vercel.json` の `crons` が毎日 19:00 UTC（日本時間 4:00）にデモアカウントを見本に戻します。未設定だと戻す API は 401 で断ります
- `COOKIE_CACHE_SECONDS`: **設定しません**（テスト用。Cookie のキャッシュの秒数を、既定の300より短くします）

関数は Vercel のシンガポール（`sin1`）で動かします（`vercel.json` の `regions`。v2.55.1 から。それまでは既定の米国東部 `iad1`）。Neon の DB も同じシンガポール（Vercel Marketplace のリージョン `sin1`）に置きます。DB を別のリージョンに移すときは、`regions` も DB に一番近いところに合わせます。

対象DBの環境変数を使って `npm run db:migrate` を実行してからデプロイします。マイグレーションは `db/migrations` の SQL で、`scripts/check-migrations.cjs`（DB より古いコードでないかの検査）のあと `prisma migrate deploy` が適用します（v2.36.19〜v2.60.7 は自作の `scripts/migrate.cjs` が `pg` で適用し、v2.60.8 から Prisma Migrate に戻しました）。アプリの DB の読み書きは Prisma Client です（v2.36.19〜v2.60.6 は `pg` の SQL、v2.60.7 から Prisma Client に戻しました）。DockerのDBからNeonへのデータコピーは自動ではありません。必要な場合はバックアップと復元を別途行います。本番への反映は、マージ後の main で `npm run verify` を通してから、手元の Vercel CLI（`vercel deploy --prod`）で行います（v2.38.1 から。[リリース運用](release-workflow.md)）。

公式資料: [GitHub OAuth App](https://docs.github.com/ja/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[PostgreSQL Docker image](https://hub.docker.com/_/postgres)。

### コンテナのイメージ

AWS への移行（[設計](superpowers/specs/2026-11-20-aws-migration-design.md)）のため、本番のイメージをリポジトリのルートの `Dockerfile` で作れます（v2.55.2 から）。AWS での動かし方は、後の手順書に書きます。

```bash
docker build --build-arg SITE_URL=https://typle.sparklingstadt.com -t typle-r .
```

- `SITE_URL` は必須です。`sitemap.xml`・`robots.txt`・ページのメタデータはビルドの時点で URL を埋め込むため、ないとビルドが止まります。
- イメージの中では `TYPLE_STANDALONE=1` で standalone のビルドをし、`node server.js` が `:3000` で受けます。Vercel と `next start`（verify・E2E）のビルドは今までどおりです。
- `.env*` と `*.pem` は `.dockerignore` でイメージに入りません。設定は実行のときに環境変数で渡します。
- マイグレーションは同じイメージの `/app/migrate` で `npm run db:migrate` を実行します（`npm --prefix /app/migrate run db:migrate`）。Prisma の CLI は開発用の依存で standalone のサーバーに入らないため、`/app/migrate` に `prisma`・`pg`・`@next/env` と、検査のスクリプト・`db/migrations`・`prisma.config.ts` だけを入れています。
- `prisma.config.ts` は、`DATABASE_URL` の `sslmode=verify-full&sslrootcert=…` を Prisma の CLI が読む形（`sslmode=require&sslcert=…&sslaccept=strict`）に直して渡します。Prisma の CLI は libpq の `verify-full` と `sslrootcert` を読まず、そのままでは証明書を確かめずにつなぐためです。
- Amazon RDS につなぐときは、`DATABASE_URL` の末尾に `?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` を付けます（RDS の CA バンドルはイメージに入っています）。
- 接続元の IP（回数制限）は `x-forwarded-for` の最後の値です。Vercel も AWS のロードバランサーも、最後に自分が見た接続元を置くためです。

### FFPF ID でのログイン（廃止）

FFPF ID（ffpf-portal）でのログインは v2.54.0 でなくしました。v2.58.0 で Sparklingstadt ID を足し、v2.59.0 からログインは Sparklingstadt ID と GitHub だけです。

- `/api/auth/signin/ffpf`・`/api/auth/callback/ffpf` は、プロバイダーがないので 404 です。
- 環境変数 `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` は読みません。ログアウトで Cookie `typle-ffpf-relogin` も置きません。
- v2.53.1 までに FFPF ID でログインしたセッション（アカウント ID が `ffpf:` で始まる）は、ログインから30日で切れるまで使えます。そのあとは、そのアカウントのデータ（DB の行はそのまま残ります）を開く方法はありません。

### パックの共有とギャラリー

パックの共有（`/api/shares`・`/api/shared`）、ギャラリー（`/gallery`・`/api/gallery` と通報・追加数・IP ごとの回数制限）、
表 `typle_gallery_reports`・`typle_gallery_hits` は v2.49.0 でなくしました（管理者ダッシュボードは v2.48.0）。表
`typle_shared_packs` は、v2.48.0 までのアプリが保存のたびに行を消すため v2.49.0 では空にして残し、v2.49.1 で消しました。
v2.49.1 からの DB では v2.48.0 までのアプリは保存できないので、Instant Rollback で戻すのは v2.49.0 までにします。パックを人に渡すときは、パックのファイル（`.typle-pack.json`）か CSV を書き出して送り、相手が取り込みます。
配られた共有リンク `/shared/<id>` は「この共有は終了しました。」とだけ表示し、`/gallery` は公式パックのカタログへ転送します。

## リリース

必須の順序は **PR作成 → CI（`verify`） → マージ（squash merge か普通のマージ） → main の CI（verify → GitHub Release作成 → Vercel本番デプロイ → 本番の確認）** です。`package.json` と `package-lock.json` のバージョンをPR内で更新します。mainへの直接pushは行いません。マージのあとは GitHub Actions がこの順に行うので、マージがそのまま本番への公開になります（v2.60.6 から。v2.38.1〜v2.60.5 の間は、マージした人が手元で行っていました）。`vercel.json` の `git.deploymentEnabled=false` は維持します。初回設定・手順・復旧手順は [リリース運用](release-workflow.md) を参照してください。
