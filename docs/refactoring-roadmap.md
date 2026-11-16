# リファクタリングのロードマップ

2026-11-06 に v2.36.0 のコードを棚卸しして、直す順番を決めたものです。1項目を1つの PR にし、機能の変更と混ぜません。終わった項目はこのファイルから消します。

## 終わったこと

段階 0〜2 は v2.36.1 から v2.36.14 で、#16 は v2.36.19 で終わりました。`/api/v1` と `typle-api` は使う人がいないので v2.36.20 で消しました。

- 検査: `staticcheck`・`knip`・単体テストのカバレッジ、`.claude` を除いた `npm run lint`、`cn` の import の規則を CI に入れました。
- 依存: 範囲内の依存を更新し、Prisma をなくしました。マイグレーションは `db/migrations` の SQL を `scripts/migrate.cjs` が適用します（事故の手順は `docs/release-workflow.md`）。
- 画面: 旧 `Page`／`PageContainer` を消し、200 行を超えていた画面を分けました。
- TS と Go: 上限値を `tests/fixtures` の共通の fixture で照合しています。
- CI: `verify` を Node・Go・E2E の並列ジョブに分けました。
- 文書: 実装済みの計画を `docs/superpowers/plans/archive` に移しました。

GraphQL（#11）は v2.43.0 で消しました。11/6〜11/13 の GraphQL を使う iPad・Mac 版は、もう読み書きできません。

## 残っていること

メジャーの依存の更新は、1つずつ別の PR にします。範囲内の依存の更新は月に1回、1つの PR にまとめます（最後は v2.43.2、2026-11-16）。`cn` 0.5 も v2.43.2 で上げました。残りは、次の理由で止めています。

| 依存 | 止めている理由 | 上げられるようになる条件 |
|---|---|---|
| ESLint 10 | `eslint-config-next` が同梱する `eslint-plugin-import`・`eslint-plugin-jsx-a11y`・`eslint-plugin-react` の peer が eslint 9 まで。lint は通るが、npm が peer を上書きしないと入らない | 3つのプラグイン（または `eslint-config-next`）が eslint 10 に対応する |
| TypeScript 7（`typescript` のまま） | パッケージが JavaScript の API（`ts.transpileModule`）を出さなくなった。typescript-eslint（8.72.2 で `typescript <6.1.0`）と、単体テストを読み込む `tests/register.cjs` がこの API を使う。v2.43.2 から、`typescript7`（`npm:typescript@^7`）を並べて入れ、`npm run typecheck` だけを TypeScript 7 の `tsc` で動かしている | typescript-eslint が TypeScript 7 に対応し、`tests/register.cjs` を別の読み込み方に変える。そのとき `typescript` を 7 に上げ、`typescript7` をやめる |
| `@types/node` 26 | 実行環境が Node.js 24（`package.json` の `engines`） | Node.js 26 に移る |

## 進め方の約束

- 1 PR に1項目。機能の変更と混ぜず、バージョンはパッチを上げます（`CLAUDE.md` の Release workflow）。
- リファクタリングの PR では `tests/e2e/` と `src/messages/` を変えません。変えたくなったら動作が変わった合図です。
- 新しいファイルは 200 行以下。処理は書き換えずに移し、見つけたバグは直さずにこのファイルか Issue に記録します。
- 見た目が変わるときは、そのことを PR のタイトルに書きます。
