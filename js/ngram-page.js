// IKI のページ（ngram.html）。絞り込んだ記録の生データから bigram・trigram を集計して表示する
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
  const keyIkiEl = document.getElementById("key-iki"); // キーごとの IKI の配列図
  const keyIkiLegendEl = document.getElementById("key-iki-legend");
  const layoutFilterEl = document.getElementById("f-layout");

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号
  const trendEl = document.getElementById("f-trend"); // 分布の下の IKI の推移の横軸（回数・日付）
  let trendInfo = { mode: "run", runs: 0, firstDay: null, lastDay: null }; // NGram.setTrend に渡したもの

  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    Promise.all([Store.getAllSessions(), Store.getAllLayouts()]).then(function (v) {
      if (myId !== loadId) return;
      const sessions = v[0];
      // 絞り込みの「配列」でかな配列を選んでいれば、キーごとの IKI の配列図にその配列のかなを書く
      const layout = v[1].find(function (l) { return l.id === layoutFilterEl.value; });
      const kana = layout ? KeyMap.kanaOf(KanaLayout.create(layout.entries)) : null;
      const picked = filters.pick(sessions);
      summaryEl.textContent = Filters.summary(picked);
      // IKI の推移の横軸：絞り込んだ記録の古い順の通し番号（回数）と、その記録の日（このPCの日付）
      const tags = new Map();
      picked.forEach(function (s, i) {
        tags.set(s.id, { run: i + 1, day: Filters.localDate(s.finishedAt), at: s.finishedAt });
      });
      trendInfo = {
        mode: trendEl.value,
        runs: picked.length,
        firstDay: picked.length ? Filters.localDate(picked[0].finishedAt) : null,
        lastDay: picked.length ? Filters.localDate(picked[picked.length - 1].finishedAt) : null
      };
      NGram.setTrend(trendInfo);
      if (picked.length === 0) {
        ngramSummaryEl.textContent = "";
        bigramTable.renderRows(bigramEl, [], 0, "データなし");
        trigramTable.renderRows(trigramEl, [], 0, "データなし");
        drawKeyIki([], 0, kana);
        drawHeatmaps([], 0);
        return;
      }

      const ids = new Set(picked.map(function (s) { return s.id; }));
      const bigrams = new Map();
      let strokes = 0; // 総打鍵数：選んだ記録の、押したキー（events の "k" の行）の数。Shift・Backspace・間違えたキーも数える
      const trigrams = new Map();
      ngramSummaryEl.textContent = "集計中…";
      return Store.eachRaw(ids, function (raw) {
        // 押したキーの記録（events の "k" の行）から数える。英語も日本語も同じ
        NGram.accumulate(bigrams, 2, raw.events, tags.get(raw.id));
        NGram.accumulate(trigrams, 3, raw.events, tags.get(raw.id));
        raw.events.forEach(function (e) { if (e[1] === "k") strokes++; });
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
        drawKeyIki(allBi, base, kana);
        drawHeatmaps(bi, base);
        ngramSummaryEl.textContent = "総打鍵数 " + strokes.toLocaleString() + " ／ bigram " + bi.length + " 種類・trigram " + tri.length + " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  // キーごとの IKI：そのキーを押すまでの間隔（直前のキーからそのキーまで。bigram の2キー目がそのキーの間隔）の平均を、
  // 配列図にキーごとの色で描く。色は表と同じ（全体の打鍵間隔の平均が基準）。bigram と同じく、間違えたキー・Backspace・
  // スペース・Shift と同時に押したキーが絡む間隔は除く。「回数」の絞り込みは使わない（全部の bigram から出す）
  function drawKeyIki(allBi, base, kana) {
    const byKey = {}; // QWERTY の文字 → { sum, count }
    allBi.forEach(function (r) {
      const k = r.gram[1];
      const e = byKey[k] || (byKey[k] = { sum: 0, count: 0 });
      r.values.forEach(function (v) { e.sum += v; e.count++; });
    });
    keyIkiLegendEl.textContent = "";
    keyIkiLegendEl.append("そのキーを押すまでの間隔（直前のキーから）の平均（ms）。色は表と同じで、全体の打鍵間隔の平均（" + Math.round(base) + " ms）が基準 ／ 速い");
    const scale = document.createElement("span");
    scale.className = "rhythm-scale";
    keyIkiLegendEl.append(scale, "遅い ／ 間違えたキー・Backspace・スペース・Shift と同時に押したキーが絡む間隔は除く ／ 1回でもあれば色を付ける（回数が少ないキーは平均がぶれやすい）／ マウスを乗せると回数を表示");
    KeyMap.draw(keyIkiEl, function (number) {
      const label = Keys.label(number);
      const e = label === null ? null : byKey[label];
      if (!e || !e.count) return null;
      const avg = e.sum / e.count;
      return {
        fill: Rhythm.color(avg, base),
        dark: true, // 表と同じ濃い色なので、文字は白
        value: String(Math.round(avg)),
        title: label + "：平均 " + Math.round(avg) + " ms（" + e.count.toLocaleString() + " 回）"
      };
    }, kana);
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
  // 推移の横軸を切り替えたら、集計し直さずに分布の下の推移だけを描き直す
  trendEl.addEventListener("change", function () {
    trendInfo.mode = trendEl.value;
    NGram.setTrend(trendInfo);
    bigramTable.refresh();
    trigramTable.refresh();
  });
  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
