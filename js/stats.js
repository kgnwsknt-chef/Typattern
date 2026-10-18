// 記録のページ（stats.html）。絞り込んだ記録で推移のグラフとランキングを表示する
(function () {
  "use strict";

  const RANK_TOP = 30;

  const groupEl = document.getElementById("f-group"); // 推移のまとめ方
  const summaryEl = document.getElementById("stats-summary");
  const trendEl = document.getElementById("trend");
  const trendLegendEl = document.getElementById("trend-legend");
  const rankingEl = document.getElementById("ranking");
  const rankingLegendEl = document.getElementById("ranking-legend");
  const levelsEl = document.getElementById("levels");
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
      // レベルの達成度と、達成レベルが上がった回は、絞り込まずに全部の記録から出す
      renderLevels(sessions);
      Trend.render(trendEl, trendLegendEl, picked, groupEl.value, { levelUps: Levels.levelUps(sessions) });
      updateRanking(picked);
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  // レベルの達成度の表（行：言語、列：モード（文章・単語））。決まりは docs/levels.md
  const LANGS = [["en", "英語"], ["ja", "日本語"]];
  const MODES = [["normal", "文章"], ["words", "単語"]];

  function renderLevels(sessions) {
    levelsEl.textContent = "";
    const table = document.createElement("table");
    table.className = "level-table";
    const head = table.createTHead().insertRow();
    head.appendChild(cell("th", ""));
    MODES.forEach(function (m) { head.appendChild(cell("th", m[1])); });
    const body = table.createTBody();
    LANGS.forEach(function (lang) {
      const tr = body.insertRow();
      tr.appendChild(cell("th", lang[1]));
      MODES.forEach(function (mode) {
        const td = document.createElement("td");
        const sum = Levels.summary(sessions, lang[0], mode[0]);
        if (sum.count === 0) {
          td.appendChild(line("level-none", "まだ記録がありません"));
        } else {
          td.appendChild(line("level-name", sum.level ? sum.level.name : "なし"));
          if (sum.level) td.appendChild(line("level-sub", "達成 " + Filters.localDate(sum.achievedAt).replace(/-/g, "/")));
          td.appendChild(line("level-sub", sum.bestRate === null
            ? "正確率 " + Store.RANK_MIN_ACCURACY + "% 以上の回がありません"
            : "最高 " + sum.bestRate.toFixed(2) + " 文字/秒"));
          td.appendChild(line("level-target", !sum.target ? "一番上のレベルです"
            : "次の目標 " + sum.target.name + (sum.gap !== null && sum.gap >= 0 ? " まで あと " + Math.max(sum.gap, 0.01).toFixed(2) + " 文字/秒" : "")));
        }
        tr.appendChild(td);
      });
    });
    levelsEl.appendChild(table);
  }

  function cell(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }

  function line(className, text) {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
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
  filters.ready.then(update);
})();
