# bigram の IKI の書き出し

IKI のページ（`analysis_iki.html`）の bigram の表に出ている bigram について、1回ごとの IKI をすべて JSON ファイルに書き出す。区間に分けた回数（ヒストグラム）にはせず、値をそのまま出すので、読み込んだ側で範囲や区間の数を自由に決めて分布を作れる。Python などで読み込んで、キー配列の評価・最適化に使うためのもの。実装は `js/ngram-page.js` の `exportBigrams`。

## 操作

- bigram の欄の「bigram データのエクスポート」ボタンを押すと、ファイルをダウンロードする。押した後、ボタンの横に「bigram N 種類を書き出しました。」と出す。表に bigram がないときは書き出さず、「書き出す bigram がありません。」と出す。
- ファイル名は書き出した日時（このPCの時刻）：`typattern-bigram-iki-YYYYMMDD-HHMMSS.json`
- trigram は書き出さない。

## 書き出す bigram

表に出ているものと同じ。つまり、データの絞り込み（言語・配列・モード・期間）、「回数」（N 回以上）、種類（同時押しの記録があるときだけ）で絞ったもの。並び順は bigram の文字の順（文字コードの順）で、表の並び順にはよらない。

bigram の数え方（何を除くか、同時押しの組の扱いなど）は `docs/analysis_iki.md` の「bigram・trigram」「同時押しのあるかな配列」と同じ。

## ファイルの形

UTF-8 の JSON。1 bigram を1行に書く。

```json
{
  "app": "Typattern",
  "version": "v0.137",
  "exportedAt": "2026-11-08T05:30:00.000Z",
  "filters": {"lang":"en","keyLayout":"qwerty","mode":null,"from":null,"to":null,"minCount":5,"kind":null},
  "sessions": 412,
  "bigrams": [
    {"bigram":"th","keys":["15","26"],"chord":false,"count":152,"meanMs":98.3,"sdMs":31.2,"values":[96,101,88]}
  ]
}
```

| 項目 | 意味 |
| --- | --- |
| `version` | 書き出したときのアプリのバージョン（画面左上と同じ） |
| `exportedAt` | 書き出した日時（ISO 8601、UTC） |
| `filters` | 書き出したときの絞り込み。`lang`・`keyLayout`・`mode` はタイピングの記録と同じ値（`docs/storage.md`）で、「すべて」は `null`。`mode` には `regular`（練習モード以外）・`not-iki-measurement`（IKI 測定以外）も入る。`from`・`to` は期間（`YYYY-MM-DD`、指定なしは `null`）。`minCount` は「回数」の N。`kind` は種類の絞り込み（`all`・`ss`・`sc`・`cs`・`cc`）で、種類の絞り込みが出ていないときは `null` |
| `sessions` | 絞り込んだ記録の回数 |
| `bigram` | 2キーの組。押した物理キーの位置を QWERTY の文字（Shift なし）で書く。同時押しの組を含むものは `d → j+k` のように書く |
| `keys` | 2打それぞれの物理キーの番号（2桁の16進数。`1a` など。決まりは `docs/layouts.md` の「物理キーの番号」）の配列。`bigram` の1文字目・2文字目に当たる。同時押しの組は `27+28` のように `+` でつなぐ |
| `chord` | 同時押しの組を含むか |
| `count` | 回数（`values` の数） |
| `meanMs`・`sdMs` | 平均と標本標準偏差（ms、小数第1位）。表と同じ値。1回しかないときの `sdMs` は `null` |
| `values` | 1回ごとの IKI（ms、整数に丸める）。表の「回数」に数えた回をすべて入れる。並び順に意味はない |
