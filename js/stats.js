// 記録ページ（stats.html）。保存した記録を絞り込み、成績の推移と n-gram を表示する
(function () {
  "use strict";

  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";
  // タイピング画面で選んだキー配列（app.js と同じキー）
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";

  // 推移と n-gram の両方に効く絞り込み
  const f = {
    lang: document.getElementById("f-lang"),
    layout: document.getElementById("f-layout"),
    mode: document.getElementById("f-mode"),
    from: document.getElementById("f-from"),
    to: document.getElementById("f-to")
  };
  const groupEl = document.getElementById("f-group"); // 推移のまとめ方
  const minEl = document.getElementById("f-min");     // n-gram の回数
  const summaryEl = document.getElementById("stats-summary");
  const trendEl = document.getElementById("trend");
  const trendLegendEl = document.getElementById("trend-legend");
  const ngramSummaryEl = document.getElementById("ngram-summary");
  const rankingEl = document.getElementById("ranking");
  const rankingLegendEl = document.getElementById("ranking-legend");
  const RANK_TOP = 30;
  const bigramEl = document.getElementById("bigram");
  const trigramEl = document.getElementById("trigram");
  const bigramTable = NGram.create(2, "bigram", document.getElementById("bigram-dist"));
  const trigramTable = NGram.create(3, "trigram", document.getElementById("trigram-dist"));

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号

  // このPCの日付で "YYYY-MM-DD"（input type="date" の値と同じ形）
  function localDate(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // 選んだ条件に合う記録を集めて、推移のグラフと n-gram の表を描き直す
  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";

    Store.getAllSessions().then(function (sessions) {
      // 空の値（「すべて」・期間の指定なし）はその条件で絞り込まない
      const match = function (sel, v) { return !sel.value || sel.value === v; };
      const picked = sessions.filter(function (s) {
        const day = localDate(s.finishedAt);
        return match(f.lang, s.lang) && match(f.layout, s.keyLayout) && match(f.mode, s.mode) &&
          (!f.from.value || day >= f.from.value) && (!f.to.value || day <= f.to.value);
      }); // 古い順のまま

      if (myId !== loadId) return;
      if (picked.length === 0) {
        summaryEl.textContent = "条件に合う記録がありません。";
      } else {
        summaryEl.textContent = "対象 " + picked.length + " 回（" + localDate(picked[0].finishedAt).replace(/-/g, "/") + " 〜 " +
          localDate(picked[picked.length - 1].finishedAt).replace(/-/g, "/") + "）";
      }
      Trend.render(trendEl, trendLegendEl, picked, groupEl.value);
      updateRanking(picked);
      return updateNgrams(picked, myId);
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  // 絞り込んだ記録のうちランキングの対象（正確率の基準以上）を、結果画面と同じ順で上位 RANK_TOP 件
  function updateRanking(picked) {
    const rows = picked.filter(Store.eligible).sort(Store.compare);
    // 言語・モード・配列が混ざっているときは「区分」の列を出す
    const cats = new Set(rows.map(Ranking.categoryLabel));
    rankingLegendEl.textContent = "Top " + RANK_TOP + "（" + (cats.size === 1 ? Array.from(cats)[0] : "区分が混ざっています") +
      "）／ 平均 IKI の小さい順、同じなら正確率の高い順 ／ 正確率 " + Store.RANK_MIN_ACCURACY + "% 未満は対象外 ／ 対象 " +
      rows.length + " 回";
    Ranking.render(rankingEl, rows.slice(0, RANK_TOP), null, { category: cats.size > 1, emptyText: "データなし" });
  }

  // n-gram は生データから集計する
  function updateNgrams(picked, myId) {
    if (picked.length === 0) {
      ngramSummaryEl.textContent = "";
      bigramTable.renderRows(bigramEl, [], 0, "データなし");
      trigramTable.renderRows(trigramEl, [], 0, "データなし");
      return Promise.resolve();
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
  }

  // タイピング画面で選んでいる配列を最初に選んでおく
  try {
    const saved = localStorage.getItem(KEY_LAYOUT_STORAGE);
    if (saved && f.layout.querySelector('option[value="' + saved + '"]')) f.layout.value = saved;
  } catch (e) { /* 既定の配列を使う */ }

  Object.keys(f).forEach(function (k) { f[k].addEventListener("change", update); });
  groupEl.addEventListener("change", update);
  minEl.addEventListener("change", update);
  document.getElementById("f-clear").addEventListener("click", function () {
    f.from.value = "";
    f.to.value = "";
    update();
  });

  document.getElementById("version").textContent = ASSET_VERSION ? "v" + ASSET_VERSION : "";
  update();
})();
