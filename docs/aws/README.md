# AWS の練習環境の手順書

typle を AWS に移す前に、同じ構成を**AWS コンソールで1つずつ手で作って**理解するための手順書です（[設計](../superpowers/specs/2026-11-20-aws-migration-design.md)の「手順書（練習環境）」）。
本番は、ここで分かった構成を CDK（`infra/`、後の PR）で作り直します。練習環境は使い終わったら**消します**。

目的は AWS Certified Cloud Practitioner（CLF-C02）の学習です。各手順の終わりに、試験のどの分野に当たるかを書いています。

## 作るもの

```
利用者 ─HTTPS─▶ Route 53（aws-lab.sparklingstadt.com。Cloudflare から委任）
                 └▶ ALB（パブリックサブネット×2 AZ、ACM の証明書）
                      └▶ ECS Fargate のタスク×1（パブリックサブネット、ARM64、:3000）
                           ├─ Secrets Manager（DATABASE_URL・BETTER_AUTH_SECRET・AUTH_GITHUB_SECRET）
                           ├─ CloudWatch Logs
                           └▶ RDS for PostgreSQL 17（プライベートサブネット×2 AZ）
```

- リージョンは**東京（`ap-northeast-1`）**だけを使います。コンソールの右上が「東京」になっていることを、毎回確かめてください。
- 練習環境の名前は、どれも `typle-lab` で始めます。後で消すときに見つけやすくするためです。
- 作ったものには、すべてタグ `Project` = `typle-lab` を付けます（タグの欄がある画面では毎回）。
- メールは送りません（`RESEND_API_KEY` を設定しない）。DB は空から始めます。本番のデータ（Neon）は写しません。

## 順番

| # | 手順 | 主なサービス | 目安の時間 |
|---|---|---|---|
| 1 | [アカウントの準備](01-account.md) | IAM Identity Center、AWS Budgets | 30分 |
| 2 | [ネットワーク](02-network.md) | VPC、サブネット、セキュリティグループ | 30分 |
| 3 | [データベース](03-database.md) | RDS for PostgreSQL | 30分（作成待ちを含む） |
| 4 | [イメージ](04-image.md) | ECR | 20分 |
| 5 | [秘密の値](05-secrets.md) | Secrets Manager | 15分 |
| 6 | [アプリを動かす](06-app.md) | ECS（Fargate）、ALB、IAM ロール | 1時間 |
| 7 | [ドメインと HTTPS](07-domain.md) | Route 53、ACM | 40分 |
| 8 | [監視](08-monitoring.md) | CloudWatch、SNS | 30分 |
| 9 | [片付け](09-cleanup.md) | Cost Explorer | 30分 |

1 から順に進めてください。後の手順は、前の手順で作ったものの名前を使います。

片付けまで終えたら、[本番を CDK で作る](production.md)に進みます。

## 費用

練習環境を動かしているあいだは、**1日あたり約 2〜3 ドル**かかります（ALB・Fargate・RDS・パブリック IPv4 アドレス）。
NAT Gateway は作りません（1つで月 40 ドル以上かかるため）。数日で終わらせて、[片付け](09-cleanup.md)まで行ってください。
始める前に、[1](01-account.md) で予算の通知を必ず作ります。

## CLF-C02 との対応

試験は4つの分野からなります（カッコは出題の割合）。

| 分野 | この手順書で触れるところ |
|---|---|
| 1. クラウドの概念（24%） | リージョンとアベイラビリティーゾーン（2）、マネージドサービスの利点（3・6）、Well-Architected の考え方（各所） |
| 2. セキュリティとコンプライアンス（30%） | 責任共有モデル、root の保護と MFA、IAM Identity Center、最小権限（1・6）、セキュリティグループ（2）、保存時の暗号化（3）、Secrets Manager・KMS（5） |
| 3. クラウドのテクノロジーとサービス（34%） | VPC（2）、RDS（3）、ECR・ECS・Fargate（4・6）、ELB（6）、Route 53・ACM（7）、CloudWatch・SNS（8） |
| 4. 請求、料金、サポート（12%） | AWS Budgets（1）、料金のしくみ（各所の「費用」）、Cost Explorer・タグ（9） |

試験の範囲だが、この構成では使わないもの（CloudFront・WAF・Lambda・S3・DynamoDB など）は、各手順の「試験のために」で触れます。
