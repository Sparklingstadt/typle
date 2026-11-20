# 8. 監視（CloudWatch と SNS）

[← 手順書の一覧](README.md)

ログを読めるようにし、問題が起きたらメールが届くようにします。

## 8-1. ログを読む

1. **CloudWatch** → **ロググループ** → `/ecs/typle-lab` を開きます。
2. ログストリーム `ecs/app/<タスク ID>` に、アプリが標準出力に書いたもの（Next.js の起動のメッセージ、エラー）が並んでいます。
3. **Logs Insights** で、ロググループに `/ecs/typle-lab` を選び、次のクエリーを実行してみます。

   ```
   fields @timestamp, @message
   | filter @message like /error|Error/
   | sort @timestamp desc
   | limit 50
   ```

ECS のコンソールでも、サービス `app` の**ログ**のタブから同じものが見られます。

## 8-2. 通知先を作る（SNS）

1. **Simple Notification Service** → **トピック** → **トピックの作成**を開きます。
2. タイプを**スタンダード**、名前を `typle-lab-alarms` にし、タグ `Project` = `typle-lab` を付けて作成します。
3. **サブスクリプションの作成**で、プロトコルを **E メール**、エンドポイントを自分のメールアドレスにします。
4. 届いたメールの **Confirm subscription** を押します。

## 8-3. アラームを作る

**CloudWatch** → **アラーム** → **アラームの作成**で、次の5つを作ります。
どれも、通知先は `typle-lab-alarms` です。名前は表のとおりにします。

| 名前 | メトリクス | 条件 |
|---|---|---|
| `typle-lab-5xx` | ApplicationELB → ロードバランサー別 → `HTTPCode_Target_5XX_Count`（`typle-lab`） | 合計が 5 分間で **5 以上** |
| `typle-lab-elb-5xx` | ApplicationELB → ロードバランサー別 → `HTTPCode_ELB_5XX_Count`（`typle-lab`） | 合計が 5 分間で **5 以上** |
| `typle-lab-unhealthy` | ApplicationELB → ターゲットグループ別 → `UnHealthyHostCount`（`typle-lab-app`） | 最大が 5 分間で **1 以上** |
| `typle-lab-db-cpu` | RDS → DB インスタンス別 → `CPUUtilization`（`typle-lab`） | 平均が 5 分間で **80% 以上** |
| `typle-lab-db-storage` | RDS → DB インスタンス別 → `FreeStorageSpace`（`typle-lab`） | 最小が **2 GB（2147483648 バイト）未満** |

- `typle-lab-5xx` はアプリが返したエラー、`typle-lab-elb-5xx` は ALB が自分で返したエラーです。後者は、正常なタスクが1つもないとき（ALB の 503）などに増えます。
- データがないときの扱いは、`typle-lab-5xx` と `typle-lab-elb-5xx` を「良好（しきい値を超えていない）」とみなし、ほかは既定のままにします。

### 試しに鳴らす

1. ECS のサービス `app` を**更新**し、必要なタスクを **0** にします。
2. タスクが止まったら、`curl -s -o /dev/null -w '%{http_code}\n' https://aws-lab.sparklingstadt.com/` を 10 回ほど実行します（ALB が 503 を返す）。数分で `typle-lab-elb-5xx` がアラーム状態になり、メールが届くことを確かめます。
   - ターゲットが1つもないと `UnHealthyHostCount` は 0 のままなので、`typle-lab-unhealthy` は鳴りません。こちらは、タスクは動いているが `/api/health` が失敗するとき（DB に届かないなど）に鳴ります。
3. 必要なタスクを **1** に戻します。

## 確かめること

- [ ] Logs Insights でアプリのログが検索できる
- [ ] 5つのアラームがあり、通知先が確認済みのメールになっている
- [ ] 試しに鳴らしたとき、メールが届いた

## 試験のために

- **CloudWatch と CloudTrail と Config**:
  - **CloudWatch**: 性能と運用の監視です（メトリクス・ログ・アラーム）。
  - **CloudTrail**: **だれが、いつ、どの API を呼んだか**の記録です（監査）。
  - **AWS Config**: リソースの**設定がどう変わったか**の記録と、ルールに合っているかの評価です。
- **セキュリティの監視のサービス**:
  - **GuardDuty**: ログから脅威を見つけます。
  - **Inspector**: EC2 とコンテナのイメージの脆弱性を調べます。ECR の「プッシュ時にスキャン」もこれです。
  - **Security Hub**: セキュリティの検出結果をまとめます。
  - **Macie**: S3 の個人情報を見つけます。
- **Trusted Advisor**: コスト・性能・セキュリティ・耐障害性・サービスの上限について、改善の提案を出します。すべての項目を使うには、ビジネス以上のサポートプランが要ります。
- **AWS Health Dashboard**: AWS 側の障害やメンテナンスが、自分のリソースに影響するかを知らせます。
- **通知の仕組み**: SNS はプッシュ型の通知（1対多、メール・SMS・HTTP）です。**SQS** はキュー（引き取り型、疎結合のため）です。
