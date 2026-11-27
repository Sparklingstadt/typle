# PRから本番公開まで

必須順序: **PR作成 → CI（`verify`） → マージ（squash merge か普通のマージ） → main の CI（policy・verify → GitHub Release → Vercel本番デプロイ → 本番の確認）**。

`.github/workflows/ci.yml` がこの順番を制御します（v2.60.6 から。v2.38.0 までの `policy → verify → release → deploy` と同じ形です。
v2.38.1〜v2.60.5 の間は、Release とデプロイを手元で行っていました）。**PR をマージすると、そのまま本番に公開されます。**

- PR・手動実行は検査（`policy` の設定の確認と `verify`）だけで、公開は main への push に限ります。
- `verify` は `npm run verify`（`scripts/verify.cjs`）の1コマンドです。DB更新・マイグレーションのテスト・型チェック・単体テスト・Lint・knip・
  本番ビルド・AWS CDK の検査・E2E・APIの文書のビルドとリンク検査を順に流し、最初の失敗で止まります。
- CI は Linux で動くので、macOS でしか一致しないスクリーンショットのスナップショット（`tests/e2e/screenshots.spec.ts`）だけは飛ばします。
  スクリーンショットを比べるのは、PR の前に手元で通す `npm run verify` だけです。省かずに通してから PR を出します。
- PR の verify に通っても、マージ後の main のコミットで verify をもう一度流してから公開します。
- Release のイベントで別の workflow を起動する方式ではないので、`GITHUB_TOKEN` で作った Release から別の workflow が起動しない制限に依りません。
- API の文書を公開する「Docs deploy」は、手で実行する別の workflow です。

## 初回設定

1. GitHubの **Settings → General → Pull Requests** で、Allow squash mergingを有効にし、
   Allow rebase mergingを無効にします。普通のマージを使うときはAllow merge commitsも有効にします。
2. **Settings → Rules → Rulesets** でmainを対象とした有効なルールを作ります。
   PR必須、ブランチを最新にすることを必須にし、force push・削除禁止、bypass対象なしを設定します。
   required status check には CI の `verify` を指定します（v2.60.3 から。指定するまでは、マージの前に PR の `verify` が通っていることを目で確かめます）。
   private repoのプラン等によりルールを強制できない場合、mainへの直接pushは運用で禁止します。
3. **Settings → Environments** の `production`（deployment branch を main に限定）に `VERCEL_ORG_ID`・`VERCEL_PROJECT_ID` を、
   リポジトリの Secret に `VERCEL_TOKEN` を登録します。`VERCEL_TOKEN` は対象のチームだけに届く範囲にし、期限を付けます。
   期限が切れると `credentials` ジョブが止まり、Release もデプロイも行いません。新しいトークンを登録して、失敗したジョブを再実行します。
   Actions が使えること、workflow の `contents: write`（Release の作成）が禁止されていないことも確かめます。
   手元の Mac は、PR の前の verify のために用意します（[development.md](development.md) の「Dockerでの仮運用」）。
   CI が公開できないときに手で公開するなら、`gh auth login` と `vercel login`・`vercel link`
   （`.vercel/project.json` が本番のプロジェクトを指すこと）も済ませます。`.vercel/`・トークン・`.env.local` はコミットしません。
4. 対象VercelプロジェクトのProduction環境にDB・Authの環境変数を設定します。
   [production.md](production.md) の「Neon / Vercelの構成」を参照してください。
   公開先は`https://typle.sparklingstadt.com`です（v2.33.0 から。`SITE_URL`・`AUTH_URL` にこの URL を設定します）。
   Vercel のドメイン`https://typle-r-six.vercel.app`も残し、iPad・Mac 版はそこの`/api/*`を呼びます。
5. API の文書（`api-docs/`）を Cloudflare Pages に公開するため、**Settings → Environments** で`production`を作り（deployment branchをmainに限定）、次の2つを登録します。
   - `CLOUDFLARE_API_TOKEN`: 対象アカウントの **Cloudflare Pages: Edit** の権限だけを持つ API トークン。期限を付けてください。
   - `CLOUDFLARE_ACCOUNT_ID`: 対象アカウントのID。
   Pages のプロジェクト `typle-api-docs` は、なければ最初の`docs-deploy`（`.github/workflows/docs-deploy.yml`）が作ります。Cloudflare の Git 連携は使いません。
6. `vercel.json`の`git.deploymentEnabled: false`を維持します。
   公開は CI の deploy ジョブ（`vercel deploy --prod`）だけで行い、Vercel の Git 連携・Deploy Hook・別の workflow は併用しません。

Release の作成（`contents: write`）は release ジョブだけ、Vercel のトークンは credentials・deploy ジョブの必要なステップだけが持ちます。

## 現在の導入状態

2026-11-25 に、main の Ruleset「main: CI の verify を必須にする」を作りました（リポジトリを公開してから使えるようになりました）。
`verify` が成功していないコミットは、main にマージも直接 push もできません。bypass はありません。
入れてあるのはこの検査だけで、PR 必須・ブランチを最新にすること・force push と削除の禁止は、まだ入れていません。
Actions が止まってマージできなくなったら、Settings → Rules でこの Ruleset を無効にします。
本番ビルドのNode.jsは24系です。`package.json` の `engines` を `"24.x"` に固定しています（v2.6.5 から）。`">=24.0.0"` のような上限のない指定では、Vercel が新しいメジャー版（26系）を自動で選び、手元の verify（24系）と食い違うためです。

## 毎回の開発

1. mainから作業ブランチを作り、コード変更とバージョン更新を行います。
   `npm version 0.18.2 --no-git-tag-version`のように、未使用の安定版`X.Y.Z`を指定します（`git tag` と GitHub の Releases で未使用を確かめます）。
   package.jsonとpackage-lock.jsonを両方コミットしてください。
2. 手元で `npm run verify` を通してから PR を作成し、変更内容を確認します。
   作業中の確認には E2E と API の文書を省く `npm run verify -- --fast` が使えますが、PR の前は省かずに通します。
3. PR の CI（`verify`）が通ったことを確かめてからマージします。**マージが公開の合図です。** 既定はsquash mergeで、コミットの履歴を残したいPRは普通のマージにします。
   どちらも、マージコミットのタイトルをPRのタイトル（末尾に `(vX.Y.Z)`）と同じにします。コミットが1つだけのPRをGitHubの画面でsquashすると、
   PRのタイトルではなくそのコミットのタイトルが入るので、マージの画面で直します（`gh pr merge <番号> --squash --subject "<PRのタイトル> (#<番号>)"` でも指定できます）。
   前のmainの公開（deploy ジョブ）が完了するまでは次のPRをマージしません。
4. main の CI の `policy` が、その push が1つのマージ済みPRのコミットであること（squash mergeは1コミットで親が直前のmain、
   普通のマージは第1親が直前のmainで第2親がPRのhead）と、マージの設定（squash 可・rebase 不可）を確かめます。
5. `verify` が、CI の PostgreSQL で `npm run verify` を流します。失敗したら公開しません。新しいバージョンで修正PRを出して、同じ順序でやり直します。
6. `credentials` が、`VERCEL_TOKEN` でまだログインできることを確かめます。Release だけができてデプロイできない、という状態を避けるためです。
7. `release` が、同じコミットに `v<package.jsonのversion>` のタグと公開済みの通常Releaseを作ります（`scripts/ci/release.cjs publish`）。
   Release notes はGitHubの自動生成です。公開済みとは非draftの意味です。タグを動かしたり、同じバージョンを別のコミットに使ったりしません
   （同じタグが別のコミットにあれば止まります。PR のバージョンを上げ直します）。
8. `deploy` が、Release のタグがそのコミットを指していることを確かめ直してから、固定版の Vercel CLI で `vercel deploy --prod --yes` を実行します。
   Vercel内で本番ビルド・デプロイします（`vercel.json` の `npm run db:migrate && npm run build`）。
   読み出し不可のSecretが`[SENSITIVE]`になるため、`vercel pull`・`vercel build` はしません。
9. `deploy` は、本番のドメインが新しいデプロイを返すまで待ちます。`vercel deploy --prod` は、ドメインがまだ前のデプロイを返しているうちに終わることがあり、
   前のデプロイにもあるパスは同じ応答になるため、そのままでは確認が新しいデプロイを見ないからです。
   そのあと `scripts/check-production.cjs`（手元では `npm run check:production`）で次を確かめます。1つでも失敗すればジョブは失敗です。
   本番（`https://typle.sparklingstadt.com`）のホームの成功応答、Vercel のドメインのページが本番へ308で移ること（クエリも残す）、
   両方のドメインで Route Handler（`src/app/api/health/route.ts`）が返す`/api/health`の200（本番DBへの接続を含む）と匿名APIアクセスの401。
   ログインの関数（Better Auth）も本番のドメインで確かめます。匿名の`GET /api/auth/get-session`が200で本文が`null`であること、
   Originを付けた`POST /api/auth/sign-in/social`（`provider`が`github`）が`https://github.com/login/oauth/authorize`のURLを返し、
   その`redirect_uri`が`https://typle.sparklingstadt.com/api/auth/callback/github`であること、`provider`が`sid`のときは
   ID サーバー（`AUTH_SID_ISSUER`のホスト。既定は`id.sparklingstadt.com`）のURLを返し、`redirect_uri`が`.../api/auth/callback/sid`であること、
   Auth.jsの`/api/auth/session`・`/api/auth/providers`・`/api/auth/csrf`が404であることです。
   これにより、本番の関数で`BETTER_AUTH_SECRET`・`AUTH_URL`・`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET`・`AUTH_SID_*`が揃って設定され、
   起動時の ID サーバーの discovery が読めたことまで確かめます。
10. マージした人は、main の CI の実行が deploy まで成功したことを Actions で確かめます。
11. API の文書（`api-docs/`）は、v2.25.2 から CI では公開せず、必要なときに手で公開します。deploy が成功した後、
    Actions の「Docs deploy」を main で実行します（Run workflow。`docs-deploy.yml`、main 以外では何もしません）。
    main の最新のコミットの文書をビルドし、リンクを検査して、固定版の Wrangler（`docs-deploy.yml`の`WRANGLER_VERSION`）で
    Cloudflare Pages の`typle-api-docs`に公開し、公開後に主なページが返ることを確かめます。
    文書の公開が失敗してもアプリの公開には影響しません。原因を直して「Docs deploy」を再実行します。
    文書のビルドとリンクの検査は `npm run verify` でも行います。

### CI が公開できないとき（手で公開する）

Actions が止まっているときなど、CI に頼れないときだけ、マージした人の Mac で同じ順に行います（v2.38.1〜v2.60.5 の手順です）。
CI の実行が途中まで進んでいたら、先にその実行を止めます。

1. `git switch main && git pull --ff-only`。HEAD がその PR のコミットで、`git status` に変更がないことを確かめ、`npm run verify` を省かずに通します。
2. Release を作ります。

   ```bash
   gh release create "v$(node -p "require('./package.json').version")" --target "$(git rev-parse HEAD)" --title "v$(node -p "require('./package.json').version")" --generate-notes --latest
   ```

3. 同じチェックアウトから `vercel deploy --prod --yes` でデプロイし、`vercel inspect typle-r-six.vercel.app` が
   そのデプロイを指すまで待ってから、`npm run check:production` を通します。

verifyのDBは CI が立てたDB（PR の前は手元のDB）ですが、`vercel deploy --prod` から起動するVercel上のビルドは本番環境変数を使います。
`vercel.json`に従い、ここで本番DBへmigrationが適用されます。DB更新に成功した後で
ビルドやデプロイが失敗することもあるため、migrationは旧アプリと互換性のある変更にします。
DBの自動ロールバックは行いません。

`npm run db:migrate` は、`scripts/check-migrations.cjs` のあと `prisma migrate deploy` で `db/migrations` の SQL を名前の順に適用します
（v2.60.8 から。v2.36.19〜v2.60.7 は自作の `scripts/migrate.cjs`、それより前も `prisma migrate deploy` でした）。履歴は `_prisma_migrations` テーブルにあり、
`0027_schema` にまとめた `0001`〜`0026` のような、手元にない古い記録があっても Prisma Migrate はそのまま進みます。

### 古いコードの検査（`scripts/check-migrations.cjs`）

古いコミットを本番へデプロイしてはいけません。2026-10-31 に v0.99.4 のソースを手元からデプロイしたところ、そのコミットには `0001`〜`0026` しかなく、
`0027_schema` にまとめる前の古いマイグレーションを未適用とみなして本番DBへ流そうとし、`0002_practice_devices` が本番DBで失敗しました。
失敗の記録が残ったため、後のデプロイも `P3009` で止まりました。

`scripts/check-migrations.cjs` は、`prisma migrate deploy` の前に `_prisma_migrations` を読み、手元の最新より後の名前の適用済みのマイグレーションがあれば、
何も適用せずに失敗します（v2.5.8 から。v2.60.8 で `migrate.cjs` から分けました）。DB にコードより新しい記録があると、コードが DB より古いと分かるためです。
`prisma migrate deploy` 自身はこれを調べず、新しいテーブルの上で古いコードを動かしてしまいます（成功で終わります）。この検査は v2.5.8 以降のコードにしかないため、
それより前のコミットは今も本番へデプロイしないでください。手で公開するときも、`main` の先頭だけを出します。
前のデプロイへ戻すときは、ビルドをしない Vercel の Instant Rollback を使うか、新しいバージョンの修正PRを出します。

## マイグレーションの失敗

Prisma Migrate は1本をトランザクションで包みません。そのため v2.60.8 からの新しいマイグレーションは、SQL の最初に `BEGIN;`、最後に `COMMIT;` を書きます
（[開発](development.md)の「テーブルを変えるとき」、`tests/migrate.test.cjs` が確かめます）。こう書いたマイグレーションが失敗すると、DB はその1本の前の状態に戻りますが、
`_prisma_migrations` に失敗の行が残り、次の `prisma migrate deploy` は `P3009` で止まります。

本番では Vercel のビルドの `npm run db:migrate` が失敗し、デプロイが止まります。今の本番のアプリと DB はそのまま動き続けます。ログで原因を見分けます。

| ログ | 意味 | 直し方 |
|---|---|---|
| `Applying migration <名前>` のあとの `Error: …`（`BEGIN;` のあるものは `current transaction is aborted`） | その SQL が本番のデータで失敗した。失敗の行が残った | 下の手順で原因を見て記録を直し、SQL を直した新しいバージョンの PR を出す |
| `The database has migrations this checkout does not have` | DB より古いコードをデプロイした。何も適用していない | 最新の main をデプロイする |
| `P3009`（`migrate found failed migrations`） | 前の失敗の行が残っている。何も適用していない | 下の手順で記録を直す |
| `P3005`（`The database schema is not empty`） | 接続先が違う（履歴のない、空でない DB）。何も適用していない | `DIRECT_URL`・`DATABASE_URL` を確かめる |
| `P1002`（advisory lock の待ち時間切れ） | 別の実行が終わらない | 終わるのを待ち、デプロイをやり直す |

失敗の行を直す手順は次のとおりです。本番の接続文字列は `vercel env pull --environment=production` で取り出し、`DIRECT_URL=<本番の直接接続> npx prisma …` のように渡します。

1. `npx prisma migrate status` で、失敗したマイグレーションの名前を確かめます。
2. 原因を見ます。`BEGIN;` のあるマイグレーションでは、Prisma のログは `current transaction is aborted` だけで、本当のエラーも
   `_prisma_migrations` の `logs` も残りません。`COMMIT;` を `ROLLBACK;` に替えて同じ DB で流すと、何も変えずに本当のエラーが出ます。

   ```bash
   sed 's/^COMMIT;$/ROLLBACK;/' db/migrations/<名前>/migration.sql | psql "$DIRECT_URL" -v ON_ERROR_STOP=1
   ```

3. その SQL が DB を途中まで変えていないかを、テーブルの定義で確かめます。`BEGIN;`・`COMMIT;` を書いたものは変えていません。
   書いていない古いもの（`0040_sid_links` まで）が途中まで変えていたら、先に手で元に戻すか、残りを手で済ませます。
4. 記録を直します。適用し直すなら `--rolled-back`、手で最後まで済ませたなら `--applied` です。

   ```bash
   npx prisma migrate resolve --rolled-back <名前>
   ```

5. SQL を直したなら、同じ名前のマイグレーションのファイルを直した新しいバージョンの PR を出します（失敗したものは適用済みではないので、書き換えて構いません）。
   SQL は正しく、原因が一時的なもの（接続の切断など）なら、失敗した deploy ジョブを再実行します（手で公開しているときは `vercel deploy --prod` をやり直します）。

適用済みのマイグレーションのファイルは書き換えません。変更は新しいマイグレーションで行います。

## 失敗時

- PR の前の verify 失敗、PR の CI の失敗: 直してから PR を出し直します（push し直します）。
- マージ後の policy・verify 失敗: 公開に進みません。新しいバージョンで修正PRを作り、同じ順序で公開します。
- credentials 失敗: Release もデプロイも行っていません。`VERCEL_TOKEN` を新しくして、失敗したジョブを再実行します。
- release 失敗: デプロイに進みません。タグだけできていれば、同じコミットを指していることを確かめてから release ジョブを再実行します。
- deploy 失敗: 先に作成したReleaseは残ります。Releaseの存在だけでは本番反映成功を意味しません。原因を直して、deploy ジョブを再実行します
  （Release が同じコミットを指していれば、そのまま使います）。
- docs-deploy失敗: アプリの本番には影響しません。Secretやトークンの権限を直し、「Docs deploy」を再実行します。手元から`wrangler`で公開しません。
- 認証・通信などの一時的な問題: 原因を直して、失敗した手順からやり直します。
  既存Releaseは非draft・非prerelease・同じタグ・同じSHAの場合だけそのまま使います。
  タグを移動したり、同じバージョンを別コミットに使ったりしません。
- コード修正が必要: 新しいバージョンで修正PRを作り、同じ順序で公開します。
- 公開の途中でmainが進んだ: 古い実行は Release もデプロイも行わずに止まります（`scripts/ci/release.cjs` が main の先頭を確かめます）。最新の main の実行が公開します。古いコミットを公開して巻き戻しません。
- HTTPチェックだけ失敗: デプロイ済みの可能性があるため、実際の公開状態を確認してから復旧します。
- v1.3.0 より前のバージョンへ戻す: 練習記録は `typle_records` に移っているため、戻す前に本番DBへ
  `scripts/records-rollback.sql` を実行して記録をリストへ戻します（[設計](superpowers/specs/2026-10-29-record-table.md)）。

常に1件ずつマージから公開完了まで進めてください。

## 検証と参考資料

手順を変えたときは、このファイルと `CLAUDE.md` の「Release workflow」、`.github/workflows/ci.yml`・`scripts/ci/release.cjs`・`scripts/verify.cjs`・`scripts/check-production.cjs` を合わせます。

- [GitHub CLI: gh release create](https://cli.github.com/manual/gh_release_create)
- [Vercel CLI: vercel deploy](https://vercel.com/docs/cli/deploy)
