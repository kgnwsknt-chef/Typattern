// n-gram ページ（ngram.html）。絞り込んだ記録の生データから bigram・trigram を集計して表示する
(function () {
  "use strict";

  const minEl = document.getElementById("f-min"); // 表示する出現回数の下限
  const summaryEl = document.getElementById("stats-summary");
  const ngramSummaryEl = document.getElementById("ngram-summary");
  const bigramEl = document.getElementById("bigram");
  const trigramEl = document.getElementById("trigram");
  const hmCountEl = document.getElementById("hm-count"); // bigram の2次元ヒストグラム（回数）
  const hmIkiEl = document.getElementById("hm-iki");     // 同じく平均 IKI
  let hmRows = [];        // 2次元ヒストグラムに描いている bigram
  let hmBase = 0;         // 色の基準
  // bigram の表で分布を出す行が変わったら、2次元ヒストグラムのそのマスを枠で囲み直す
  const bigramTable = NGram.create(2, "bigram", document.getElementById("bigram-dist"), redrawHeatmaps);
  const trigramTable = NGram.create(3, "trigram", document.getElementById("trigram-dist"));
  const filters = Filters.init(update);

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号

  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    Store.getAllSessions().then(function (sessions) {
      if (myId !== loadId) return;
      const picked = filters.pick(sessions);
      summaryEl.textContent = Filters.summary(picked);
      if (picked.length === 0) {
        ngramSummaryEl.textContent = "";
        bigramTable.renderRows(bigramEl, [], 0, "データなし");
        trigramTable.renderRows(trigramEl, [], 0, "データなし");
        drawHeatmaps([], 0);
        return;
      }

      const ids = new Set(picked.map(function (s) { return s.id; }));
      const bigrams = new Map();
      const trigrams = new Map();
      ngramSummaryEl.textContent = "集計中…";
      return Store.eachRaw(ids, function (raw) {
        // 押したキーの記録（events の "k" の行）から数える。英語も日本語も同じ
        NGram.accumulate(bigrams, 2, raw.events);
        NGram.accumulate(trigrams, 3, raw.events);
      }).then(function () {
        if (myId !== loadId) return;
        // 色の基準：選んだ記録の、n-gram に使えるキーの間隔（bigram の1回ごとの値）すべての平均
        const allBi = NGram.toRows(bigrams);
        let ikiSum = 0;
        let ikiCount = 0;
        allBi.forEach(function (r) {
          r.values.forEach(function (v) { ikiSum += v; ikiCount++; });
        });
        const base = ikiCount ? ikiSum / ikiCount : 0;
        const min = Number(minEl.value);
        const keep = function (r) { return r.count >= min; };
        const bi = allBi.filter(keep);
        const tri = NGram.toRows(trigrams).filter(keep);
        bigramTable.renderRows(bigramEl, bi, base);
        trigramTable.renderRows(trigramEl, tri, base);
        drawHeatmaps(bi, base);
        ngramSummaryEl.textContent = "bigram " + bi.length + " 種類・trigram " + tri.length + " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  // 2次元ヒストグラム2枚を描く。マスをクリックすると、その bigram の分布を表の行のクリックと同じ場所（bigram の表の下）に出す
  function drawHeatmaps(rows, base) {
    hmRows = rows;
    hmBase = base;
    redrawHeatmaps();
  }

  function redrawHeatmaps() {
    const opts = { selected: bigramTable.selected(), onSelect: function (r) { bigramTable.show(r.gram); } };
    NGram.drawHeatmap(hmCountEl, hmRows, "count", hmBase, opts);
    NGram.drawHeatmap(hmIkiEl, hmRows, "iki", hmBase, opts);
  }

  minEl.addEventListener("change", update);
  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
