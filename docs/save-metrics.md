# 保存の計測

保存にかかった時間と大きさを DB に残し、Issue [#174](https://github.com/Sparklingstadt/typle-r/issues/174) の「効果の計測」（保存時間と `409` の発生率）と、v2.42.0 で記録に足した間違えた単語（`missed`）の影響を数字で見るための仕組みです（v2.45.0 から）。

## 残すもの

Go のバックエンドが、次の3つの保存を1回ごとに `typle_save_metrics`（マイグレーション `0035_save_metrics`）へ1行ずつ残します。

| `operation` | リクエスト |
|---|---|
| `workspace.write` | `PUT /api/workspace`（リスト・パック・端末・興味の保存） |
| `record.add` | `POST /api/workspace/records`（練習の記録の追加） |
| `record.delete` | `DELETE /api/workspace/records`（記録の削除） |

| 列 | 内容 |
|---|---|
| `at` | 残した時刻 |
| `status` | 答えた HTTP ステータス。`409` は競合、`413` は大きすぎる保存 |
| `duration_ms` | ハンドラーにかかった時間（ミリ秒）。ログインの確認・検証・DB の読み書きを含み、通信の時間は含みません |
| `request_bytes` | リクエストの本文のバイト数（`Content-Length`。ないときは 0） |
| `response_bytes` | 答えの本文のバイト数（圧縮の前） |

アカウントのIDも保存の中身も残しません。90日より古い行は、次の行を残すときに消します。読み込み（`GET /api/workspace`）は測りません。

## 入れ方と止め方

環境変数 `TYPLE_MEASURE_SAVES=1` を設定したときだけ測ります（`web.FromEnv`）。設定しなければ、ハンドラーは今までと同じです。

- 本番: Vercel のプロジェクトの Production に `TYPLE_MEASURE_SAVES=1` を足して、デプロイし直します。止めるときは消してデプロイし直します。
- 手元: `.env.local` に `TYPLE_MEASURE_SAVES=1` を足して `npm run dev` を起動し直します。

測っている間は、保存の答えを返す前に INSERT を1回行うので、保存がその分（数ミリ秒）遅くなります。サーバーレスの関数は答えたあとに止まることがあるため、答えたあとには行いません。INSERT は2秒で打ち切り、失敗してもログに出すだけで、保存の答えは変わりません。`duration_ms` にこの INSERT の時間は入りません。

## 数字の見方

Neon の SQL エディターか `psql` で読みます。

操作ごとの回数・時間・大きさ（直近28日、成功した保存だけ）:

```sql
SELECT operation,
       count(*) AS saves,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
       max(duration_ms) AS max_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY request_bytes)::int AS p50_request_bytes,
       max(request_bytes) AS max_request_bytes,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY response_bytes)::int AS p50_response_bytes,
       max(response_bytes) AS max_response_bytes
FROM typle_save_metrics
WHERE at >= now() - interval '28 days' AND status BETWEEN 200 AND 299
GROUP BY operation
ORDER BY operation;
```

`409`（競合）の発生率:

```sql
SELECT operation,
       count(*) AS requests,
       count(*) FILTER (WHERE status = 409) AS conflicts,
       round(100.0 * count(*) FILTER (WHERE status = 409) / count(*), 2) AS conflict_percent
FROM typle_save_metrics
WHERE at >= now() - interval '28 days'
GROUP BY operation
ORDER BY operation;
```

`missed` の影響は、`record.add` の `request_bytes` と `duration_ms` で見ます。`missed` は1記録に20語までです。答え（`response_bytes`）は保存後のワークスペースなので、記録が増えて答えが大きくなっていないかも見ます。

## 決めること

4週間ぶん集めたら、数字を Issue #174 に書き、次を決めます（[roadmap.md](roadmap.md) の「今」）。

- 記録の一括移行と、`lists` からの `records` の削除をするか。
- `missed` に残す語数（20語）を減らすか。
- 計測を止めるか（`TYPLE_MEASURE_SAVES` を消す）。止めたあと、表は残しても消してもかまいません。
