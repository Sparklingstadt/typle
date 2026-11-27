# 6. アプリを動かす（ECS Fargate と ALB）

[← 手順書の一覧](README.md)

ECR のイメージを ECS（Fargate）で動かし、ALB（Application Load Balancer）の後ろに置きます。
順番は次のとおりです。

1. ロール
2. クラスター
3. タスク定義
4. DB のユーザーとマイグレーション（単発のタスク）
5. ALB
6. サービス

## 6-1. タスク実行ロールを作る

ECS がタスクを起動するときに使うロールです。イメージの取得、ログの書き込み、シークレットの読み取りに使います。
アプリ用と、DB のユーザーを作る単発のタスク用に、**2つ**作ります。読めるシークレットを分けるためです。

1. **IAM** → **ロール** → **ロールを作成**を開きます。
2. 信頼されたエンティティは **AWS のサービス**、ユースケースは **Elastic Container Service** → **Elastic Container Service Task** を選びます。
3. 許可ポリシーに `AmazonECSTaskExecutionRolePolicy` を付け、名前を `typle-lab-task-execution` にして作ります。
4. 作ったロールの**許可を追加** → **インラインポリシーを作成**で、JSON に次を入れ、名前を `typle-lab-app-runtime` にします。

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "secretsmanager:GetSecretValue",
         "Resource": [
           "arn:aws:secretsmanager:ap-northeast-1:<アカウントID>:secret:typle-lab/DATABASE_URL-*",
           "arn:aws:secretsmanager:ap-northeast-1:<アカウントID>:secret:typle-lab/BETTER_AUTH_SECRET-*",
           "arn:aws:secretsmanager:ap-northeast-1:<アカウントID>:secret:typle-lab/AUTH_GITHUB_SECRET-*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": "logs:CreateLogGroup",
         "Resource": "arn:aws:logs:ap-northeast-1:<アカウントID>:log-group:/ecs/typle-lab:*"
       }
     ]
   }
   ```

5. 1〜4 と同じやり方で、2つ目のロール `typle-lab-dbuser-execution` を作ります。許可ポリシーは同じ `AmazonECSTaskExecutionRolePolicy`、インラインポリシーは名前を `typle-lab-dbuser-runtime` にして、`secretsmanager:GetSecretValue` の `Resource` だけを次の2つに変えます（`logs:CreateLogGroup` の文はそのまま）。
   - `<RDS のマスター認証情報のシークレットの ARN>`
   - `arn:aws:secretsmanager:ap-northeast-1:<アカウントID>:secret:typle-lab/APP_DB_PASSWORD-*`

シークレットの ARN の末尾には、AWS が付けたランダムな6文字（`-AbCdEf`）があります。そのため、名前のあとに `-*` を付けて指定します。

- アプリのタスクが読めるのは、アプリの3つのシークレットだけです。DB のマスターパスワードは読めません（**最小権限**）。
- `logs:CreateLogGroup` を許すのは、新しいコンソールがタスク定義のログの設定に `awslogs-create-group` を自動で付けるためです。この権限がないと、ロググループがすでにあってもタスクが起動できません。
- アプリそのものは AWS の API を呼ばないので、タスクロール（アプリが使うロール）は作りません。

## 6-2. クラスターを作る

**Elastic Container Service** → **クラスター** → **クラスターの作成**で、名前を `typle-lab`、インフラストラクチャを **AWS Fargate（サーバーレス）**だけにして作ります。
Container Insights は、費用のためオフにします。

## 6-3. ロググループを作る

**CloudWatch** → **ロググループ** → **ロググループを作成**で、名前を `/ecs/typle-lab`、保持期間を **1週間**にして作ります。

## 6-4. タスク定義を作る

**ECS** → **タスク定義** → **新しいタスク定義の作成**（JSON ではなく画面で）を開き、次のとおりに入れます。

| 項目 | 値 |
|---|---|
| タスク定義ファミリー | `typle-lab` |
| 起動タイプ | AWS Fargate |
| OS、アーキテクチャ | Linux/**ARM64** |
| CPU、メモリ | **0.5 vCPU**、**1 GB** |
| タスクロール | なし |
| タスク実行ロール | `typle-lab-task-execution` |
| コンテナの名前 | `app` |
| イメージ URI | `<ECR の URI>:v<バージョン>-lab` |
| ポートマッピング | コンテナポート **3000**、TCP、アプリケーションプロトコル HTTP |
| ログ収集 | Amazon CloudWatch、ロググループ `/ecs/typle-lab` |

**環境変数**には、次のものを足します。

- **値**（秘密でないもの）:
  - `AUTH_URL` = `https://aws-lab.sparklingstadt.com`
  - `SITE_URL` = `https://aws-lab.sparklingstadt.com`
  - `AUTH_GITHUB_ID` = 練習用の OAuth App の Client ID
- **ValueFrom**（シークレットの ARN を入れる）:
  - `DATABASE_URL` ← `typle-lab/DATABASE_URL`
  - `BETTER_AUTH_SECRET` ← `typle-lab/BETTER_AUTH_SECRET`
  - `AUTH_GITHUB_SECRET` ← `typle-lab/AUTH_GITHUB_SECRET`

コンテナのヘルスチェックは設定しません（ALB が確かめます）。

## 6-5. アプリ用の DB ユーザーを作る（単発のタスク）

DB はプライベートサブネットにあるので、Mac からは直接つなげません。
そこで、VPC の中で一度だけ動いて終わるタスク（**単発のタスク**）を動かして、作業させます。

まず、ユーザーを作るためだけのタスク定義を、もう1つ作ります。

| 項目 | 値 |
|---|---|
| ファミリー | `typle-lab-dbuser` |
| 起動タイプ、OS・アーキテクチャ | Fargate、Linux/ARM64 |
| CPU、メモリ | 0.25 vCPU、0.5 GB |
| タスク実行ロール | `typle-lab-dbuser-execution` |
| コンテナの名前 | `psql` |
| イメージ URI | `public.ecr.aws/docker/library/postgres:17` |
| ログ | `/ecs/typle-lab` |

環境変数は次のとおりです。

- **値**:
  - `PGHOST` = RDS のエンドポイント
  - `PGDATABASE` = `typle`
  - `PGUSER` = `postgres`
  - `PGSSLMODE` = `require`
- **ValueFrom**:
  - `PGPASSWORD` ← `<RDS のマスター認証情報のシークレットの ARN>:password::`（JSON の `password` だけを取り出す書き方）
  - `APP_PASSWORD` ← `typle-lab/APP_DB_PASSWORD`

**コマンド**には、次をカンマ区切りで1つのフィールドに入れます。

```
sh,-c,printf '%s\n' "SELECT 'CREATE ROLE typle_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'typle_app') \gexec" "ALTER ROLE typle_app LOGIN PASSWORD :'pw';" "GRANT ALL ON DATABASE typle TO typle_app;" "GRANT ALL ON SCHEMA public TO typle_app;" | psql -v ON_ERROR_STOP=1 -v pw="$APP_PASSWORD"
```

- パスワードを `psql` の変数（`:'pw'`）で渡しているので、パスワードがコマンドやタスクのログに出ません。
- ユーザーがなければパスワードなしで作り、そのあと `ALTER ROLE` でパスワードを設定します。何度動かしても失敗しません（2回目以降はパスワードの入れ替えになります）。
- 失敗した SQL の文は、その文面ごと RDS のログに残ります。パスワードを含む `ALTER ROLE` が、もう一度動かしたときに失敗しない形にしてあるのはそのためです。

動かし方:

1. **クラスター** `typle-lab` → **タスク** → **新しいタスクの実行**を開きます。
2. 次のとおりに選びます。
   - 起動タイプ: Fargate
   - タスク定義: `typle-lab-dbuser`
   - VPC: `typle-lab-vpc`
   - サブネット: **パブリック**サブネット2つ
   - セキュリティグループ: `typle-lab-app`（DB に届くグループ）だけ
   - **パブリック IP**: オン（イメージを取ってくるため）
3. タスクが**停止済み**になったら、コンテナ `psql` の**終了コードが 0** であることを確かめます。0 でなければ、**ログ**のタブで理由を見ます。

## 6-6. マイグレーションを流す（単発のタスク）

アプリのイメージに入っている `/app/migrate`（`npm run db:migrate`: 検査のスクリプトのあと `prisma migrate deploy`）で、テーブルを作ります。

1. 6-5 と同じ**新しいタスクの実行**を開き、タスク定義に `typle-lab`（アプリのもの）を選びます。
   ネットワークは 6-5 と同じにします（パブリックサブネット、`typle-lab-app`、パブリック IP オン）。
2. **コンテナの上書き** → `app` の**コマンドの上書き**に、`npm,--prefix,/app/migrate,run,db:migrate` と入れます。
3. 停止済みになったら、終了コードが 0 で、ログの最後が `All migrations have been successfully applied.` であることを確かめます
   （ログの `migrations found in prisma/migrations` の場所は Prisma の表示の決まり文句で、実際に読むのは `db/migrations` です）。

マイグレーションはアプリ用のユーザー `typle_app` で流れるので、テーブルの持ち主も `typle_app` になります。

## 6-7. ALB を作る

まず、ALB が転送する先をまとめる**ターゲットグループ**を作ります。

1. **EC2** → **ターゲットグループ** → **ターゲットグループの作成**を開きます。
2. 次のとおりに入れて作成します。
   - ターゲットタイプ: **IP アドレス**（Fargate のタスクは IP で登録されるため）
   - 名前: `typle-lab-app`
   - プロトコルとポート: HTTP、**3000**
   - VPC: `typle-lab-vpc`
   - ヘルスチェックのパス: `/api/health`（DB に届くことまで確かめるエンドポイント）
   - 成功コード: 200
3. ターゲットの登録は空のまま作ります（ECS のサービスが登録します）。

次に、ALB を作ります。

1. **EC2** → **ロードバランサー** → **ロードバランサーの作成** → **Application Load Balancer** を開きます。
2. 次のとおりに入れて作成します。
   - 名前: `typle-lab`
   - スキーム: インターネット向け
   - IP アドレスタイプ: IPv4
   - VPC: `typle-lab-vpc`
   - マッピング: 2つの AZ の**パブリック**サブネット
   - セキュリティグループ: `typle-lab-alb` だけ
   - リスナー: HTTP:80 → ターゲットグループ `typle-lab-app` に転送
3. **DNS 名**（`typle-lab-….ap-northeast-1.elb.amazonaws.com`）を控えます。

HTTPS のリスナーは、証明書を作ってから [7](07-domain.md) で足します。

## 6-8. サービスを作る

サービスは、指定した数のタスクを動かし続ける仕組みです。タスクが止まったら、新しいものを起動し直します。

1. **クラスター** `typle-lab` → **サービス** → **作成**を開きます。
2. 次のとおりに入れて作成します。
   - コンピューティングオプション: 起動タイプ、Fargate
   - タスク定義: `typle-lab`（最新のリビジョン）
   - サービス名: `app`
   - 必要なタスク: **1**
   - デプロイの設定: ローリングアップデート、最小 100%・最大 200%、**デプロイサーキットブレーカー**とロールバックをオン
   - ネットワーク: `typle-lab-vpc`、**パブリック**サブネット2つ、セキュリティグループ `typle-lab-app`、パブリック IP **オン**
   - ロードバランシング: 既存の ALB `typle-lab`、コンテナ `app 3000:3000`、既存のリスナー 80、既存のターゲットグループ `typle-lab-app`
3. 数分待ちます。**デプロイ**が完了し、ターゲットグループのターゲットが **healthy** になったら成功です。

```bash
curl -i http://<ALB の DNS 名>/api/health    # 200
```

このときは、まだ `AUTH_URL` の https のドメインがないので、ログインはできません（[7](07-domain.md) の後でできます）。

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| タスクがすぐ止まる、`CannotPullContainerError` | パブリック IP がオンか、イメージのアーキテクチャが ARM64 か |
| `ResourceInitializationError`（シークレット） | 実行ロールのインラインポリシーの ARN（末尾の `-*`）と、タスク定義で選んだ実行ロール |
| `ResourceInitializationError`（`CreateLogGroup` の `AccessDenied`） | 実行ロールのインラインポリシーに `logs:CreateLogGroup` があるか |
| ターゲットが unhealthy | `typle-lab-app` が `typle-lab-alb` からの 3000 を許しているか。ログの `/api/health` のエラー |
| `/api/health` が 503 | `typle-lab-db` が `typle-lab-app` からの 5432 を許しているか。`DATABASE_URL` の書き方 |

## 試験のために

- **Elastic Load Balancing の種類**:
  - **ALB**: HTTP・HTTPS、L7。パスやホスト名で振り分けられます。
  - **NLB**: TCP・UDP、L4。性能が高く、固定 IP を持てます。
  - **Gateway Load Balancer**: 仮想アプライアンスの前に置きます。
- **伸縮性**: ECS のサービスの Auto Scaling、EC2 の **Auto Scaling グループ**で、負荷に合わせて台数を変えます。「必要なときに必要な分だけ」がクラウドの利点です（**伸縮性**と**スケーラビリティ**の違いも出題されます）。
- **IAM のロール**: サービスに一時的な権限を渡す仕組みです。アクセスキーを埋め込まずに済みます。
- **Well-Architected フレームワークの6つの柱**: 運用上の優秀性、セキュリティ、信頼性、パフォーマンス効率、コスト最適化、持続可能性。
  サーキットブレーカー（失敗したら前のリビジョンに戻す）は信頼性の例です。
