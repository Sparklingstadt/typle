# 5. 秘密の値（Secrets Manager）

[← 手順書の一覧](README.md)

アプリに渡す秘密の値を Secrets Manager に置きます。
タスク定義（[6](06-app.md)）には値そのものではなくシークレットの ARN だけを書き、タスクの起動のときに ECS が値を取ってきます。
こうすると、秘密の値がタスク定義・イメージ・リポジトリのどこにも平文で残りません。

## 5-1. 値を作る

Mac で、アプリ用の DB ユーザーのパスワードと、ログインの鍵を作ります。

```bash
openssl rand -hex 24      # アプリ用の DB ユーザー（typle_app）のパスワード。英数字だけなので URL に入れても崩れない
openssl rand -base64 32   # AUTH_SECRET
```

出てきた値は、次の 5-2 で入れたら、ターミナルの画面を消して、どこにも保存しないでください。

GitHub のログインには、**練習環境用の OAuth App** を新しく作ります（本番の OAuth App は使いません）。

1. GitHub の **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App** を開きます。
2. 次のとおりに入れて登録します。
   - **Application name**: `typle-lab`
   - **Homepage URL**: `https://aws-lab.sparklingstadt.com`
   - **Authorization callback URL**: `https://aws-lab.sparklingstadt.com/api/auth/callback/github`
3. **Client ID** を控えます（これは秘密ではありません）。
4. **Generate a new client secret** で、Client secret を作ります。

## 5-2. シークレットを作る

**Secrets Manager** → **新しいシークレットを保存する**で、種類は**その他のシークレットのタイプ**を選び、**プレーンテキスト**のタブに値だけを入れます（JSON にしない）。
暗号化キーは既定の `aws/secretsmanager` のままにし、自動ローテーションは使いません。タグ `Project` = `typle-lab` を付けます。

| シークレットの名前 | 値 |
|---|---|
| `typle-lab/DATABASE_URL` | `postgresql://typle_app:<パスワード>@<RDS のエンドポイント>:5432/typle?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` |
| `typle-lab/APP_DB_PASSWORD` | 5-1 で作った `typle_app` のパスワード（[6](06-app.md) でユーザーを作るときだけ使う） |
| `typle-lab/AUTH_SECRET` | 5-1 で作った `AUTH_SECRET` |
| `typle-lab/AUTH_GITHUB_SECRET` | 練習用の OAuth App の Client secret |

それぞれの**シークレットの ARN** を控えます。

## 確かめること

- [ ] シークレットが4つあり、どれも名前が `typle-lab/` で始まる
- [ ] RDS が作ったマスターユーザーのシークレット（`rds!db-…`）も別にある（これは自分では変えない）

## 費用

1つのシークレットにつき月 0.40 ドルかかります（API の呼び出しは1万回ごとに 0.05 ドル）。この練習環境では、RDS のものと合わせて5つです。

## 試験のために

- **Secrets Manager と Systems Manager Parameter Store**:
  - どちらも設定や秘密の値を置けます。
  - Secrets Manager は有料で、RDS などのパスワードを自動でローテーションできます。
  - Parameter Store の標準パラメータは無料で、ローテーションの仕組みはありません。
- **KMS**: 暗号化の鍵を管理するサービスです。Secrets Manager も RDS も、保存するデータを KMS の鍵で暗号化します。専用のハードウェアで鍵を持つなら **CloudHSM** を使います。
- **責任共有モデル**: 秘密の値をどう管理するかは、利用者の責任です。
