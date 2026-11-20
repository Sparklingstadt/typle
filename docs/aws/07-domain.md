# 7. ドメインと HTTPS（Route 53 と ACM）

[← 手順書の一覧](README.md)

`aws-lab.sparklingstadt.com` で、HTTPS でアプリを開けるようにします。

`sparklingstadt.com` は Cloudflare Registrar で取ったドメインで、ネームサーバーを Cloudflare から変えられません。
そこで、Cloudflare に NS レコードを足して、**サブドメイン `aws-lab.sparklingstadt.com` だけを Route 53 に任せます（委任）**。
本番の `typle.sparklingstadt.com` も、後で同じやり方で委任します。

## 7-1. Route 53 にホストゾーンを作る

1. **Route 53** → **ホストゾーン** → **ホストゾーンの作成**を開きます。
2. ドメイン名を `aws-lab.sparklingstadt.com`、タイプを**パブリックホストゾーン**にし、タグ `Project` = `typle-lab` を付けて作成します。
3. 自動でできた **NS** レコードの値（`ns-123.awsdns-45.com.` のような4つ）を控えます。

## 7-2. Cloudflare から委任する

1. Cloudflare のダッシュボードで `sparklingstadt.com` → **DNS** → **Records** を開きます。
2. 7-1 の4つの値それぞれについて、次の **NS** レコードを1つずつ足します（4つになります）。
   - Name: `aws-lab`
   - Content: Route 53 の NS の値（末尾の `.` はなくてよい）
   - TTL: Auto
3. 委任できたかを Mac で確かめます。

   ```bash
   dig +short NS aws-lab.sparklingstadt.com    # Route 53 の4つが出る
   ```

   出るまで、数分かかることがあります。

NS レコードには、Cloudflare のプロキシ（オレンジの雲）はありません。この名前への問い合わせは、そのまま Route 53 に回ります。

## 7-3. 証明書を作る（ACM）

1. リージョンが**東京**であることを確かめて、**Certificate Manager** → **証明書をリクエスト** → **パブリック証明書をリクエスト**を開きます。
2. 完全修飾ドメイン名を `aws-lab.sparklingstadt.com`、検証方法を **DNS 検証**にしてリクエストします。
3. 証明書の画面で **Route 53 でレコードを作成**を押します。検証用の CNAME が 7-1 のホストゾーンに入ります。
4. 数分で、状態が**発行済み**になります。

ALB で使う証明書は、ALB と同じリージョンに作ります（CloudFront で使うときだけは、バージニア北部に作ります）。
ACM の公開証明書は無料で、期限の前に自動で更新されます。

## 7-4. ALB を HTTPS にする

1. **EC2** → **ロードバランサー** → `typle-lab` → **リスナーとルール** → **リスナーの追加**を開きます。
2. 次のとおりにして足します。
   - プロトコルとポート: HTTPS:443
   - アクション: ターゲットグループ `typle-lab-app` に転送
   - 証明書: ACM の `aws-lab.sparklingstadt.com`
   - セキュリティポリシー: 既定（推奨）のもの
3. 元からある HTTP:80 のリスナーの**デフォルトアクション**を編集し、**URL にリダイレクト**（HTTPS、443、**301**）に変えます。

## 7-5. 名前を ALB に向ける

1. **Route 53** → `aws-lab.sparklingstadt.com` → **レコードを作成**を開きます。
2. 次のとおりにして作成します。
   - レコード名: 空（ゾーンの頂点）
   - タイプ: A
   - **エイリアス**: オン
   - トラフィックのルーティング先: Application Load Balancer、アジアパシフィック（東京）、`typle-lab`
   - ルーティングポリシー: シンプル

エイリアスレコードは、ALB の IP アドレスが変わっても自動で追いかけます。ゾーンの頂点（ここでは `aws-lab.sparklingstadt.com` そのもの）には CNAME を置けないので、エイリアスを使います。

## 7-6. 確かめる

```bash
curl -sI http://aws-lab.sparklingstadt.com/ | head -3          # 301 で https へ
curl -s  https://aws-lab.sparklingstadt.com/api/health          # 200 の JSON
curl -s  https://aws-lab.sparklingstadt.com/api/auth/providers  # github と password が並ぶ
```

ブラウザで `https://aws-lab.sparklingstadt.com` を開き、次のことを確かめます。

- [ ] 鍵のマークが出る（証明書が正しい）
- [ ] GitHub でログインできる（練習用の OAuth App）
- [ ] 単語リストを作って練習すると、記録が保存され、再読み込みしても残っている
- [ ] ID とパスワードでの登録は、確認のメールが届かないので最後まではできない（`RESEND_API_KEY` がないため。予定どおり）

## 試験のために

- **Route 53 のルーティングポリシー**:
  - **シンプル**: 1つの宛先に送ります。
  - **加重**: 割合で振り分けます。
  - **レイテンシー**: いちばん近いリージョンに送ります。
  - **フェイルオーバー**: 正常な方に送ります（ヘルスチェックと組み合わせる）。
  - **位置情報**: 利用者の場所で振り分けます。
  - **複数値回答**: 複数の値を返します。
- **Route 53 のそのほかの機能**: ドメインの登録とヘルスチェックもできます。名前の由来は、DNS のポート番号 53 です。
- **CloudFront**: エッジロケーションからコンテンツを配る CDN です。**AWS Shield Standard**（DDoS 対策）は無料で自動的に付き、**AWS WAF** で HTTP の攻撃を防げます。
- **ACM**: TLS 証明書を無料で発行し、自動で更新します。証明書を使えるのは ALB・CloudFront・API Gateway などで、EC2 に直接入れることはできません。
