// 推移・ランキングのページ（stats.html）。絞り込んだ記録で推移のグラフとランキングを表示する
(function () {
  "use strict";

  const RANK_TOP = 30;

  const groupEl = document.getElementById("f-group"); // 推移のまとめ方
  const summaryEl = document.getElementById("stats-summary");
  const trendEl = document.getElementById("trend");
  const trendLegendEl = document.getElementById("trend-legend");
  const rankingEl = document.getElementById("ranking");
  const rankingLegendEl = document.getElementById("ranking-legend");
  const filters = Filters.init(update);

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号

  // 選んだ条件に合う記録を集めて、推移のグラフとランキングを描き直す（概要だけを使う）
  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    Store.getAllSessions().then(function (sessions) {
      if (myId !== loadId) return;
      const picked = filters.pick(sessions); // 古い順のまま
      summaryEl.textContent = Filters.summary(picked);
      Trend.render(trendEl, trendLegendEl, picked, groupEl.value);
      updateRanking(picked);
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
    const catText = cats.size === 0 ? "" : "（" + (cats.size === 1 ? Array.from(cats)[0] : "区分が混ざっています") + "）";
    rankingLegendEl.textContent = "Top " + RANK_TOP + catText + " ／ 平均 IKI の小さい順、同じなら正確率の高い順 ／ 正確率 " +
      Store.RANK_MIN_ACCURACY + "% 未満は対象外 ／ 対象 " + rows.length + " 回";
    Ranking.render(rankingEl, rows.slice(0, RANK_TOP), null, { category: cats.size > 1, emptyText: "データなし" });
  }

  groupEl.addEventListener("change", update);
  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  update();
})();
