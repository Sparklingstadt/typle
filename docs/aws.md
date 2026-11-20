# AWS で動かす（ECS Fargate・RDS）

Typle を AWS でも動かせます。今は本番（Vercel・Neon）と並べて、別のドメイン（既定は `aws.typle.sparklingstadt.com`）で動かします。本番の DNS を AWS に向けるかは、動作を確かめてから決めます。

## 構成

| もの | AWS | 備考 |
|---|---|---|
| Web と API（Next.js） | ECS Fargate（ARM64、0.5 vCPU・1 GB、1台） | リポジトリの `Dockerfile`。`output: 'standalone'`（`TYPLE_STANDALONE=1` のときだけ）の `server.js` を動かします |
| HTTPS | Application Load Balancer と ACM の証明書 | HTTP は HTTPS へ転送します。ヘルスチェックは `/api/health`（DB が答えるときだけ 200） |
| DB | RDS for PostgreSQL 17（db.t4g.micro、20 GB、1 AZ） | 暗号化あり、バックアップ7日、削除保護あり。TLS の証明書を確かめてつなぎます（`sslmode=verify-full`） |
| 秘密の値 | Secrets Manager | `typle/database`（RDS が作る）、`typle/app`（`AUTH_SECRET` は自動で作る。GitHub と Resend は後で入れる） |
| ログ | CloudWatch Logs | `/typle/web`（1か月） |

- 構成は CDK（TypeScript）で `infra/aws` にあります。`cdk deploy` が `Dockerfile` からイメージを作って ECR に送り、ECS を更新します。
- NAT ゲートウェイは使いません（月 $30 以上かかるため）。タスクは公開サブネットに置いて公開 IP を持ちますが、セキュリティグループでロードバランサーからしか入れません。DB は外とつながらないサブネットに置き、タスクと DB 用の作業タスクからしか入れません。
- マイグレーションは、コンテナが起動するときに `scripts/migrate.cjs` で当てます（`scripts/docker-entrypoint.sh`）。Vercel でビルドの前に `npm run db:migrate` を走らせるのと同じです。ロックを取るので、タスクが同時に起動しても順番に待ちます。
- リージョンの既定は東京（`ap-northeast-1`）です。
- 料金のめやす（東京、1台、2026年11月の単価から）: ALB 約 $20、Fargate 約 $15、RDS 約 $15、ほか（Secrets Manager・ログ・公開 IPv4）約 $10 で、月 $60 前後です。

## 用意するもの

- AWS のアカウントと、管理者に近い権限の認証情報（`aws configure` または `aws sso login`）
- Node.js 24、Docker（Docker Desktop）
- ECS Exec を使うときは Session Manager plugin（`brew install --cask session-manager-plugin`）
- GitHub でログインするなら、AWS 用の OAuth App（下の「GitHub のログイン」）

## 初めてのデプロイ

```sh
cd infra/aws
npm ci
npx cdk bootstrap        # アカウントとリージョンごとに1回だけ
npx cdk deploy
```

- ドメインを変えるときは `-c domainName=...` を付けます。メールの差出人は `-c mailFrom="Typle <no-reply@example.com>"` です。
- `sparklingstadt.com` を Route 53 で管理しているなら、`-c hostedZoneName=sparklingstadt.com` を付けると、証明書の確認とドメインの向き先を自動で作ります。
- Route 53 でないとき:
  1. `cdk deploy` は ACM の証明書の確認で止まります。AWS のコンソールの Certificate Manager で、確認用の CNAME（名前と値）を見て、DNS に足します。数分で確認が終わり、デプロイが続きます。
  2. デプロイが終わったら、出力の `LoadBalancerDnsName` に向けて、`aws.typle.sparklingstadt.com` の CNAME を DNS に足します。
- 最初のデプロイでは、DB が空のままタスクが起動し、マイグレーションで表を作ります。データは次の「Neon からデータを移す」で入れます。

## 秘密の値を入れる

`typle/app` には、`AUTH_SECRET` だけが入っています。GitHub と Resend を使うときは、ほかの値も入れます。

```sh
aws secretsmanager get-secret-value --secret-id typle/app --query SecretString --output text > /tmp/typle-app.json
# /tmp/typle-app.json の AUTH_GITHUB_ID・AUTH_GITHUB_SECRET・RESEND_API_KEY を書き換える
aws secretsmanager put-secret-value --secret-id typle/app --secret-string file:///tmp/typle-app.json
rm /tmp/typle-app.json
aws ecs update-service --cluster typle --service typle-web --force-new-deployment
```

タスクは起動するときに秘密の値を読むので、変えたら `--force-new-deployment` で入れ替えます。

### GitHub のログイン

GitHub の OAuth App は、コールバック URL を1つしか持てません。本番とは別の OAuth App を作ります。

- Homepage URL: `https://aws.typle.sparklingstadt.com`
- Authorization callback URL: `https://aws.typle.sparklingstadt.com/api/auth/callback/github`

## Neon からデータを移す

DB は外から入れないので、VPC の中で作業用のタスク（`typle-db-tool`、`postgres:17-alpine`）を起動し、ECS Exec で入って `pg_dump` と `psql` を使います。値は `cdk deploy` の出力を使います。

```sh
aws ecs run-task --cluster typle --task-definition typle-db-tool --launch-type FARGATE --enable-execute-command \
  --network-configuration "awsvpcConfiguration={subnets=[<PublicSubnets の1つ>],securityGroups=[<DbToolSecurityGroupId>],assignPublicIp=ENABLED}"
aws ecs execute-command --cluster typle --task <タスクの ID> --container psql --interactive --command sh
```

タスクの中では、RDS への接続（`PGHOST` など）がすでに入っています。

1. 先に Web のタスクを止めて、移すあいだに書き込まれないようにします（`aws ecs update-service --cluster typle --service typle-web --desired-count 0`）。
2. RDS の表を空にします。最初のデプロイのマイグレーションで作った表があるので、スキーマを作り直します。
   ```sh
   psql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   ```
3. Neon から写します。`<NEON の URL>` は Neon の直接の接続（プーラーでないもの）です。シェルの履歴に残らないよう、この場で入力します。
   ```sh
   read -rs NEON_URL
   pg_dump --no-owner --no-acl "$NEON_URL" | psql -v ON_ERROR_STOP=1
   ```
4. 行の数を比べて確かめます（例: `psql -c 'select count(*) from users'` と `psql "$NEON_URL" -c ...`）。
5. `exit` で抜けて、作業用のタスクを止め（`aws ecs stop-task --cluster typle --task <ID>`）、Web のタスクを1台に戻します（`--desired-count 1`）。

本番を AWS に移すまでは、本番は Neon に書き込み続けます。並べて動かしているあいだの AWS のデータは確認用で、切り替えるときにもう一度写します。

## 新しい版を出す

`docs/release-workflow.md` の手順（PR → マージ → verify → GitHub Release → Vercel）の後に、同じコミットで次を実行します。

```sh
cd infra/aws
npm ci
npx cdk deploy
curl -fsS https://aws.typle.sparklingstadt.com/api/health
```

新しいタスクが `/api/health` に 200 を返すまで、古いタスクが答え続けます。返さなければ、ECS が前の版に戻します（circuit breaker）。

## 本番を AWS に移すとき（まだしない）

1. Web のタスクを止めて、Neon から RDS にもう一度写す（上の手順）
2. `-c domainName=typle.sparklingstadt.com` で `cdk deploy` し、証明書を確かめる
3. GitHub の OAuth App のコールバックを本番のドメインに変える（または本番の OAuth App の値を `typle/app` に入れる）
4. `typle.sparklingstadt.com` の DNS を ALB に向ける
5. `npm run check:production` で確かめ、Vercel と Neon をやめる

## 片付け

`npx cdk destroy` で消せます。RDS は削除保護があるので、先にコンソールか CLI で外します（`aws rds modify-db-instance --db-instance-identifier <ID> --no-deletion-protection`）。消すときは最後のスナップショットを残します。
