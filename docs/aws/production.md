# 本番を CDK で作る

[← 手順書の一覧](README.md)

[練習環境](README.md)で手で作った構成を、`infra/` の CDK（TypeScript）で本番として作ります。
ここでは、**切り替えの前まで**を扱います。この手順を終えても利用者は今までどおり Vercel を使っていて、AWS の本番は「すぐ切り替えられる状態」で待ちます。
切り替えの当日の手順は、後の PR で書きます。

構成と理由は[設計](../superpowers/specs/2026-11-20-aws-migration-design.md)にあります。コードは `infra/lib/` を見てください。

## 始める前に

- [ ] 練習環境を[片付け](09-cleanup.md)まで終えている（費用が二重にかからないように）
- [ ] [1. アカウントの準備](01-account.md)が済んでいて、`aws sts get-caller-identity --profile typle` が通る
- [ ] Mac で Node.js 24・Docker Desktop・AWS CLI v2 が使える
- [ ] `cd infra && npm ci` が済んでいる

コマンドはどれも、リポジトリのルートか `infra/` で実行します（それぞれ書いてあります）。

## 1. CDK の準備（最初の1回だけ）

CDK がデプロイに使う置き場所（S3 バケット・ECR・IAM ロール）を、`CDKToolkit` というスタックで作ります。

```bash
cd infra
ACCOUNT=$(aws sts get-caller-identity --profile typle --query Account --output text)
npx cdk bootstrap aws://$ACCOUNT/ap-northeast-1 --profile typle
```

## 2. 今の DNS のレコードを調べる

Cloudflare の `sparklingstadt.com` の **DNS** → **Records** で、名前が `typle` か `<何か>.typle` のものをすべて書き出します。

- `typle`（Vercel への CNAME など）は、3 で Route 53 の頂点のレコード（Vercel の `76.76.21.21`）に置き換わります。
- `<何か>.typle` のレコード（Resend のメールの `send.typle` の SPF・DKIM・MX など）が**ある**ときは、委任すると Cloudflare 側のものが効かなくなります。
  - 4 の前に、Route 53 のゾーン `typle.sparklingstadt.com` に同じレコードを手で作ってください。
  - これらは CDK の管理の外です。スタックを更新しても消えません。
- `TYPLE_MAIL_FROM` のドメインが `sparklingstadt.com` そのものなら、メールのレコードは `typle` の下にないので、何もしなくて構いません。

## 3. ホストゾーンと ECR を作る（スタック `TypleBase`）

CDK のアプリには、スタックが2つあります。

| スタック | 中身 | deploy するとき |
|---|---|---|
| `TypleBase` | ホストゾーン、頂点の A レコード、ECR | 最初と、切り替えの当日だけ |
| `Typle` | VPC・RDS・ECS・ALB・秘密・監視 | 最初と、リリースのたび（`scripts/deploy-aws.cjs`） |

分けてあるので、リリースでドメインの向き先が変わることはありません。また、どのスタックを deploy しても、もう一方のリソースは消えません。
どちらのスタックも削除保護（termination protection）付きです。

まず `TypleBase` だけを作ります。CDK はアプリ全体を組み立てるので、`Typle` 用の値も要ります。ここではまだ使わないので、仮の値を渡します。

```bash
cd infra
npx cdk deploy TypleBase --exclusively --profile typle -c appTag=unused -c githubClientId=unused -c mailFrom=unused
```

できるもの:

- ホストゾーン `typle.sparklingstadt.com`
- 頂点の A レコード（Vercel の `76.76.21.21`、TTL 60 秒）
- ECR のリポジトリ `typle`

出力の `NameServers`（4つ）と `RepositoryUri` を控えます。

頂点のレコードが Vercel と AWS のどちらを向くかは、`infra/cdk.json` の `"dnsTarget": "vercel"` で決まります。
コミットされた値なので、だれがどこで deploy しても同じです。切り替えの当日の PR で `aws` に変えます。

## 4. Cloudflare から委任する

委任のあいだも Vercel の本番が見え続けることを、先に確かめます。

```bash
NS=$(aws cloudformation describe-stacks --profile typle --region ap-northeast-1 --stack-name TypleBase \
  --query "Stacks[0].Outputs[?OutputKey=='NameServers'].OutputValue" --output text | cut -d, -f1)
dig +short typle.sparklingstadt.com @$NS     # 76.76.21.21
```

Cloudflare で、次の2つを続けて行います（同じ名前に CNAME と NS は同時に置けないため）。

1. `typle` のレコード（Vercel への CNAME）を消す
2. `typle` の **NS** レコードを4つ足す（値は `NameServers` の4つ）

あいだが空くと、数秒だけ名前が引けない人が出るかもしれません。2つの操作は続けて行ってください。

確かめる:

```bash
dig +short NS typle.sparklingstadt.com     # Route 53 の4つ
dig +short typle.sparklingstadt.com        # 76.76.21.21
cd .. && npm run check:production          # Vercel の本番がそのまま通る
```

## 5. 最初のイメージを送る

```bash
# リポジトリのルートで
REPO=$(aws cloudformation describe-stacks --profile typle --region ap-northeast-1 --stack-name TypleBase \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text)
TAG=v$(node -p "require('./package.json').version")
aws ecr get-login-password --profile typle --region ap-northeast-1 | docker login --username AWS --password-stdin ${REPO%%/*}
docker build --platform linux/arm64 --build-arg SITE_URL=https://typle.sparklingstadt.com -t $REPO:$TAG .
docker push $REPO:$TAG
```

以後のリリースでは、`scripts/deploy-aws.cjs` がこれを行います。

## 6. デプロイの設定ファイルを作る

`infra/cdk.context.local.json` を作ります。git の管理外なので、コミットされません。

```json
{
  "githubClientId": "<本番の GitHub OAuth App の Client ID（Vercel の AUTH_GITHUB_ID と同じ）>",
  "mailFrom": "<Vercel の TYPLE_MAIL_FROM と同じ>",
  "alarmEmail": "<アラームを受け取るメールアドレス>"
}
```

7・9・11 のコマンドは、5 で作った `$TAG` と、7 で作る `$S`、9 で作る関数 `out`・`runtask` を使います。新しいターミナルを開いたときは、もう一度定義してください（ないと、CDK が値の不足でエラーにして止まります）。

## 7. 本番のリソースを作る（タスク 0 で）

最初の deploy は、サービスのタスクを **0** で作ります。
秘密の値と DB のユーザーがまだないので、アプリを起動しても `/api/health` が失敗します。そのままでは、サーキットブレーカーがスタックの作成を巻き戻してしまうためです。

```bash
cd infra
S=cdk.context.local.json
npx cdk deploy Typle --exclusively --profile typle -c appCount=0 -c appTag=$TAG \
  -c githubClientId="$(node -p "require('./$S').githubClientId")" \
  -c mailFrom="$(node -p "require('./$S').mailFrom")" \
  -c alarmEmail="$(node -p "require('./$S').alarmEmail")"
```

- RDS と証明書の検証で、20〜30 分ほどかかります。
- 証明書の検証は、4 の委任ができていないと終わりません。
- アラームの通知先のメールに **Confirm subscription** が届くので、押します。

## 8. 秘密の値を入れる

CDK が作ったシークレット `typle/…` には、仮のランダムな値が入っています。本物に入れ替えます。
値を画面にもシェルの履歴にも残さないように、次の関数を使います。

```bash
put() {
  printf '%s: ' "$1"; read -rs value; echo
  aws secretsmanager put-secret-value --profile typle --region ap-northeast-1 \
    --secret-id "typle/$1" --secret-string "$value" > /dev/null && echo "typle/$1 saved"
  unset value
}
```

| 名前 | 値 |
|---|---|
| `APP_DB_PASSWORD` | `openssl rand -hex 24` で作る（英数字だけ） |
| `DATABASE_URL` | `postgresql://typle_app:<APP_DB_PASSWORD>@<出力の DatabaseEndpoint>:5432/typle?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` |
| `BETTER_AUTH_SECRET` | **Vercel の本番と同じ値**（下を参照。v2.62.0 から。以前の `AUTH_SECRET` はもう読みません） |
| `AUTH_GITHUB_SECRET` | 本番の GitHub OAuth App で **Generate a new client secret** した新しい値（Vercel のものはそのまま使い続けられる） |
| `RESEND_API_KEY` | Resend のダッシュボードで AWS 用に新しく作ったキー |

`put APP_DB_PASSWORD` のように1つずつ実行し、値を貼り付けます。

**`BETTER_AUTH_SECRET` について**:

- ログインの Cookie と署名は `BETTER_AUTH_SECRET` で守られています。値が変わると、既存のセッションの Cookie が読めなくなり、切り替えた瞬間に全員がログアウトされます。
- Vercel で `vercel env pull` して読めれば、同じ値を入れます。
- 「Sensitive」にしてあって読めないときは、新しい値（`openssl rand -base64 32`）を作ります。この場合、切り替えのときに一度ログアウトされることを受け入れることになります。

## 9. アプリ用の DB ユーザーを作り、マイグレーションを流す

単発のタスクを動かして終了コードを返す関数を用意します。

```bash
out() { aws cloudformation describe-stacks --profile typle --region ap-northeast-1 --stack-name Typle \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
runtask() {
  local arn=$(aws ecs run-task --profile typle --region ap-northeast-1 --cluster typle --launch-type FARGATE \
    --task-definition "$(out "$1")" \
    --network-configuration "awsvpcConfiguration={subnets=[$(out TaskSubnetIds)],securityGroups=[$(out TaskSecurityGroupId)],assignPublicIp=ENABLED}" \
    --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --profile typle --region ap-northeast-1 --cluster typle --tasks "$arn"
  aws ecs describe-tasks --profile typle --region ap-northeast-1 --cluster typle --tasks "$arn" \
    --query 'tasks[0].containers[0].exitCode' --output text
}
```

```bash
runtask DbUserTaskDefinitionArn     # 0
runtask MigrateTaskDefinitionArn    # 0
```

0 でなければ、ログを見て直してから、同じコマンドをもう一度実行します。
`DbUserTaskDefinitionArn` は何度動かしても構いません（`APP_DB_PASSWORD` を変えたときも、これでパスワードが入れ替わります。そのときは `DATABASE_URL` も合わせて変え、11 の deploy でタスクを入れ替えます）。

```bash
aws logs tail /ecs/typle --profile typle --region ap-northeast-1 --since 30m
```

## 10. データの移行のリハーサル

切り替えの当日と同じ方法で、Neon のデータを RDS に写してみます。かかる時間を測っておきます。

1. `put NEON_DIRECT_URL` で、Neon の**直接の**接続文字列（pooler でないもの。Vercel の `DIRECT_URL` と同じ）を入れます。
2. 写します。

   ```bash
   time runtask DataMoveTaskDefinitionArn    # 0
   aws logs tail /ecs/typle --profile typle --region ap-northeast-1 --since 15m | grep -E 'source:|target:|row counts'
   ```

   ログの `source:` と `target:` が同じで、「The row counts match.」と出れば成功です。
   0 でないときは、行数が違うか、途中で失敗しています。

- リハーサルで写したデータは、そのまま残して構いません。当日にもう一度写すと、`pg_restore --clean` が前のものを消してから入れ直します。
- RDS には本番の利用者のデータが入るので、Neon と同じように扱ってください。

## 11. アプリを起動する（タスク 1 で）

```bash
cd infra
npx cdk deploy Typle --exclusively --profile typle -c appTag=$TAG \
  -c githubClientId="$(node -p "require('./$S').githubClientId")" \
  -c mailFrom="$(node -p "require('./$S').mailFrom")" \
  -c alarmEmail="$(node -p "require('./$S').alarmEmail")"
```

名前はまだ Vercel を向いているので、ALB の IP アドレスを指定して確かめます。

```bash
IP=$(dig +short "$(out LoadBalancerDnsName)" | head -1)
curl -s --resolve typle.sparklingstadt.com:443:$IP https://typle.sparklingstadt.com/api/health          # 200
curl -s --resolve typle.sparklingstadt.com:443:$IP https://typle.sparklingstadt.com/api/auth/providers  # github と password
```

ブラウザでも試すときは、`/etc/hosts` に `<IP> typle.sparklingstadt.com` を一時的に書きます。
GitHub でのログインと保存を確かめたら、**必ずその行を消します**（ALB の IP アドレスは変わることがあるため）。

## 12. 切り替えまでのリリース

切り替えの当日までは、**本番は Vercel のまま**です。リリースは今までどおり `vercel deploy --prod` で行います（[リリース運用](../release-workflow.md)）。

AWS 側も同じコミットに合わせておきたいときは、リリースのあとに次を実行します。

```bash
node scripts/deploy-aws.cjs --profile typle
```

マイグレーションは RDS に流れます。最後の `check:production` は、名前が Vercel を向いているあいだは Vercel を確かめます。

## 費用の目安

月 60〜70 ドルです（ALB 約 20、Fargate 約 15、RDS 約 20、パブリック IPv4 約 11、その他数ドル）。
タスク 0 のあいだも、ALB と RDS の分はかかります。

## 試験のために

- **Infrastructure as Code**: 構成をコードで書くと、同じものを何度でも作れて、変更をレビューできます。AWS の IaC は **CloudFormation**（JSON・YAML のテンプレート）です。CDK はプログラミング言語でそれを生成する道具です。
- **CloudFormation のスタック**: 作ったものをまとめて管理する単位です。更新に失敗すると、前の状態に**自動でロールバック**します。
- **DeletionPolicy**: スタックから外したときに、リソースを残す（Retain）か、スナップショットを取る（Snapshot）かを決めます。
- **ほかのデプロイの道具**:
  - **Elastic Beanstalk**: コードを渡すだけで、環境まで任せられます。
  - **CodePipeline・CodeBuild・CodeDeploy**: CI/CD の道具です。
  - **AWS Systems Manager**: 多くのサーバーをまとめて運用します。
