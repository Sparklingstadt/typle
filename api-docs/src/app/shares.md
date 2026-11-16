# パックのファイル

パックの共有（`/api/shares`・`/api/shared`）とギャラリー（`/api/gallery`・`/api/gallery/categories`・`/api/gallery/added`・
`/api/gallery/reports`）は v2.49.0 でなくしました。パックを人に渡すときは、アプリの「書き出す」で書いたファイルか CSV を
送り、受け取った人がアプリで取り込みます。どちらもブラウザーの中で読み書きし、API は使いません。

## 形

アプリの「書き出す」が書き、「ファイルから取り込む」が読む形です。

```json
{
  "format": "typle-pack",
  "version": 1,
  "pack": { "name": "Linux", "description": "よく使うコマンド", "category": "プログラミング", "tags": ["シェル"] },
  "lists": [{ "name": "基本", "levels": ["初級"], "words": [{ "display": "ls", "input": "ls", "annotation": "一覧" }] }]
}
```
