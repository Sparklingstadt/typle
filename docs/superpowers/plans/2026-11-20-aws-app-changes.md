# AWS への移行: アプリの準備（PR 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vercel のまま出せる「アプリの変更 1・2・3・5」を入れ、同じコードが Vercel でも AWS（ECS Fargate のコンテナ）でも正しく動くようにする。

**Architecture:** 接続元の IP を `x-forwarded-for` の末尾から取る（ALB が付ける値）。`TYPLE_STANDALONE=1` のときだけ Next.js を `output: 'standalone'` でビルドし、リポジトリのルートの `Dockerfile` がそれを Node 24 のイメージにする。RDS の SSL は `DATABASE_URL` の `sslmode=verify-full&sslrootcert=…` と、イメージに入れる RDS の CA バンドルで行い、コードは変えない。

**Tech Stack:** Next.js 16.4.6、Node.js 24、`pg` 8、`node:test`、Docker。

**Spec:** `docs/superpowers/specs/2026-11-20-aws-migration-design.md`（「アプリの変更」の 1・2・3・5）

## Global Constraints

- ブランチは `claude/gifted-hopper-6479qh`、PR は #366（設計書と同じ PR に積む）。バージョンは PR の v2.55.2 のまま（まだ Release していない）。
- 途中のコミットは日本語で内容だけを書き、`(vX.Y.Z)` を付けない。PR のタイトルは日本語の1文で末尾に ` (v2.55.2)`。
- コードのコメントと識別子は英語、文書は日本語。
- Vercel での動きを変えない: Vercel では `TYPLE_STANDALONE` を付けないので、ビルドは今までどおり `.next`。
- 秘密の値（`.env*`・`*.pem` 以外の鍵）をイメージにもコミットにも入れない。`.gitignore` は `*.pem` を除外済み。
- テストは `npm test`（`node --test --test-isolation=none tests/*.test.cjs`）。DB のテストは `.env.local` の `DATABASE_URL`（Docker の PostgreSQL）を使う。

## Review Focus

1. **偽の `x-forwarded-for`**: 利用者が `x-forwarded-for: 1.1.1.1` を送ると、ALB はそれに本当の IP を足して `1.1.1.1, <本当の IP>` にする。回数制限は本当の IP で数えられなければならない → Task 1 のテスト。
2. **末尾が空のヘッダー**（`"1.2.3.4, "`・`" , "`）: 空の値を IP として数えない。空でない最後の値、なければ `unknown` → Task 1 のテスト。
3. **イメージに `.env.local` が入る**: `@next/env` はビルドでも実行でも `.env*` を読むので、入ると手元の秘密がイメージに残り、本番の値も上書きされる → Task 3 の `.dockerignore` と確認の手順。
4. **ビルドの時点で URL が埋め込まれる**: `src/app/sitemap.ts`・`robots.ts`・`layout.tsx` の `metadataBase` は `siteUrl`（`SITE_URL` → `AUTH_URL` → …→ `http://localhost:3000`）をビルドの時点で読んで静的に出す。コンテナのビルドで `SITE_URL` がないと、本番の sitemap に `localhost` が載る → Task 3 で `SITE_URL` をビルド引数で必須にし、確認の手順で `sitemap.xml` を見る。
5. **手書き認識の wasm が配られない**: `public/handwriting/ort/` は `postinstall`・`prebuild` が写すもので、コミットされていない。standalone の出力には `public/` が入らない → Task 3 の確認で `/handwriting/ort/ort-wasm-simd-threaded.wasm` が 200。

---

### Task 1: 接続元の IP を `x-forwarded-for` の末尾から取る

**Files:**
- Modify: `src/server/limits.ts:42-57`（`clientIp` とそのコメント）
- Test: `tests/authLimits.test.cjs:98-118`

**Interfaces:**
- Produces: `clientIp(request: Request): string` — 名前・型・IPv6 の /64 への丸めは今のまま。変わるのは、どの値を取るかだけ。

- [ ] **Step 1: テストを書き換える（失敗するように）**

`tests/authLimits.test.cjs` の `'the client IP is the first x-forwarded-for value'` を次に置き換える。IPv6 のテスト（107〜117 行）の `'2001:DB8:0001:0002::9, 1.1.1.1'` の行は `'1.1.1.1, 2001:DB8:0001:0002::9'` に直し、期待値は `'2001:db8:1:2::/64'` のまま。

```js
test('the client IP is the last x-forwarded-for value, the one the load balancer added', () => {
  const request = value => new Request('http://localhost/', value === undefined ? {} : { headers: { 'x-forwarded-for': value } })
  assert.equal(clientIp(request('1.2.3.4, 5.6.7.8')), '5.6.7.8')
  // A value the client sent itself comes first; the load balancer appends the address it saw.
  assert.equal(clientIp(request('1.1.1.1, 203.0.113.7')), '203.0.113.7')
  assert.equal(clientIp(request('  9.9.9.9  ')), '9.9.9.9')
  assert.equal(clientIp(request('1.2.3.4, ')), '1.2.3.4')
  assert.equal(clientIp(request(' , ')), 'unknown')
  assert.equal(clientIp(request()), 'unknown')
  assert.equal(clientIp(request('')), 'unknown')
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test --test-isolation=none tests/authLimits.test.cjs`
Expected: FAIL（`'1.2.3.4'` と `'5.6.7.8'` の食い違いなど）

- [ ] **Step 3: `clientIp` を直す**

`x-forwarded-for` を `,` で分けて前後の空白を取り、空でない**最後の**値を使う（なければ `'unknown'`）。その先の IPv6 の扱いは今のまま。コメントは「最後の値」と、その理由（Vercel は値を1つに付け直し、ALB は届いた値の後ろに見えた接続元を足すので、どちらでも最後の値が偽れない）に書き直す。

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test --test-isolation=none tests/authLimits.test.cjs tests/accountSignup.test.cjs tests/accountRecovery.test.cjs`
Expected: PASS（後ろの2つは `x-forwarded-for` に値を1つだけ送るので、変わらず通る）

- [ ] **Step 5: コミット**

```bash
git add src/server/limits.ts tests/authLimits.test.cjs
git commit -m "接続元の IP を x-forwarded-for の最後の値から取る"
```

### Task 2: 本番の https の URL では開発ログインが付かないことを確かめる

**Files:**
- Test: `tests/serverSettings.test.cjs:19-27`

`src/server/settings.ts` は変えない（設計書の「アプリの変更」5: `NODE_ENV` で判定すると E2E が壊れる。`localLoginAllowed` が http の loopback・LAN だけを通す）。

- [ ] **Step 1: テストを足す**

`'the local login is on only for plain http to this machine, never on Vercel'` の中に足す:

```js
  // Off in production anywhere, not only on Vercel: the site is https and not this machine.
  assert.equal(on({ AUTH_URL: 'https://typle.sparklingstadt.com' }), false)
  assert.equal(on({ AUTH_URL: 'https://typle.sparklingstadt.com', NODE_ENV: 'production' }), false)
```

- [ ] **Step 2: 通ることを確かめる**

Run: `node --test --test-isolation=none tests/serverSettings.test.cjs`
Expected: PASS（今の作りを固定するテストなので、最初から通る。通らなければ設計の前提が違うので止めて報告する）

- [ ] **Step 3: コミット**

```bash
git add tests/serverSettings.test.cjs
git commit -m "本番の https の URL では開発ログインが付かないことをテストで確かめる"
```

### Task 3: コンテナのイメージ（standalone のビルドと Dockerfile）

**Files:**
- Modify: `next.config.mjs`（`output`）
- Create: `Dockerfile`、`.dockerignore`
- Test: `tests/standaloneBuild.test.cjs`（新規）

**Interfaces:**
- Produces（後の PR の `scripts/deploy-aws.cjs` と CDK が使う）:
  - `docker build --build-arg SITE_URL=<https の URL> -t <tag> .` でイメージができる。`SITE_URL` がなければビルドが失敗する。
  - コンテナは `:3000` で受ける（`CMD ["node", "server.js"]`、作業ディレクトリ `/app`）。
  - マイグレーション: 同じイメージで `node scripts/migrate.cjs`（`/app/db/migrations` を読む）。
  - RDS の CA バンドル: `/app/certs/rds-global-bundle.pem`。`DATABASE_URL` は `…?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/standaloneBuild.test.cjs`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

async function config(env) {
  const saved = process.env.TYPLE_STANDALONE
  if (env === undefined) delete process.env.TYPLE_STANDALONE
  else process.env.TYPLE_STANDALONE = env
  try {
    const url = `${pathToFileURL(path.join(__dirname, '..', 'next.config.mjs'))}?t=${Date.now()}-${Math.random()}`
    return (await import(url)).default('phase-production-build')
  } finally {
    if (saved === undefined) delete process.env.TYPLE_STANDALONE
    else process.env.TYPLE_STANDALONE = saved
  }
}

test('the container build is standalone, every other build is as before', async () => {
  assert.equal((await config('1')).output, 'standalone')
  assert.equal((await config(undefined)).output, undefined)
  assert.equal((await config('0')).output, undefined)
})
```

（`next.config.mjs` が `TYPLE_STANDALONE` をモジュールの読み込み時ではなく関数の中で読むなら、`?t=` は要らない。どちらでも通る形にしてある。）

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test --test-isolation=none tests/standaloneBuild.test.cjs`
Expected: FAIL（`undefined !== 'standalone'`）

- [ ] **Step 3: `next.config.mjs` に `output` を足す**

`output: process.env.TYPLE_STANDALONE === '1' ? 'standalone' : undefined`。上に英語で1行: the container image (Dockerfile) sets it; Vercel and `next start` (verify, E2E) do not.

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test --test-isolation=none tests/standaloneBuild.test.cjs tests/backendPaths.test.cjs tests/contentSecurityPolicy.test.cjs`
Expected: PASS

- [ ] **Step 5: `.dockerignore` を書く**

除くもの: `.git`、`node_modules`、`.next`、`.next-production`、`.env*`（`.env.example` も含めてすべて）、`*.pem`、`.vercel`、`kotlin`、`server`、`api`、`api-docs`、`tests`、`test-results`、`playwright-report`、`coverage`、`docs`、`*.md`。

- [ ] **Step 6: `Dockerfile` を書く**

- ビルドの段: `node:24-slim`。`ARG SITE_URL` があり、空ならエラーで止める（`RUN test -n "$SITE_URL"`）。ソースを写してから `npm ci`（`postinstall` が `scripts/` を使う）、`TYPLE_STANDALONE=1 SITE_URL=$SITE_URL npm run build`。
- 実行の段: `node:24-slim`、`WORKDIR /app`、`ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000`。
  - `.next-production/standalone/` の中身を `/app/` に写す。
  - `.next-production/static` を `/app/.next-production/static` に写す。
  - `public/` を `/app/public/` に写す。
  - `scripts/migrate.cjs` を `/app/scripts/`、`db/migrations` を `/app/db/migrations` に写す。
  - `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` を `/app/certs/rds-global-bundle.pem` に置く（`ADD` でよい）。
  - `USER node`、`EXPOSE 3000`、`CMD ["node", "server.js"]`。
- `--platform` は Dockerfile に書かない（デプロイのときに `linux/arm64` を渡す）。

- [ ] **Step 7: イメージを作って確かめる**

Docker の PostgreSQL（`docker compose --env-file .env.local up -d --wait`、:5433）を使う。秘密でない確認用の値で:

```bash
docker build --build-arg SITE_URL=https://typle.sparklingstadt.com -t typle-r:check .
docker build -t typle-r:nosite . ; echo "exit=$?"   # SITE_URL なし → exit が 0 でない
docker run --rm typle-r:check ls -a /app | grep -c '^\.env' ; # 0
docker run --rm --network host -e DATABASE_URL="$(grep ^DATABASE_URL .env.local | cut -d= -f2-)" typle-r:check node scripts/migrate.cjs
docker run -d --name typle-check --network host -e PORT=3200 \
  -e DATABASE_URL="$(grep ^DATABASE_URL .env.local | cut -d= -f2-)" \
  -e AUTH_SECRET=check-only-not-a-secret-32-bytes-long -e AUTH_URL=http://127.0.0.1:3200 typle-r:check
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/api/health                              # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/                                        # 200 か 3xx
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/handwriting/ort/ort-wasm-simd-threaded.wasm   # 200
curl -s http://127.0.0.1:3200/sitemap.xml | grep -c 'https://typle.sparklingstadt.com'               # 1 以上
curl -s http://127.0.0.1:3200/sitemap.xml | grep -c localhost                                         # 0
docker rm -f typle-check
```

Expected: 各行のコメントのとおり。`migrate.cjs` は「No migrations to apply.」か「Applied …」で終了コード 0。

- [ ] **Step 8: コミット**

```bash
git add next.config.mjs Dockerfile .dockerignore tests/standaloneBuild.test.cjs
git commit -m "コンテナのイメージを作れるようにする（standalone のビルドと Dockerfile）"
```

### Task 4: RDS への SSL 接続を確かめ、DB のコメントを直す

**Files:**
- Modify: `src/server/database.ts:3-4, 18`（コメントだけ）
- Test: `tests/serverDatabase.test.cjs`（テストを1つ足す）

**Interfaces:**
- Consumes: Task 3 の `DATABASE_URL` の形（`sslmode=verify-full&sslrootcert=<path>`）。

- [ ] **Step 1: テストを足す**

DB に接続しないテスト。`pg` の `Client` は作るだけでは接続しないので、`connectionParameters.ssl` を見る:

```js
test('an RDS URL verifies the server with the CA bundle it names', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { Client } = require('pg')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typle-ca-'))
  const ca = path.join(dir, 'bundle.pem')
  fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n')
  try {
    const client = new Client({ connectionString: `postgres://u:p@db.example:5432/typle?sslmode=verify-full&sslrootcert=${ca}` })
    const ssl = client.connectionParameters.ssl
    assert.equal(typeof ssl, 'object')
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/)
    assert.notEqual(ssl.rejectUnauthorized, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 通ることを確かめる**

Run: `node --test --test-isolation=none tests/serverDatabase.test.cjs`
Expected: PASS（`pg` の今の振る舞いを固定するテスト。通らなければ、`pg` が `sslrootcert` を読まない版なので止めて報告する。そのときは `createPool` で `ssl` を組み立てる変更を別に計画する）

- [ ] **Step 3: コメントを直す**

`database.ts` の冒頭のコメントを、どこで動くかに寄らない書き方にする: 各サーバーのインスタンスが小さなプールを1つ持つ（Vercel では多くのインスタンスが同時に動き、AWS ではタスク1つ）。RDS では `DATABASE_URL` の `sslmode=verify-full`・`sslrootcert` で SSL を検証する。`keepAlive` のコメントも同様に。コードは変えない。

- [ ] **Step 4: コミット**

```bash
git add src/server/database.ts tests/serverDatabase.test.cjs
git commit -m "RDS への SSL 接続の形をテストで確かめ、DB のコメントを直す"
```

### Task 5: 文書と PR

**Files:**
- Modify: `README.md`（「Dockerでの仮運用」の近くに「コンテナのイメージ」の節）

- [ ] **Step 1: README に節を足す**

日本語で短く: `docker build --build-arg SITE_URL=… -t typle-r .` の作り方、`SITE_URL` が要る理由（sitemap などに埋め込まれる）、`.env*` はイメージに入らないこと、マイグレーションは同じイメージで `node scripts/migrate.cjs`、RDS では `DATABASE_URL` に `sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem`。AWS での動かし方は後の PR の手順書に書く、と1行。

- [ ] **Step 2: 速い検査**

Run: `npm run verify -- --fast`
Expected: 最後まで通る（DB 更新・型チェック・単体テスト・Lint・knip・本番ビルド）。`knip` が `tests/standaloneBuild.test.cjs` を見つけること（`tests/*.test.cjs` は entry 済み）。クラウドのセッションで Docker や Node 24 がなく流せなければ、そう書いて持ち主に渡す。

- [ ] **Step 3: コミットと push、PR の更新**

```bash
git add README.md
git commit -m "README にコンテナのイメージの作り方を書く"
git push origin claude/gifted-hopper-6479qh
```

PR #366 のタイトルを「AWS への移行の設計を書き、アプリをコンテナでも動くようにする (v2.55.2)」に、説明に Task 1〜4 の変更と確認の結果（Step 2 と Task 3 Step 7）を足す。
