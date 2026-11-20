# 9. 片付け

[← 手順書の一覧](README.md)

練習環境を消します。消し忘れたものは、本番とは別に毎月料金がかかり続けます。
**作った順の逆**に消します。依存しているものが残っていると、消せないことがあるためです。

本番の CDK に進む前に、ここまで終わらせてください（[設計](../superpowers/specs/2026-11-20-aws-migration-design.md)の「作業の順序」の 2）。

## 9-1. 消す順番

| # | 消すもの | 場所と操作 |
|---|---|---|
| 1 | アラーム5つ、SNS のトピック `typle-lab-alarms` | CloudWatch → アラーム、SNS → トピック |
| 2 | サービス `app` | ECS → クラスター `typle-lab` → サービス → 削除（強制削除。タスクも止まる） |
| 3 | クラスター `typle-lab` | ECS → クラスター → 削除 |
| 4 | タスク定義 `typle-lab`・`typle-lab-dbuser` | ECS → タスク定義 → すべてのリビジョンを**登録解除**し、そのあと**削除** |
| 5 | ALB `typle-lab` | EC2 → ロードバランサー → 削除 |
| 6 | ターゲットグループ `typle-lab-app` | EC2 → ターゲットグループ → 削除 |
| 7 | Route 53 の A レコードと、ACM の検証用 CNAME | Route 53 → `aws-lab.sparklingstadt.com` → レコードを選んで削除（NS と SOA は残る） |
| 8 | ACM の証明書 | Certificate Manager → 削除（ALB を消したあとでないと消せない） |
| 9 | ホストゾーン `aws-lab.sparklingstadt.com` | Route 53 → ホストゾーン → 削除（月 0.50 ドル） |
| 10 | Cloudflare の NS レコード4つ（`aws-lab`） | Cloudflare → DNS → Records |
| 11 | RDS `typle-lab` | RDS → データベース → 削除。**最終スナップショットは作らない**、**自動バックアップを保持しない**にチェック |
| 12 | DB サブネットグループ `typle-lab-db` | RDS → サブネットグループ → 削除 |
| 13 | シークレット `typle-lab/` の4つ | Secrets Manager → 削除（下の CLI ですぐに消せる）。RDS のシークレットは、RDS を消すと一緒に消える |
| 14 | ECR のリポジトリ `typle-lab` | ECR → リポジトリ → 削除（中のイメージも消える） |
| 15 | ロググループ `/ecs/typle-lab` | CloudWatch → ロググループ → 削除 |
| 16 | VPC `typle-lab-vpc` | VPC → VPC → 削除（サブネット・ルートテーブル・インターネットゲートウェイ・セキュリティグループも一緒に消える） |
| 17 | ロール `typle-lab-task-execution` | IAM → ロール → 削除 |
| 18 | 練習用の GitHub OAuth App `typle-lab` | GitHub → Developer settings → OAuth Apps → Delete application |

シークレットは、画面から消すと最低7日の**削除の待機期間**に入ります。待たずにすぐ消すときは、CLI を使います。

```bash
for name in DATABASE_URL APP_DB_PASSWORD AUTH_SECRET AUTH_GITHUB_SECRET; do
  aws secretsmanager delete-secret --profile typle --secret-id typle-lab/$name --force-delete-without-recovery
done
```

VPC が消せないときは、まだ何かのネットワークインターフェイス（ENI）が残っています。
**EC2** → **ネットワークインターフェイス**で VPC が `typle-lab-vpc` のものを探し、何が使っているか（説明の欄）を見て、その元を消します。

## 9-2. 残っていないか確かめる

1. **Resource Groups & Tag Editor** → **タグエディタ**を開きます。リージョンを「すべてのリージョン」、リソースタイプを「すべてのサポートされているリソースタイプ」、タグを `Project` = `typle-lab` にして検索し、何も出ないことを確かめます。
2. **EC2** → **Elastic IP** と **VPC** → **NAT ゲートウェイ**が空であることを確かめます。
3. 1〜2 日後に、**Billing and Cost Management** → **Cost Explorer** で、日別・サービス別のコストを見ます。片付けた翌々日から、ALB・RDS・Fargate・VPC（パブリック IPv4）の費用が 0 になっていれば終わりです。

## 確かめること

- [ ] タグエディタで `Project` = `typle-lab` のリソースが出ない
- [ ] `dig +short NS aws-lab.sparklingstadt.com` が何も返さない
- [ ] 数日後の Cost Explorer で、練習環境の費用が止まっている

## 試験のために

- **料金のしくみ**: 料金は、使った分だけ払う**従量課金**です。安くする方法には次のものがあります。
  - **リザーブドインスタンス**と **Savings Plans**: 1年か3年の約束で安くなります。
  - **スポットインスタンス**: 空いている容量を最大 90% 引きで使えます（中断されることがある）。
  - **ボリュームディスカウント**: 使う量が多いほど単価が下がります。
- **コスト配分タグ**: タグを請求の画面で有効にすると、`Project` ごとの費用を Cost Explorer で分けて見られます。
- **AWS Organizations の一括請求**: 複数のアカウントの請求を1つにまとめ、使用量を合算して割引を受けられます。
- **TCO**: オンプレミスと比べるときは、サーバーの代金だけでなく、電気・場所・人の手間まで含めた総保有コストで比べます。
