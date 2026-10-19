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
  // ランキングの行をクリックしたときに出す、その回のキーごとの間隔
  const svEl = document.getElementById("session-view");
  const svSummaryEl = document.getElementById("sv-summary");
  const svNoteEl = document.getElementById("sv-note");
  const svWhatEl = document.getElementById("sv-what");
  const svAvgEl = document.getElementById("sv-avg");
  const svChartEl = document.getElementById("sv-chart");
  let selectedId = null; // 表示中の回の id
  let trendData = null;  // 推移のグラフに描く記録と、達成レベルが上がった回（選んだ回が変わったら描き直す）
  let rankingRows = [];  // ランキングに出している回（順位を求めるのに使う）
  let viewId = 0;        // 古い読み込みの結果で上書きしないための番号
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
      trendData = { picked: picked, levelUps: Levels.levelUps(sessions) };
      updateRanking(picked);
      drawTrend(); // ランキングで選んだ回が絞り込みで外れたら閉じるので、ランキングの後に描く
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }


  // 推移のグラフ。ランキングで選んだ回（selectedId）の位置に緑の縦線を引く（1回ごとのときだけ）
  function drawTrend() {
    if (!trendData) return;
    Trend.render(trendEl, trendLegendEl, trendData.picked, groupEl.value, { levelUps: trendData.levelUps, selectedId: selectedId });
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
            ? "正確率 " + Levels.MIN_ACCURACY + "% 以上の回がありません"
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
    rankingRows = rows.slice(0, RANK_TOP);
    // 絞り込みを変えて、表示中の回がランキングから外れたら閉じる。残っていれば順位などを出し直す
    const sel = rankingRows.find(function (s) { return s.id === selectedId; });
    if (sel) showSession(sel, false);
    else closeSession();
    drawRanking(cats.size > 1);
  }

  let rankingCategory = false;
  function drawRanking(category) {
    rankingCategory = category;
    Ranking.render(rankingEl, rankingRows, null, {
      category: category,
      emptyText: "データなし",
      selectedId: selectedId,
      onSelect: function (s) {
        // 同じ行をもう一度クリックすると閉じる
        if (s.id === selectedId) closeSession();
        else showSession(s, true);
        drawRanking(rankingCategory);
      }
    });
  }

  // その回の生データを読み、結果画面と同じキーごとの間隔のグラフを描く。scroll なら、その区分までページをスクロールする
  function showSession(session, scroll) {
    selectedId = session.id;
    drawTrend();
    const myId = ++viewId;
    const rank = rankingRows.findIndex(function (s) { return Store.compare(s, session) === 0; }) + 1;
    let raw = null;
    Promise.all([
      Store.eachRaw(new Set([session.id]), function (r) { raw = r; }),
      Store.getAllLayouts()
    ]).then(function (v) {
      if (myId !== viewId) return;
      svEl.hidden = false;
      svSummaryEl.textContent = SessionView.summary(session, rank);
      if (!raw) {
        svNoteEl.hidden = false;
        svNoteEl.textContent = "この回の生データが見つかりません。";
        svChartEl.textContent = "";
        svWhatEl.textContent = "-";
        svAvgEl.textContent = "-";
      } else {
        const r = SessionView.render(svChartEl, session, raw, v[1]);
        svWhatEl.textContent = r.what;
        svAvgEl.textContent = r.avg;
        svNoteEl.hidden = !r.note;
        svNoteEl.textContent = r.note;
      }
      if (scroll) svEl.scrollIntoView({ block: "start", behavior: "smooth" });
    }).catch(function (err) {
      console.error(err);
      svEl.hidden = false;
      svNoteEl.hidden = false;
      svNoteEl.textContent = "この回の記録を読み込めませんでした: " + err.message;
    });
  }

  function closeSession() {
    selectedId = null;
    viewId++;
    svEl.hidden = true;
    svChartEl.textContent = "";
    drawTrend();
  }

  document.getElementById("sv-close").addEventListener("click", function () {
    closeSession();
    drawRanking(rankingCategory);
  });
  groupEl.addEventListener("change", update);
  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
