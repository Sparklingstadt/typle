# 開発の手順

手元で動かす手順と、検査（`npm run verify`）の中身です。コードの構成とログイン・保存のしくみは [architecture.md](architecture.md)、本番の構成は [production.md](production.md) にあります。

## 開発環境のセットアップ

### Dockerでの仮運用

Node.js 24（`package.json` の `engines` で24系に固定）、npm、Docker Composeを使用します（v2.47.0 から Go は要りません）。

```sh
npm ci
node scripts/setup-local.cjs
docker compose --env-file .env.local up -d --wait
npm run db:migrate
```

`setup-local.cjs` はランダムなDBパスワードと `BETTER_AUTH_SECRET`（Better Auth が Cookie とトークンを署名・暗号化する秘密値。以前の `AUTH_SECRET` はもう読みません）を `.env.local` に生成します。既存ファイルは上書きしません。DBは `127.0.0.1:5433` のみ公開し、名前付きボリューム `typle-r_postgres_data` にデータを保持します。

GitHubの Settings → Developer settings → OAuth Apps でローカル用OAuth Appを作成します。

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Client IDとClient secretを `.env.local` の `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` に設定します。秘密値はコミットしないでください。

```sh
npm run dev
```

`npm run dev` は `next dev`（`127.0.0.1:3000`）を起動します。ページも API（Route Handler）も Next.js が答えます（v2.47.0 から。それまでは Go のバックエンドも一緒に起動していました）。`npm run dev:local`・`npm run dev:lan` も同じです。DB に接続できなくても起動し、その間 `/api/workspace`・`/api/health`（どちらも Next.js）は 503（`databaseUnavailable`）を返しますが、ログインは使えます。GitHub のログインは `AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` が揃っているときだけ使え、揃っていなければ GitHub のログインの開始（`POST /api/auth/sign-in/social`）だけが失敗します（開発ログインだけで開発できます）。

[ローカルアプリ](http://localhost:3000) を開いてGitHubでログインします。**アプリは `AUTH_URL` のホストとまったく同じアドレスで開いてください**（`localhost` と `127.0.0.1` は別のサイトとして Cookie が分かれるため、`AUTH_URL=http://localhost:3000` なら `http://127.0.0.1:3000` で開くとログインの Cookie が戻りません）。通常の停止は `docker compose --env-file .env.local stop`、再開は `up -d --wait` です。`down -v` は保存データを削除するため使用しないでください。

### 開発用ログインで起動

```sh
npm run dev:local
```

http://localhost:3000/local-login を開き「練習を始める」を押します。このMacのチェックアウトの `.env.local` は設定済みです。新規クローンでは上記のセットアップ後、`.env.local` に `LOCAL_DEVELOPMENT_LOGIN=1` を設定してください。DBは `docker compose --env-file .env.local up -d --wait` で再開できます。

開発ログインは `NODE_ENV=development`、`LOCAL_DEVELOPMENT_LOGIN=1`、`AUTH_URL` がHTTPのloopbackまたは明示指定したLAN内IPv4、`BETTER_AUTH_SECRET` 設定済みのすべてを満たす場合だけ有効です。専用アカウント `github:0` を使用し、GitHubアカウントとは分離します。本番ビルドでは無効です。`COOKIE_CACHE_SECONDS` はテスト用で（Cookie のキャッシュを1〜300秒に短くします。300を超える値は無視されます）、手元の開発や本番では設定しません。GitHub OAuthを使用する場合は `LOCAL_DEVELOPMENT_LOGIN=0` とし、従来どおりOAuthの設定を行ってください。

### LAN内の別端末から利用

`.env.local` の `AUTH_URL` を `http://<このMacのLAN IP>:3000`、`LOCAL_DEVELOPMENT_LAN_HOST` を同じIPに設定し、`npm run dev:lan` で起動します。別端末から同じURLの `/local-login` を開いてください。LAN用の開発ログインは明示指定したプライベートIPv4に限って有効で、本番では無効です。接続できるLAN内の利用者は、同じローカル練習用データを利用できます。DBポートは引き続きloopbackのみで待ち受けます。

`dev:lan` は `.env.local` のLANアドレスと `AUTH_URL` のポートを使用します。IPアドレスが変わった場合はこの2設定を更新してください。

## 検証

Dockerを起動してマイグレーションを実行した状態で。`npm run verify` は、公開の前に通す検査をすべて同じ順に流し、最初の失敗で止まります（E2E と API の文書を省くときは `npm run verify -- --fast`）。1つずつなら:

```sh
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # スキーマと DB のずれ
npm run typecheck
npm test
npm run lint
npm run build
(cd infra && npm ci && npm run typecheck && npm test && npm run synth)   # AWS の CDK（--fast でも流れる）
npx playwright install chromium
npm run test:e2e
```

### テーブルを変えるとき

アプリは DB を Prisma Client（`prisma/schema.prisma` から作る `src/generated/prisma`）で読み書きし、テーブルは `db/migrations` の SQL を Prisma Migrate が適用して作ります（`npm run db:migrate`: `scripts/check-migrations.cjs` のあと `prisma migrate deploy`。v2.60.8 から。v2.36.19〜v2.60.7 は自作の `scripts/migrate.cjs` でした）。`prisma.config.ts` の `migrations.path` が `db/migrations` を指します。Prisma の表示は「`migrations found in prisma/migrations`」となりますが、実際に読むのは `db/migrations` です。

`prisma migrate dev` は使えません。本番の履歴には、`0027_schema` にまとめて手元にはない `0001`〜`0026` の記録が残っていて、`migrate dev` はそれを手元との不一致とみなし、DB を作り直そうとするためです。新しいマイグレーションは次の手順で作ります。

1. `prisma/schema.prisma` を変えます。
2. 手元の DB（`npm run db:migrate` 済み）と変えた `schema.prisma` の差を SQL にします。名前は、今の最後の番号の次の4桁の番号と、変更の短い英語の名前です。

   ```sh
   mkdir db/migrations/0041_<名前>
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > db/migrations/0041_<名前>/migration.sql
   ```

   Prisma が書けないもの（CHECK 制約、データの書き換え、`unnest` などの関数）は、出てきた SQL に手で足します。最初から手で書いても構いません。
3. SQL の最初の行を `BEGIN;`、最後の行を `COMMIT;` にします。Prisma Migrate は1本をトランザクションで包まないため、こう書かないと、途中で失敗したときに変更が半分だけ残ります（`tests/migrate.test.cjs` が `0040_sid_links` より後のものを確かめます。それまでのものはチェックサムが変わるので書き換えません）。`CREATE INDEX CONCURRENTLY` のようにトランザクションの中で実行できない SQL は、そのマイグレーションだけで1本にし、`BEGIN;`・`COMMIT;` を書かずにテストの例外にします。
4. `npm run db:migrate` で手元の DB に当て、`npx prisma generate` で Prisma Client を作り直します。
5. `npm run verify` は `db:migrate` のあとに、マイグレーションを当てた DB と `schema.prisma` の差を `prisma migrate diff` で確かめ、違えば止まります（CHECK 制約は `schema.prisma` に書けないので比べません）。

適用済みのマイグレーションのファイルは書き換えません。変更は新しいマイグレーションで行います。DB の形から `schema.prisma` を作り直すときは `npx prisma db pull` ですが、モデル名・フィールド名とコメントが消えるので、差分を見て戻します。手元の DB の履歴は `npx prisma migrate status` で見られます。

SQL のまま残しているのは4か所です。Prisma で書けない `modifyWorkspace` の行のロック（`FOR UPDATE`）、`writeWorkspace` の最初の保存どうしのロック（`pg_advisory_xact_lock`）、`revokeLogins` の時刻の upsert と、速さのための `syncRecords` の記録の挿入（`unnest` の1文。Prisma の `createMany` では記録 5,000 件の保存が約3倍遅くなったため）です。

API の Route Handler は、DB を使うテスト（`tests/api*.test.cjs` など）が、マイグレーション済みのテスト用DB（`TYPLE_TEST_DATABASE_URL`）で確かめます（`npm run verify` は `db:migrate` の後に実行します）。v2.46.11 まで動いていた Go のバックエンドの答え・Cookie・トークンは `tests/fixtures`（`auth-answers.json` など）に記録してあり、TS が同じ答えを返すことを確かめます（Go の Cookie の fixtures は v2.62.0 で Cookie の実装とともになくしました）。

`npm test` は入力判定、記録、移行、形式検証などの単体テストです。速さのため全ファイルを1つのプロセスで動かす（`--test-isolation=none`）ので、`process.env` や `globalThis` を変えるテストは終わりに元へ戻してください。E2Eは既定で6 workersを使い、ファイル内も並列実行します（v2.38.2 から。それまでは手元ではコアの半分でした）。すべてのテストが1つの `next start` を共有するため、workers を増やしても速くなりません。14コアの Mac では、6のとき約56秒、コアの半分の7で約61秒、14で約88秒でした。数は環境変数 `TYPLE_E2E_WORKERS`（`4` や `50%` など）で変えられます。テストごとにランダムなアカウントIDを使用します。Playwright が本番ビルドの `next start`（ポート3101）を起動し、実PostgreSQLとAPIを通して作成・編集・練習・再読み込み・削除、アカウント分離、401/403/409応答を確認します。GitHub にはつながず、`tests/e2e/sessionCookie.ts` がテスト専用の秘密値で署名したログインの Cookie を作ります（`src/server/session.ts` と同じ値になることは `tests/sessionCookie.test.cjs` が確かめます）。GitHub OAuth画面の実ログインは自動テストできないため、公開後に本番で別途確認が必要です。Sparklingstadt ID は、Playwright が起動する偽の OpenID Connect のサーバー（`tests/e2e/fakeSid.cjs`、ポート3197）を相手に、ログイン・ひも付け・断る場合・ログアウト後の `prompt=login` まで通します（`tests/e2e/sid-login.spec.ts`）。テストユーザーの行だけを終了後に削除します。スナップショットテストの更新手順は [docs/snapshots.md](snapshots.md) にまとめています。`tests/e2e/aria-snapshots.spec.ts` は、ログインの画面、使い方の目次、トップバーと、練習の結果、単語リストの行のメニュー、CSV の読み込みのダイアログ、編集をやめるときの確認のアクセシビリティツリー（役割・名前・並び）を、テストに書いた期待値と比べます（ARIA スナップショット。画像ではないので OS やフォントで変わりません）。ほかの画面（ホーム、記録、設定、編集、思い出して打つ・手書きのモード、パックの編集、ログイン中の表示、共有された結果、公式パック、エラーの表示、英語の表示など）は期待値が長いので、画面ごとのファイル（`tests/e2e/aria-snapshots.spec.ts-snapshots/*.aria.yml`）に分けています。公式パックの一覧・関心・トップページ・ライセンスは、公式パックや依存パッケージが増えると一覧が変わるので、期待値を手で書き、見出し・説明・操作と一覧の1件目の形だけを比べます（ARIA スナップショットは、期待値を含んでいれば一致とみなします）。記録のデータと時計は `tests/e2e/snapshotData.ts` でスクリーンショットと共通にしてあり、日付・時刻・秒数まで実際の値で比べます。画面をわざと変えたときは、テストの中の期待値を `npx playwright test tests/e2e/aria-snapshots.spec.ts --update-snapshots --update-source-method=overwrite` で、ファイルに分けた期待値を `TYPLE_ARIA_WRITE=1 npx playwright test tests/e2e/aria-snapshots.spec.ts` で書き直し、差分を確かめてからコミットします。`tests/e2e/screenshots.spec.ts` は、ログイン（ライト・ダーク・スマートフォンの幅）、使い方の上部、練習中・打ち間違い・練習の結果・練習記録・ベスト記録（それぞれライトとダーク）、ホーム（ライト・ダーク・はじめての人向け・英語）、単語パックの一覧と行のメニュー、単語リストの編集・入力エラー・編集をやめるときの確認、CSV の読み込みのプレビュー、パックの作成と編集、単語一覧、端末、設定の一般と入力、トップページ、Typleについて、スマートフォンのメニュー・練習・結果、思い出して打つ（ライト・ダーク）・手書きのモード、ログイン中のメニューと設定、共有された結果、終了した共有のリンク、公式パック1つのページ、読めない保存データ、保存できなかったとき、英語のログインを、前に撮った画像（`tests/e2e/screenshots.spec.ts-snapshots/`）と比べます。フォントの描画が OS で違うため、画像は macOS で撮っていて（名前が `-darwin` で終わります）、macOS でしか一致しません。サイドバーのバージョンは PR のたびに変わるので、塗りつぶして比べます。ログイン中の画面は、ほかの E2E と同じく `tests/e2e/account.ts` のテスト用のログイン（名前は E2E User、ID はテストごとにランダム）を使い、終わったら DB の行を消します。公式パックの数はパックを足すたびに変わるので、トップページの件数は塗りつぶし、公式パックの一覧と関心の画面は撮りません。練習の画面は、Playwright の時計（`page.clock`）を止めて決まった秒数だけ進めながら打つので、経過・速度・所要時間・記録の日付も毎回同じになります。記録の画面も時計を 2026年11月1日（日）の正午（日本時間）に固定し、その日から数えた記録を入れておくので、「今日」「昨日」の見出しまで毎回同じです。画面の見た目をわざと変えたときは `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots` で撮り直し、変わった画像を1枚ずつ見てからコミットします。

GitHub Actions の CI（`.github/workflows/ci.yml`）は、PR と main で同じ `npm run verify` を Linux で流します（v2.60.3 から。v2.38.1〜v2.60.2 の間はありませんでした）。スクリーンショットのスナップショットは macOS でしか一致しないので CI では飛ばし、手元の verify で比べます。マージのあとは、main の CI が verify・Release・本番デプロイを続けて行います（v2.60.6 から。[リリース運用](release-workflow.md)）。スクリーンショットを比べるのは PR の前の手元の `npm run verify` だけなので、省かずに通してから PR を出します。開発ビルド `.next` と本番ビルド `.next-production` は分離しています。

## UIコンポーネント

UIはshadcn/ui（Radix / Nova）とTailwind CSS 4で構成しています。設定は `components.json`、テーマは `src/app/globals.css`、コンポーネントのソースは `src/components/ui` にあります。追加は `npx shadcn@latest add <component>` で行えます。ボタンの既定typeはフォームの誤送信を避けるため `button`、標準の高さは44pxに調整しています。

削除確認はAlertDialogを使い、失敗時はダイアログ内で再試行できます。入力欄のラベル・必須属性、IME入力、認証とDB保存は維持しています。

Tailwind 4の対象ブラウザーはSafari 16.4以上、Chrome 111以上、Firefox 128以上です（v0.5.0 から）。

## 依存関係の監査

2026-11-06 の `npm audit` の指摘は13件（low 2・moderate 11）で、どれも開発用の ESLint と shadcn の依存（`minimatch`・`deepmerge`）です。本番の依存には入っていません。v2.36.19 で Prisma をなくし、そのための override もなくなりました。v2.60.7 で Prisma Client（7.10.1）を戻しました。
