# マイグレーションを Prisma Migrate に戻す（設計）

## なぜ

持ち主は AI の購読をやめるにあたり、自分で読み、公式の文書で調べられる仕組みに戻したい。v2.60.7 で DB の読み書きを
Prisma Client に戻した。マイグレーションも自作の `scripts/migrate.cjs`（`pg` で `db/migrations` の SQL を適用）から
`prisma migrate deploy` に戻す。

## 決めたこと

- `npm run db:migrate` は `node scripts/check-migrations.cjs && prisma migrate deploy`。
- **古いコードの検査を残す**（持ち主が決めた。案 A）。`scripts/check-migrations.cjs` は、DB に手元の最新より新しい適用済みの
  マイグレーションがあれば、何も適用せずに止める。`prisma migrate deploy` はこの場合も成功で終わるため（2026-11-25 に手元で確かめた）。
  2026-10-31 の事故（v0.99.4 を本番に出し、`0002_practice_devices` が本番 DB で失敗した）を防ぐ。
- **失敗の記録の検査は残さない**。`prisma migrate deploy` が `P3009` で止める。空でない DB に履歴がない場合（`P3005`）と、
  同時実行のロック（同じ advisory lock のキー）も Prisma が持つ。
- `prisma.config.ts` に `migrations: { path: 'db/migrations' }`、`db/migrations/migration_lock.toml` を置く。
- 既存の `_prisma_migrations` の履歴・チェックサム、手元にない 0001〜0026 の記録は、そのまま受け入れられる（手元で確かめた）。
- **トランザクション**: Prisma は1本をトランザクションで包まない。新しいマイグレーションは `BEGIN;` で始め `COMMIT;` で終える決まりにし、
  テストで検査する（0040 までは書き換えない。チェックサムが変わるため）。こう書くと、失敗しても DB は変わらず、失敗の行だけが残る。
  直し方は `prisma migrate resolve --rolled-back <名前>`（手元で確かめた）。ただし Prisma のログは `current transaction is aborted` だけになり、
  本当のエラーは残らない。`COMMIT;` を `ROLLBACK;` に替えて psql で流して見る手順を `docs/release-workflow.md` に書く。
- **TLS**: Prisma の CLI は libpq の `sslmode=verify-full`・`sslrootcert`（AWS の `DATABASE_URL`）を読まず、証明書を確かめずにつなぐ
  （手元で確かめた）。`prisma.config.ts` の `prismaUrl` が Prisma の `sslmode=require&sslcert=…&sslaccept=strict` に直す（作る人の判断）。
- `prisma migrate dev` は使えないまま（手元にない 0001〜0026 を不一致とみなす）。新しいマイグレーションは手で書くか、
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` で作り、`docs/development.md` に書く。
- **Docker イメージ**: 実行時のイメージに `/app/migrate`（`prisma`・`pg`・`@next/env` と、検査のスクリプト・`db/migrations`・
  `prisma/schema.prisma`・`prisma.config.ts`）を入れ、マイグレーションのタスクのコマンドを `npm run db:migrate` と同じ2段にする
  （`infra/lib/app.ts`）。

## 直すもの

`scripts/migrate.cjs`（消す）、`scripts/check-migrations.cjs`（新しい）、`package.json`、`prisma.config.ts`、`tests/migrate.test.cjs`、
`Dockerfile`、`infra/lib/app.ts` とそのテスト、`docs/release-workflow.md`（古いコードの検査、マイグレーションの失敗）、
`docs/development.md`、`docs/production.md`、`docs/aws/production.md`、AWS 移行の設計、README。

## 案

- A（採った）: 古いコードの検査を deploy の前の小さなスクリプトで残す。読むものは20行ほど増えるが、事故をコードで防ぐ。
- B: Prisma の標準だけにし、古いコミットを出さないことを文書の決まりで守る。持ち主は一度選んだが、A に変えた。
- 失敗の記録の検査も残す案は、Prisma が同じことをするので採らない。
