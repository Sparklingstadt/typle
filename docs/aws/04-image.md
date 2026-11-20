# 4. イメージ（ECR）

[← 手順書の一覧](README.md)

アプリのコンテナのイメージを、AWS のレジストリである ECR に置きます。ECS は、ここからイメージを取ってきてタスクを動かします。

## 4-1. リポジトリを作る

1. **Elastic Container Registry** → **プライベートレジストリ** → **リポジトリ** → **リポジトリを作成**を開きます。
2. 名前を `typle-lab`、イメージタグの変更可能性を**イミュータブル**（同じタグで上書きできない）にします。
3. タグ `Project` = `typle-lab` を付けて作成します。
4. 作ったリポジトリの**ライフサイクルポリシー** → **ルールを作成**で、「どのタグでも、イメージが **10 個**を超えたら古いものから期限切れにする」を足します（ストレージの料金を抑えるため）。
5. 画面の上の **URI**（`<アカウントID>.dkr.ecr.ap-northeast-1.amazonaws.com/typle-lab`）を控えます。

## 4-2. イメージを作って送る

Mac のリポジトリのルートで、Docker Desktop を起動してから実行します。

```bash
ACCOUNT=$(aws sts get-caller-identity --profile typle --query Account --output text)
REGISTRY=$ACCOUNT.dkr.ecr.ap-northeast-1.amazonaws.com
VERSION=$(node -p "require('./package.json').version")

# ECR にログイン（12 時間有効）
aws ecr get-login-password --profile typle --region ap-northeast-1 \
  | docker login --username AWS --password-stdin $REGISTRY

# ARM64（Graviton の Fargate）用に作る。練習環境の URL を埋め込む
docker build --platform linux/arm64 \
  --build-arg SITE_URL=https://aws-lab.sparklingstadt.com \
  -t $REGISTRY/typle-lab:v$VERSION-lab .

docker push $REGISTRY/typle-lab:v$VERSION-lab
```

- Apple Silicon の Mac なら、ARM64 のイメージは速く作れます。Intel の Mac ではエミュレーションになり、時間がかかります。
- `SITE_URL` は、`sitemap.xml` などに埋め込まれる URL です。練習環境の URL を入れたイメージは、本番には使えません。そのため、タグの末尾に `-lab` を付けて区別しています。
- イメージタグをイミュータブルにしたので、同じタグでもう一度 push すると断られます。作り直すときは、`-lab2` のようにタグを変えます。

## 確かめること

- [ ] リポジトリ `typle-lab` に `v<バージョン>-lab` のイメージがある
- [ ] イメージの詳細で、アーキテクチャ（プラットフォーム）が `arm64` / `linux/arm64` になっている

## 試験のために

- **コンテナのサービス**:
  - **ECR** は、イメージの置き場所（レジストリ）です。
  - **ECS** と **EKS**（Kubernetes）は、コンテナを動かす仕組み（オーケストレーション）です。
  - **Fargate** は、サーバーを持たずにコンテナを動かす実行環境です。ECS でも EKS でも使えます。
- **コンピューティングの選び方**:
  - 仮想サーバーなら **EC2**
  - サーバーを意識せずにイベントで短く動かすなら **Lambda**（最大 15 分）
  - コードを置くだけで環境まで任せるなら **Elastic Beanstalk**
  - 簡単な構成を定額で使うなら **Lightsail**
- **Graviton**: AWS が設計した ARM のプロセッサーです。同じ性能なら x86 より安く、消費電力も少なくて済みます（Well-Architected の**持続可能性**の柱の例）。
