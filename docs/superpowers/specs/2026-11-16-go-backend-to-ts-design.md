# Go のバックエンドを Next.js の Route Handler に移す

2026-11-16 に決めた設計です。

## なぜやるか

バックエンド（`server/`、本体約7,900行・テスト約12,000行）は Go で書かれており、持ち主が自分で処理を追えません。
画面と `src/core` と同じ TypeScript・同じ書き方に移し、バックエンドも自分で読んで直せる状態にします。

あわせて、今は Go の `internal/workspace` が `src/core` と同じ検証をもう一度書いており、`tests/fixtures`
（`strings.json`・`workspace-put.json`・`limits.json` など）で両者が一致することを確かめ続けています。移した後は
`src/core` の検証を直接呼ぶので、この二重の実装と照合が要らなくなります。

## 目標

- `server/`・`api/index.go`・`go.mod`・`go.sum` をなくし、バックエンドを `src/app/api/**/route.ts` で動かす。
- 検証は `src/core` の関数をそのまま使う（`decodeLists`・`decodeDevices` など）。
- `npm run verify` と `npm run dev` から Go を外し、手元に Go がなくても開発・検証できる。
- 移行のどの時点でも本番が動いている。

## 目標にしないこと

- API の仕様の変更。パス・メソッド・状態コード・応答の JSON・エラーの名前（`authUnavailable` など）・ヘッダー・
  Cookie の名前と属性・トークンの形式は今のまま保つ。改善はこの移行の後に別の PR で行う。
- DB のスキーマの変更（移行 `db/migrations` は触らない）。
- 機能を減らすこと。アーカイブ済みの `client=android`・`windows` も今は受け付け続ける。捨てる機能は、移す途中で
  見つけたらその都度持ち主に聞いて別に決める。

## 失敗とみなすこと

- iPad／Mac アプリ（typle-ipad）のログインや保存が壊れる。アプリはこのリポジトリと別に出荷しているので、
  サーバーの応答の形が1か所でも変わると直せない端末が残る。
- 移行後に既存のログイン（Cookie・トークン）が無効になり、全員がログインし直しになる。`AUTH_SECRET` から鍵を
  導く手順と HMAC-SHA256 の署名形式を、Go とビット単位で同じにする。
- TS に移したのに、Go と同じくらい追いにくい構造になる（後述の「書き方」）。

## 制約

- Next.js 16.4.6。Route Handler の決まりは `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  などを読んでから書く（AGENTS.md）。
- DB は PostgreSQL。ドライバーはすでに依存にある `pg` を使う。
- エラー報告は `@sentry/nextjs`（Go の `sentry-go` の代わり）。
- 本番は Vercel。デプロイ・リリースは CLAUDE.md の Release workflow のとおり、1つの PR が1つの版。
- `eslint.config.mjs` の層の規則を守る。サーバーのコードは `src/core` を import してよいが、`src/core` から
  サーバーのコードを import しない。画面（`src/app` のページ・`src/components`）からサーバーのコードを import しない。

## 作り方の候補と選んだもの

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| **A（採用）** | Next.js の Route Handler（`src/app/api/.../route.ts`）に置き、`pg` と `src/core` を使う | 画面と同じアプリ・同じ書き方。検証の二重実装が消え、読む量が最少 | README の「Next.js の `/api` は使いません」を改める |
| B | `api/index.ts` を1つ置き、中で自前の振り分け | 今の構造と1対1で見比べやすい | Next.js と別の仕組みが残り、自前の振り分けが追いにくい |
| C | A の置き場所で、使わない機能を捨てながら作り直す | 読む量がさらに減る | 捨てる機能を1つずつ決める必要があり、移行と仕様変更が混ざる |

持ち主が A を選んだ。理由は、画面と同じ書き方になり、自分で読めるという目的にいちばん近いこと。C の
「捨てる機能」は A の途中で見つけたときに別に決める。

## 進め方

`vercel.json` の `rewrites` と `next.config.mjs` の開発用の `beforeFiles` がパスごとに分かれているので、
エンドポイントのまとまりごとに1つの PR で移す。各 PR で、移したパスを両方の一覧と `tests/backendPaths.test.cjs`
から外し、Go の該当するハンドラーとそのテストを消す。移行中は Go と TS の両方が本番で動く。

順番（手間と危険の小さいものから）:

1. 土台と `/api/health`：DB の接続、共通の応答（セキュリティヘッダー4つ・JSON のエラー）、Sentry、テストの
   仕組み。ここで書き方を決め、持ち主が読んで納得してから次へ進む。
2. ギャラリーの読み取り：`GET /api/gallery`・`/api/gallery/categories`、`/api/shared`。
3. ギャラリーの書き込み：`/api/gallery/added`・`/api/gallery/reports`（IP ごとの回数制限、`Origin` の確認）。
4. ログインのセッションの読み取り（Cookie とトークンの検証）を TS に作る。以降のログインが要るエンドポイントの前提。
   Go と TS が同じ Cookie を互いに読めることを、両方を動かすテストで確かめる。
5. `/api/shares`。
6. `/api/workspace`・`/api/workspace/records`（`revision` による保存、409、`typle_save_metrics` の記録）。
7. 管理画面 `/api/admin/*`（`/api/auth/admin/signout` は `/api/auth/*` の転送をまとめて外せる段階8に回した）。
8. ログインの流れ：`/api/auth/admin/signout`・`/api/auth/signin`・`callback/github`・`callback/ffpf`・`session`・`token`・`signout`・`local`。
   iPad／Mac のトークンの流れ（PKCE）を含む。
9. 片付け：`server/`・`api/index.go`・`go.mod`・`go.sum`・`vercel.json` の `rewrites`・`next.config.mjs` の
   `beforeFiles`、`scripts/dev.cjs` の Go の起動、`scripts/verify.cjs` の Go の検査、Go と TS の照合だけのための
   fixture を消し、README・CLAUDE.md・`docs/` の Go の記述を書き換える。

各段階は Go の挙動を正とし、移す前に Go のテストが確かめている事柄を TS のテストに写す。

### `src/core` と Go の検証が食い違ったとき（持ち主の決定）

段階6の前に、`src/core` と Go の `internal/workspace` の検証の違いを洗い出す。違いが見つかったら、どちらに
合わせるかをその都度持ち主に聞く。その PR は返事を待って止めてよい。

### iPad／Mac との互換の確かめ方（持ち主の決定）

出す前は自動テストで確かめる。段階4〜8では、同じリクエストに対する Go の応答（状態コード・主なヘッダー・JSON）を
記録し、TS の応答と比べるテストを書く。実機での確認は、リリースの後に持ち主が手で行う。段階5・6・8の PR の説明に、
リリース後に確かめる操作（ログイン、保存、共有など）を書いておく。

### 本番が壊れたとき（持ち主の決定）

Vercel のロールバックで前のデプロイ（Go が応答する版）に戻して止血してよい。直した版は新しい版番号の PR として
CLAUDE.md の手順どおり出し直す。ロールバックで戻るのはコードだけなので、各段階は DB のスキーマも、
Go と TS が互いに読む Cookie・トークンの形も変えない（どちらに戻っても動く）。

### 移した後も Go と違うところ（段階2で分かったこと）

「API は変えない」の例外として、次の3つは Go と同じにできない、または同じにしないことにした。どれも JSON として読めば
同じ値で、アプリ（Web・iPad・Mac）の動きは変わらない。

- 壊れたクエリ：Next.js は Route Handler に渡す前にクエリを `URLSearchParams` で書き直す。そのため UTF-8 でないエスケープ
  （`q=%FF`）は U+FFFD として検索され（Go は 400）、`%zz` や `;` も文字として検索される（Go はその組を飛ばした）。
  NUL（`%00`）は Go と同じく 400。本番の経路での答えは `tests/e2e/gallery-query.spec.ts` が確かめる。
- 名前の照合：同じ件数の分類の並びは `Intl.Collator('ja')` で、Go の `golang.org/x/text/collate` とは長音記号「ー」などで
  順が違う。Go の `CompareNames` 自身がアプリの `Intl.Collator('ja')` に合わせるためのものだったので、こちらを正とする。
- JSON の文字のエスケープ：Go は `<`・`>`・`&`・U+2028・U+2029 を `\u003c` などと書いた。TS は `JSON.stringify` のまま書く。
- 時刻の細かさ（段階2・4・7）：Go はマイクロ秒まで書いた（`2026-11-16T08:44:48.123456Z`）。TS は `Date#toISOString()` のミリ秒まで。
  画面とアプリは `Date` で読むので同じ時刻になる。
- Vercel での確かめる順（段階7で分かったこと）：Go は設定や DB がないとき、メソッドを見る前に 503 を返した。段階2〜7の Route Handler は
  ファイルが出していないメソッドに先に 405 を返す。アプリが送るメソッドでは同じ答え。段階8a の `/api/auth/*` は Go の Vercel と同じく、
  設定の 503 → ローカルログインが切れていれば 404 → 405 の順。
- 知らない `/api/*`（段階2〜8a で移したパスの下）は、Go の JSON の `{"error":"notFound"}` ではなく Next.js の 404 のページになる。アプリは呼ばない。
- 全端末のログアウト（段階8a）：Vercel の Go は DB を開いていない instance では取り消しを読めず、503 を返していた。TS は DB を直接読むので通る。
- セッションの答え（段階8a）：Vercel の Go は DB を開いていない instance では取り消しを確かめずに答えた。TS は最大1秒待って確かめ、
  読めなければ確かめずに答える（データの API は別に確かめる）。
- アプリのトークンの交換の本文（段階8a）：同じ名前と大文字小文字だけ違う名前が混ざって重なる本文（`{"code":"A","Code":"B","code":"C"}`）は、
  `JSON.parse` が同じ名前を最初の位置にまとめるため、Go と勝つ値が違うことがある。アプリは送らない。
- ログインの始まりと戻り（段階8b）：GitHub・FFPF ID の答えの JSON のあとに余計な文字が続くと、Go は最初の値だけを読んだが、TS は読めない答えとして
  ログインを失敗にする（どちらのサービスも送らない）。クエリの UTF-8 でないバイトは U+FFFD になる（Go はバイトのまま `returnTo` に入れた）。
  `redirect_uri` は `AUTH_URL` のオリジンで、ホストの大文字・国際化ドメイン・既定のポート（`https://host:443`）は正規化される（Go は書いたまま使った）。本番の設定にはない。
  クエリの `;` や壊れた `%` は、Go はその組を捨てたが、Next.js が Route Handler の前に書き直すため、TS ではそのまま値になる（`returnTo` ならこのサイトのパスなので害はない）。
  戻り先の ASCII でない文字は、Go は `Location` に UTF-8 のバイトのまま書いたが、Vercel がそれを1バイトずつの文字として書き直して壊すため、TS は
  `%E3%81%BB` の形にエンコードする（ブラウザーは同じページへ行く。v2.46.11）。
  GitHub の `GET /user` のリダイレクトを Go は辿ったが、TS は辿らずにログインを失敗にする（GitHub は返さない）。管理者のメールの小文字化は JavaScript の
  `toLowerCase`（`İ` などで Go の `strings.ToLower` と違う。DB の照合は SQL の `lower()` なので通るかどうかは変わらない）。

### 段階6の前に洗い出した違いと、持ち主の決定（2026-11-16）

段階6は 6a（`GET /api/workspace`）・6b（`PUT /api/workspace`）・6c（`/api/workspace/records`）の3つの PR に分ける。

- 保存済みのデータの任意項目の `null`（リストの `tags`・`category`・`group`・`levels`・`packId`、記録の `id`・`mistakes`・`accuracy`・
  `wordCount`・`device`、パックの `description`・`tags`、`origin.followed`）：**Go に合わせ、`src/core` で省略として読む**
  （`writing: null` と同じ）。6a で直す。
- API の答え（エラーのキーを Go と同じく `levelsConflict` 以外は `invalidWorkspace` にまとめる、保存できない文字（NUL・単独の
  サロゲート）は 400 `invalidWorkspace`、`interests: null` は「なし」、記録の知らない項目は `invalidRecord`、難易度が2〜5個の古い
  アプリの保存は1つにまとめる、記録の追加の `wordCount`・`device`・`deviceId` の `null` は省略）：**Go に合わせる**。
- ふつうは来ない入力の細部（日付の書式、`1.0` のような整数、記録の `missed: []`、壊れた `weakReview`、大文字小文字だけ違うキー、
  150リストの上限付近の数え方、単語が空で `origin` が不正な保存済みのリスト）：**`src/core` のまま**。Go との違いとして扱う。
- TS で新しく書く必要があるもの：`typle_records` から記録をリストに戻す処理（`withRecords`）と記録の同期・`legacyID`、
  `revision` による保存と 409、`records_split`、保存の計測（`typle_save_metrics`）、共有リンクの掃除（`deleteRemovedShares`）、
  GET の答え（DB の jsonb テキストそのまま、`packs` が NULL なら `null`、`interests` がなければ既定、行がなければ revision 0）。

### DB の接続（実装者の判断）

Go は1つの関数で `MaxConns=5` のプールを持っていた。Route Handler ではインスタンスごとにプールができるので、
`pg.Pool` の `max` は小さく（5以下）し、`DATABASE_URL` は README のとおり Neon の pooled 接続を使う前提にする。

## 書き方（読みやすさのための決まり）

- 1つのパスは1つの `route.ts`。そのファイルを開けば、そのエンドポイントが何をするかが上から順に読める。
- DB の読み書きは、まとまりごとに1つのファイル（例：`gallery`・`workspace`・`sessions`）に置き、SQL をそのまま書く。
  ORM や独自の抽象は入れない。
- 共通の処理（ヘッダー、エラーの応答、ログインの確認、回数制限）は小さな関数にし、ラッパーを何重にも重ねない。
- 置き場所は `src/server/`（DB・セッション・OAuth など、Route Handler から使うもの）。正確な分け方は段階1で決める。

## テスト

- Go の `server/internal/**/_test.go` が確かめている事柄を、`node --test` のテスト（`tests/*.test.cjs` と同じ仕組み）
  に移す。DB を使うテストは、今の Go の DB テストと同じく `.env.local` のローカルの PostgreSQL を使い、
  ランダムな持ち主で行を作って消す。
- 既存の E2E（`npm run test:e2e`）は、移行の各段階でそのまま通ること。
- `npm run check:production` は各リリースの後にそのまま通ること（`/api/health` の説明文の「Go function」は直す）。

## 実装者に任せること

- `src/server/` の中の正確なファイルの分け方。
- Route Handler からテストをどう呼ぶか（ハンドラーの関数を直接呼ぶか、`next start` に対して HTTP で叩くか）。
- 段階の中で PR をさらに分けるかどうか。
- Sentry へ送る内容の細部（Go と同じ程度の情報を送る）。
