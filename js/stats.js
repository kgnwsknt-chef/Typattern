// 記録ページ（stats.html）。保存した全記録から n-gram を集計して表示する
(function () {
  "use strict";

  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";
  // タイピング画面で選んだキー配列（app.js と同じキー）
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";

  const f = {
    lang: document.getElementById("f-lang"),
    layout: document.getElementById("f-layout"),
    mode: document.getElementById("f-mode"),
    recent: document.getElementById("f-recent"),
    min: document.getElementById("f-min")
  };
  const summaryEl = document.getElementById("stats-summary");
  const bigramEl = document.getElementById("bigram");
  const trigramEl = document.getElementById("trigram");
  const bigramTable = NGram.create(2, "bigram", document.getElementById("bigram-dist"));
  const trigramTable = NGram.create(3, "trigram", document.getElementById("trigram-dist"));

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号

  // 選んだ条件に合う記録を集めて集計し、表を描き直す
  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";

    Store.getAllSessions().then(function (sessions) {
      // 古い順に並んでいる。条件で絞り込み、期間が決まっていれば新しい方から N 回
      // 空の値（「すべて」）はその条件で絞り込まない
      const match = function (sel, v) { return !sel.value || sel.value === v; };
      let picked = sessions.filter(function (s) {
        return match(f.lang, s.lang) && match(f.layout, s.keyLayout) && match(f.mode, s.mode);
      });
      const recent = Number(f.recent.value);
      if (recent > 0) picked = picked.slice(-recent);
      const ids = new Set(picked.map(function (s) { return s.id; }));

      const bigrams = new Map();
      const trigrams = new Map();
      let ikiSum = 0;
      let ikiCount = 0;
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
        if (picked.length === 0) {
          summaryEl.textContent = "条件に合う記録がありません。";
          bigramTable.renderRows(bigramEl, [], 0, "データなし");
          trigramTable.renderRows(trigramEl, [], 0, "データなし");
          return;
        }
        // 色の基準：選んだ記録の、各文字の最後の打鍵の間隔の平均（結果画面の点線と同じ考え方）
        const base = ikiCount ? ikiSum / ikiCount : 0;
        const min = Number(f.min.value);
        const keep = function (r) { return r.count >= min; };
        const bi = NGram.toRows(bigrams).filter(keep);
        const tri = NGram.toRows(trigrams).filter(keep);
        bigramTable.renderRows(bigramEl, bi, base);
        trigramTable.renderRows(trigramEl, tri, base);
        summaryEl.textContent = "対象 " + picked.length + " 回（" + formatDate(picked[0].finishedAt) + " 〜 " +
          formatDate(picked[picked.length - 1].finishedAt) + "）／ bigram " + bi.length + " 種類・trigram " + tri.length +
          " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
  }

  // タイピング画面で選んでいる配列を最初に選んでおく
  try {
    const saved = localStorage.getItem(KEY_LAYOUT_STORAGE);
    if (saved && f.layout.querySelector('option[value="' + saved + '"]')) f.layout.value = saved;
  } catch (e) { /* 既定の配列を使う */ }

  Object.keys(f).forEach(function (k) { f[k].addEventListener("change", update); });

  document.getElementById("version").textContent = ASSET_VERSION ? "v" + ASSET_VERSION : "";
  update();
})();
