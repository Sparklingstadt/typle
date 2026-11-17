# 単語パックの共有とギャラリーをなくす Implementation Plan

> v2.50.0 で `src/core` は `src/lib` に（公式パックは `src/lib/packs`）、`src/lib` の React のフック（`use*`）は `src/hooks` に移りました。この文書のパスは書いた当時のものです。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** パックの共有とギャラリーを、画面・API・サーバー・DB・文書から消す。

**Architecture:** 共有とギャラリーだけが使うものを消し、ワークスペースの保存から共有の片付けを外す。`/shared/<id>` は
終了の表示だけのページ、`/gallery` はカタログへの転送にする。移行 `0037_drop_sharing` で表を消す。

**Tech Stack:** Next.js 16.4.6、Node.js 24、`node --test`、Playwright、PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-11-17-remove-sharing-design.md`

## Global Constraints

- CSV・`.typle-pack.json`・公式パック・`/result` は変えない。利用者のパック・記録を失わない。
- v2.49.0。

## Review Focus

1. 共有から追加したパック、共有していたパックを持つワークスペースが、読み込み・保存とも今までどおり動く。
2. `/shared/<id>`（どんな id でも）が終了の表示になり、API を呼ばない。`/gallery` はカタログへ転送される。
3. 消した API が 404 になる。
4. パックの行・削除の確認・リストの管理画面から、共有の表示と操作が残らずに消え、ほかの操作は変わらない。
5. 消したファイル・キー・関数・表を指す記述・import が残らない。

---

### Task 1: サーバーと API

- `src/app/api/{shares,shared,gallery}` と `src/server/{shares,shared,gallery,galleryWrites,rateLimit}.ts`、そのテストと fixture を消す。
- `src/server/workspace.ts` の `typle_shared_packs` の片付けを消す（Review Focus 1 のテストを先に）。
- `backendPaths`・e2e の 404。コミット `共有とギャラリーの API を消す`

### Task 2: 画面・翻訳・ガイド

- `/gallery`（転送）、`/shared/[id]`（終了の表示だけ）、`src/components/{Gallery,Shared}`、`ShareDialog`・`OrphanShares`、
  `PackRow`・`ListManager`・`DeletePackDialog` の共有の部分、`useShares`・`useSharedPack`・`useGalleryResults`、
  `src/core/gallery.ts`、サイドバー、翻訳・ガイド・エラーキー。e2e の `shares`・`gallery`・`gallery-query` を消し、終了ページと転送を確かめる。
- コミット `共有とギャラリーの画面を消す`

### Task 3: 移行・文書・版

- `db/migrations/0037_drop_sharing`。README・`docs/`・api-docs・`.env.example`。v2.49.0、`npm run verify`、
  PR `単語パックの共有とギャラリーをなくす (v2.49.0)`。公開後に Docs deploy。
