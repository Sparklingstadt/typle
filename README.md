# Typle

自分の単語リストで練習できるタイピングアプリです。

練習画面（`/play`）の「思い出して打つ」を入れると、答えを隠して練習します。補足は答えを伏せて表示し（「apple / りんご」なら「りんご」だけ、区切りのない補足では答えを「＿＿」にします）、表示する単語が入力する文字と違うときはそれも出します（どちらもないときは「ヒントがありません」）。答えは未入力の文字数だけ「＿」で示します。次の単語・すべての単語・入力する文字の案内・簡易入力の対応は表示しません。「答えを見る」で答えを表示でき、その単語の残りの文字は1回だけミスに数えます。選んだモードはブラウザーごとに保存され、練習の途中では切り替えられません。この練習の記録は `mode: "recall"` を持ち、ベストと順位では通常の記録と分けて比べます（ベスト記録ページは「通常／思い出す」で切り替え、`?mode=recall`）。ダッシュボードは通常の記録だけを使います。

- 本番: https://typle.sparklingstadt.com （v2.33.0 から。`https://typle-r-six.vercel.app` のページはここへ移ります）
- リポジトリ: https://github.com/Sparklingstadt/typle-r （公開）

本番は GitHub と ID・パスワードのログイン、Neon DB、ローカル/LANは開発用アカウントとDocker DBを使用します。開発ログインは本番では無効です。

## 文書

| 文書 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | バージョンごとの変更（v2.1.3 まで。以降は [GitHub Releases](https://github.com/Sparklingstadt/typle-r/releases)） |
| [docs/features.md](docs/features.md) | 画面ごとの機能の仕様（ログインなしでの利用・表示言語・入力・ダッシュボード・単語リスト・CSV・端末・ベスト記録など） |
| [docs/word-list-sources.md](docs/word-list-sources.md) | 公式の単語リスト（国名・コマンド・構文）の出典と検証 |
| [docs/release-workflow.md](docs/release-workflow.md) | PR から本番公開までの手順 |
| [docs/snapshots.md](docs/snapshots.md) | スナップショットテスト（スクリーンショット・ARIA）が落ちたときの見分け方と、期待値の更新・画面の足し方 |
| [docs/aws/](docs/aws/README.md) | AWS の練習環境をコンソールで作って消す手順書（AWS への移行と CLF-C02 の学習のため） |
| [docs/aws/production.md](docs/aws/production.md) | 本番を `infra/`（AWS CDK）で作る手順（切り替えの前まで） |
| [api-docs/](api-docs/src/README.md) | アプリの API の仕様（VuePress。`cd api-docs && npm ci && npm run docs:dev`） |
| [docs/save-metrics.md](docs/save-metrics.md) | 保存の時間と大きさの計測（`TYPLE_MEASURE_SAVES=1`） |
| [docs/backend-compare.md](docs/backend-compare.md) | Next.js・Go・Kotlin・Rails のバックエンドの速度比較（`TYPLE_BACKEND_COMPARE=1` のプレビューだけ。Rails は [rails/README.md](rails/README.md)） |
| [docs/backend-switch.md](docs/backend-switch.md) | workspace と records の API を Go に切り替える（`TYPLE_BACKEND=go`。本番でも使える） |
| [docs/design/](docs/design) | 画面ごとのデザインレビュー |
| [docs/roadmap.md](docs/roadmap.md) | これからの進め方（今・次・その先の順番と理由） |
| [docs/refactoring-roadmap.md](docs/refactoring-roadmap.md) | リファクタリングのロードマップ（負債の棚卸しと直す順番） |

## 関連リポジトリ

| リポジトリ | 内容 |
|---|---|
| typle-r（このリポジトリ） | Web 版と、そのバックエンドの API（どちらも Next.js。API は `src/app/api`・`src/server`） |
| [typle-ipad](https://github.com/Sparklingstadt/typle-ipad) | iPad 版と Mac 版（SwiftUI）。同じコードを1つのプロジェクトでビルドします |
| [typle-macos](https://github.com/Sparklingstadt/typle-macos)（旧 typle-m） | Mac 版。v2.6.11 で typle-ipad にまとめてアーカイブしました |
| [typle-w](https://github.com/Sparklingstadt/typle-w) | Windows 11 版（C#・WinUI 3）。v2.6.9 でアーカイブし、開発を止めました |
| [typle-a](https://github.com/Sparklingstadt/typle-a) | Android タブレット版（Kotlin・Jetpack Compose）。v2.6.9 でアーカイブし、開発を止めました |
| [typle-kotlin-backend](https://github.com/Sparklingstadt/typle-kotlin-backend) | 以前の Go のバックエンドと同じ API の Kotlin（Ktor）版。v2.6.10 でアーカイブし、`TYPLE_BACKEND=kotlin` の切り替えも外しました |

Web 版は `https://typle.sparklingstadt.com` の Next.js の Route Handler（`/api/*`）につながります。iPad・Mac 版は `https://typle-r-six.vercel.app` の `/api/workspace` などを呼びますが、**v2.55.0 からログインできません**（アプリのトークンと `/api/auth/token` をなくしたため。端末内の保存だけで使います。アプリ側の「ログイン」の表示を消すのは typle-ipad の別の作業です）。Vercel のドメインのページは、`vercel.json` で本番のドメインへ移します（`tests/domainRedirect.test.cjs`）。ほかのリポジトリは、このリポジトリのコードやデータの写しや対応する実装を持っています。ここを変えたら、合わせて直してください。

- 公式の単語リスト（`src/lib/packs`）：`commands/` の各 JSON が1リストです。並び順の原本は `commands/manifest.json` です。追加・削除時は JSON と manifest を更新して `npm run packs:generate` を実行すると、Web が読み込む `commands/index.ts` を生成します（v1.5.0 から。v2.46.11 までは Go のバックエンドの埋め込み用コピーも生成していました）。生成し忘れは単体テストで分かります。以前の `commands.json` 形式を使う他アプリには、`commands/manifest.json` の順に各 JSON を配列へまとめて渡してください。
- iPad 版と Mac 版：typle-ipad の `TypleCore/` は `src/lib` の規則の Swift 版で、`catalog.json` は公式の単語リストから作った写しです。公式の単語リストを変えたら、typle-ipad で `node scripts/catalog.cjs ../typle-r` を実行して作り直します。
- ログイン：v2.55.0 でアプリのログイン（`client=…`・トークン）をなくしました。アプリが必要とするなら、Auth.js の上で作り直します。
- アーカイブした typle-macos・typle-w・typle-a・typle-kotlin-backend は、このリポジトリを変えても直しません。

## 開発環境のセットアップ

### Dockerでの仮運用

Node.js 24（`package.json` の `engines` で24系に固定）、npm、Docker Composeを使用します（v2.47.0 から Go は要りません）。

```sh
npm ci
node scripts/setup-local.cjs
docker compose --env-file .env.local up -d --wait
npm run db:migrate
```

`setup-local.cjs` はランダムなDBパスワードとAUTH_SECRETを `.env.local` に生成します。既存ファイルは上書きしません。DBは `127.0.0.1:5433` のみ公開し、名前付きボリューム `typle-r_postgres_data` にデータを保持します。

GitHubの Settings → Developer settings → OAuth Apps でローカル用OAuth Appを作成します。

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Client IDとClient secretを `.env.local` の `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` に設定します。秘密値はコミットしないでください。

```sh
npm run dev
```

`npm run dev` は `next dev`（`127.0.0.1:3000`）を起動します。ページも API（Route Handler）も Next.js が答えます（v2.47.0 から。それまでは Go のバックエンドも一緒に起動していました）。`npm run dev:local`・`npm run dev:lan` も同じです。DB に接続できなくても起動し、その間 `/api/workspace`・`/api/health`（どちらも Next.js）は 503（`databaseUnavailable`）を返しますが、ログインは使えます。GitHub のログインは `AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` が揃っているときだけ使え、揃っていなければ `/api/auth/signin` だけが 503 になります（開発ログインだけで開発できます）。

[ローカルアプリ](http://localhost:3000) を開いてGitHubでログインします。通常の停止は `docker compose --env-file .env.local stop`、再開は `up -d --wait` です。`down -v` は保存データを削除するため使用しないでください。

### 開発用ログインで起動

```sh
npm run dev:local
```

http://localhost:3000/local-login を開き「練習を始める」を押します。このMacのチェックアウトの `.env.local` は設定済みです。新規クローンでは上記のセットアップ後、`.env.local` に `LOCAL_DEVELOPMENT_LOGIN=1` を設定してください。DBは `docker compose --env-file .env.local up -d --wait` で再開できます。

開発ログインは `NODE_ENV=development`、`LOCAL_DEVELOPMENT_LOGIN=1`、`AUTH_URL` がHTTPのloopbackまたは明示指定したLAN内IPv4、`AUTH_SECRET` 設定済みのすべてを満たす場合だけ有効です。専用アカウント `github:0` を使用し、GitHubアカウントとは分離します。本番ビルドでは無効です。GitHub OAuthを使用する場合は `LOCAL_DEVELOPMENT_LOGIN=0` とし、従来どおりOAuthの設定を行ってください。

### LAN内の別端末から利用

`.env.local` の `AUTH_URL` を `http://<このMacのLAN IP>:3000`、`LOCAL_DEVELOPMENT_LAN_HOST` を同じIPに設定し、`npm run dev:lan` で起動します。別端末から同じURLの `/local-login` を開いてください。LAN用の開発ログインは明示指定したプライベートIPv4に限って有効で、本番では無効です。接続できるLAN内の利用者は、同じローカル練習用データを利用できます。DBポートは引き続きloopbackのみで待ち受けます。

`dev:lan` は `.env.local` のLANアドレスと `AUTH_URL` のポートを使用します。IPアドレスが変わった場合はこの2設定を更新してください。

## 検証

Dockerを起動してマイグレーションを実行した状態で。`npm run verify` は、公開の前に通す検査をすべて同じ順に流し、最初の失敗で止まります（E2E と API の文書を省くときは `npm run verify -- --fast`）。1つずつなら:

```sh
npm run typecheck
npm test
npm run lint
npm run build
(cd infra && npm ci && npm run typecheck && npm test && npm run synth)   # AWS の CDK（--fast でも流れる）
npx playwright install chromium
npm run test:e2e
```

API の Route Handler は、DB を使うテスト（`tests/api*.test.cjs` など）が、マイグレーション済みのテスト用DB（`TYPLE_TEST_DATABASE_URL`）で確かめます（`npm run verify` は `db:migrate` の後に実行します）。v2.46.11 まで動いていた Go のバックエンドの答え・Cookie・トークンは `tests/fixtures`（`sessions.json`・`auth-answers.json` など）に記録してあり、TS が同じ答えを返し、Go の発行した Cookie・トークンを読めることを確かめます。

`npm test` は入力判定、記録、移行、形式検証などの単体テストです。速さのため全ファイルを1つのプロセスで動かす（`--test-isolation=none`）ので、`process.env` や `globalThis` を変えるテストは終わりに元へ戻してください。E2Eは既定で6 workersを使い、ファイル内も並列実行します（v2.38.2 から。それまでは手元ではコアの半分でした）。すべてのテストが1つの `next start` を共有するため、workers を増やしても速くなりません。14コアの Mac では、6のとき約56秒、コアの半分の7で約61秒、14で約88秒でした。数は環境変数 `TYPLE_E2E_WORKERS`（`4` や `50%` など）で変えられます。テストごとにランダムなアカウントIDを使用します。Playwright が本番ビルドの `next start`（ポート3101）を起動し、実PostgreSQLとAPIを通して作成・編集・練習・再読み込み・削除、アカウント分離、401/403/409応答を確認します。GitHub にはつながず、`tests/e2e/sessionCookie.ts` がテスト専用の秘密値で署名したログインの Cookie を作ります（`src/server/session.ts` と同じ値になることは `tests/sessionCookie.test.cjs` が確かめます）。GitHub OAuth画面の実ログインは自動テストできないため、公開後に本番で別途確認が必要です。テストユーザーの行だけを終了後に削除します。スナップショットテストの更新手順は [docs/snapshots.md](docs/snapshots.md) にまとめています。`tests/e2e/aria-snapshots.spec.ts` は、ログイン・登録のフォーム、使い方の目次、トップバーと、練習の結果、単語リストの行のメニュー、CSV の読み込みのダイアログ、編集をやめるときの確認のアクセシビリティツリー（役割・名前・並び）を、テストに書いた期待値と比べます（ARIA スナップショット。画像ではないので OS やフォントで変わりません）。ほかの画面（ホーム、記録、設定、編集、思い出して打つ・手書きのモード、パックの編集、ログイン中の表示、共有された結果、パスワード・ID を忘れたときとメールのリンク、公式パック、エラーの表示、英語の表示など）は期待値が長いので、画面ごとのファイル（`tests/e2e/aria-snapshots.spec.ts-snapshots/*.aria.yml`）に分けています。公式パックの一覧・関心・トップページ・ライセンスは、公式パックや依存パッケージが増えると一覧が変わるので、期待値を手で書き、見出し・説明・操作と一覧の1件目の形だけを比べます（ARIA スナップショットは、期待値を含んでいれば一致とみなします）。記録のデータと時計は `tests/e2e/snapshotData.ts` でスクリーンショットと共通にしてあり、日付・時刻・秒数まで実際の値で比べます。画面をわざと変えたときは、テストの中の期待値を `npx playwright test tests/e2e/aria-snapshots.spec.ts --update-snapshots --update-source-method=overwrite` で、ファイルに分けた期待値を `TYPLE_ARIA_WRITE=1 npx playwright test tests/e2e/aria-snapshots.spec.ts` で書き直し、差分を確かめてからコミットします。`tests/e2e/screenshots.spec.ts` は、ログイン（ライト・ダーク・スマートフォンの幅）、登録、使い方の上部、練習中・打ち間違い・練習の結果・練習記録・ベスト記録（それぞれライトとダーク）、ホーム（ライト・ダーク・はじめての人向け・英語）、単語パックの一覧と行のメニュー、単語リストの編集・入力エラー・編集をやめるときの確認、CSV の読み込みのプレビュー、パックの作成と編集、単語一覧、端末、設定の一般と入力、トップページ、Typleについて、スマートフォンのメニュー・練習・結果、思い出して打つ（ライト・ダーク）・手書きのモード、ログイン中のメニューと設定、共有された結果、終了した共有のリンク、パスワード・ID を忘れたとき、パスワードの再設定、使えないメールのリンク、公式パック1つのページ、読めない保存データ、保存できなかったとき、英語のログインを、前に撮った画像（`tests/e2e/screenshots.spec.ts-snapshots/`）と比べます。フォントの描画が OS で違うため、画像は macOS で撮っていて（名前が `-darwin` で終わります）、macOS でしか一致しません。サイドバーのバージョンは PR のたびに変わるので、塗りつぶして比べます。ログイン中の画面は、ほかの E2E と同じく `tests/e2e/account.ts` のテスト用のログイン（名前は E2E User、ID はテストごとにランダム）を使い、終わったら DB の行を消します。公式パックの数はパックを足すたびに変わるので、トップページの件数は塗りつぶし、公式パックの一覧と関心の画面は撮りません。練習の画面は、Playwright の時計（`page.clock`）を止めて決まった秒数だけ進めながら打つので、経過・速度・所要時間・記録の日付も毎回同じになります。記録の画面も時計を 2026年11月1日（日）の正午（日本時間）に固定し、その日から数えた記録を入れておくので、「今日」「昨日」の見出しまで毎回同じです。画面の見た目をわざと変えたときは `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots` で撮り直し、変わった画像を1枚ずつ見てからコミットします。

GitHub Actions の CI は v2.38.1 でやめ、公開の前の検査は手元の `npm run verify` で行います（[リリース運用](docs/release-workflow.md)）。開発ビルド `.next` と本番ビルド `.next-production` は分離しています。

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
| `src/server` | Next.js の Route Handler（`src/app/api/**/route.ts`）と、それが使う JSON の応答（`response.ts`）・DB の接続（`database.ts`、`pg`）・失敗の報告（`report.ts`。Vercel の関数のログに出す）・ログインの設定（`settings.ts`）・書き込みの要求の確認（`request.ts`）・ログインの Cookie を封じて開く処理（`session.ts`。鍵と形式は v2.46.11 までの Go と同じ）と、それを Auth.js の JWT にする `authJwt.ts`・Auth.js のコールバック（`authOptions.ts`）・ログインの確認とすべての端末からのログアウトの失効（`account.ts`）・ID とパスワードのアカウント（`users.ts`・`password.ts`・`passwordLogin.ts`・`emailTokens.ts`・`mail.ts`・`limits.ts`、API は `accountApi.ts`・`accountRecovery.ts`）・ワークスペースの読み込みと `revision` による保存と練習の記録の追加・削除（`workspace.ts`。記録は表 `typle_records` に分けて持つ（`records.ts`）。`TYPLE_MEASURE_SAVES=1` なら保存を計測する（`metrics.ts`））。`/api` のすべてのパスです（v2.46.10 から。それまでは一部が Go のバックエンドでした）。`src/lib` を使えますが、画面（`src/app`・`src/components`）からは import しません |

v2.43.2 まであったプラグインの層（`src/plugins`）と、ファイル形式を差し替えるための拡張口（`WordFormat` と形式の一覧）は v2.43.3 でやめました。読み書きする単語ファイルは CSV だけで、保存先は guest と cloud の2つです。

v2.46.11 まではバックエンドの一部が Go（`server/`、Vercel の Go の関数 `api/index.go`）でした。v2.46.10 で `/api` のすべてのパスを Next.js の Route Handler に移し、v2.47.0 で Go のコードを消しました（設計は `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`。Go と違うところもそこにあります）。

ログインの Cookie は `HttpOnly`・`SameSite=Lax` で、ログインから30日で切れます（延長しません）。名前は `AUTH_URL` が HTTPS なら `__Host-typle-session`、HTTP なら `typle-session` です。中身は `{sub,name,image,iat,exp}` を、`AUTH_SECRET` から HKDF（info `typle session v1`）で導いた鍵で HMAC-SHA256 署名したもので、v2.46.11 までの Go と同じ形です（`src/server/session.ts`・`settings.ts`）。v2.55.0 から Auth.js（next-auth v5）がこの Cookie を作ります（`src/auth.ts`、`jwt.encode`・`jwt.decode` を差し替えて同じ形にしています）。

### ログインのしくみ（Auth.js）

ログインは Auth.js（next-auth v5）で、`/api/auth/*` は `src/app/api/auth/[...nextauth]/route.ts` が答えます（知らないパスは 404。`authPathKnown`）。プロバイダーは次の3つです。

- **GitHub**（`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET` が揃っているとき）：アカウントは `github:<GitHub のユーザー番号>`。
- **ID とパスワード**（Credentials、id `password`）：アカウントは `password:<小文字の UUID>`（`typle_users.id`）、名前は ID。登録・メールの確認・再設定・ID の通知は `/api/account/*`（`src/server/accountApi.ts`・`accountRecovery.ts`。仕様は [api-docs](api-docs/src/app/auth.md)）と、画面 `/signin`・`/signup`・`/verify-email`・`/forgot-password`・`/reset-password`・`/forgot-id`、設定の「アカウント」です。
- **開発用**（Credentials、id `local`）：`github:0`。「開発用ログインで起動」の条件を満たすときだけ有効です。

セッションは JWT で、DB のセッションも adapter も使いません。API（workspace など）は Cookie を `signedIn`（`src/server/account.ts`）で読み、「すべての端末からログアウト」の表（`typle_session_revocations`）を確かめます。この操作は `POST /api/account/signout-everywhere` です（v2.54.0 までの `POST /api/auth/signout?everywhere=1` と、`Authorization: Bearer` のアプリのトークンは使えません。`Authorization` ヘッダーは読みません）。

- ID は `^[a-z0-9_-]{3,32}$`（大文字小文字は区別しない）、パスワードは10〜128文字で、ハッシュは `crypto.scrypt` です。
- 回数の制限は表 `typle_auth_limits` に持ちます（ログインの失敗は同じ ID で15分に5回・同じ IP で30回、登録は IP ごとに1時間に5件、メールは ID かアドレスごとに1時間に3通・IP ごとに10回、すべてのメールを合わせて UTC の1日に80通）。登録とメールは、仕事の前に1回分を数えてから進めます。IP は `x-forwarded-for` の最初の値で、IPv6 は /64 ごとに数えます。1日より前に終わった制限と使えなくなったリンクの行は、登録のときに消します。
- 登録の確認のメールは24時間、再設定は30分で切れ、どちらも1回だけ使えます。トークンは32バイトの乱数で、DB には SHA-256 だけを持ちます。再設定とパスワードの変更では、ほかの端末のログインを無効にします。
- 注意：ブラウザーの Cookie の `Expires` は、Auth.js がセッションを読むたびに「今から30日」に書き直されます。切れるかどうかは Cookie の中身の `exp`（ログインから30日で固定）で決まるので、延長にはなりません。
- 注意：**本番では `AUTH_REDIRECT_PROXY_URL` を設定しないでください。** Auth.js はこの値があると、GitHub のログインの callback をそのアドレスのプロキシへ向けます（`redirectProxyUrl` は手元の開発のときだけ値を決めますが、環境変数が残っていれば Auth.js が読みます）。

#### メール（Resend）

確認・再設定・ID の通知のメールは Resend（`https://api.resend.com/emails`）へ fetch で送ります（SDK は使いません）。用意するもの：

1. Resend で送信元のドメインを登録し、DNS のレコードを足して確認します。
2. API キーを作ります。
3. `RESEND_API_KEY` と `TYPLE_MAIL_FROM`（例 `Typle <no-reply@sparklingstadt.com>`）を Vercel の環境変数（Production と Preview）に足します。

どちらかがなければメールは送れず、登録は成功したまま「送れなかった」と出ます（失敗はログに残ります）。`TYPLE_RESEND_URL` はテストのための送り先の差し替えで、本番では設定しません。Resend の無料枠は1日100通なので、上の制限でメールの送信を抑えています。

#### iPad・Mac のアプリ

v2.55.0 から、iPad・Mac のアプリは Typle にログインできません。`/api/auth/token`・`/api/auth/signin?client=…&code_challenge=…`・アプリのトークンをなくしたためです。v2.54.0 までに発行したトークンは、`/api/workspace` などでもう通りません（`TYPLE_BACKEND=go` のときだけ Go が受け付けます。[docs/backend-switch.md](docs/backend-switch.md)）。

画面は `src/lib/session.tsx` の `useSession`・`signIn`・`signOut` で Auth.js の `/api/auth/*` を呼びます。ログイン状態は `/api/auth/session` の 200 の答えだけで決め、確認が失敗したとき（通信の失敗、200 以外の答え、読めない本文）は前の状態のままにします。最初の確認だけは 1・2・4 秒後にやり直し、すべて失敗したら未ログインとして扱います。`/api/*` はどれも Next.js の Route Handler が答えます。サーバーの失敗は Vercel の関数のログに出します（Auth.js が出す `CredentialsSignin`、つまりパスワードの間違いは、毎回ログに出ないよう `src/auth.ts` の `logger` で外しています）。エラーを外のサービスに送ることはしません（Sentry は v2.53.0 でやめました）。

## 保存とアクセス制御

`typle_workspaces` テーブルにユーザーごとのJSONBスナップショットとrevisionを保持します。APIとログインは Next.js の Route Handler（`src/app/api`・`src/server`）が提供し、所有者はサーバーがログインセッションのアカウントID（`github:…`・`password:…`）から決定します。APIは未認証アクセスを拒否し、書き込みでOrigin、アカウント一致、形式、最大1MiBのサイズを検証します。共有ランキングはありません。

次の段落は v2.0.0 より前の記録です（v2.0.0 でホームの「以前のデータを移行」をなくしました）。

旧形式のキーは `typle-r:word-lists:v1`、値は `{ version: 1, lists: [...] }` です。ホームの移行ボタンは現在のアカウントに追加し、同じ内容の再移行を重複させません。同名のリストは名前に移行番号を付けます。壊れた元データは変更しません。リスト削除はその記録も削除します。

## 本番の構成

### Neon / Vercelの構成

Vercel MarketplaceでNeonを接続し、サーバー用の環境変数を設定します。

- `DATABASE_URL`: NeonのPostgreSQL接続URL（pooled接続可、`POSTGRES_URL`も代替として利用可能）
- `DIRECT_URL`: マイグレーション用の直接接続URL（任意、未指定時はDATABASE_URL）。DATABASE_DRIVERは不要です。
- `AUTH_SECRET`: 暗号学的にランダムな秘密値
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`: 本番用OAuth Appの認証情報
- `AUTH_URL`: 本番URL。本番OAuth callbackは `<本番URL>/api/auth/callback/github`（v0.55.0 でも変わりません）。この値のオリジンだけを使います
- `RESEND_API_KEY`, `TYPLE_MAIL_FROM`: ID・パスワードのアカウントのメール（確認・再設定・ID の通知）を送る Resend の API キーと送信元（上の「メール（Resend」）
- `AUTH_REDIRECT_PROXY_URL`: **設定しません**（Auth.js が読んで GitHub の callback の向きを変えてしまうため）

関数は Vercel のシンガポール（`sin1`）で動かします（`vercel.json` の `regions`。v2.55.1 から。それまでは既定の米国東部 `iad1`）。Neon の DB も同じシンガポール（Vercel Marketplace のリージョン `sin1`）に置きます。DB を別のリージョンに移すときは、`regions` も DB に一番近いところに合わせます。

対象DBの環境変数を使って `npm run db:migrate` を実行してからデプロイします。マイグレーションは `db/migrations` の SQL で、`scripts/migrate.cjs` が `pg` で適用します（v2.36.19 から Prisma は使いません。アプリの DB の読み書きは Route Handler の `pg`）。DockerのDBからNeonへのデータコピーは自動ではありません。必要な場合はバックアップと復元を別途行います。本番への反映は、マージ後の main で `npm run verify` を通してから、手元の Vercel CLI（`vercel deploy --prod`）で行います（v2.38.1 から。[リリース運用](docs/release-workflow.md)）。

公式資料: [GitHub OAuth App](https://docs.github.com/ja/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[PostgreSQL Docker image](https://hub.docker.com/_/postgres)。

### コンテナのイメージ

AWS への移行（[設計](docs/superpowers/specs/2026-11-20-aws-migration-design.md)）のため、本番のイメージをリポジトリのルートの `Dockerfile` で作れます（v2.55.2 から）。AWS での動かし方は、後の手順書に書きます。

```bash
docker build --build-arg SITE_URL=https://typle.sparklingstadt.com -t typle-r .
```

- `SITE_URL` は必須です。`sitemap.xml`・`robots.txt`・ページのメタデータはビルドの時点で URL を埋め込むため、ないとビルドが止まります。
- イメージの中では `TYPLE_STANDALONE=1` で standalone のビルドをし、`node server.js` が `:3000` で受けます。Vercel と `next start`（verify・E2E）のビルドは今までどおりです。
- `.env*` と `*.pem` は `.dockerignore` でイメージに入りません。設定は実行のときに環境変数で渡します。
- マイグレーションは同じイメージで `node scripts/migrate.cjs` を実行します。
- Amazon RDS につなぐときは、`DATABASE_URL` の末尾に `?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` を付けます（RDS の CA バンドルはイメージに入っています）。
- 接続元の IP（回数制限）は `x-forwarded-for` の最後の値です。Vercel も AWS のロードバランサーも、最後に自分が見た接続元を置くためです。

### FFPF ID でのログイン（廃止）

FFPF ID（ffpf-portal）でのログインは v2.54.0 でなくしました。ログインは GitHub と ID・パスワードです（v2.55.0 から）。

- `/api/auth/signin/ffpf`・`/api/auth/callback/ffpf` は Auth.js のプロバイダーがないので 404 です。
- 環境変数 `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` は読みません。ログアウトで Cookie `typle-ffpf-relogin` も置きません。
- v2.53.1 までに FFPF ID でログインしたセッション（アカウント ID が `ffpf:` で始まる）は、ログインから30日で切れるまで使えます。そのあとは、そのアカウントのデータ（DB の行はそのまま残ります）を開く方法はありません。

### パックの共有とギャラリー

パックの共有（`/api/shares`・`/api/shared`）、ギャラリー（`/gallery`・`/api/gallery` と通報・追加数・IP ごとの回数制限）、
表 `typle_gallery_reports`・`typle_gallery_hits` は v2.49.0 でなくしました（管理者ダッシュボードは v2.48.0）。表
`typle_shared_packs` は、v2.48.0 までのアプリが保存のたびに行を消すため v2.49.0 では空にして残し、v2.49.1 で消しました。
v2.49.1 からの DB では v2.48.0 までのアプリは保存できないので、Instant Rollback で戻すのは v2.49.0 までにします。パックを人に渡すときは、パックのファイル（`.typle-pack.json`）か CSV を書き出して送り、相手が取り込みます。
配られた共有リンク `/shared/<id>` は「この共有は終了しました。」とだけ表示し、`/gallery` は公式パックのカタログへ転送します。

## リリース

必須の順序は **PR作成 → マージ（squash merge か普通のマージ） → マージ後のverify（手元の `npm run verify`） → GitHub Release作成 → Vercel本番デプロイ** です。`package.json` と `package-lock.json` のバージョンをPR内で更新します。mainへの直接pushは行いません。v2.38.1 から GitHub Actions は検査・Release・デプロイのどれも行わず、マージした人が手元でこの順に行います。`vercel.json` の `git.deploymentEnabled=false` は維持します。初回設定・手順・復旧手順は [リリース運用](docs/release-workflow.md) を参照してください。

## UIコンポーネント

UIはshadcn/ui（Radix / Nova）とTailwind CSS 4で構成しています。設定は `components.json`、テーマは `src/app/globals.css`、コンポーネントのソースは `src/components/ui` にあります。追加は `npx shadcn@latest add <component>` で行えます。ボタンの既定typeはフォームの誤送信を避けるため `button`、標準の高さは44pxに調整しています。

削除確認はAlertDialogを使い、失敗時はダイアログ内で再試行できます。入力欄のラベル・必須属性、IME入力、認証とDB保存は維持しています。

Tailwind 4の対象ブラウザーはSafari 16.4以上、Chrome 111以上、Firefox 128以上です（v0.5.0 から）。

## 依存関係の監査

2026-11-06 の `npm audit` の指摘は13件（low 2・moderate 11）で、どれも開発用の ESLint と shadcn の依存（`minimatch`・`deepmerge`）です。本番の依存には入っていません。v2.36.19 で Prisma をなくし、そのための override もなくなりました。

## リポジトリの経緯

`liyur-qie/typle-r` の履歴を保持した独立したコピーです。2026年11月から公開しています。
