# DB の読み書きを Prisma Client に戻す Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/server` と `sid-link` の `pg` の手書き SQL を Prisma Client 7.10.1 に置き換え、持ち主が `schema.prisma` と Prisma の呼び出しを読めば分かる形にする。

**Architecture:** `src/server/database.ts` が今の `pg` の Pool（タイムアウトの設定つき）を `@prisma/adapter-pg` に渡して `PrismaClient` を作る。各関数は `Pool` の代わりに `Db`（`PrismaClient`）か `Tx`（`Prisma.TransactionClient`）を受け取る。マイグレーションは今の `db/migrations` と `scripts/migrate.cjs` のままにし、`schema.prisma` とのずれは verify で `prisma migrate diff` が見つける。

**Tech Stack:** Prisma 7.10.1（`prisma-client` generator、`moduleFormat = "cjs"`）、`@prisma/adapter-pg`、`pg` 8、Next.js 16.4.6、Node.js 24、`node --test`（`tests/register.cjs` が TS を CJS に変換）

**Spec:** `docs/superpowers/specs/2026-11-25-prisma-client-design.md`

## Global Constraints

- `prisma`・`@prisma/client`・`@prisma/adapter-pg` は `7.10.1` に固定（`^` を付けない）。Prisma 8 は使わない。
- テーブル・列・`db/migrations` は変えない。`scripts/migrate.cjs` は `pg` のまま変えない。
- API の答え（状態コード・本文・キー）、保存されるデータ、409 とロックの扱いは今と同じ。今のテストの確かめている内容を減らさない。
- SQL を残すのは3か所だけ：`modifyWorkspace` の `FOR UPDATE`、`writeWorkspace` の `pg_advisory_xact_lock`、`revokeLogins` の upsert。それぞれに「なぜ Prisma でないか」を英語のコメントで書く。`checkHealth` の `SELECT 1` は例外として可。
- 対話型の `$transaction` は `timeout: 15_000`。`readSavedWorkspace` をトランザクションの外から呼ぶときは `isolationLevel: RepeatableRead` で包む。
- モデル名は単数の英語、列は `@map` で snake_case、テーブルは `@@map`。各モデルに1〜2行の英語の説明のコメント。
- 生成先は `src/generated/prisma`（`.gitignore`・ESLint・knip の対象外）。`prisma generate` は `postinstall` と `prebuild` で走らせる。
- コードのコメントと識別子は英語。`docs/`・README・CHANGELOG・コミット・PR は日本語。
- 本番の計測（`TYPLE_MEASURE_SAVES`）は速さの確認に使わない。
- PR のバージョンは、`git tag` と GitHub Releases で使われていない次の版（`npm version patch` の前に確かめる）。PR のタイトルは日本語の1文 + `(vX.Y.Z)`。

## Review Focus

1. **`Json?` 列の null**：`packs`・`interests` を送らない最初の保存では、DB に SQL の `NULL` が入る（JSON の `null` ではない）。読み出しは今と同じ `null`。→ Task 4 の `first save without packs or interests stores SQL NULL`。
2. **同じアカウントの最初の保存が2つ同時に来る**：片方は保存され、もう片方は `Conflict`。行は1つ。→ Task 4 の `two first saves at once: one saves, one conflicts`。
3. **記録の追加が2つ同時に来る**（`modifyWorkspace`）：行ロックで順に処理され、両方の記録が残り、revision は2つ上がる。→ Task 4 の `two record adds at once keep both records`。
4. **先頭の記録を消して後ろの `position` がずれる**：数が合い、読み出しの順は消す前と同じ（消したもの以外）。→ Task 3 の `deleting the first record renumbers the rest`。
5. **記録の多いアカウント**：5,000 件の保存が 5 秒を超えても打ち切られず、数が合う。→ Task 4 の `a save of 5000 records`。

---

### Task 1: 今のコードの保存の速さを測る（コミットしない）

**Files:**
- Create: `$TMPDIR/bench-save.cjs`（リポジトリの外。コミットしない）

**Interfaces:**
- Consumes: 今の `writeWorkspace(db: Pool, owner, revision, change)`、`modifyWorkspace(db: Pool, owner, change)`、`createPool(url)`。Task 4 のあとは同じ名前で `db` が `createPrisma(url)` になる。
- Produces: 3つの数（ms の中央値）：(a) 記録 5,000 件のリスト1つの最初の保存、(b) 同じワークスペースに `addRecord` で1件足す `modifyWorkspace`、(c) 先頭の記録を除いた lists の `writeWorkspace`。

- [ ] **Step 1: スクリプトを書く**

`require('<repo>/tests/register.cjs')` のあと `src/server/database.ts` と `src/server/workspace.ts` を読む。`database.createPrisma` があればそれ、なければ `createPool` で DB を開く（Task 4 のあとにも同じスクリプトで測るため）。記録は `src/lib/records.ts` の `addRecord` で作る。所有者は `bench:<random>`、終わったら `typle_records`・`typle_workspaces` の行を消す。各操作を5回測り、中央値を出す。

- [ ] **Step 2: 測る**

Run: `node $TMPDIR/bench-save.cjs`（`DATABASE_URL` は `.env.local`）
Expected: 3つの数が出る。数を作業メモに残す（Task 6 で比べる）。

---

### Task 2: Prisma を入れ、スキーマと接続を作る

**Files:**
- Create: `prisma/schema.prisma`、`prisma.config.ts`
- Modify: `package.json`（依存・`postinstall`・`prebuild`）、`.gitignore`（`/src/generated/`）、`eslint.config.mjs:20`（`src/generated/**`）、`knip.json`（`src/generated/**` を ignore、`prisma.config.ts` を入口に）、`.github/workflows/ci.yml:82`（キャッシュのキーに `prisma/schema.prisma`）、`scripts/verify.cjs`（`schema drift` の段）、`src/server/database.ts`、`next.config.mjs`（要るときだけ）
- Test: `tests/serverDatabase.test.cjs`

**Interfaces:**
- Produces（`src/server/database.ts`）:
  - `createPool(url: string, timeoutMs = 5_000): Pool`（今のまま）
  - `createPrisma(url: string, timeoutMs = 5_000): PrismaClient` — `new PrismaClient({ adapter: new PrismaPg(createPool(url, timeoutMs)) })`
  - `prisma(): PrismaClient` — 今の `pool()` の置き換え。`DATABASE_URL || POSTGRES_URL` から最初に使うときに開く。`pool()` は消す。
  - `ping(db: PrismaClient, timeoutMs = 5_000): Promise<void>` — `db.$queryRaw\`SELECT 1\`` と期限の競争。期限切れは `the database did not answer within ${timeoutMs} ms`。
  - `type Db = PrismaClient`、`type Tx = Prisma.TransactionClient`、`const TRANSACTION_TIMEOUT_MS = 15_000`
  - 生成物の import は `../generated/prisma/client`
- Produces（`prisma/schema.prisma`）: モデル `Workspace`（`typle_workspaces`）、`Record`（`typle_records`、`@@id([ownerId, listId, recordId])`）、`SessionRevocation`、`SaveMetric`、`User`、`EmailToken`、`AuthLimit`、`SidLink`。

- [ ] **Step 1: 依存を入れる**

Run: `npm install --save-exact @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 && npm install --save-exact --save-dev prisma@7.10.1`
Expected: `package.json` に `^` なしで3つが入る。`pg`・`@types/pg` は残す。

- [ ] **Step 2: `prisma.config.ts` と generator を書き、DB からスキーマを作る**

`prisma.config.ts` は v2.36.18 のもの（`git show 8a496849^:prisma.config.ts`）を元に、`migrations` の項を外す。generator は `provider = "prisma-client"`、`output = "../src/generated/prisma"`、`moduleFormat = "cjs"`。
Run: `npx prisma db pull`（手元の DB に `npm run db:migrate` を当ててから）
そのあと、モデル名・フィールド名を Interfaces のとおりに直し、各モデルに説明のコメントを付ける（以前の `schema.prisma` のコメントを使える）。
Expected: `npx prisma validate` が通る。`_prisma_migrations` のモデルはない。

- [ ] **Step 3: 生成をつなぐ**

`postinstall` と `prebuild` の先頭に `prisma generate && ` を足す。`.gitignore`・ESLint・knip・CI のキャッシュのキーを Files のとおりに直す。
Run: `npm run postinstall && npm run lint && npm run knip`
Expected: `src/generated/prisma/client.ts` ができ、lint と knip が通る。

- [ ] **Step 4: 失敗するテストを書く**

`tests/serverDatabase.test.cjs` に足す:

```js
test('createPrisma answers SELECT 1 on the test database', database, async () => {
  const db = createPrisma(url)
  await ping(db)
  await db.$disconnect()
})

test('ping of a database that is not there fails within the timeout', async () => {
  const db = createPrisma('postgres://user:pass@127.0.0.1:1/none')
  await assert.rejects(ping(db, 500))
  await db.$disconnect()
})
```

今の `ping` のテスト（応答しないサーバーで期限に落ちる、など）は `createPrisma` で同じことを確かめる形に直す。`sslmode=verify-full` のテストは `createPool` のままでよい。

- [ ] **Step 5: 落ちることを確かめる**

Run: `node --test --test-isolation=none tests/serverDatabase.test.cjs`
Expected: FAIL（`createPrisma is not a function`）

- [ ] **Step 6: `database.ts` を書く**

Interfaces のとおり。生成物を `tests/register.cjs` で読めないときは、まずここで直す（`moduleFormat`・`importFileExtension` など。register に手を入れるなら最小に）。

- [ ] **Step 7: 通ることを確かめる**

Run: `node --test --test-isolation=none tests/serverDatabase.test.cjs`
Expected: PASS

- [ ] **Step 8: スキーマのずれの検査を verify に足す**

`scripts/verify.cjs` の `db:migrate` のすぐあとに `schema drift` の段を足す。`npx prisma migrate diff`（移行を当てた DB → `prisma/schema.prisma`）を `--exit-code` で走らせ、差があれば落とす。Prisma 7.10.1 での正しいフラグ名は `npx prisma migrate diff --help` で確かめる。
Run: `node scripts/verify.cjs --fast` を途中まで（`schema drift` が通るところまで）
Expected: `schema drift` が通る。試しに `schema.prisma` の列を1つ消すと落ちる（確かめたら戻す）。

- [ ] **Step 9: Next.js のビルドで読めることを確かめる**

`node_modules/next/dist/docs/01-app/02-guides/package-bundling.md` と `serverExternalPackages.md` を読み、要るなら `next.config.mjs` に足す。
Run: `npm run build && TYPLE_STANDALONE=1 npm run build`
Expected: どちらも通る。

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json prisma prisma.config.ts .gitignore eslint.config.mjs knip.json .github/workflows/ci.yml scripts/verify.cjs src/server/database.ts tests/serverDatabase.test.cjs next.config.mjs
git commit -m "Prisma 7.10.1 のスキーマと接続を足し、スキーマと移行のずれを verify で確かめる"
```

---

### Task 3: 小さな読み書きと記録の同期を Prisma にする

**Files:**
- Modify: `src/server/account.ts`、`src/server/accountApi.ts`、`src/server/sidLinks.ts`、`src/server/metrics.ts`、`src/server/health.ts`、`src/server/records.ts`、`src/app/api/health/route.ts`、`src/app/api/account/signout-everywhere/route.ts`、`src/auth.ts:12,95`
- Test: `tests/serverAccount.test.cjs`、`tests/authRevocation.test.cjs`、`tests/sidLinks.test.cjs`（読み出しの部分）、`tests/apiHealth.test.cjs`、`tests/serverRecords.test.cjs`、`tests/apiUnavailable.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `Db`・`Tx`・`prisma()`・`ping()`・`createPrisma()`
- Produces:
  - `readRevokedAt(db: Tx, owner: string): Promise<Date | null>` — `sessionRevocation.findUnique`
  - `revokeLogins(db: Tx, owner: string): Promise<void>` — `$executeRaw`（SQL は今と同じ）
  - `revokedSoon(open: () => Db, ...)`、`signedIn(request, db: Db | null, ...)`、`answerSignOutEverywhere(request, open: () => Db, ...)` — 型だけ替える
  - `linkedAccount(db: Tx, sub: string): Promise<string | null>` — `sidLink.findUnique`
  - `measureSave(request, operation, open: () => Db, save, env)` — `$transaction([saveMetric.deleteMany({ where: { at: { lt: 90 日前 } } }), saveMetric.create(...)])`
  - `checkHealth(open: () => Db)`
  - `syncRecords(db: Tx, owner: string, rows: RecordRow[]): Promise<void>` — 下の手順
  - `RecordRow` は今のまま（`data: string`）

- [ ] **Step 1: 失敗するテストを書く**

既存のテストの `createPool` を `createPrisma` に替え、前準備・後始末の `db.query(...)` を Prisma の呼び出しに替える（例: `db.sessionRevocation.deleteMany({ where: { ownerId: { in: owners } } })`）。`apiUnavailable.test.cjs` の作り物の pool は、同じ考え方（通す呼び出しだけ答え、ほかは失敗）で作り物の Prisma Client にする。`tests/serverRecords.test.cjs` に足す:

```js
test('deleting the first record renumbers the rest', database, async () => {
  const owner = newOwner()
  await db.workspace.create({ data: { ownerId: owner, recordsSplit: true } })
  const rows = [0, 1, 2].map(i => row('list-a', `r${i}`, i))   // row(listId, recordId, position) は既存の作り方に合わせる
  await syncRecords(db, owner, rows)
  const rest = rows.slice(1).map((r, i) => ({ ...r, position: i }))
  await syncRecords(db, owner, rest)
  const saved = await db.record.findMany({ where: { ownerId: owner }, orderBy: [{ listId: 'asc' }, { position: 'asc' }] })
  assert.deepEqual(saved.map(r => [r.recordId, r.position]), [['r1', 0], ['r2', 1]])
})

test('a record whose data did not change is not rewritten', database, async () => {
  // 同じ rows で2回 syncRecords し、2回目のあとも行が同じ（count・data・position・at）
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npm test`
Expected: 上のファイルが FAIL（`db.query is not a function` など）。ほかは PASS。

- [ ] **Step 3: 各関数を Interfaces のとおりに書き換える**

`syncRecords` の手順:
1. `record.findMany({ where: { ownerId: owner } })` で今の行を読む。
2. 鍵 `listId + '\u0000' + recordId` で突き合わせる。`gone` = 今あって rows にない、`changed` = 両方にあり `position`・`at.getTime()`・`data` のどれかが違う、`added` = rows にだけある。`data` は `isDeepStrictEqual(saved.data, JSON.parse(row.data))`（`node:util`）で比べる（jsonb はキーの順を並べ替えるので、文字列では比べない）。
3. `gone ∪ changed` を `deleteMany({ where: { ownerId: owner, OR: [{ listId, recordId }, ...] } })` で1回で消す（空なら呼ばない）。
4. `added ∪ changed` を `createMany` で1回で入れる（`data: JSON.parse(row.data)`）。
5. `count({ where: { ownerId: owner } })` が `rows.length` と違えば今と同じ文言で throw。

`revokeLogins` の `$executeRaw` の上に、「前回より必ず後の時刻を1文で決めるため SQL のまま」と英語のコメント。`auth.ts` と2つのルートは `pool` を `prisma` に替える。

- [ ] **Step 4: 通ることを確かめる**

Run: `npm test && npm run typecheck`
Expected: PASS（`workspace.ts` の型の誤りは Task 4 で直すので、typecheck はこの時点で `workspace.ts` だけ落ちてよい）

- [ ] **Step 5: Commit**

```bash
git add src/server src/app/api src/auth.ts tests
git commit -m "ログアウトの記録・ID の紐づけ・計測・ヘルスチェック・記録の同期を Prisma Client で書く"
```

---

### Task 4: ワークスペースの読み書きを Prisma にする

**Files:**
- Modify: `src/server/workspace.ts:32-58,174-270,339,435`、`src/app/api/workspace/route.ts`、`src/app/api/workspace/records/route.ts`
- Test: `tests/serverWorkspaceRead.test.cjs`、`tests/serverWorkspaceWrite.test.cjs`、`tests/serverWorkspaceModify.test.cjs`、`tests/apiWorkspace.test.cjs`、`tests/apiRecords.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `Db`・`Tx`・`TRANSACTION_TIMEOUT_MS`、Task 3 の `syncRecords(db: Tx, ...)`
- Produces:
  - `readSavedWorkspace(db: Tx, owner: string): Promise<SavedWorkspace | null>` — `workspace.findUnique`、`recordsSplit` なら `record.findMany`（`orderBy: [{ listId: 'asc' }, { position: 'asc' }]`）。`SavedWorkspace` の型は今のまま。
  - `readWorkspace(db: Db, owner: string): Promise<SavedWorkspace | null>` — 新規。`db.$transaction(tx => readSavedWorkspace(tx, owner), { isolationLevel: 'RepeatableRead' })`。GET はこれを使う。
  - `writeWorkspace(db: Db, owner, revision, change): Promise<SavedWorkspace>`
  - `modifyWorkspace<T>(db: Db, owner, change): Promise<{ result: T, saved: SavedWorkspace | null }>`
  - `answerWorkspace(request, open: () => Db, ...)`、`answerRecords(request, open: () => Db, ...)`

- [ ] **Step 1: 失敗するテストを書く**

既存の4ファイルを Task 3 と同じく `createPrisma` に替える。`tests/serverWorkspaceWrite.test.cjs` に足す:

```js
test('first save without packs or interests stores SQL NULL', database, async () => {
  const owner = newOwner()
  await writeWorkspace(db, owner, 0, { lists: [], devices: [] })
  const [row] = await db.$queryRaw`SELECT packs IS NULL AS packs, interests IS NULL AS interests FROM typle_workspaces WHERE owner_id = ${owner}`
  assert.deepEqual(row, { packs: true, interests: true })
})

test('two first saves at once: one saves, one conflicts', database, async () => {
  const owner = newOwner()
  const results = await Promise.allSettled([0, 1].map(() => writeWorkspace(db, owner, 0, { lists: [], devices: [] })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.ok(results.find(r => r.status === 'rejected').reason instanceof Conflict)
})

test('a save of 5000 records', database, async () => {
  // 記録 5,000 件のリスト1つを revision 0 で保存し、readWorkspace の記録が 5,000 件、typle_records も 5,000 行
})
```

`packs` を送らない最初の保存が今の `json(undefined)` で `NULL` になることを、テストの前に今のコードで確かめておく（違えば仕様に合わせてテストを直す）。`tests/serverWorkspaceModify.test.cjs` に足す:

```js
test('two record adds at once keep both records', database, async () => {
  // 1つのリストを保存したあと、modifyWorkspace で別の記録を2つ同時に足す。
  // 両方 fulfilled、記録は2件、revision は保存直後 + 2
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npm test`
Expected: 上のファイルが FAIL、ほかは PASS。

- [ ] **Step 3: 書き換える**

- `writeWorkspace`：`db.$transaction(async tx => ..., { timeout: TRANSACTION_TIMEOUT_MS })`。
  - revision 0：上限の検査（今と同じ）→ `$executeRaw` の `pg_advisory_xact_lock`（SQL は今と同じ。「最初の保存どうしを待たせる。Prisma にロックの API がない」とコメント）→ `workspace.createMany({ data: [...], skipDuplicates: true })` の `count` が 0 なら `Conflict` → `record.deleteMany({ where: { ownerId } })`。
  - それ以外：`workspace.findUnique` で行を読み、なければ／revision が違えば `Conflict`。保存済みの数は `ownListCount` と `followedPackCount`（`src/lib/listOverview.ts`）に行の `lists`・`packs ?? []` を渡して数える。上限の検査（今と同じ）→ `workspace.updateMany({ where: { ownerId, revision }, data: { ..., revision: { increment: 1 }, updatedAt: new Date() } })` の `count` が 0 なら `Conflict`。送られていない部分は `undefined`（変えない）、`lists` を送ったときだけ `recordsSplit: true`。
  - `Json?` 列に null を入れるときは `Prisma.DbNull`。
  - そのあと今と同じく `syncRecords` と `readSavedWorkspace(tx, owner)`。
- `modifyWorkspace`：`$transaction`（`timeout` 同じ）の中で、`$queryRaw\`SELECT 1 FROM typle_workspaces WHERE owner_id = ${owner} FOR UPDATE\``（「行を押さえて、別の保存の revision の進みで変更を断らないため。Prisma に行ロックの API がない」とコメント）→ `workspace.findUnique` と（`recordsSplit` なら）`record.findMany` → 今と同じ処理 → `workspace.update`。
- `readSavedWorkspace` の doc コメントの「one statement」を、「トランザクションの中で読む。外からは `readWorkspace` を使う」に直す。
- `answerWorkspace` の GET と PUT の後の読み出しで、トランザクションの外からは `readWorkspace` を使う。
- 2つのルートの `pool` を `prisma` に替える。

- [ ] **Step 4: 通ることを確かめる**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS。`grep -rn "from 'pg'" src` が `src/server/database.ts` だけを出す。

- [ ] **Step 5: Commit**

```bash
git add src/server/workspace.ts src/app/api/workspace tests
git commit -m "ワークスペースの読み書きを Prisma Client で書く"
```

---

### Task 5: `sid-link` を Prisma で書く

**Files:**
- Create: `scripts/sid-link.ts`（`scripts/sid-link.cjs` を置き換え）
- Delete: `scripts/sid-link.cjs`
- Modify: `package.json`（`"sid:link": "node scripts/sid-link.ts"`）、`knip.json`（入口の名前）
- Test: `tests/sidLinks.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `createPrisma`、`Db`
- Produces: `parseSub(text: string): string | null`、`databaseLabel(url: string): string`、`linkSid(db: Db, sub: string, accountId: string): Promise<'linked' | 'subLinked' | 'accountLinked' | 'accountInvalid' | 'accountEmpty' | 'sidHasData'>`（答えと検査の順は今と同じ）。`require.main === module` のときだけ `main()`。

- [ ] **Step 1: テストを替える**

`tests/sidLinks.test.cjs` の `require('../scripts/sid-link.cjs')` を `.ts` に、`createPool` を `createPrisma` にし、前準備を Prisma の呼び出しにする。確かめる内容（6つの答え）は変えない。

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test --test-isolation=none tests/sidLinks.test.cjs`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `scripts/sid-link.ts` を書く**

`linkSid` は `db.$transaction(async tx => ...)`。`hasData` は `workspace.count` と `record.count`（または `findFirst`）。紐づけは `sidLink.create`。文言・終了コードは今と同じ。

- [ ] **Step 4: 通ることと、手で動くことを確かめる**

Run: `node --test --test-isolation=none tests/sidLinks.test.cjs && npm run sid:link -- abc not-an-account`
Expected: テストは PASS。スクリプトは `accountInvalid` の文言で終わる（Node 24 の型の取り除きで動かないなら、`node -r ./tests/register.cjs scripts/sid-link.ts` にする）。

- [ ] **Step 5: Commit**

```bash
git add scripts package.json knip.json tests/sidLinks.test.cjs
git commit -m "sid:link を TypeScript と Prisma Client で書く"
```

---

### Task 6: 速さを比べ、文書を直し、verify を通して PR を出す

**Files:**
- Modify: `README.md`（コードの構成）、`docs/production.md:21`、`docs/development.md:81`、`docs/refactoring-roadmap.md:10`、`CHANGELOG.md`、`package.json`・`package-lock.json`（版）
- Modify（要るときだけ）: `Dockerfile`（`npm ci` が `prisma generate` を走らせるので、生成物はビルドに含まれる。`migrate.cjs` は `pg` のままなので変えない）

- [ ] **Step 1: 速さを比べる**

Run: `node $TMPDIR/bench-save.cjs`
Expected: Task 1 の数と並べる。どれかが倍を超えたら、ここで止めて持ち主に数を見せて相談する。

- [ ] **Step 2: 文書を直す**

各文書の「Prisma は使わない／アプリは `pg`」を、「アプリの読み書きは Prisma Client（`prisma/schema.prisma`）、マイグレーションは今までどおり `db/migrations` の SQL を `scripts/migrate.cjs` が適用、ずれは verify が確かめる」に直す。CHANGELOG に新しい版の節を足す（Task 1 と Step 1 の数も書く）。

- [ ] **Step 3: 版を上げる**

Run: `git tag --list 'v2.6*' | sort -V | tail -3 && gh release list --limit 3`
そのうえで使われていない次の版に `npm version <版> --no-git-tag-version`。

- [ ] **Step 4: verify を全部通す**

Run: `npm run verify`（サンドボックスの外で。E2E の Chromium が要る）
Expected: すべての段が通る（`schema drift` を含む）。

- [ ] **Step 5: Commit と PR**

```bash
git add -A
git commit -m "Prisma に戻したことを文書と CHANGELOG に書き、版を上げる"
git push -u origin HEAD
gh pr create --title "DB の読み書きを Prisma Client に戻す (vX.Y.Z)" --body "..."
```

マージは持ち主の確認を取ってから（マージすると CI が本番に出す）。
