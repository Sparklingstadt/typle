# Vercel・Neon から AWS への移行（設計）

日付: 2026-11-20 ／ 対象: typle-r（main は v2.55.1）

## 目的

typle の本番（`https://typle.sparklingstadt.com`）を、Vercel（アプリ）と Neon（DB）から AWS へ完全に移す。

移す理由は、利用者のためではなく**持ち主が AWS を学ぶため**で、AWS Certified Cloud Practitioner（CLF-C02）の受験に向けて、
試験に出るサービスを本物の本番で触ることにある。そのため、安さや手軽さよりも「主要なサービスを1つずつ理解して使う」ことを重く見る。
ただし本番なので、利用者の使い心地とデータは移行の前後で変えない。

## 目標

- 本番のアプリが AWS の東京リージョン（`ap-northeast-1`）の ECS Fargate で動き、DB は RDS for PostgreSQL になる。
- 同じドメイン `typle.sparklingstadt.com` で、ログイン（GitHub・ID とパスワード）、保存、メールが今までどおり動く。
- Neon の本番データを、欠けなく RDS に移す。
- 持ち主がまず AWS コンソールで手順書どおりに一通り作って理解し（練習環境）、そのあと同じ構成を AWS CDK（TypeScript）で
  コードにして本番を作る。本番の構成はリポジトリのコードで再現できる。
- リリースの手順（PR → マージ → verify → GitHub Release → デプロイ → `check:production`）の形を保ったまま、
  デプロイの段を Vercel から AWS に置き換える。
- 使った AWS のサービスと CLF-C02 の範囲との対応が、手順書から分かる。

## 目標にしないこと

- 高い可用性（マルチ AZ の RDS、複数タスク）。考え方は手順書で説明するが、費用のため本番では使わない。
- CloudFront・WAF・Lambda の導入。試験の範囲だが、この移行では使わない（手順書で触れるだけ）。
- Vercel Web Analytics の代わりのアクセス解析。
- Go・Kotlin のバックエンド（`TYPLE_BACKEND=go`・`TYPLE_BACKEND_COMPARE`）を AWS で動かすこと。これは Vercel の Go 関数に
  頼っているので、AWS では使えなくなる。コードを消すかは別の PR で決める。
- API の文書（`api-docs/`、Cloudflare Pages）を移すこと。今のまま。
- GitHub Actions による自動デプロイ。今と同じく、公開は持ち主の Mac から手で行う。

## 失敗とみなすこと（動いても駄目なもの）

- 本番のデータが1行でも失われる、または移行のあいだの書き込みが Neon にだけ残る。
- IP ごとの回数制限（ログイン失敗・登録・メール）がすり抜けられる（下の「アプリの変更」）。
- 秘密の値（DB のパスワード・`AUTH_SECRET`・GitHub の secret・Resend のキー・AWS の鍵）がリポジトリ・イメージ・タスク定義の平文に入る。
- 思わぬ請求。NAT Gateway のような常時課金の大きいものを知らずに作る、予算の通知がない。
- root ユーザーで日常の作業をする。
- 切り替えで長く止まる（目安 30 分以上）、または切り替えたあとにログインできない。
- 練習環境を消し忘れて、本番と二重に課金され続ける。

## 制約

- Node.js 24（`package.json` の `engines`）、Next.js 16.4.6、Auth.js（next-auth 5 beta）、`pg`。
- `next.config.mjs` は、`VERCEL=1` でも開発サーバーでもないとき、ビルドを `.next-production` に出す。
- `npm run verify` は Docker と Node.js 24 が要るので、持ち主の Mac で流す。クラウドのセッションは AWS にも触れない。
  AWS の操作（コンソール・`aws`・`cdk`・`docker push`）はすべて持ち主の Mac で、持ち主が行う。
- main へは直接 push しない。変更は PR で、PR ごとに未使用のバージョンを付ける（`CLAUDE.md`）。
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

## 今の作り（調べた結果）

- 本番は Vercel（`vercel.json`: リージョン `sin1`、`buildCommand` が `npm run db:migrate && npm run build`、
  `typle-r-six.vercel.app` から本番ドメインへのリダイレクト）。デプロイは Mac から `vercel deploy --prod --yes`。
- DB は Neon。`DATABASE_URL` は Neon の pooler、マイグレーションは `DIRECT_URL`（`npm run db:migrate`: v2.60.8 から `scripts/check-migrations.cjs` のあと `prisma migrate deploy`。それまでは `scripts/migrate.cjs`）。
- `src/server/database.ts` はインスタンスごとに `max: 5` のプール。
- `src/server/limits.ts` の `clientIp` は `x-forwarded-for` の**先頭**の値を接続元とする。Vercel はこのヘッダーを自分で付け直すので
  正しいが、ALB は届いた値の**末尾に**接続元を足すので、先頭は利用者が偽れる。
- Vercel 専用のもの: `@vercel/analytics`（`src/components/WebAnalytics.tsx`、`VERCEL=1` のときだけ）、`api/go.go`・`server/vercel`
  （Go 関数）、`src/server/settings.ts` の `VERCEL !== '1'`（開発ログインを Vercel で無効にする）、`src/lib/siteUrl.ts` の
  `VERCEL_PROJECT_PRODUCTION_URL`。
- `scripts/check-production.cjs` は本番ドメインと `typle-r-six.vercel.app` の両方を確かめる。後者は iPad・Mac 版のアプリが `/api/*` を呼ぶため残している。
- ほかに Vercel を前提にしているもの: `src/app/layout.tsx` の `onVercel`、`src/proxy.ts` の matcher と `next.config.mjs` の CSP の
  `_vercel`、`scripts/bench-backends.cjs`（`VERCEL_AUTOMATION_BYPASS_SECRET`）、紹介ページの「アクセス解析」の節（6言語、`src/app/about/page.tsx`）。
  `src/lib/analytics.ts` は `WebAnalytics.tsx` からしか使われていない。
- iPad・Mac 版は v2.55.0 からログインできず、端末内の保存だけで使う（README）。
- v2.55.1 で関数を `sin1` に移したのは、Neon（シンガポール）の近くに置くため。DB を RDS に移せば、この理由はなくなる。
- 紹介ページの技術の一覧（`src/messages/*/about.json` の `techList`、6言語）に「PostgreSQL（Neon）」とある。
- `public/` は約 14MB（手書き認識の onnxruntime の wasm を含む。`postinstall`・`prebuild` で `node_modules` から写す）。

## 構成（本番）

```
利用者 ─HTTPS─▶ Route 53（typle.sparklingstadt.com）
                 └▶ ALB（パブリックサブネット×2 AZ、ACM の証明書、HTTP は HTTPS へ 301）
                      └▶ ECS Fargate のタスク×1（パブリックサブネット、ARM64、0.5 vCPU / 1 GB、:3000）
                           ├─ Secrets Manager（DATABASE_URL・AUTH_SECRET・AUTH_GITHUB_SECRET・RESEND_API_KEY）
                           ├─ CloudWatch Logs
                           └▶ RDS for PostgreSQL 17（プライベートサブネット×2 AZ、db.t4g.micro、シングル AZ）
```

- **VPC**: 2 AZ。パブリックサブネット（ALB とタスク）とプライベートサブネット（RDS）。**NAT Gateway は作らない**（月 $40 以上かかる）。
  タスクはパブリック IP を持ち、外（GitHub・Resend・ECR・Secrets Manager）へはインターネットゲートウェイから出る。
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
- **Secrets Manager**: 上の4つ。タスクの実行ロールだけが読める。秘密でない値（`AUTH_URL`・`SITE_URL`・`AUTH_GITHUB_ID`・`TYPLE_MAIL_FROM`）はタスク定義の環境変数。
- **CloudWatch**: タスクのログ（保持 30 日）。アラーム: ALB の 5xx、ターゲットの異常、RDS の CPU と空き容量。通知は SNS でメール。
- **費用**: AWS Budgets で月の予算（$80、通知だけで止めはしない）を作り、実績の 80%・予測の 100% でメール。最初に作る。
- **アカウント**: root には MFA を付けて普段は使わない。IAM Identity Center のユーザーで作業し、Mac の `aws` CLI も
  `aws configure sso` のプロファイルで使う（長期のアクセスキーを作らない）。
- **DNS**: ドメイン `sparklingstadt.com` は Cloudflare Registrar で取ってあり、Cloudflare Registrar のドメインはネームサーバーを
  Cloudflare から変えられない。そこで、Cloudflare に NS レコードを足して**サブドメイン `typle.sparklingstadt.com` だけを
  Route 53 のホストゾーンに委任する**（持ち主の判断として作る人が決めた。Route 53 のホストゾーン・エイリアスレコード・ACM の DNS 検証を
  本番で使えるため）。ゾーンの頂点の `typle.sparklingstadt.com` は ALB へのエイリアス（A・AAAA）。
  委任すると、Cloudflare にある `typle.sparklingstadt.com` とその下のレコード（Resend の SPF・DKIM・MX が `TYPLE_MAIL_FROM` の
  ドメインにあれば、それも）は効かなくなるので、委任の前に一覧にして Route 53 に写す。Cloudflare のプロキシ（オレンジの雲）は通らなくなる
  （通すと `x-forwarded-for` の末尾が Cloudflare の IP になり、回数制限が壊れる）。練習環境は、同じように `aws-lab.sparklingstadt.com`
  を委任する（使い終わったら NS レコードを消す）。
- **リージョン**: `ap-northeast-1`（東京）。持ち主が決めた。`sin1` は Neon の近くに置くためだったので、RDS に移せば理由がなくなる。

月額の目安（東京、オンデマンド）: ALB 約 $20、Fargate ARM 0.5vCPU/1GB 約 $15、RDS db.t4g.micro + 20GB 約 $20、
パブリック IPv4（ALB 2・タスク 1）約 $11、Secrets Manager・Route 53・CloudWatch で数ドル。合計 約 $60〜70。

## アプリの変更

1. **コンテナ**: `next.config.mjs` に `output: 'standalone'`。リポジトリのルートに `Dockerfile`（Node 24 の slim、マルチステージ、
   ARM64）を置く。実行時のイメージに入れるもの: `.next-production/standalone` の中身、`.next-production/static`、`public/`、
   RDS の CA バンドル、マイグレーションに要るもの（v2.60.8 からは `/app/migrate` に、`prisma`・`pg`・`@next/env` と `scripts/check-migrations.cjs`・`db/migrations`・`prisma.config.ts`・`prisma/schema.prisma`。それまでは `scripts/migrate.cjs` と `db/migrations`、`pg`）。
   root でないユーザーで `node server.js`（`HOSTNAME=0.0.0.0`・`PORT=3000`）。`.dockerignore` で `.env*`・`.next*`・`node_modules`・`.git`・`kotlin`・`server` などを除く。
2. **接続元の IP**: `clientIp` を `x-forwarded-for` の**末尾**の値にする（ALB が足した、偽れない値）。Vercel も値1つなので、
   この変更は Vercel のままでも同じに動く（移行前に出せる）。`tests/` の該当テストを直し、「先頭に偽の値を足しても効かない」テストを足す。
   関数のコメントも直す。
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

1・2・3・5 は切り替えの**前**に Vercel のまま出せる（Vercel ではビルドが `.next` のままで `standalone` も害がない）。4・6 と
Vercel の後片付けは切り替えの**後**。

## マイグレーションとデプロイ（新しいリリースの段）

RDS はプライベートサブネットにあり、Mac からは直接つながらない。マイグレーションは **ECS の単発タスク**（同じイメージ、
コマンドを `npm --prefix /app/migrate run db:migrate` に差し替え。v2.60.7 までは `node scripts/migrate.cjs`）で流す。これで `RunTask` とタスク定義の上書きを学べる。

リリースの7〜8（`docs/release-workflow.md`）を次に置き換える。コマンドは `scripts/deploy-aws.cjs`（仮）にまとめ、各段で止まる:

1. `docker build --platform linux/arm64` でイメージを作り、`v<version>` のタグで ECR に push。
2. そのイメージでマイグレーションの単発タスクを流し、終了コード 0 を確かめる。
3. タスク定義の新しいリビジョンを登録してサービスを更新し、`aws ecs wait services-stable` で待つ。
4. `npm run check:production`。

戻すとき: サービスを前のタスク定義のリビジョンに戻す（マイグレーションは前に進むだけなので、戻すのはアプリだけ）。
CDK にしたあとは、イメージのタグを CDK の入力にするか、CDK はインフラだけを持ちデプロイは上の手順で行うかを、作る人が決める。

`vercel.json` の `buildCommand` にあったマイグレーションは、この2で置き換わる。

## データの移行（切り替えの手順）

前もって:

- Route 53 への委任は、切り替えの前に済ませる。最初は Route 53 のゾーンに、今の Vercel を指すレコードを写して委任し（利用者には何も変わらない）、TTL を 60 秒にしておく。切り替えの当日は、そのレコードを ALB へのエイリアスに変えるだけにする。
- 練習環境で、Neon のコピーを使って移行を一度通しで行い、かかる時間と行数の確かめ方を決めておく。

当日（目安 15〜30 分止まる）:

1. Vercel のプロジェクトを一時停止し、本番への書き込みを止める（停止のあいだのページは Vercel の表示になる）。
2. 単発の ECS タスク（公式の `postgres:17` イメージ）で `pg_dump`（Neon の直接接続）を `pg_restore`（RDS）に流す。
   Neon の接続文字列はそのタスクにだけ Secrets Manager から渡す。
3. 主なテーブルの行数を Neon と RDS で比べる（`scripts/` に比べる SQL を用意）。違えば中止して Vercel の停止を解く。
4. DNS のレコードを ALB に向ける。
5. `npm run check:production` が新しい構成で通ること、本番でログイン・保存・登録のメールを、持ち主のテスト用アカウントで手で確かめる。
6. 5 までに問題があれば DNS を Vercel に戻し、Vercel の停止を解く（Neon には停止の前のデータがそのまま残っているので戻せる）。
   5 が通ったら、そこが**戻れない点**。そのあとは利用者の書き込みが RDS にだけあるので Neon には戻さず、問題は RDS のまま
   直す（必要なら RDS のスナップショットから戻す）。テスト用アカウントの行は 5 のあとに消す。（持ち主の判断として作る人が決めた）
7. 5 が通ったら、Vercel の一時停止を解いて予備に戻す（DNS はもう AWS を向いているので、利用者は Vercel に来ない）。

Vercel と Neon は切り替えのあとも消さずに、**予備として今のまま動かし続ける**（持ち主が決めた）。

- 予備の Vercel は切り替えた時点のコードのまま止め、そのあとのリリースでは更新しない（作る人の判断。リリースのたびに AWS と Vercel の
  両方に出すと手間が倍になり、Neon のマイグレーションも要る）。`.vercel/` のリンクは持ち主の Mac に残す。
- 利用者は `typle.sparklingstadt.com`（AWS）に来る。`typle-r-six.vercel.app` のページは `vercel.json` で本番ドメインへ移り、
  ログイン（Auth.js の Cookie）は本番ドメインにしか付かないので、予備の Vercel から Neon に利用者の書き込みが入る道はない。
  Vercel に残るのは iPad・Mac 版が呼ぶ `/api/*` だけで、ログインできないアプリには 401 を返す。
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

練習環境では Neon のデータのコピーを使ってよいが、メールは送らない（`RESEND_API_KEY` を設定しない）。GitHub のログインには練習環境用の OAuth App を使う。

## CDK（本番）

- リポジトリの `infra/` に CDK（TypeScript）のアプリを置く。手順書の構成をそのままコードにする（L2 コンストラクトで、読んで構成が分かる書き方）。
- `infra/` は自分の `package.json` を持ち、アプリの依存と混ぜない。`verify` に `cdk synth` を足すか、`knip`・`eslint`・`tsc` の対象から外すかは作る人が決める。
- 秘密の値は CDK のコードに書かない。Secrets Manager のシークレットは CDK で器だけ作り、値はコンソールか CLI で入れる。
- RDS には削除保護と `RemovalPolicy.SNAPSHOT`（スタックを消しても DB を残す）。

## リポジトリの後片付け（切り替えのあと）

- `docs/release-workflow.md` の Vercel の段（予備の Vercel の扱いを書き足す。`vercel.json` は予備のために残す）、`CLAUDE.md` の Release workflow の 3、README の「Neon / Vercel の構成」を AWS に書き換える。
  README の「Go は v2.47.0 で消した」という記述は、`api/go.go` が残っている今と食い違うので合わせて直す。
- `scripts/bench-backends.cjs` など、Vercel のプレビューを前提にした比較の道具は使えなくなる。消すかは Go のコードと一緒に別の PR で決める。
- `scripts/check-production.cjs` は、本番ドメインを AWS として確かめ、`typle-r-six.vercel.app` の確認（ページが本番へ 308 で移ること、`/api/health`）は残す。
- `.env.example` の `DIRECT_URL`（Neon）を整理する。

## 作業の順序

1. PR: アプリの変更 1・2・3・5（Vercel のまま出す）
2. 持ち主: アカウントの準備と練習環境（手順書の PR を先に出す）。終わったら**練習環境を消してから**次へ進む（二重の課金を避ける）
3. PR: CDK（`infra/`）。持ち主が本番のスタックを作り、空の RDS にマイグレーションを流し、ALB の DNS 名で動くことを確かめる。
   データの移行のリハーサルもこのスタックで行い、終わったら RDS のテーブルを空に戻す
4. 持ち主: 切り替えの当日の手順
5. PR: 後片付け（アプリの変更 4・6 を含む）とリリース手順の書き換え

## 作る人に任せること

- Dockerfile の細部（ベースイメージのタグ、層の分け方）、`scripts/deploy-aws.cjs` の形。
- CDK のコンストラクトの分け方、スタックの数。
- CloudWatch のアラームのしきい値。
- 行数の比べ方の SQL。

## 決まっていないこと

なし（2026-11-20 に持ち主と確認した）。
