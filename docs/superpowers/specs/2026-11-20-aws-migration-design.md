# Vercel・Neon から AWS への移行（設計）

日付: 2026-11-20 ／ 対象: typle-r（main は v2.55.1）
改訂: 2026-11-28 ／ main は v2.68.1

## 2026-11-28 の改訂

v2.55.2（#366）でこの設計を書いてから、アプリと公開のしかたが大きく変わったので、今の main に合わせて書き直した。
決めたことの骨組み（ECS Fargate + ALB + RDS、練習環境のあとに CDK、サブドメインの委任、Vercel・Neon を予備に残す）は変えていない。

| 変わったこと | 版 | この設計への影響 |
|---|---|---|
| ログインを Sparklingstadt ID と GitHub だけにした。ID とパスワード、登録・確認・再設定のメール、IP ごとの回数制限（`src/server/limits.ts` の `clientIp`）をなくした | v2.59.0 | メール（Resend）は送らなくなった。`RESEND_API_KEY`・`TYPLE_MAIL_FROM` は要らない。Sparklingstadt ID の設定（`AUTH_SID_*`）が要る。「アプリの変更」の 2 は役目を終えた |
| Go・Kotlin・Rails の比較用の実装を typle-backends に分けた | v2.60.5 | `api/go.go`・`server/`・`scripts/bench-backends.cjs` はもうない。「目標にしないこと」と後片付けから外した |
| GitHub Actions（`ci.yml`）が、マージのあと verify・Release・Vercel への本番デプロイ・本番の確認まで行う | v2.60.6 | 「公開は持ち主の Mac から手で」という前提が崩れた。AWS へのデプロイも CI に載せる（持ち主が決めた。「マイグレーションとデプロイ」） |
| DB の読み書きを Prisma Client（`@prisma/adapter-pg` と `pg` のプール）に、マイグレーションを `prisma migrate deploy` に戻した | v2.60.7・v2.60.8 | マイグレーションの単発タスクのコマンドが変わった（反映済み） |
| ログインを Auth.js から Better Auth に移した | v2.62.0・v2.62.1 | 秘密の値が `AUTH_SECRET` から `BETTER_AUTH_SECRET` に変わった。回数制限は Better Auth のもの（下の「接続元の IP と回数制限」） |
| 共有のデモアカウントを足した。毎日 Vercel Cron が `/api/demo/reset` を呼んで中身を戻す | v2.63.0 | AWS に Vercel Cron の代わりが要る。`DEMO_LOGIN`・`CRON_SECRET` が要る |

CDK（`infra/`）と手順書（`docs/aws/`）は、Better Auth への移行（`BETTER_AUTH_SECRET`）までは追いついている。
Sparklingstadt ID・デモアカウント・メールの削除はまだ反映されていない（「作業の順序」の 3a）。

## 目的

typle の本番（`https://typle.sparklingstadt.com`）を、Vercel（アプリ）と Neon（DB）から AWS へ完全に移す。

移す理由は、利用者のためではなく**持ち主が AWS を学ぶため**で、AWS Certified Cloud Practitioner（CLF-C02）の受験に向けて、
試験に出るサービスを本物の本番で触ることにある。そのため、安さや手軽さよりも「主要なサービスを1つずつ理解して使う」ことを重く見る。
ただし本番なので、利用者の使い心地とデータは移行の前後で変えない。

## 目標

- 本番のアプリが AWS の東京リージョン（`ap-northeast-1`）の ECS Fargate で動き、DB は RDS for PostgreSQL になる。
- 同じドメイン `typle.sparklingstadt.com` で、ログイン（Sparklingstadt ID・GitHub・デモアカウント）と保存が今までどおり動き、デモアカウントの中身が毎日戻る。
- Neon の本番データを、欠けなく RDS に移す。
- 持ち主がまず AWS コンソールで手順書どおりに一通り作って理解し（練習環境）、そのあと同じ構成を AWS CDK（TypeScript）で
  コードにして本番を作る。本番の構成はリポジトリのコードで再現できる。
- リリースの手順（PR → CI の verify → マージ → main の CI: policy・verify → GitHub Release → デプロイ → 本番の確認）の形を保ったまま、
  デプロイの段を Vercel から AWS に置き換える。
- 使った AWS のサービスと CLF-C02 の範囲との対応が、手順書から分かる。

## 目標にしないこと

- 高い可用性（マルチ AZ の RDS、複数タスク）。考え方は手順書で説明するが、費用のため本番では使わない。
- CloudFront・WAF・Lambda の導入。試験の範囲だが、この移行では使わない（手順書で触れるだけ）。
- Vercel Web Analytics の代わりのアクセス解析。
- API の文書（`api-docs/`、Cloudflare Pages）を移すこと。今のまま。
- メールを送ること。v2.59.0 でメールを送る機能はなくなった（SES も Resend も使わない）。

（2026-11-20 の版にあった「Go・Kotlin のバックエンドを AWS で動かすこと」と「GitHub Actions による自動デプロイ」は外した。
前者は v2.60.5 でコードがなくなり、後者は v2.60.6 から CI が Vercel へ公開しているため。）

## 失敗とみなすこと（動いても駄目なもの）

- 本番のデータが1行でも失われる、または移行のあいだの書き込みが Neon にだけ残る。
- ログインの回数制限（Better Auth の `rateLimit`）が、`x-forwarded-for` を偽ることですり抜けられる（下の「接続元の IP と回数制限」）。
- 秘密の値（DB のパスワード・`BETTER_AUTH_SECRET`・GitHub と Sparklingstadt ID の secret・`CRON_SECRET`・AWS の鍵）が
  リポジトリ・イメージ・タスク定義の平文に入る。
- 切り替えで全員がログアウトされる（`BETTER_AUTH_SECRET` が Vercel と違う）。ただし、Vercel の値が読めないときは持ち主が受け入れる（`docs/aws/production.md` の 8）。
- デモアカウントの中身が戻らなくなる（Vercel Cron の代わりがない）。
- 思わぬ請求。NAT Gateway のような常時課金の大きいものを知らずに作る、予算の通知がない。
- root ユーザーで日常の作業をする。
- 切り替えで長く止まる（目安 30 分以上）、または切り替えたあとにログインできない。
- 練習環境を消し忘れて、本番と二重に課金され続ける。

## 制約

- Node.js 24（`package.json` の `engines`）、Next.js 16.4.6、Better Auth 1.7、Prisma 7（`@prisma/adapter-pg` と `pg`）。
- `next.config.mjs` は、`VERCEL=1` でも開発サーバーでもないとき、ビルドを `.next-production` に出す。
- `npm run verify` は Docker と Node.js 24 が要る。PR と main では GitHub Actions（Linux）が流し、PR の前には持ち主の Mac でも流す。
  クラウドのセッションは AWS に触れない。練習環境と本番のスタックを作る操作（コンソール・`aws`・`cdk`・`docker push`）は持ち主の Mac で、持ち主が行う。
- main へは直接 push しない。変更は PR で、PR ごとに未使用のバージョンを付ける（`CLAUDE.md`）。マージすると CI が本番へ公開する。
- 文書は日本語。コードのコメントと識別子は英語。
- 持ち主の Mac は Apple Silicon と考え、Fargate は ARM64（Graviton）で動かす（安く、手元でそのままビルドできる）。

## 案（どう作るか）

### 動かす場所

| 案 | 構成 | 月額の目安 | 判断 |
|---|---|---|---|
| **A** | ECS Fargate + ALB + RDS | 約 $60〜70 | **採用**。試験の中心のサービス（VPC・ECS・ELB・RDS・IAM・Route 53・ACM・Secrets Manager・CloudWatch）を本番で使える |
| B | Lightsail のコンテナ + Lightsail の DB | 約 $25 | 安いが、試験の中心のサービスにほとんど触れない |
| C | OpenNext で Lambda + CloudFront + RDS Proxy | 使った分（RDS 込みで約 $30〜） | Next.js 16.4 への対応と DB の接続数に不安。本番が不安定になりやすい |

### だれがどう作るか

| 進め方 | 判断 |
|---|---|
| **① コンソールで作ってから CDK にする** | **採用**（持ち主が選んだ） |
| ② 最初から CDK | 早いが、中身がコードに隠れて学びが薄い |
| ③ コンソールだけ | 再現できない |

①の具体化（持ち主が決めた）: コンソールで作るのは**練習環境**とし、本番は CDK で作る。
コンソールで作った本番を後から CDK に取り込む（`cdk import`）と、取り込めないリソースが出て手間が大きく、
CDK で作り直すと本番の切り替えが2回になる。練習環境なら、作って、壊して、消すことも学びになる。

## 今の作り（調べた結果。2026-11-28、v2.68.1）

- 本番は Vercel（`vercel.json`: リージョン `sin1`、`buildCommand` が `npm run db:migrate && npm run build`、
  `typle-r-six.vercel.app` から本番ドメインへのリダイレクト、Git 連携なし、Cron 1つ）。
  公開は main の CI（`.github/workflows/ci.yml`）の `deploy` ジョブが `vercel deploy --prod --yes` で行い、本番のドメインが新しいデプロイを返すまで待ってから
  `scripts/check-production.cjs` を流す。CI が使えないときだけ、持ち主の Mac から手で公開する（`docs/release-workflow.md`）。
- DB は Neon。`DATABASE_URL` は Neon の pooler、マイグレーションは `DIRECT_URL`（`npm run db:migrate`: `scripts/check-migrations.cjs` のあと `prisma migrate deploy`）。
- `src/server/database.ts` は、Prisma Client を `@prisma/adapter-pg` で `pg` のプール（インスタンスごとに `max: 5`）に載せる。コメントは Vercel と AWS の両方を書いてある。
- ログインは Better Auth（`src/server/betterAuth.ts`）。Sparklingstadt ID（OpenID Connect、`AUTH_SID_ISSUER`・`AUTH_SID_ID`・`AUTH_SID_SECRET`）、
  GitHub（`AUTH_GITHUB_ID`・`AUTH_GITHUB_SECRET`）、共有のデモアカウント（`DEMO_LOGIN=1`）。秘密は `BETTER_AUTH_SECRET`、
  基準の URL は `AUTH_URL`（GitHub と Sparklingstadt ID のコールバックの origin、保存を受け付ける唯一の origin）。
  Sparklingstadt ID の OAuth クライアントは `id.sparklingstadt.com` に `<AUTH_URL>/api/auth/callback/sid` で登録してある。
- 回数制限は Better Auth の `rateLimit`（`/sign-in/social`・`/sign-in/demo`・`/get-session` に独自の枠）。保存先は既定のメモリー（インスタンスごと）。
  接続元の IP は `x-forwarded-for` から取るが、`advanced.ipAddress.trustedProxies` を設定していないので、**値が1つのときだけ**信じる。
  値が2つ以上なら IP が分からないものとして、その道の共有の枠1つで数える。
- デモアカウント: `/api/demo/reset`（GET）を Vercel Cron が毎日 19:00 UTC（日本時間 4:00）に `Authorization: Bearer <CRON_SECRET>` 付きで呼び、
  中身を見本に戻す（`src/server/demoReset.ts`）。`CRON_SECRET` が違えば 401、`DEMO_LOGIN` が `1` でなければ 404。
- メールは送らない（v2.59.0 から）。アプリのコードに Resend も `TYPLE_MAIL_FROM` もない。
- Vercel 専用のもの: `@vercel/analytics`（`src/components/WebAnalytics.tsx`、`VERCEL=1` のときだけ）、`src/server/settings.ts` の
  `VERCEL !== '1'`（開発ログインを Vercel で無効にする）、`src/lib/siteUrl.ts` の `VERCEL_PROJECT_PRODUCTION_URL`、`vercel.json` の Cron。
- `scripts/check-production.cjs` は本番ドメイン（ホーム、`/api/auth/*`、GitHub と Sparklingstadt ID のログインの始まり）と、
  `typle-r-six.vercel.app`（ページが本番へ 308 で移ること、`/api/health`）を確かめる。後者は iPad・Mac 版のアプリが `/api/*` を呼ぶため残している。
- ほかに Vercel を前提にしているもの: `src/app/layout.tsx` の `onVercel`、`src/proxy.ts` の matcher と `next.config.mjs` の CSP の
  `_vercel`、紹介ページの「アクセス解析」の節（6言語、`src/app/about/page.tsx`）。`src/lib/analytics.ts` は `WebAnalytics.tsx` からしか使われていない。
- iPad・Mac 版は v2.55.0 からログインできず、端末内の保存だけで使う（README）。
- v2.55.1 で関数を `sin1` に移したのは、Neon（シンガポール）の近くに置くため。DB を RDS に移せば、この理由はなくなる。
- 紹介ページの技術の一覧（`src/messages/*/about.json` の `techList`、6言語）に「PostgreSQL（Neon）」とある。README の技術の表も「Vercel（シンガポール）と Neon」。
- `public/` は約 14MB（手書き認識の onnxruntime の wasm を含む。`postinstall`・`prebuild` で `node_modules` から写す）。
- AWS 側の用意（v2.55.2 から）: `Dockerfile`（`output: 'standalone'`）、`infra/` の CDK（スタック `TypleBase`・`Typle`）、`scripts/deploy-aws.cjs`、
  `docs/aws/` の手順書。`infra/cdk.json` の `dnsTarget` は `vercel` のままで、切り替えはまだ行っていない。
- CDK と今のアプリの食い違い: タスク定義に `AUTH_SID_*`・`DEMO_LOGIN`・`CRON_SECRET` がなく、使わなくなった `RESEND_API_KEY`（シークレット）と
  `TYPLE_MAIL_FROM`（`mailFrom` の入力）が残っている。デモアカウントを戻す仕組みもない。

## 構成（本番）

```
利用者 ─HTTPS─▶ Route 53（typle.sparklingstadt.com）
                 └▶ ALB（パブリックサブネット×2 AZ、ACM の証明書、HTTP は HTTPS へ 301）
                      └▶ ECS Fargate のタスク×1（パブリックサブネット、ARM64、0.5 vCPU / 1 GB、:3000）
                           ├─ Secrets Manager（DATABASE_URL・BETTER_AUTH_SECRET・AUTH_GITHUB_SECRET・AUTH_SID_SECRET・CRON_SECRET）
                           ├─ CloudWatch Logs
                           └▶ RDS for PostgreSQL 17（プライベートサブネット×2 AZ、db.t4g.micro、シングル AZ）

EventBridge（毎日 19:00 UTC）─HTTPS─▶ https://typle.sparklingstadt.com/api/demo/reset（Authorization: Bearer <CRON_SECRET>）
```

- **VPC**: 2 AZ。パブリックサブネット（ALB とタスク）とプライベートサブネット（RDS）。**NAT Gateway は作らない**（月 $40 以上かかる）。
  タスクはパブリック IP を持ち、外（GitHub・Sparklingstadt ID・ECR・Secrets Manager）へはインターネットゲートウェイから出る。
  受け付けるのはセキュリティグループで ALB からの :3000 だけ。
- **セキュリティグループ**: ALB は 80/443 を全体から。タスクは ALB からの 3000 だけ。RDS はタスク（とマイグレーション・データ移行のタスク）からの 5432 だけ。
- **RDS**: PostgreSQL 17（ローカルの `compose.yaml` と同じメジャー版）、gp3 20GB、保存時の暗号化、自動バックアップ 7 日、削除保護あり、
  パブリックアクセスなし。マスターユーザーのパスワードは Secrets Manager の管理にする。アプリは専用のユーザーで接続する
  （マスターをアプリで使わない。権限はマイグレーションに要るものまで）。
- **接続の SSL**: RDS の PostgreSQL は SSL 必須。RDS の CA バンドル（`global-bundle.pem`）をイメージに入れ、
  `DATABASE_URL` を `sslmode=verify-full`・`sslrootcert=<イメージ内のパス>` にする。
- **ECR**: イメージのリポジトリ。タグは `v<package.json の version>`。古いイメージはライフサイクルルールで 10 個まで残す。
- **ECS**: クラスター1つ、サービス1つ（タスク1）。ヘルスチェックは ALB のターゲットグループから `/api/health`。
  デプロイはローリング（最小 100%・最大 200%）とデプロイのサーキットブレーカー（失敗したら前のリビジョンに戻す）。
- **Secrets Manager**: アプリのタスクには上の5つ。タスクの実行ロールだけが読める。ほかに単発のタスク用の `APP_DB_PASSWORD`・`NEON_DIRECT_URL`（どちらも CDK で器だけ作る）。
  秘密でない値（`AUTH_URL`・`SITE_URL`・`AUTH_GITHUB_ID`・`AUTH_SID_ISSUER`・`AUTH_SID_ID`・`DEMO_LOGIN=1`）はタスク定義の環境変数。
  `AUTH_SID_ID` と `AUTH_SID_SECRET` は、Vercel と同じクライアントを使い続けてよい（コールバックの URL は同じ本番ドメインなので、登録を変えなくてよい）。
- **デモアカウントを戻す**: Vercel Cron の代わりに、EventBridge のスケジュールのルールから **API destination** で
  `GET https://typle.sparklingstadt.com/api/demo/reset` を毎日 19:00 UTC に呼ぶ。`Authorization: Bearer <CRON_SECRET>` は EventBridge の
  connection（API キーの認可。値は EventBridge が Secrets Manager に持つ）に入れる。アプリのコードは変えない。
  ECS の単発タスクでリセットのスクリプトを流す案より、ルートと 401・404 の扱いをそのまま使えて、試験の範囲の EventBridge にも触れられる（作る人の判断）。
  呼び出しの失敗（`FailedInvocations`）を CloudWatch のアラームに足す。
- **接続元の IP と回数制限**: ALB は届いた `x-forwarded-for` の**末尾に**接続元を足す。利用者がヘッダーを付けてこなければ値は1つで、
  Better Auth はそれを接続元として使う。利用者が偽の値を付けてくると値が2つ以上になり、Better Auth はどれも信じずに共有の枠で数えるので、
  偽った IP で枠を逃れることはできない（偽った人どうしが同じ枠を食い合うだけ）。そのため、アプリの変更は要らない。
  `advanced.ipAddress.trustedProxies` に ALB のサブネットを入れて右から辿らせる案は、偽った人にも正しい IP を割り当てられるが、必須ではない（作る人の判断で入れてよい）。
  回数制限の保存先はメモリーなので、タスクを2つ以上にするときは DB に移す。
- **CloudWatch**: タスクのログ（保持 30 日）。アラーム: ALB の 5xx、ターゲットの異常、RDS の CPU と空き容量。通知は SNS でメール。
- **費用**: AWS Budgets で月の予算（$80、通知だけで止めはしない）を作り、実績の 80%・予測の 100% でメール。最初に作る。
- **アカウント**: root には MFA を付けて普段は使わない。IAM Identity Center のユーザーで作業し、Mac の `aws` CLI も
  `aws configure sso` のプロファイルで使う（長期のアクセスキーを作らない）。
- **DNS**: ドメイン `sparklingstadt.com` は Cloudflare Registrar で取ってあり、Cloudflare Registrar のドメインはネームサーバーを
  Cloudflare から変えられない。そこで、Cloudflare に NS レコードを足して**サブドメイン `typle.sparklingstadt.com` だけを
  Route 53 のホストゾーンに委任する**（持ち主の判断として作る人が決めた。Route 53 のホストゾーン・エイリアスレコード・ACM の DNS 検証を
  本番で使えるため）。ゾーンの頂点の `typle.sparklingstadt.com` は ALB へのエイリアス（A・AAAA）。
  委任すると、Cloudflare にある `typle.sparklingstadt.com` とその下のレコードは効かなくなるので、委任の前に一覧にして、要るものを Route 53 に写す
  （以前メールに使った Resend の SPF・DKIM・MX が残っていても、v2.59.0 からメールは送らないので写さなくてよい）。Cloudflare のプロキシ（オレンジの雲）は通らなくなる
  （通すと `x-forwarded-for` が2段になり、Better Auth が接続元を決められず回数制限が共有の枠1つになる）。練習環境は、同じように `aws-lab.sparklingstadt.com`
  を委任する（使い終わったら NS レコードを消す）。
- **リージョン**: `ap-northeast-1`（東京）。持ち主が決めた。`sin1` は Neon の近くに置くためだったので、RDS に移せば理由がなくなる。

月額の目安（東京、オンデマンド）: ALB 約 $20、Fargate ARM 0.5vCPU/1GB 約 $15、RDS db.t4g.micro + 20GB 約 $20、
パブリック IPv4（ALB 2・タスク 1）約 $11、Secrets Manager・Route 53・CloudWatch で数ドル。合計 約 $60〜70。

## アプリの変更

1. **コンテナ**: `next.config.mjs` に `output: 'standalone'`。リポジトリのルートに `Dockerfile`（Node 24 の slim、マルチステージ、
   ARM64）を置く。実行時のイメージに入れるもの: `.next-production/standalone` の中身、`.next-production/static`、`public/`、
   RDS の CA バンドル、マイグレーションに要るもの（v2.60.8 からは `/app/migrate` に、`prisma`・`pg`・`@next/env` と `scripts/check-migrations.cjs`・`db/migrations`・`prisma.config.ts`・`prisma/schema.prisma`。それまでは `scripts/migrate.cjs` と `db/migrations`、`pg`）。
   root でないユーザーで `node server.js`（`HOSTNAME=0.0.0.0`・`PORT=3000`）。`.dockerignore` で `.env*`・`.next*`・`node_modules`・`.git`・`kotlin`・`server` などを除く。
2. **接続元の IP**（v2.55.2 で済み、v2.59.0 で役目を終えた）: `clientIp` を `x-forwarded-for` の末尾の値にした。
   v2.59.0 で `clientIp` ごと回数制限をなくし、今は Better Auth の回数制限だけがある（上の「接続元の IP と回数制限」。変更は要らない）。
3. **DB の接続**: `src/server/database.ts` の Vercel・Neon 前提のコメントを直す。プールの大きさ（`max: 5`）は、タスク1つなら
   RDS の上限に対して十分小さいのでそのまま。
4. **Vercel Web Analytics を外す**: `WebAnalytics.tsx`・`src/lib/analytics.ts`・`@vercel/analytics`、`layout.tsx` の `onVercel`、
   `proxy.ts` と CSP の `_vercel` を消す。紹介ページの「アクセス解析」の節は、6言語とも節ごと消す（持ち主が決めた）。
5. **`VERCEL` の判定**: `settings.ts` の開発ログインは、`localLoginAllowed` が `LOCAL_DEVELOPMENT_LOGIN=1` と http の loopback・LAN の
   `AUTH_URL` を求めるので、本番（`https://typle.sparklingstadt.com`）では `VERCEL` の判定がなくても無効になる。`NODE_ENV` で
   判定してはいけない（E2E は本番ビルドで開発ログインを使う）。変更はせず、「https の `AUTH_URL` では `LOCAL_DEVELOPMENT_LOGIN=1` でも
   開発ログインが無効」というテストを足して、AWS でも有効にならないことを確かめる。`env.VERCEL` の判定と `siteUrl.ts` の
   `VERCEL_PROJECT_PRODUCTION_URL` は、切り替えのあとの PR で消す（作る人の判断）。
6. **紹介ページ**: `techList` の「PostgreSQL（Neon）」を、切り替えのあとの PR で「PostgreSQL（Amazon RDS）」・AWS に直す（6言語）。

7. **デモアカウントのリセット**: `src/app/api/demo/reset/route.ts` と `src/server/demoReset.ts` のコメントの「Vercel Cron」を、
   切り替えのあとの PR で EventBridge に直す。動きは変えない。

1・2・3・5 は v2.55.2 で Vercel のまま出した（Vercel ではビルドが `.next` のままで `standalone` も害がない）。4・6・7 と
Vercel の後片付けは切り替えの**後**。

## マイグレーションとデプロイ（新しいリリースの段）

RDS はプライベートサブネットにあり、Mac からは直接つながらない。マイグレーションは **ECS の単発タスク**（同じイメージ、
コマンドを `npm --prefix /app/migrate run db:migrate` に差し替え。v2.60.7 までは `node scripts/migrate.cjs`）で流す。これで `RunTask` とタスク定義の上書きを学べる。

main の CI の `deploy` ジョブ（`vercel deploy --prod` と本番の確認）を、AWS へのデプロイに置き換える。中身は `scripts/deploy-aws.cjs`（v2.55.2 で作った）の段で、各段で止まる:

1. 作業ツリーがきれいで、HEAD が `origin/main` であることを確かめる。
2. `docker build --platform linux/arm64` でイメージを作り、`v<version>` のタグで ECR に push（ECR にあれば作り直さない）。
3. `cdk deploy Typle --exclusively` で、マイグレーションのタスク定義だけを新しいイメージにする（サービスは前のイメージのまま）。
4. マイグレーションの単発タスクを流し、終了コード 0 を確かめる。
5. `cdk deploy Typle --exclusively` で、サービスも新しいイメージにする（CloudFormation がサービスの安定を待つ）。
6. `npm run check:production`。

イメージのタグは CDK の入力（`-c appTag=v<version>`）にした。`TypleBase`（ドメインの向き先）はリリースでは deploy しない。

戻すとき: 前のバージョンのタグで 5 を行う（マイグレーションは前に進むだけなので、戻すのはアプリだけ）。

`vercel.json` の `buildCommand` にあったマイグレーションは、この 4 で置き換わる。

**どこで流すか**: **CI に載せる**（2026-11-28 に持ち主が決めた）。切り替えのあとも「マージすると CI が公開する」を保つ。
`deploy-aws.cjs` は今、持ち主の Mac で `--profile typle`（IAM Identity Center）を使って流す作りになっているので、CI で動くように直す。作り:

- GitHub Actions の **OIDC** で IAM ロールを引き受ける（長期のアクセスキーを GitHub に置かない）。ロールの信頼ポリシーは
  このリポジトリの `main` の push だけに絞り、権限は CDK の deploy ロール（`cdk-…-deploy-role`）を引き受けることと、`ecs:RunTask` などに要るものだけにする。
  ロールと OIDC のプロバイダーは `TypleBase` で作る。
- ARM64 のイメージは、GitHub の ARM64 のランナー（`ubuntu-24.04-arm`）で作る（QEMU で作ると遅い）。
- `cdk.context.local.json` の値（GitHub の Client ID など）は、GitHub の変数（秘密でない）に移す。
- `deploy-aws.cjs` の 1（HEAD が `origin/main`）は、CI では Release のタグがそのコミットを指すことの確かめに置き換える（今の `deploy` ジョブと同じ）。

- CI が使えないとき（Actions が止まっている・払えない）だけ、今の Vercel と同じく、持ち主の Mac から `deploy-aws.cjs --profile typle` で手で公開する。

載せない案（リリースのたびに持ち主の Mac で流す）は採らなかった。v2.60.6 で手での公開をやめた理由がそのまま当てはまり、OIDC のロールも CLF-C02 の IAM の範囲で学べるため。

## データの移行（切り替えの手順）

前もって:

- Route 53 への委任は、切り替えの前に済ませる。最初は Route 53 のゾーンに、今の Vercel を指すレコードを写して委任し（利用者には何も変わらない）、TTL を 60 秒にしておく。切り替えの当日は、そのレコードを ALB へのエイリアスに変えるだけにする。
- 練習環境で、Neon のコピーを使って移行を一度通しで行い、かかる時間と行数の確かめ方を決めておく。

当日（目安 15〜30 分止まる）:

1. Vercel のプロジェクトを一時停止し、本番への書き込みを止める（停止のあいだのページは Vercel の表示になる）。
2. 単発の ECS タスク（公式の `postgres:17` イメージ）で `pg_dump`（Neon の直接接続）を `pg_restore`（RDS）に流す。
   Neon の接続文字列はそのタスクにだけ Secrets Manager から渡す。
3. 主なテーブルの行数を Neon と RDS で比べる（`scripts/` に比べる SQL を用意）。違えば中止して Vercel の停止を解く。
4. DNS のレコードを ALB に向ける（`infra/cdk.json` の `dnsTarget` を `aws` にして `TypleBase` を deploy）。
5. `npm run check:production` が新しい構成で通ること、本番で Sparklingstadt ID・GitHub・デモアカウントのログインと保存を、
   持ち主のテスト用アカウントで手で確かめる。EventBridge からデモのリセットを一度手で呼べること（200）も確かめる。
6. 5 までに問題があれば DNS を Vercel に戻し、Vercel の停止を解く（Neon には停止の前のデータがそのまま残っているので戻せる）。
   5 が通ったら、そこが**戻れない点**。そのあとは利用者の書き込みが RDS にだけあるので Neon には戻さず、問題は RDS のまま
   直す（必要なら RDS のスナップショットから戻す）。テスト用アカウントの行は 5 のあとに消す。（持ち主の判断として作る人が決めた）
7. 5 が通ったら、Vercel の一時停止を解いて予備に戻す（DNS はもう AWS を向いているので、利用者は Vercel に来ない）。

切り替えと CI: v2.60.6 から、PR をマージすると main の CI が Vercel へ公開する。`dnsTarget` を `aws` にする変更も PR でマージするので、
その PR で CI の `deploy` ジョブも AWS へのデプロイ（3b で用意したもの）に切り替えておく。変えずにマージすると、一時停止中の Vercel への
公開で CI が失敗するか、予備のはずの Vercel が更新される。当日の流れ（だれがいつマージし、いつ `TypleBase` を deploy するか）は、
3b のあとに当日の手順書に書く。

Vercel と Neon は切り替えのあとも消さずに、**予備として今のまま動かし続ける**（持ち主が決めた）。

- 予備の Vercel は切り替えた時点のコードのまま止め、そのあとのリリースでは更新しない（作る人の判断。リリースのたびに AWS と Vercel の
  両方に出すと手間が倍になり、Neon のマイグレーションも要る）。`.vercel/` のリンクは持ち主の Mac に残す。
- 利用者は `typle.sparklingstadt.com`（AWS）に来る。`typle-r-six.vercel.app` のページは `vercel.json` で本番ドメインへ移り、
  ログイン（Better Auth の Cookie）は本番ドメインにしか付かないので、予備の Vercel から Neon に利用者の書き込みが入る道はない。
  Vercel に残るのは iPad・Mac 版が呼ぶ `/api/*` だけで、ログインできないアプリには 401 を返す。
- 予備の Vercel の Cron は、Neon のデモアカウントを毎日戻し続ける。Neon の中だけのことなので害はない。
- 予備の Vercel は CI からもう公開しない。Vercel のトークン（GitHub の `VERCEL_TOKEN`）と `credentials` ジョブは、後片付けの PR で外す。
- 予備に戻せるのは「戻れない点」（データの移行の 5）より前だけ。そのあとの Neon は切り替えの時点で止まった古い写しなので、
  Vercel に DNS を戻すと、切り替えのあとの登録と保存が見えなくなる。持ち主にこのことを伝えてある。
- 費用: Vercel と Neon のプランの料金はそのままかかる。

## 手順書（練習環境）

`docs/aws/` に日本語で置く。コンソールの操作を1つずつ、何のために何をするかと、CLF-C02 のどの分野（クラウドの概念・
セキュリティとコンプライアンス・クラウドテクノロジーとサービス・請求と料金）に当たるかを書く。順序:

1. アカウントの準備（root の MFA、IAM Identity Center、Budgets、リージョン）
2. VPC・サブネット・セキュリティグループ
3. RDS（と、作らないマルチ AZ・リードレプリカの説明）
4. ECR とイメージの push
5. Secrets Manager
6. ECS（クラスター・タスク定義・サービス）と ALB
7. ACM と Route 53（練習環境はサブドメイン）
8. CloudWatch（ログ・アラーム）
9. 片付け（作った順の逆に消す。消し忘れを Cost Explorer で確かめる）

練習環境では Neon のデータのコピーを使ってよい。GitHub のログインには練習環境用の OAuth App を使う。
Sparklingstadt ID とデモアカウントは練習環境では使わない（設定しなければ、そのログインだけが出ない）。
手順書は v2.55.2 で書いたもので、`RESEND_API_KEY` の扱いなどメールの記述が残っている。3a の PR で直す。

## CDK（本番）

- リポジトリの `infra/` に CDK（TypeScript）のアプリを置く。手順書の構成をそのままコードにする（L2 コンストラクトで、読んで構成が分かる書き方）。
- `infra/` は自分の `package.json` を持ち、アプリの依存と混ぜない。`npm run verify` が `infra/` の typecheck・テスト・`cdk synth` も流す。
- スタックは2つ: `TypleBase`（ホストゾーン、頂点の A レコード、ECR。最初と切り替えの当日だけ deploy）と `Typle`（VPC・RDS・ECS・ALB・秘密・監視。リリースのたび）。
  どちらも削除保護付き。CI に載せるときの OIDC のロールは `TypleBase` に足す。
- EventBridge の connection・API destination・ルールは `Typle` に足す。connection の API キーの値（`CRON_SECRET`）は、ほかの秘密と同じくコードに書かず、
  deploy のあとに CLI で入れる（`aws events update-connection`）。アプリの `CRON_SECRET` と同じ値にする。
- 秘密の値は CDK のコードに書かない。Secrets Manager のシークレットは CDK で器だけ作り、値はコンソールか CLI で入れる。
- RDS には削除保護と `RemovalPolicy.SNAPSHOT`（スタックを消しても DB を残す）。

## リポジトリの後片付け（切り替えのあと）

- `docs/release-workflow.md` の Vercel の段（予備の Vercel の扱いを書き足す。`vercel.json` は予備のために残す）、`CLAUDE.md` の Release workflow、
  `docs/production.md` と README の技術の表の「Vercel（シンガポール）と Neon」を AWS に書き換える。
- `.github/workflows/ci.yml` から Vercel の `credentials` と、使わなくなった Vercel のデプロイの手順を外す（`deploy` は切り替えの PR で AWS に置き換わっている）。
- `scripts/check-production.cjs` は、本番ドメインを AWS として確かめ、`typle-r-six.vercel.app` の確認（ページが本番へ 308 で移ること、`/api/health`）は残す。
- `.env.example` の `DIRECT_URL`（Neon）と、`CRON_SECRET` の「Vercel Cron」の説明を直す。

（2026-11-20 の版にあった README の Go の記述と `scripts/bench-backends.cjs` は、v2.60.5 で片付いた。）

## 作業の順序

1. ~~PR: アプリの変更 1・2・3・5（Vercel のまま出す）~~ — v2.55.2（#366）で済み。手順書と CDK も同じ PR で出した
2. 持ち主: アカウントの準備と練習環境。終わったら**練習環境を消してから**次へ進む（二重の課金を避ける）
3. 持ち主: 本番のスタックを作り、空の RDS にマイグレーションを流し、ALB の IP を指定して動くことを確かめる（`docs/aws/production.md`）。
   データの移行のリハーサルもこのスタックで行う。写したデータは残してよい（当日に `pg_restore --clean` が入れ直す）
   - 3a. PR: CDK と手順書を今のアプリに合わせる。タスク定義に `AUTH_SID_ISSUER`・`AUTH_SID_ID`・`AUTH_SID_SECRET`・`DEMO_LOGIN`・`CRON_SECRET` を足し、
     `RESEND_API_KEY` と `mailFrom`（`TYPLE_MAIL_FROM`）を外し、EventBridge のデモのリセットと、その失敗のアラームを足す。
     `docs/aws/` の秘密の値の表とメールの記述を直す。**3 で本番の `Typle` スタックを作る前に**出す（作ったあとなら、次の deploy で反映される）
   - 3b. PR: AWS のデプロイを CI に載せる用意。`TypleBase` に GitHub の OIDC のプロバイダーとロールを足し、`deploy-aws.cjs` を CI で動くように直し、
     `ci.yml` に AWS のデプロイのジョブを（切り替えまでは動かない形で）用意する
4. 持ち主: 切り替えの当日の手順（当日の手順書は、3b のあとに PR で書く）
5. PR: 後片付け（アプリの変更 4・6・7 を含む）とリリース手順の書き換え

## 作る人に任せること

- Dockerfile の細部（ベースイメージのタグ、層の分け方）、`scripts/deploy-aws.cjs` の形。
- CDK のコンストラクトの分け方、スタックの数。
- CloudWatch のアラームのしきい値。
- 行数の比べ方の SQL。
- デモのリセットの呼び方（API destination か、ECS の単発タスクか）。この設計は API destination を勧める。
- Better Auth に `trustedProxies` を設定するか。

## 決まっていないこと

なし。2026-11-20 に持ち主と確認し、2026-11-28 の改訂で残った「AWS へのデプロイを CI に載せるか」は、載せると持ち主が決めた。
