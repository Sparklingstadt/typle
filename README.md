# Typle

自分の単語リストで練習できるタイピングアプリです。

練習画面（`/play`）の「思い出して打つ」を入れると、答えを隠して練習します。補足は答えを伏せて表示し（「apple / りんご」なら「りんご」だけ、区切りのない補足では答えを「＿＿」にします）、表示する単語が入力する文字と違うときはそれも出します（どちらもないときは「ヒントがありません」）。答えは未入力の文字数だけ「＿」で示します。次の単語・すべての単語・入力する文字の案内・簡易入力の対応は表示しません。「答えを見る」で答えを表示でき、その単語の残りの文字は1回だけミスに数えます。選んだモードはブラウザーごとに保存され、練習の途中では切り替えられません。この練習の記録は `mode: "recall"` を持ち、ベストと順位では通常の記録と分けて比べます（ベスト記録ページは「通常／思い出す」で切り替え、`?mode=recall`）。ダッシュボードは通常の記録だけを使います。

- 本番: https://typle.sparklingstadt.com （v2.33.0 から。`https://typle-r-six.vercel.app` のページはここへ移ります）
- リポジトリ: https://github.com/Sparklingstadt/typle-r （公開）

本番はGitHub認証とNeon DB、ローカル/LANは開発用アカウントとDocker DBを使用します。開発ログインは本番では無効です。

## 文書

| 文書 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | バージョンごとの変更（v2.1.3 まで。以降は [GitHub Releases](https://github.com/Sparklingstadt/typle-r/releases)） |
| [docs/features.md](docs/features.md) | 画面ごとの機能の仕様（ログインなしでの利用・表示言語・入力・ダッシュボード・単語リスト・CSV・端末・ベスト記録など） |
| [docs/word-list-sources.md](docs/word-list-sources.md) | 公式の単語リスト（国名・コマンド・構文）の出典と検証 |
| [docs/release-workflow.md](docs/release-workflow.md) | PR から本番公開までの手順 |
| [api-docs/](api-docs/src/README.md) | アプリの API の仕様（VuePress。`cd api-docs && npm ci && npm run docs:dev`） |
| [docs/save-metrics.md](docs/save-metrics.md) | 保存の時間と大きさの計測（`TYPLE_MEASURE_SAVES=1`） |
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

どのアプリも、このリポジトリのバックエンド（Next.js の Route Handler）に同じ GitHub ログインでつなぎます。Web は `https://typle.sparklingstadt.com`、iPad・Mac 版は `https://typle-r-six.vercel.app` の `/api/*` を呼びます。Vercel のドメインで始めたログイン（`/api/auth/signin`）は、OAuth の cookie とコールバックを同じホストにするため、`vercel.json` で本番のドメインへ移します（`tests/domainRedirect.test.cjs`）。ほかのリポジトリは、このリポジトリのコードやデータの写しや対応する実装を持っています。ここを変えたら、合わせて直してください。

- 公式の単語リスト（`src/lib/packs`）：`commands/` の各 JSON が1リストです。並び順の原本は `commands/manifest.json` です。追加・削除時は JSON と manifest を更新して `npm run packs:generate` を実行すると、Web が読み込む `commands/index.ts` を生成します（v1.5.0 から。v2.46.11 までは Go のバックエンドの埋め込み用コピーも生成していました）。生成し忘れは単体テストで分かります。以前の `commands.json` 形式を使う他アプリには、`commands/manifest.json` の順に各 JSON を配列へまとめて渡してください。
- iPad 版と Mac 版：typle-ipad の `TypleCore/` は `src/lib` の規則の Swift 版で、`catalog.json` は公式の単語リストから作った写しです。公式の単語リストを変えたら、typle-ipad で `node scripts/catalog.cjs ../typle-r` を実行して作り直します。
- ログイン（`client=ipad|macos|android|windows`）とトークンの形：各アプリが使うので、互換を保ちます。アーカイブした Android 版・Windows 版も、入っているアプリがそのままログインできるよう `android`・`windows` を受け付け続けます。
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
npx playwright install chromium
npm run test:e2e
```

API の Route Handler は、DB を使うテスト（`tests/api*.test.cjs` など）が、マイグレーション済みのテスト用DB（`TYPLE_TEST_DATABASE_URL`）で確かめます（`npm run verify` は `db:migrate` の後に実行します）。v2.46.11 まで動いていた Go のバックエンドの答え・Cookie・トークンは `tests/fixtures`（`sessions.json`・`auth-answers.json`・`signin-answers.json` など）に記録してあり、TS が同じ答えを返し、Go の発行した Cookie・トークンを読めることを確かめます。

`npm test` は入力判定、記録、移行、形式検証などの単体テストです。速さのため全ファイルを1つのプロセスで動かす（`--test-isolation=none`）ので、`process.env` や `globalThis` を変えるテストは終わりに元へ戻してください。E2Eは既定で6 workersを使い、ファイル内も並列実行します（v2.38.2 から。それまでは手元ではコアの半分でした）。すべてのテストが1つの `next start` を共有するため、workers を増やしても速くなりません。14コアの Mac では、6のとき約56秒、コアの半分の7で約61秒、14で約88秒でした。数は環境変数 `TYPLE_E2E_WORKERS`（`4` や `50%` など）で変えられます。テストごとにランダムなアカウントIDを使用します。Playwright が本番ビルドの `next start`（ポート3101）を起動し、実PostgreSQLとAPIを通して作成・編集・練習・再読み込み・削除、アカウント分離、401/403/409応答を確認します。GitHub にはつながず、`tests/e2e/sessionCookie.ts` がテスト専用の秘密値で署名したログインの Cookie を作ります（`src/server/session.ts` と同じ値になることは `tests/sessionCookie.test.cjs` が確かめます）。GitHub OAuth画面の実ログインは自動テストできないため、公開後に本番で別途確認が必要です。テストユーザーの行だけを終了後に削除します。

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
| `src/server` | Next.js の Route Handler（`src/app/api/**/route.ts`）と、それが使う JSON の応答（`response.ts`）・DB の接続（`database.ts`、`pg`）・失敗の報告（`report.ts`。Vercel の関数のログに出す）・ログインの設定（`settings.ts`）・書き込みの要求の確認（`request.ts`）・ログインの Cookie・アプリのトークン・アプリのコード・ログイン途中の状態を封じて開く処理（`session.ts`。鍵と形式は v2.46.11 までの Go と同じ）・ログインとすべての端末からのログアウトの確認（`account.ts`）・ログインのセッション・アプリのトークン・ログアウト（すべての端末からも）・ローカル開発のログイン（`auth.ts`）・ログインの始まりと戻り（`signin.ts`。GitHub は `github.ts`、FFPF ID は `ffpf.ts`）・ワークスペースの読み込みと `revision` による保存と練習の記録の追加・削除（`workspace.ts`。記録は表 `typle_records` に分けて持つ（`records.ts`）。`TYPLE_MEASURE_SAVES=1` なら保存を計測する（`metrics.ts`））。`/api` のすべてのパスです（v2.46.10 から。それまでは一部が Go のバックエンドでした）。`src/lib` を使えますが、画面（`src/app`・`src/components`）からは import しません |

v2.43.2 まであったプラグインの層（`src/plugins`）と、ファイル形式を差し替えるための拡張口（`WordFormat` と形式の一覧）は v2.43.3 でやめました。読み書きする単語ファイルは CSV だけで、保存先は guest と cloud の2つです。

v2.46.11 まではバックエンドの一部が Go（`server/`、Vercel の Go の関数 `api/index.go`）でした。v2.46.10 で `/api` のすべてのパスを Next.js の Route Handler に移し、v2.47.0 で Go のコードを消しました（設計は `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`。Go と違うところもそこにあります）。

ログインの Cookie は `HttpOnly`・`SameSite=Lax` で、ログインから30日で切れます（延長しません）。名前は `AUTH_URL` が HTTPS なら `__Host-typle-session`、HTTP なら `typle-session` です。Cookie・アプリのトークン・アプリのログインのコード・ログイン途中の状態（`typle-oauth`）は、`AUTH_SECRET` から HKDF で導いた種類ごとの鍵で HMAC-SHA256 署名します（`src/server/session.ts`・`settings.ts`。形式と鍵は Go のときと同じです）。ログインの始まりと戻りは `src/server/signin.ts`、GitHub と FFPF ID とのやりとりは `github.ts`・`ffpf.ts` です。

### iPad と Mac と Android と Windows のログイン

Android 版（typle-a）と Windows 版（typle-w）は v2.6.9 でアーカイブしました。サーバーは今も `client=android`・`windows` を受け付けます。この節の Android・Windows の動作は、アーカイブした時点のものです。

iPad アプリと Mac アプリ（どちらも [typle-ipad](https://github.com/Sparklingstadt/typle-ipad) リポジトリ）・Android アプリ（[typle-a](https://github.com/Sparklingstadt/typle-a) リポジトリ）・Windows アプリ（[typle-w](https://github.com/Sparklingstadt/typle-w) リポジトリ）は、Web版と同じ GitHub OAuth App でログインし、Cookie の代わりにトークンを使います（RFC 8252 のネイティブアプリの形）。サーバーの側は `client` が `ipad`・`macos`・`android`・`windows` のどれかだけが違い、流れは同じです。

1. アプリが32バイトの乱数から検証値（verifier）を作り、システムのログイン画面（iPad と Mac は `ASWebAuthenticationSession`、Android は Custom Tabs、Windows は既定のブラウザー）で `/api/auth/signin?client=<ipad|macos|android|windows>&code_challenge=<S256>` を開きます。チャレンジは OAuth の Cookie に入り、GitHub にはサーバー自身の PKCE を使います。
2. `callback/github` は Cookie を発行せず、`typle-r://login?code=<コード>` へリダイレクトします。コードはユーザーとチャレンジに署名したもので、2分で切れます。失敗・キャンセルは `typle-r://login?error=loginFailed` です。Android は `MainActivity` の intent-filter（scheme `typle-r`・host `login`）で、Windows は起動のたびに登録するプロトコル（`typle-r`、この Windows ユーザーの `HKEY_CURRENT_USER`）でこの URL を受け取ります。Windows では、ブラウザーが開いた2つ目の Typle が、動いている Typle にこの URL を渡して終わります。アプリを離れてコールバックが来なかったときは、何も起きなかったものとして戻ります（Windows は「ログインをやめる」で待つのをやめます）。
3. アプリが `POST /api/auth/token`（`{"code","verifier"}`）を呼び、検証値の SHA-256 がチャレンジと一致すれば `{"token","user"}` を返します。コードを横取りしても、検証値がなければトークンにできません。間違いはすべて `400 loginFailed` です。Android と Windows は、ログインを始めてから10分たったログイン途中の状態は無効とし、ログインに失敗したものとして扱います。
4. アプリは `Authorization: Bearer <トークン>` で `/api/auth/session` と `/api/workspace` を呼びます。トークンは Cookie と別の鍵で署名した、ログインから30日で切れる（延長しない）値で、Cookie の値をトークンとして、トークンを Cookie として使うことはできません。`Authorization` ヘッダーがある要求はトークンだけで判断し（Cookie は見ません）、ブラウザーが自動では付けないため、`PUT /api/workspace` の Origin の確認は要りません（`Content-Type` の確認は残ります）。
5. トークンは更新されません（v0.107.0 から。それまでは発行から24時間で `/api/auth/session` の応答の `token` で新しくなっていました）。切れたら `401` になるので、もう一度ログインします。ログアウトはアプリがトークンを消すだけですが、`POST /api/auth/signout?everywhere=1` を `Authorization: Bearer <トークン>` で呼ぶと、そのアカウントのすべての端末のログインを無効にできます（`typle_session_revocations`）。トークンは iPad と Mac では Keychain に、Android では Android Keystore の鍵で暗号化して、Windows では Windows のデータ保護（DPAPI）で暗号化して保存します。

Android のエミュレーターから手元の `npm run dev` で試すときは、サーバー URL に `http://10.0.2.2:<ポート>`（エミュレーターから見たホストの `localhost`）を入れます。ただし GitHub の OAuth App の callback URL は `AUTH_URL` に合わせたもの（`<AUTH_URL>/api/auth/callback/github`）でなければならず、開発用ログイン（`POST /api/auth/local`）はアプリでは使えません。

画面は `src/lib/session.tsx` の `useSession`・`signIn`・`signOut` で `/api/auth/*` を呼びます。ログイン状態は `/api/auth/session` の 200 の答えだけで決め、確認が失敗したとき（通信の失敗、200 以外の答え、読めない本文）は前の状態のままにします。最初の確認だけは 1・2・4 秒後にやり直し、すべて失敗したら未ログインとして扱います。`/api/*` はどれも Next.js の Route Handler が答えます。サーバーの失敗は Vercel の関数のログに出します。エラーを外のサービスに送ることはしません（Sentry は v2.53.0 でやめました）。

## 保存とアクセス制御

`typle_workspaces` テーブルにユーザーごとのJSONBスナップショットとrevisionを保持します。APIとログインは Next.js の Route Handler（`src/app/api`・`src/server`）が提供し、所有者はサーバーがログインセッション（iPad はトークン）のGitHubユーザーIDから決定します。APIは未認証アクセスを拒否し、書き込みでOrigin（Cookie のとき）、アカウント一致、形式、最大1MiBのサイズを検証します。共有ランキングはありません。

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
- `FFPF_ID_ISSUER`, `FFPF_ID_CLIENT_ID`, `FFPF_ID_CLIENT_SECRET`: FFPF ID（ffpf-portal）の issuer とクライアントの認証情報（任意。3つ揃えたときだけ FFPF ID のログインを使えます）。portal に登録する redirect URI は `<本番URL>/api/auth/callback/ffpf` です

対象DBの環境変数を使って `npm run db:migrate` を実行してからデプロイします。マイグレーションは `db/migrations` の SQL で、`scripts/migrate.cjs` が `pg` で適用します（v2.36.19 から Prisma は使いません。アプリの DB の読み書きは Route Handler の `pg`）。DockerのDBからNeonへのデータコピーは自動ではありません。必要な場合はバックアップと復元を別途行います。本番への反映は、マージ後の main で `npm run verify` を通してから、手元の Vercel CLI（`vercel deploy --prod`）で行います（v2.38.1 から。[リリース運用](docs/release-workflow.md)）。

公式資料: [GitHub OAuth App](https://docs.github.com/ja/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[PostgreSQL Docker image](https://hub.docker.com/_/postgres)。

### FFPF ID でのログインの設定

FFPF ID（ffpf-portal）は、GitHub と並ぶもう1つのログイン方法です。次の3つの環境変数がすべて設定されているときだけ有効になります（1〜2個だけだと警告を1回ログに書いて無効のままです）。

| 環境変数 | 内容 |
|---|---|
| `FFPF_ID_ISSUER` | ffpf-portal の issuer（`https://…`。末尾の `/` は付けても外されます） |
| `FFPF_ID_CLIENT_ID` | portal に登録したクライアントの ID |
| `FFPF_ID_CLIENT_SECRET` | そのクライアントのシークレット |

- portal に登録する redirect URI は `<AUTH_URL のオリジン>/api/auth/callback/ffpf` です（本番は `https://typle.sparklingstadt.com/api/auth/callback/ffpf`）。portal は redirect URI が登録と完全に一致しないと拒否します。
- クライアントの登録（client_id・シークレットの作成と redirect URI の登録）は ffpf-portal 側の作業です。手順は ffpf-portal の README と、`docs/superpowers/specs/2026-10-27-ffpf-id-design.md` の「クライアント」を見てください。
- `.env.example` に3つの変数を載せています。ローカルで試すときは `.env.local` に書きます。Vercel では「Neon / Vercelの構成」の環境変数に足します。
- ログインした利用者は GitHub のアカウントとは別のアカウントです（アカウント ID は `ffpf:` で始まります）。
- portal にログインしたままのブラウザでは、FFPF ID のログインはパスワードを聞かずに通ります（SSO）。ただし typle-r でログアウト（`/api/auth/signout`）したブラウザには Cookie `typle-ffpf-relogin`（`/api/auth`、30日）を置き、次の FFPF ID のログインに `prompt=login` を付けて portal のログイン画面を出させます。FFPF ID でログインし終えると消します。アプリ（iPad など）のログアウトでは置きません。

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
