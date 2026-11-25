# DB の読み書きを Prisma Client に戻す（設計）

## 目的

v2.36.19（2026-11-06）で、SQL を学ぶために Prisma を外し、アプリの DB の読み書きを `pg` の手書き SQL にした。
ただ、持ち主は実際にはその SQL を読んでおらず、書いたのは AI だった。AI の購読をやめるにあたり、
持ち主が自分で読んで直せる形に戻す。**読みやすさがいちばんの基準**で、速さや SQL の巧みさはその次。

## ゴール

- `src/server` と `scripts/sid-link.cjs` の DB の読み書きを、Prisma Client（`prisma.<model>.findUnique` など）で書く。
- テーブルの形は `prisma/schema.prisma` を読めば分かる。
- Prisma で書けない箇所だけ短い `$queryRaw`／`$executeRaw` に残し、なぜ SQL なのかをコメントで書く。
- API の答え、保存されるデータ、同時保存の扱い（409・ロック）は今と同じ。今のテスト（Go の時代の fixture を含む）が通る。

## ゴールではないもの

- マイグレーションの仕組みを変えること。`db/migrations` の SQL を `scripts/migrate.cjs` が適用する形はそのまま
  （古いコードで本番 DB に流すのを止める検査、失敗の記録の検査、AWS 移行の設計が前提にしているため）。
- テーブルや列を変えること。
- Prisma 8（今は RC）。

## 失敗とみなすもの

- 読み書きの意味が変わる：保存の取りこぼし、409 にすべき保存が上書きになる、記録の数が合わない。
- 本番のマイグレーションの手順（`docs/release-workflow.md`）が変わる。
- `prisma generate` を忘れるとビルドや CI が分かりにくい形で落ちる。

## 決まっていること

- **版**：`prisma`・`@prisma/client`・`@prisma/adapter-pg` を 7.10.1 に固定する。
- **接続**：Prisma 7 は driver adapter で `pg` を使う。今の `createPool` の設定（`max: 5`、接続と問い合わせの
  タイムアウト 5 秒、keep-alive、`error` を記録するだけ）を `PrismaPg` に渡し、`DATABASE_URL`（または `POSTGRES_URL`）
  から開く。RDS の `sslmode=verify-full`・`sslrootcert` もそのまま効くこと。
- **スキーマ**：今の DB から `prisma db pull` で作り、以前の `schema.prisma` と同じく、モデル名は単数の英語
  （`Workspace`・`Record`・`SessionRevocation`・`SaveMetric`・`User`・`EmailToken`・`AuthLimit`・`SidLink`）、
  列は `@map` で snake_case、テーブルは `@@map`。各モデルに1〜2行の説明のコメントを付ける。
- **スキーマと移行のずれの検査**：`prisma migrate diff`（`db/migrations` を当てた DB と `schema.prisma` の差）を
  verify に足し、差があれば落とす。
- **Prisma Client で書く箇所**
  - `readRevokedAt`・`linkedAccount`：`findUnique`。
  - `measureSave`：90 日より古い行の `deleteMany` と `create`。
  - `readSavedWorkspace`：`workspace.findUnique` と、`recordsSplit` のときだけ `record.findMany`（`listId`・`position` の順）。
    `jsonb` は Prisma の `Json` として受け取り、`JSON.parse` はなくなる。今は1文で読むので行と記録が同じ時点のものになる。
    2回に分けても同じ時点になるよう、トランザクションの外から呼ぶとき（GET）は RepeatableRead の `$transaction` で包む
    （*作る人の判断*：答えを変えないことを、GET の往復が1〜2回増えることより優先した）。
  - `writeWorkspace`：`$transaction` の中で行う。revision 0 は `create`、主キーの重複（`P2002`）を `Conflict` にする。
    それ以外は、行を読んで自分のリストと購読パックを TypeScript で数え（今は `jsonb` の SQL で数えている）、
    `updateMany({ where: { ownerId, revision } })` の件数が 0 なら `Conflict`。
  - `modifyWorkspace`：`$transaction` の中で行う。
  - `syncRecords`：今ある記録を読み、TypeScript で差を取る。消えたものと変わったものを1回の `deleteMany` で消し、
    新しいものと変わったものを1回の `createMany` で入れる。最後に `count` で数を確かめる（今と同じ）。
    （*作る人の判断*：変わったものを1件ずつ `update` すると、前の記録を1つ消しただけで後ろの記録の `position` が
    すべて変わり、数百〜数千回の問い合わせになる。消して入れ直せば、記録の数によらず問い合わせは4回で済む。）
  - トランザクション：Prisma の `$transaction` は既定で 5 秒で打ち切る。今はトランザクション全体の制限がないので、
    `timeout` を 15 秒にする（*作る人の判断*）。
  - `checkHealth`：`$queryRaw\`SELECT 1\``（Prisma に「つながるか」だけを見る API がないため）。
  - `scripts/sid-link.cjs`：Prisma Client で書く。生成物は TypeScript なので、スクリプトも `scripts/sid-link.ts` にし、
    Node 24 の型の取り除き（`node scripts/sid-link.ts`）で動かす。`npm run sid:link` の使い方は変えない
    （*作る人の判断*。動かなければ `tests/register.cjs` と同じ読み込みを使う）。
- **SQL のまま残す箇所**（それぞれ数行、理由をコメントで書く）
  - `modifyWorkspace` の行のロック：`SELECT ... FOR UPDATE`。Prisma に行ロックの API がない。
  - `writeWorkspace` の最初の保存どうしを待たせる `pg_advisory_xact_lock`。
  - `revokeLogins`：`GREATEST(clock_timestamp(), 前回 + 1 秒)` の upsert。前回より必ず後になることを1文で守るため。
- **受け渡し**：関数は今 `Pool` を受け取っている。これを `PrismaClient`（トランザクションの中では
  `Prisma.TransactionClient`）に替える。ルートが渡す `pool` は `prisma`（最初に使うときに開く）に替える。
  テストは今と同じく実際の DB に対して動かし、`createPool` の代わりに Prisma Client を作る。
- **生成**：`prisma generate` を `postinstall` と `prebuild` に戻す。生成先は `src/generated/prisma`（git に入れない）。
  CI のキャッシュのキーにスキーマを足す。knip・ESLint は生成先を見ない。
- **文書**：README の「コードの構成」、`docs/production.md`、`docs/development.md`、CHANGELOG、
  `docs/refactoring-roadmap.md` の Prisma の記述を、今の形に直す。

## 検討した進め方

| 案 | 中身 | 得失 | 結果 |
|---|---|---|---|
| A | ほぼ Prisma Client。ロック2つと時刻の upsert だけ SQL。マイグレーションは `migrate.cjs` のまま | 読むのは `schema.prisma` と Prisma の呼び出しだけ。記録の多いアカウントでは保存の問い合わせが増える | **採用**（持ち主が選んだ） |
| B | A に加え、マイグレーションも `prisma migrate deploy` に戻す | 古いコードの検査と失敗の検査がなくなり、AWS 移行の設計も直す必要がある | 不採用 |
| C | A と同じだが、記録の同期だけ今の一括 SQL を残す | 速さは今と同じだが、いちばん複雑な箇所が SQL のまま | 不採用（目的に合わない） |

TypedSQL（`.sql` ファイルに型を付ける Prisma の機能）は、SQL を読む量が減らないので外した。

## 作る人に任せること

- 関数の分け方とファイルの置き場所（`src/server/database.ts` に `prisma()` を置くなど）。
- `Json` 型と既存の型（`WorkspaceDocument` など）のつなぎ方。
- テストの書き換え方。ただし今のテストの「何を確かめているか」は減らさない。
- 速さの確認：PR の前に手元で、記録 5,000 件のアカウントの保存（記録を1つ足す、先頭の記録を1つ消す）を今のコードと
  比べる。マージすると本番に出るので、本番の計測（`TYPLE_MEASURE_SAVES`）は確認に使わない。今の倍を超えたら、
  PR を出す前に持ち主に相談する（*作る人の判断*：5,000 件は、記録の多いアカウントを大きめに見積もった数）。

## 心配なこと

- **テストの読み込み**：単体テストは `tests/register.cjs` が TS を CommonJS に変換して読む。Prisma 7 の生成物が
  ESM 前提（`import.meta` など）だと読めない。generator の `moduleFormat = "cjs"` で足りるかを最初に確かめる。
- **Next.js 16.4**：Route Handler とビルドで Prisma Client が読めること（`serverExternalPackages` が要るか）を、
  `node_modules/next/dist/docs/` で確かめる。
- **AWS のイメージ**：Docker イメージのビルドで `prisma generate` が走ること。
