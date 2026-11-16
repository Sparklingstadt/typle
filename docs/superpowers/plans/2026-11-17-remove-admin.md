# 管理機能をなくす Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使っていない管理画面・`/api/admin/*`・管理者のログインと `typle_admins` を typle からなくす。

**Architecture:** 利用者の API とギャラリーの動きは変えずに、管理だけが使うコード・翻訳・テスト・文書を消す。
`signin?admin=1` の `admin` は読まなくなり、ふつうのログインになる。移行 `0036_drop_admins` で表を消す。

**Tech Stack:** Next.js 16.4.6、Node.js 24、`node --test`、Playwright、PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-11-17-remove-admin-design.md`

## Global Constraints

- 利用者の API・ログイン・Cookie・トークンの形式は変えない。`hidden_at` と通報は残す。
- 過去の版を書いた文書（CHANGELOG、`docs/release-notes`、`docs/superpowers`）は書き換えない。
- v2.48.0。

## Review Focus

1. `signin?admin=1` が 500 にならず、ふつうのログイン（`returnTo` どおり、GitHub か `provider` どおり）になる。
2. 前の版が封じた、`admin` の付いたログイン途中の Cookie を持って戻っても、ふつうのログインとして終わる。
3. `/admin`・`/api/admin/*`・`/api/auth/admin/signout` が 404 になる。
4. 隠された共有がギャラリー・`/api/shared` に出ないことと、持ち主の表示が変わらない。
5. 消したファイル・キー・関数を指す記述・import が残らない（knip・型検査・i18n のテスト）。

---

### Task 1: コード・翻訳・テストから管理を消す

- `src/app/admin/`、`src/app/api/admin/`、`src/app/api/auth/admin/`、`src/server/admin.ts`、`src/messages/*/admin.json`、
  `tests/apiAdmin.test.cjs`、`tests/e2e/admin.spec.ts`、`tests/fixtures/admin-*.json` を消す。
- `signin.ts`：`admin` の経路と `finishAdmin` を消す。`session.ts`：`Admin`・`openAdmin`・`newAdmin`・`sealAdmin`・
  `adminCookieName`・`ADMIN_MAX_AGE` を消し、`PendingLogin.admin` をなくす（開くときは `admin` の claim を読み流す）。
  `settings.ts`：`adminKey`。`auth.ts`：`adminSignout`。i18n の `admin`。analytics・robots の `/admin`。
- テスト：`signin?admin=1` がふつうのログインになること、`admin: true` の付いた OAuth Cookie で戻ってもふつうに終わること
  （Review Focus 1・2）を先に書いて落ちるのを見る。fixture の管理の場面は外す。`backendPaths` の一覧。
- 消した API が 404 になることを e2e で確かめる（Review Focus 3）。
- コミット `管理画面と管理者のログインを消す`

### Task 2: 表を消す移行

- `db/migrations/0036_drop_admins/migration.sql`：`DROP TABLE IF EXISTS "typle_admins";`。`npm run db:migrate`。
- コミット `typle_admins を消す移行を足す`

### Task 3: 文書・版・PR

- README（`admin.ts`、FFPF ID の説明、ログアウトの説明、「管理者ダッシュボード」の節）、`docs/features.md`、
  `docs/app-api.md`、api-docs（`admin.md`、`auth.md`・`shares.md`・`README.md`・`config.ts` の管理の記述）、`.env.example`。
- v2.48.0、`npm run verify`、PR `管理画面をなくす (v2.48.0)`。公開後に Docs deploy。
