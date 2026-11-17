# Go から TS への移行・段階6a（/api/workspace の読み込みと保存）Implementation Plan

> v2.50.0 で `src/core` は `src/lib` に（公式パックは `src/lib/packs`）、`src/lib` の React のフック（`use*`）は `src/hooks` に移りました。この文書のパスは書いた当時のものです。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET`・`HEAD`・`PUT /api/workspace`（ワークスペースの読み込みと、`revision` による保存）を Go から Route Handler に移す。

**Architecture:** Vercel の転送はパスで振り分け、メソッドでは分けられないので、同じパスの `GET` と `PUT` を1つの PR で移す（設計書の
6a・6b を 6a にまとめ、記録の `/api/workspace/records` を 6b とする）。保存データの検査と正規化は `src/core`
（`decodeDocument`・`followed`・`validateWorkspaceRequest`・`applyChange`・`withoutFollowedWords`）を使い、Go に合わせる部分
（設計書の「段階6の前に洗い出した違いと、持ち主の決定」）だけを `src/server` に書く。記録の表 `typle_records` の読み書きは、Go の
`server/internal/store/records.go` を写した `src/server/records.ts` に置く。正しさは、Go が本物の DB で作った保存の結果を fixture に
固定し、TS が同じ結果になることで確かめる。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（前の段階の計画：`docs/superpowers/plans/2026-11-16-go-to-ts-stage*.md`）

## Global Constraints

- 段階1〜5の Global Constraints はそのまま（API は変えない、本文末尾の `\n`、相対 import、`src/server` は画面から import しない、SQL はそのまま、
  識別子とコメントは英語・文書とコミットは日本語、途中のコミットに版を付けない）。
- 持ち主の決定（設計書）：保存済みのデータの任意項目の `null` は省略として読む（`src/core` を直す）。API の答えは Go に合わせる。
  ふつうは来ない入力の細部は `src/core` のまま。
- 答えの JSON：`{"lists","packs","devices","interests","revision","accountId"}` の順。`lists`・`packs`・`devices`・`interests` は DB の
  jsonb を読んだ値（知らない項目も含む）。`packs` が NULL なら `null`、`interests` が NULL なら `DEFAULT_INTERESTS`。行がなければ
  `lists: []`・`packs: null`・`devices: []`・`interests: DEFAULT_INTERESTS`・`revision: 0`。`records_split` の行は `typle_records` の記録を
  リストに戻す（Go の `withRecords`）。JSON としては Go と同じ値で、キーの順・数の書き方・`<>&` の書き方はバイト単位では揃えない
  （段階2の決定と同じ）。
- 読み込み：保存行は、アプリが読むのと同じ手順（`decodeDocument` → `followed`）と `decodeInterests` で検査し、読めなければ
  503 `databaseUnavailable`（報告は `workspace.read`）。答えは検査した値ではなく保存された値。
- `PUT` の確かめる順（Go の `saveRequest`・`saveWorkspace`）：設定がなければ 503 `authUnavailable` → `fromAppOrOrigin` と `jsonContent`
  （403 `forbiddenRequest`）→ ログイン → 本文（本文なしは 400 `emptyRequest`、1 MiB（1048576 バイト）を超えれば 413 `workspaceTooLarge`、
  オブジェクトでなければ 400 `invalidWorkspace`、読み取りの失敗は 503 `workspaceSaveFailed`）→ `accountId` が文字列でログインと同じでなければ
  401 `loginAccountChanged` → 本文の検査（`levelsConflict` は 400 `levelsConflict`、それ以外の誤りはすべて 400 `invalidWorkspace`）→ 保存
  （古い `revision` は 409 `conflict`、上限は 400 `listLimit`・`followLimit`、そのほかの失敗は 503 `workspaceSaveFailed`（報告は `workspace.write`））
  → 200 と、保存した後の読み込みと同じ答え。
- `PUT` の本文で Go に合わせること：`profileId`・`profiles` があれば、`packs` が `lists` なしで来れば、`lists`・`packs`・`devices` のどれかが
  `null` なら 400 `invalidWorkspace`。NUL・単独のサロゲートを含めば 400 `invalidWorkspace`。`interests: null` は「なし」（`[]`）。
  難易度が2〜5個のリストは、Go の `server/internal/workspace/packs_levels.go`・`packs_check.go` と同じ規則で1つにまとめる。`lists` も `devices`
  もなければ、`interests` だけの保存（`revision` は上がる）。
- 保存（Go の `WriteRevision`）：1つのトランザクションで、`revision` 0 は `pg_advisory_xact_lock(hashtext('typle_workspaces:' || owner))` を
  取ってから `INSERT … ON CONFLICT (owner_id) DO NOTHING`（行があれば 409）し、その持ち主の `typle_records` を消す。それ以外は保存済みの
  `revision` と、自分のリストの数・追いかけている公式パックの数を Go と同じ SQL で数え、`revision` が違えば 409、上限（自分のリスト150、
  追いかけているパック。数は `src/core` の定数）を超え、かつ保存済みより増えるなら `listLimit`・`followLimit`、`UPDATE … WHERE revision = $2`
  （送られなかった部分は `COALESCE` で残す、`lists` を送れば `records_split = true`）。`lists` を送ったら記録を `typle_records` に同期する
  （Go の `syncRecords`）。保存する `lists` は `withoutFollowedWords` を通し、記録を除いた形。`packs` を送ったら、`packs` にないパックの共有を
  消す（Go の `deleteRemovedShares`）。最後に読み込みと同じく読み直して答える。
- 記録の id：id のない記録と、同じリストの前の記録と同じ id の記録には `legacy-` + `sha256(listId + "\0" + position + "\0" + date + "\0" + time)`
  の hex の先頭20文字（Go の `legacyID`）。`time` は Go の `strconv.FormatFloat(time, 'g', -1, 64)` と同じ書き方（例：`1234567` は `1.234567e+06`）。
- 保存の計測：`TYPLE_MEASURE_SAVES=1` のとき、`PUT` ごとに `typle_save_metrics` に1行（`operation` は `workspace.write`、`status`、`duration_ms`、
  `request_bytes`、`response_bytes`）。同じ文で90日より古い行を消す。答えを待たせるのは最大2秒、失敗はログだけ。

## Review Focus

1. Go と TS が同じ保存の結果を作る：同じ行に同じ `PUT` をしたとき、DB の `lists`・`packs`・`devices`・`interests`・`revision`・`typle_records`
   が同じ値になる（公式パックを追いかけているパック、記録のある・id のない・同じ id の記録、難易度が複数のリスト、`interests` だけの保存）。
   → Task 5（Go で作った fixture）。
2. 409：同時に2つの保存が同じ `revision` から来たら、片方だけが通る。`revision` 0 の2つ目も 409。→ Task 5。
3. 記録を表に移した行（`records_split`）の読み込みで、リスト自身の記録が先、同じ id は表のもの。→ Task 3。
4. 共有の掃除：パックを消す保存で、そのパックの共有リンクが消え、ほかのパックの共有は残る。→ Task 5。
5. 他のサイト・取り消されたログイン・別のアカウントの画面からの保存（403・401 `loginRequired`・401 `loginAccountChanged`）。→ Task 6。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-workspace`（main から）。設計書の書き足し（段階6の前の違いと持ち主の決定）とこの計画をコミット：
  `git commit -m "段階6の前に洗い出した違いと決定を設計に書き、段階6aの計画を書く"`

### Task 1: 保存済みのデータの任意項目の null を、省略として読む（src/core）

**Files:** Modify `src/core/wordLists.ts`（`decodeLists`）、`src/core/wordPacks.ts`（`decodePacks`）。Test: `tests/wordLists.test.cjs`・`tests/wordPacks.test.cjs`（追記）。

- [ ] **Step 1:** 失敗するテスト：リストの `tags`・`category`・`group`・`levels`・`packId`、記録の `id`・`mistakes`・`accuracy`・`wordCount`・`device` が `null`
  の保存データを `decodeLists` すると、その項目のないデータと同じ結果になる。パックの `description`・`tags`・`origin.followed` が `null` の
  `decodePacks` も同じ。`validateList` など編集の時点の確認は今までどおり `null` を断る（既存のテストが通ったまま）。
- [ ] **Step 2:** FAIL → **Step 3:** `writing: null` と同じく、検査の前にこれらの項目の `null` を消す → **Step 4:** PASS・`npm test` →
  **Step 5:** コミット `git commit -m "保存データの任意項目が null なら、Go と同じく省略として読む"`

### Task 2: 記録の id と、表の行（src/server/records.ts）

**Files:** Create `src/server/records.ts`、`tests/fixtures/record-ids.json`。Test: `tests/serverRecords.test.cjs`。

**Interfaces（Produces）:**
- `goFloat(value: number): string` — Go の `strconv.FormatFloat(value, 'g', -1, 64)`。
- `legacyId(listId: string, position: number, record: { date: string, time: number }): string`
- `recordRows(lists: SavedWordList[]): { listId: string, recordId: string, position: number, at: Date, data: string }[]` — Go の `recordRows`。
  記録に id を付け（Global Constraints）、`at` は Go の `record.At`（`date` を読んだ時刻。Go の `server/internal/workspace/records.go` を見る）、
  `data` は記録の JSON。

- [ ] **Step 1: fixture を Go で作る。** 一時的な Go のテスト（コミットしない）で、いくつかの `time`（`0`・`1500`・`1234.5`・`999999`・`1234567`・
  `0.00001`・`1e21`）と `date` について `strconv.FormatFloat` と `legacyID` の結果を、また記録のあるリスト（id なし・同じ id・id あり）について
  `recordRows` の `recordID`・`position`・`at`・`data` を `tests/fixtures/record-ids.json` に保存する。
- [ ] **Step 2:** 失敗するテスト（fixture のすべてで一致）→ FAIL → **Step 3:** 実装 → PASS → **Step 4:** コミット
  `git commit -m "記録の id と表の行を、Go と同じ規則で TS に作る"`

### Task 3: ワークスペースを読む

**Files:** Create `src/server/workspace.ts`（読み込みまで）。Modify `src/server/records.ts`（`withRecords`）。Test: `tests/serverWorkspaceRead.test.cjs`。

**Interfaces（Produces）:**
- `withRecords(lists: unknown[], stored: Map<string, unknown[]>): unknown[]` — Go の `withRecords`。リスト自身の記録を先に、表の記録で同じ id のものは表を使う。
- `type SavedWorkspace = { lists: unknown, packs: unknown | null, devices: unknown, interests: unknown, revision: number }`
- `readSavedWorkspace(db: Pool | PoolClient, owner: string): Promise<SavedWorkspace | null>` — Go の `readSaved`（`recordsColumn` を同じ1文で読む）と
  `ReadRevision` の検査。読めなければ投げる。
- `workspaceAnswer(saved: SavedWorkspace | null, owner: string): object` — Global Constraints の答えの形。

- [ ] **Step 1:** 失敗するテスト（DB、ランダムな `github:<数字>` の持ち主、最後に行を消す）：行なし、`records_split` false の行（記録はリストの中）、
  `records_split` true の行（`typle_records` の行がリストに戻る。リスト自身の記録が先、同じ id は表のもの、保存されていないリストの表の行は出ない）、
  `packs` NULL、`interests` NULL（既定）、任意項目が `null` の行（読める）、壊れた行（投げる）。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS → **Step 4:** コミット `git commit -m "ワークスペースの保存行を、記録を戻して TS で読む"`

### Task 4: PUT の本文を、Go と同じ答えで読む

**Files:** Modify `src/server/workspace.ts`。Test: `tests/serverWorkspaceBody.test.cjs`。

**Interfaces（Produces）:**
- `readWorkspaceChange(fields: Record<string, unknown>, rawText: string): { revision: number, change: WorkspaceChange } | { refusal: 'invalidWorkspace' | 'levelsConflict' }`
  — Global Constraints の「PUT の本文で Go に合わせること」。中は `validateWorkspaceRequest` を使い、難易度のまとめ、`interests: null`、
  保存できない文字、エラーのキーのまとめを足す。

- [ ] **Step 1:** 失敗するテスト：`tests/fixtures/workspace-put.json` の受け付ける・断る本文がすべて Go と同じ答え。加えて、洗い出しで見つかった
  API の違い（`profileId`、`packs` だけ、`lists: null`、NUL・`\ud800`、`interests: null` が `[]`、難易度が3個のリスト（Go と同じ1つにまとめた結果。
  期待値は一時的な Go のテストで作る）、細かいエラーキーがすべて `invalidWorkspace`、`levelsConflict` はそのまま）。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS → **Step 4:** コミット `git commit -m "ワークスペースの保存の本文を、Go と同じ答えで読む"`

### Task 5: revision による保存

**Files:** Modify `src/server/workspace.ts`、`src/server/records.ts`（`syncRecords`・`forgetRecords`）。Create `tests/fixtures/workspace-writes.json`。
Test: `tests/serverWorkspaceWrite.test.cjs`。

**Interfaces（Produces）:**
- `writeWorkspace(db: Pool, owner: string, revision: number, change: WorkspaceChange): Promise<SavedWorkspace>` — Global Constraints の保存。
  409 は `Conflict` を投げる。上限は `listLimit`・`followLimit` の `AppError` を投げる。

- [ ] **Step 1: fixture を Go で作る。** 一時的な Go のテスト（コミットしない、`TYPLE_TEST_DATABASE_URL` を使う）で、いくつかの「保存前の行と
  `typle_records`」と「`PUT` の本文の列」について、Go の `decodeFields` → `WriteRevision` を順に流し、各回の答え（409・エラーのキーを含む）と、
  最後の行（`lists`・`packs`・`devices`・`interests`・`revision`・`records_split`）と `typle_records` の行（`list_id`・`record_id`・`position`・`at`・`data`）を
  `tests/fixtures/workspace-writes.json` に保存する。入れる場面：初めての保存（revision 0）、記録の増えたリストの保存、id のない記録、
  `records_split` false の古い行への最初の保存、公式パックを追いかけているパック、`interests` だけ・`devices` だけの保存、古い revision（409）、
  リストの上限を超える保存（`listLimit`）、パックを消す保存（共有の掃除。`typle_shared_packs` の行も入れて、残るものを記録する）。
- [ ] **Step 2:** 失敗するテスト：fixture のすべての場面を TS で流し、答えと最後の行・記録・共有が Go と（JSON の値として）同じ。加えて、同じ
  `revision` からの2つの保存を `Promise.all` で同時に流すと、片方だけ通り片方は 409。
- [ ] **Step 3:** FAIL → **Step 4:** 実装 → PASS。**違いが出たら**、設計書の持ち主の決定に当てはまらないものは ledger に書いて止まって聞く。
- [ ] **Step 5:** コミット `git commit -m "revision によるワークスペースの保存を TS で行う"`

### Task 6: /api/workspace の Route Handler と保存の計測

**Files:** Modify `src/server/workspace.ts`（`answerWorkspace`）。Create `src/server/metrics.ts`、`src/app/api/workspace/route.ts`。
Test: `tests/apiWorkspace.test.cjs`。

**Interfaces（Produces）:**
- `answerWorkspace(request: Request, open: () => Pool, settings?: () => LoginSettings | null): Promise<Response>` — `GET`（`HEAD` は route で本文なし）と `PUT`。
- `measureSave(request: Request, operation: string, answer: () => Promise<Response>, db: Pool, env?): Promise<Response>` — `TYPLE_MEASURE_SAVES=1` のときだけ計る。
- `route.ts`：`GET`・`HEAD`・`PUT`、ほかは 405 `Allow: GET, HEAD, PUT`。

- [ ] **Step 1:** 失敗するテスト（DB）：Global Constraints の確かめる順のすべての答え（403・401・400 `emptyRequest`・413・400 `invalidWorkspace`・
  401 `loginAccountChanged`・409・200）、取り消されたログインは 401 と Cookie の削除、アプリのトークンで `Origin` なしでも通る、計測が有効なら
  `typle_save_metrics` に1行（`status` と bytes が答えと一致）、無効なら書かない、405。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS・typecheck・lint → **Step 4:** コミット `git commit -m "/api/workspace を Route Handler で答える"`

### Task 7: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` から `/api/workspace` を消し（`/api/workspace/records` は残す）、`tests/backendPaths.test.cjs` の `nextRoutes`
  に足す（先に FAIL を見る）。
- Go を消す：`web/workspace.go` の `workspace`・`readWorkspace`・`writeWorkspace`・`saveWorkspace`・`decodeFields` など `/api/workspace` だけが使うもの
  と mux の登録、そのテスト。記録（段階6b まで Go）が使う `store.ReadRevision`・`Modify`・`saveRequest`・`answer`・`measured` などは残す。
  `gofmt -l .`（空）・`go vet ./...`・staticcheck・`go test ./...` が通るまで。
- README（`src/server` と Go の表）を直す。
- `npm run build` のあと、E2E を全部流す（`npm run test:e2e`、サンドボックスの外）。ワークスペースの読み込みと保存は、ほとんどの画面の E2E が通る。
- コミット `git commit -m "/api/workspace の転送をやめ、Go の該当する処理を消す"`

### Task 8: 版と PR

- [ ] `git tag` と `gh release list` で確かめて `npm version patch --no-git-tag-version`（v2.46.6）。`npm run verify` を最後まで通す。push して PR。
  タイトル `ワークスペースの読み込みと保存を Go から Next.js の Route Handler に移す (v2.46.6)`。リリース後に確かめること：本番でログインしたまま
  リストが出る、リストを編集して保存できる、別の端末（または iPad／Mac アプリ）で同じ変更が見える、2つのタブで同時に保存すると片方が
  読み直しになる（409）。
