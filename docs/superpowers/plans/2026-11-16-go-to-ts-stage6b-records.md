# Go から TS への移行・段階6b（/api/workspace/records）Implementation Plan

> v2.50.0 で `src/core` は `src/lib` に（公式パックは `src/lib/packs`）、`src/lib` の React のフック（`use*`）は `src/hooks` に移りました。この文書のパスは書いた当時のものです。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 練習の記録の追加と削除（`POST`・`DELETE /api/workspace/records`）を Go から Route Handler に移し、ワークスペースをすべて TS で扱う。

**Architecture:** 記録の追加・削除の規則は `src/core/records.ts` の `addRecord`・`deleteRecord`（Go の `workspace.AddRecord`・`DeleteRecord` と共通の
fixture で揃っている）を使う。Go の `store.Modify`（行を `FOR UPDATE` で握り、変更し、行全体を正規化して書き直し、記録を差分で同期し、
共有を掃除する）を、段階6aの `src/server/workspace.ts`・`records.ts` の部品で `modifyWorkspace` として写す。正しさは、段階6aと同じく
Go を本物の DB で動かした結果を fixture に固定して確かめる。

**Tech Stack:** Next.js 16.4.6 Route Handler、`pg` 8、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階6aの計画：`docs/superpowers/plans/2026-11-16-go-to-ts-stage6a-workspace.md`）

## Global Constraints

- 段階1〜6aの Global Constraints はそのまま。持ち主の決定（設計書「段階6の前に洗い出した違いと、持ち主の決定」）：API の答えは Go に合わせる
  （記録の知らない項目は `invalidRecord`、記録の追加の `wordCount`・`device`・`deviceId` の `null` は省略）、ふつうは来ない入力の細部は `src/core` のまま。
- 確かめる順（Go の `records`・`saveRequest`）：設定がなければ 503 `authUnavailable` → `fromAppOrOrigin` と `jsonContent`（403 `forbiddenRequest`）
  → ログイン → 本文（本文なし 400 `emptyRequest`、1 MiB 超 413 `workspaceTooLarge`、オブジェクトでなければ 400 `invalidRecord`、読み取りの失敗は
  503 `workspaceSaveFailed`（報告は `record.add`・`record.delete`））→ `accountId` が文字列でログインと同じでなければ 401 `loginAccountChanged`。
- `POST {accountId, listId, record}`：メンバーはちょうど3つ、`listId` は空でない文字列、`record` は1つのオブジェクトで、Go の `RecordInput` の
  項目（`id`・`time`・`date`・`mistakes`・`accuracy`・`wordCount`・`deviceId`・`device`・`mode`・`missed`）だけ、`id` が必須（文字列）。違えば 400
  `invalidRecord`。リストがなければ 404 `recordListDeleted`。新しく足せば 201、同じ id の記録がすでにあれば 200。答えは `GET` と同じ形に
  `record`（保存した記録）を足したもの。
- `DELETE {accountId, listId, recordId}`：メンバーはちょうど3つ、`listId`・`recordId` は空でない文字列。違えば 400 `invalidRecord`。記録やリストが
  すでになくても 200。答えは `GET` と同じ形。
- `addRecord`・`deleteRecord` のそのほかの断り（`src/core` の `AppError`）は 400 とそのキー。保存のほかの失敗は 503 `workspaceSaveFailed`（報告は
  `record.add`・`record.delete`）。
- 変更（Go の `Modify`）：1つのトランザクションで、行を `FOR UPDATE` で読み（`records_split` なら `typle_records` を戻す）、保存行をアプリと同じ手順で読み、
  変更し、変更があれば行全体を段階6aの `encodeChange` と同じ形で書き直す（`revision` は1上がる、`records_split = true`）。リストの JSON
  （記録を含む、追いかけているパックの単語を除いた形）が変更前より大きく、896 KiB（`MaxListsBytes`。Go の `server/internal/workspace` の値を確かめる）
  を超えれば 413 `workspaceTooLarge`。記録は変更前の行と比べて差分だけを書く。パックにない共有を消す。
- 行がない持ち主：Go は初期の行を作ってから変更し、リストがないので失敗してロールバックする。TS も同じ答え（`POST` は 404 `recordListDeleted`、
  `DELETE` は Go と同じ答え。Go の答えは Task 1 の fixture で確かめる）にする。
- 保存の計測：`TYPLE_MEASURE_SAVES=1` のとき `record.add`・`record.delete` を記録する（段階6aの `measureSave`）。

## Review Focus

1. Go と TS が同じ記録の追加・削除で同じ結果を残す（記録を分けていない古い行、追いかけている公式パックのリストへの記録、同じ id の再送、
   端末・モード・間違えた単語のある記録）。→ Task 1（Go で作った fixture）。
2. 記録の追加と保存（`PUT`）が同時に来ても、記録は失われず、古い `revision` の保存は 409。→ Task 2。
3. 大きすぎるワークスペースへの追加は 413、小さくなる変更は通る。→ Task 2。
4. 記録の本文の知らない項目・`null` の扱いが Go と同じ。→ Task 3。
5. 他のサイト・取り消されたログイン・別のアカウントの画面からの要求。→ Task 4。

---

### Task 0: 作業ブランチ

- [ ] `git switch -c go-to-ts-records`（main から）。計画をコミット：`git commit -m "Go から TS への移行の段階6bの計画を書く"`

### Task 1: Go で記録の操作の fixture を作る

- [ ] 一時的な Go のテスト（コミットしない、`TYPLE_TEST_DATABASE_URL`）で、いくつかの「保存前の行と `typle_records`」と「記録の操作の列」について、
  Go の `recordAdd`・`recordDelete`（`server/internal/web/records.go`）を順に流し、各回の答え（状態コード・エラーのキー・答えの `record`）と、
  最後の行・`typle_records`・`typle_shared_packs` を `tests/fixtures/record-writes.json` に保存する（段階6aの `workspace-writes.json` と同じ形）。
  入れる場面：記録の追加と同じ id の再送、削除と再削除、`records_split` false の古い行への追加、追いかけている公式パックのリストへの追加、
  端末（`deviceId` と `device`）・モード・間違えた単語のある記録、ないリスト、行のない持ち主への追加と削除、記録の本文の `null`
  （`wordCount`・`device`・`deviceId`）と知らない項目。
- [ ] コミット `git commit -m "Go の記録の追加と削除を、本物の DB で fixture に固定する"`

### Task 2: 変更（modifyWorkspace）

**Files:** Modify `src/server/workspace.ts`・`src/server/records.ts`。Test: `tests/serverWorkspaceModify.test.cjs`。

**Interfaces（Produces）:**
- `modifyWorkspace<T>(db: Pool, owner: string, change: (document: WorkspaceDocument) => { document: WorkspaceDocument, changed: boolean, result: T }): Promise<{ result: T, saved: SavedWorkspace | null }>`
  — Global Constraints の変更。`change` が投げた `AppError` はそのまま投げる（ロールバック）。`saved` は変更の後の読み込み（`readSavedWorkspace`）。
- `syncRecords` に変更前の行を渡せるようにし、Go と同じく差分だけを書く（`before` がなければ今のとおり）。

- [ ] **Step 1:** 失敗するテスト（DB）：変更なしなら書かない（`revision` が変わらない）、変更があれば `revision` が1上がり記録が同期される、
  行が大きくなりすぎる変更は 413 の `AppError('workspaceTooLarge')`、大きいまま小さくなる変更は通る、`PUT`（`writeWorkspace`）と同時に
  `Promise.all` で流すとどちらも失われない（`PUT` が古い `revision` なら 409）。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS → **Step 4:** コミット `git commit -m "記録の変更のためのワークスペースの変更を TS で行う"`

### Task 3: 記録の本文を Go と同じ答えで読む

**Files:** Modify `src/server/workspace.ts`（または `src/server/records.ts`）。Test: `tests/serverRecordBody.test.cjs`。

**Interfaces（Produces）:**
- `readRecordAdd(fields: Record<string, unknown>): { listId: string, input: RecordInput } | null`
- `readRecordDelete(fields: Record<string, unknown>): { listId: string, recordId: string } | null`

- [ ] **Step 1:** 失敗するテスト：Go の `server/internal/web/records_test.go` の本文の誤りの表（`no record id`・`empty id`・`extra field` など）と、
  記録の知らない項目（`{"foo":1}`）は `null`（400 `invalidRecord`）、`wordCount`・`device`・`deviceId` の `null` は省略として読む。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS → **Step 4:** コミット `git commit -m "記録の追加と削除の本文を、Go と同じ答えで読む"`

### Task 4: /api/workspace/records の Route Handler

**Files:** Create `src/app/api/workspace/records/route.ts`。Modify `src/server/workspace.ts`（`answerRecords`）。Test: `tests/apiRecords.test.cjs`。

- [ ] **Step 1:** 失敗するテスト：Task 1 の fixture のすべての場面を TS で流し、答え（状態コード・キー・`record`）と最後の行・記録・共有が Go と
  （JSON の値として）同じ。加えて、Global Constraints の確かめる順の答え（403・401・400・413・401 `loginAccountChanged`）、取り消されたログイン、
  アプリのトークン、計測（`record.add`・`record.delete`）、405 `Allow: POST, DELETE`。
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → PASS・typecheck・lint → **Step 4:** コミット `git commit -m "/api/workspace/records を Route Handler で答える"`

### Task 5: 転送を切り替え、Go の該当する処理を消す

- `vercel.json`・`next.config.mjs` から `/api/workspace/records` を消し、`tests/backendPaths.test.cjs` の `nextRoutes` に足す（先に FAIL を見る）。
- Go を消す：`web/records.go`・`web/measure.go`（記録とワークスペースのほかに使い道がなければ）・`web/workspace.go`（`saved`・`answer`）・
  `server/internal/operation`、`saveRequest`・`sameAccount` などこれらだけが使うもの、mux の登録、テスト。`store` の `Modify`・`ReadRevision`・
  `WriteRevision`・記録の表の関数などは、Go の store のテストだけが使うなら消す（段階9で Go ごと消えるので、消すのが重ければ残して ledger に書く）。
  Go に残るテスト（ヘッダー・ログアウト・計測など）は、管理画面や `/api/auth/session` に付け替える。`gofmt -l .`（空）・`go vet ./...`・staticcheck・
  `go test ./...` が通るまで。
- README・`docs/save-metrics.md`・`docs/sentry.md`・`tests/fixtures/records`・`record-operations` の README（Go も読む、の記述）を直す。
- `npm run build` のあと、E2E を全部流す（サンドボックスの外）。
- コミット `git commit -m "/api/workspace/records の転送をやめ、Go の該当する処理を消す"`

### Task 6: 版と PR

- [ ] `npm version patch --no-git-tag-version`（v2.46.7、`git tag` と `gh release list` で確かめる）。`npm run verify` を最後まで通す。push して PR。
  タイトル `練習の記録の追加と削除を Go から Next.js の Route Handler に移す (v2.46.7)`。リリース後に確かめること：本番で練習の記録が残る、
  記録を消せる、iPad／Mac アプリの練習の記録が残る、記録の後にリストを編集すると読み直しになる（409）こと。
