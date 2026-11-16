# Go から TS への移行・段階9（片付け）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2.46.10 からどのリクエストにも使われていない Go のバックエンドを、コード・起動・検査・文書からなくす。

**Architecture:** 動きは変えない。`server/`・`api/index.go`・`go.mod`・`go.sum` を消し、Go を起動・検査・生成していたスクリプトとテストを Node.js だけのものにし、
README・CLAUDE.md・`docs/`・api-docs の Go の記述を今の構成に書き換える。

**Tech Stack:** Next.js 16.4.6、Node.js 24、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md`（段階9）

## Global Constraints

- API・Cookie・トークンの形式は変えない（このPRは Go を消すだけ）。
- Go が封じた Cookie・トークン・答えを記録した fixture（`tests/fixtures/sessions.json`・`auth-answers.json`・`signin-answers.json`・`admin-*.json`・
  `client-mac.json` など）は消さない：アプリや手元に残る Go の発行した Cookie・トークンを読めることと、答えの形を TS のテストが確かめる元になっている。
  Go と TS が同じ fixture を読んでいたもの（`follow`・`pack-file`・`packs`・`records`・`record-operations`）も TS のテストが読むので残し、README の Go の記述だけ消す。
- 過去の版を書いた文書（CHANGELOG、`docs/release-notes`、`docs/superpowers` の計画・設計書）は書き換えない。

## Review Focus

1. `npm run dev`・`dev:local`・`dev:lan` が Go なしで起動し、止めると止まる。
2. `npm run verify` が Go なしで通り、項目の数と文書が合う。
3. `packs:generate --check` が Go の写しなしで通る。
4. Vercel のビルドが Go の関数なしで通る（`.vercelignore`・`vercel.json`）。
5. 消したファイルを指す記述・import が残っていない。

---

### Task 1: Go のコードと、それを起動・検査・生成するものを消す

- `git rm -r server api go.mod go.sum`。`.vercelignore` の Go の行。
- `scripts/dev.cjs`・`tests/devAddress.test.cjs` を消し、`dev`・`dev:local` は `next dev`、`dev-lan.cjs` は `next dev` を直接起動する。
- `scripts/verify.cjs` の gofmt・go vet・staticcheck・go test。`scripts/generate-packs.cjs` の Go の写し。`tests/i18n.test.cjs` の Go の読み取り。
- `npm run verify -- --fast`。コミット `Go のバックエンドのコードと、その起動・検査を消す`

### Task 2: 文書

- README、CLAUDE.md（Release workflow の Verify）、`docs/release-workflow.md`、`docs/` の今の構成を書いた文書、api-docs、`.env.example`、
  `.claude/skills/new-word-list/SKILL.md`、コードのコメントが指す `server/` のファイル。
- コミット `文書から Go のバックエンドの記述を消す`

### Task 3: 版と PR

- v2.47.0（バックエンドの実装が1つになる）。`npm run verify`。PR `Go のバックエンドをなくす (v2.47.0)`。
