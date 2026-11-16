# 管理機能をなくす（短い設計）

## 目的

`/admin` の管理画面は実際には使っていない。typle のデータの確かめは別の管理用プロジェクト
（`typle-data-viewer`、本番の PostgreSQL に直接つなぐ Mac アプリ）で行う。使わない画面・API・ログインの経路を
typle から消し、保守するコードと攻撃される入口を減らす。

## 目標・目標でないこと

- 目標：管理画面、`/api/admin/*`、管理者のログインと Cookie、`/api/auth/admin/signout`、`typle_admins` を消す。
- 目標でないこと：別のアプリに管理の機能（共有を隠すなど）を足すこと。今後、通報された共有を隠すには
  `typle_shares.hidden_at` に SQL で時刻を入れる。
- してはいけないこと：利用者の API（iPad・Mac・Android・Windows のアプリが使うもの）、ログイン、ギャラリーの
  動きを変えること。隠された共有（`hidden_at`）がギャラリーに出ないことと、通報（`/api/gallery/reports`）は残す。

## 制約

- iPad・Mac のアプリは `/api/admin` も `admin=1` も使っていない（確かめ済み）。
- 消した URL は Next.js の 404 になる。
- 過去の版を書いた文書（CHANGELOG、`docs/release-notes`、`docs/superpowers`）は書き換えない。

## 作り方

- A（選んだもの）：typle から消すだけ。別のアプリは DB に直接つなぐので、typle に管理用の API は要らない。
- B：管理用の API を残して別のアプリから呼ぶ。別のアプリは API を使わないので、認証を保守するだけ損になる。

## 決めたこと

- 1つの PR、v2.48.0（機能をなくすのでマイナー）。
- `typle_admins` は新しい移行 `0036_drop_admins` で消す（私の判断）。Vercel で前の版に戻すと、その版の管理者の
  ログインは `adminUnavailable` になるだけで、ほかは動く。
- `signin?admin=1` は、ただのログインの引数として扱わず、これまでなかった引数として読み流す（`admin` の
  意味はなくなる）。古い管理用 Cookie は誰も読まなくなる。
- 管理画面の翻訳、api-docs の `admin.md` と管理者の節、テスト・fixture・e2e の管理の部分も消す。
- 公開後に Docs deploy を流す。

## 作る人に任せること

- 管理だけが使っていた関数・型・翻訳キーの洗い出し（knip と型検査が手がかり）。
- 管理と共有されていたもの（例：`src/core/analytics.ts`、`useShares` の管理向けの部分）を残すか消すか。
