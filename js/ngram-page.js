// n-gram ページ（ngram.html）。絞り込んだ記録の生データから bigram・trigram を集計して表示する
(function () {
  "use strict";

  const minEl = document.getElementById("f-min"); // 表示する出現回数の下限
  const summaryEl = document.getElementById("stats-summary");
  const ngramSummaryEl = document.getElementById("ngram-summary");
  const bigramEl = document.getElementById("bigram");
  const trigramEl = document.getElementById("trigram");
  const bigramTable = NGram.create(2, "bigram", document.getElementById("bigram-dist"));
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
        return;
      }

      const ids = new Set(picked.map(function (s) { return s.id; }));
      const bigrams = new Map();
      const trigrams = new Map();
      let ikiSum = 0;
      let ikiCount = 0;
      ngramSummaryEl.textContent = "集計中…";
      return Store.eachRaw(ids, function (raw) {
        const missed = new Array(raw.text.length).fill(false);
        raw.missedPositions.forEach(function (i) { missed[i] = true; });
        NGram.accumulate(bigrams, 2, raw.text, raw.intervals, missed);
        NGram.accumulate(trigrams, 3, raw.text, raw.intervals, missed);
        raw.intervals.forEach(function (v) {
          if (v !== null) { ikiSum += v; ikiCount++; }
        });
      }).then(function () {
        if (myId !== loadId) return;
        // 色の基準：選んだ記録の、各文字の最後の打鍵の間隔の平均（結果画面の点線と同じ考え方）
        const base = ikiCount ? ikiSum / ikiCount : 0;
        const min = Number(minEl.value);
        const keep = function (r) { return r.count >= min; };
        const bi = NGram.toRows(bigrams).filter(keep);
        const tri = NGram.toRows(trigrams).filter(keep);
        bigramTable.renderRows(bigramEl, bi, base);
        trigramTable.renderRows(trigramEl, tri, base);
        ngramSummaryEl.textContent = "bigram " + bi.length + " 種類・trigram " + tri.length + " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  minEl.addEventListener("change", update);
  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  update();
})();
