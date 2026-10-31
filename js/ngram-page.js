// IKI のページ（analysis_iki.html）。絞り込んだ記録の生データから bigram・trigram を集計して表示する
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
  // trigram の表で分布を出す行が変わったら、相関の図のその点を囲み直す
  const trigramTable = NGram.create(3, "trigram", document.getElementById("trigram-dist"), redrawCorr);
  const corrPairEl = document.getElementById("corr-pair");   // trigram の中の2つの間隔
  const corrInnerEl = document.getElementById("corr-inner"); // trigram の中の間隔と、bigram 全体の平均
  let corrTri = [];            // 相関の図に描く trigram（表と同じ）
  let corrBi = new Map();      // bigram の文字 → 行（「回数」で絞らない全部の bigram）
  const filters = Filters.init(update);
  const keyIkiEl = document.getElementById("key-iki"); // キーごとの IKI の配列図
  const keyIkiLegendEl = document.getElementById("key-iki-legend");
  const layoutFilterEl = document.getElementById("f-layout");

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号
  const loadingEl = document.getElementById("page-loading"); // 集計し終えるまで出す「Loading...」
  const trendEl = document.getElementById("f-trend"); // 分布の下の IKI の推移の横軸（回数・日付）
  let trendInfo = { mode: "run", runs: 0, firstDay: null, lastDay: null }; // NGram.setTrend に渡したもの

  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    loadingEl.hidden = false;
    Promise.all([Store.getAllSessions(), Store.getAllLayouts()]).then(function (v) {
      if (myId !== loadId) return;
      const sessions = v[0];
      // 絞り込みの「配列」でかな配列を選んでいれば、キーごとの IKI の配列図にその配列のかなを書く
      const layout = v[1].find(function (l) { return l.id === layoutFilterEl.value; });
      const kana = layout ? KeyMap.kanaOf(KanaLayout.create(layout.entries)) : null;
      const picked = filters.pick(sessions);
      summaryEl.textContent = Filters.summary(picked);
      // IKI の推移の横軸：絞り込んだ記録の古い順の通し番号（回数）と、その記録の日（このPCの日付）
      const tags = PointTrend.tagsOf(picked, Filters.localDate);
      trendInfo = PointTrend.axisOf(trendEl.value, picked, Filters.localDate);
      NGram.setTrend(trendInfo);
      if (picked.length === 0) {
        ngramSummaryEl.textContent = "";
        bigramTable.renderRows(bigramEl, [], 0, "データなし");
        trigramTable.renderRows(trigramEl, [], 0, "データなし");
        drawKeyIki([], 0, kana);
        drawHeatmaps([], 0);
        drawClasses([], [], 0);
        drawCorr([], []);
        return;
      }

      const byId = new Map(picked.map(function (s) { return [s.id, s]; }));
      const ids = new Set(byId.keys());
      const bigrams = new Map();
      let strokes = 0; // 総打鍵数：選んだ記録の、押したキー（events の "k" の行）の数。Shift・Backspace・間違えたキーも数える
      const trigrams = new Map();
      ngramSummaryEl.textContent = "集計中…";
      return Store.eachRaw(ids, function (raw) {
        // 押したキーの記録（events の "k" の行）から数える。英語も日本語も同じ。IKI 測定モードの回は、各語の1回目を数えない
        const skip = IkiMeasurement.skipOf(byId.get(raw.id), raw);
        NGram.accumulate(bigrams, 2, raw.events, tags.get(raw.id), skip);
        NGram.accumulate(trigrams, 3, raw.events, tags.get(raw.id), skip);
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
        const allTri = NGram.toRows(trigrams);
        const tri = allTri.filter(keep);
        drawClasses(allBi, allTri, base); // 指と行(row)で分けた分類は「回数」で絞らない
        bigramTable.renderRows(bigramEl, bi, base);
        trigramTable.renderRows(trigramEl, tri, base);
        drawKeyIki(allBi, base, kana);
        drawHeatmaps(bi, base);
        drawCorr(tri, allBi);
        ngramSummaryEl.textContent = "総打鍵数 " + strokes.toLocaleString() + " ／ bigram " + bi.length + " 種類・trigram " + tri.length + " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    }).then(function () {
      if (myId === loadId) loadingEl.hidden = true;
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
    // W A S D で動かしたとき（byKey）はページをスクロールしない。データのないマスに止まったら（r が null）分布を消す
    const opts = { selected: bigramTable.selected(), keyMove: true, onSelect: function (r, byKey) { bigramTable.show(r ? r.gram : null, byKey); } };
    NGram.drawHeatmap(hmCountEl, hmRows, "count", hmBase, opts);
    NGram.drawHeatmap(hmIkiEl, hmRows, "iki", hmBase, opts);
  }

  // ---- trigram と bigram の相関（決まりは docs/analysis_iki.md の「trigram と bigram の相関」） ----

  // tri：表に出す trigram（「回数」で絞ったもの）。allBi：全部の bigram（trigram の中の bigram の IKI を引く）
  function drawCorr(tri, allBi) {
    corrTri = tri;
    corrBi = new Map(allBi.map(function (r) { return [r.gram, r]; }));
    redrawCorr();
  }

  function redrawCorr() {
    const ms = function (v) { return Math.round(v) + " ms"; };
    const pair = [];
    const inner = [];
    corrTri.forEach(function (t) {
      const ab = corrBi.get(t.gram.slice(0, 2));
      const bc = corrBi.get(t.gram.slice(1));
      if (!ab || !bc) return;
      const head = t.gram + "（" + t.count + " 回）";
      // 左の図：横軸 = trigram の中の1つ目の間隔、縦軸 = 2つ目の間隔
      pair.push({ gram: t.gram, x: t.steps[0], y: t.steps[1], count: t.count,
        tip: head + "の中の間隔：1つ目 " + ab.gram + " " + ms(t.steps[0]) + " ／ 2つ目 " + bc.gram + " " + ms(t.steps[1]) });
      // 右の図：trigram の中の2つの間隔それぞれを、その bigram の点にする（1つ目・2つ目は区別しない）。
      // 横軸 = bigram の IKI、縦軸 = trigram の中の間隔
      [[ab, t.steps[0]], [bc, t.steps[1]]].forEach(function (s) {
        inner.push({ gram: t.gram, x: s[0].avg, y: s[1], count: t.count,
          tip: s[0].gram + "（bigram 全体の平均 " + ms(s[0].avg) + "）：trigram " + head + "の中では " + ms(s[1]) });
      });
    });
    const selected = trigramTable.selected();
    const onSelect = function (gram) { trigramTable.show(gram); };
    NGram.drawScatter(corrPairEl, pair, { title: "trigram の中の2つの間隔", xLabel: "1つ目の間隔（trigram の中）",
      yLabel: "2つ目の間隔（trigram の中）", selected: selected, onSelect: onSelect,
      noR: true, ariaLabel: "trigram の中の1つ目の間隔と2つ目の間隔の散布図" });
    NGram.drawScatter(corrInnerEl, inner, { title: "trigram の中の間隔と、bigram 全体の平均", xLabel: "bigram 全体の平均 IKI",
      yLabel: "間隔（trigram の中）", selected: selected, onSelect: onSelect,
      ariaLabel: "trigram の中の間隔と、その bigram の IKI の散布図" });
  }

  // ---- 指と行(row)で分けた bigram・trigram（分類は js/finger-map.js。決まりは docs/analysis_iki.md） ----

  // 表の行：{ name, ids: 合わせる分類の名前, level: 字下げ（0 はその表の見出しの行、1・2 はすぐ上の行の内訳）, desc: 定義（マウスを乗せると出す） }
  function node(name, ids, level, desc) { return { name: name, ids: ids, level: level || 0, desc: desc || "" }; }
  const PAIRS = ["12", "13", "14", "23", "24", "34"]; // 指の組（内側の指・外側の指）
  const pairName = function (p) { return FingerMap.FINGER_NAME[p[0]] + "と" + FingerMap.FINGER_NAME[p[1]]; };
  const NONE = node("分類しない", ["none"], 0, "指を割り当てていないキー（初期値では数字キーの行など）を含む組");
  function staggerNodes(side, name, desc) {
    const ids = PAIRS.map(function (p) { return "stagger-" + side + "-" + p; });
    return [node(name, ids, 1, desc)].concat(PAIRS.map(function (p, i) { return node(pairName(p), [ids[i]], 2); }));
  }
  const CLASS_TABLES = {
    biBase: {
      el: document.getElementById("bc-base"),
      idsOf: function (g) { return [FingerMap.bigramBase(g)]; },
      nodes: [
        node("alternation（左右交互）", ["alternation"], 0, "左右の手が違う"),
        node("repeat（連打）", ["repeat"], 0, "同じキーを続けて打つ"),
        node("SFB（同指異鍵）", ["sfb-0", "sfb-1", "sfb-2"], 0, "same-finger bigram。同じ指で、別のキーを続けて打つ"),
        node("同じ行", ["sfb-0"], 1, "同じ行のキーへ横に動く（例 fg）"),
        node("1行違い", ["sfb-1"], 1, "行が1つ違う（例 ed）"),
        node("2行以上違い", ["sfb-2"], 1, "行が2つ以上違う（例 ec）"),
        node("roll（ロール）", ["roll-in", "roll-out"], 0, "同じ手の別の指で続けて打つ"),
        node("内向き", ["roll-in"], 1, "小指 → 人差し指の向き（例 sd）"),
        node("外向き", ["roll-out"], 1, "人差し指 → 小指の向き（例 ds）"),
        NONE
      ]
    },
    biFeat: {
      el: document.getElementById("bc-feat"),
      idsOf: function (g) { return FingerMap.bigramBase(g) === "none" ? ["none"] : FingerMap.bigramFeatures(g); },
      nodes: [node("行(row)違い", PAIRS.map(function (p) { return "stagger-inner-" + p; })
        .concat(PAIRS.map(function (p) { return "stagger-outer-" + p; })), 0, "同じ手の別の指で、行が違う")]
        .concat(staggerNodes("inner", "内側の指が奥", "2つの指のうち、人差し指に近い方の指が奥の行（例 rd・se）"))
        .concat(staggerNodes("outer", "外側の指が奥", "2つの指のうち、小指に近い方の指が奥の行（例 ko・in）"))
        .concat([
          node("scissors", ["hsb", "fsb"], 0, "隣の指で、短い方の指が奥の行（人差し指と中指は人差し指、中指と薬指は薬指、薬指と小指は小指が短い）"),
          node("HSB（1行違い）", ["hsb"], 1, "half scissor bigram。行が1つ違う（例 dr・ko・pl）"),
          node("FSB（2行違い）", ["fsb"], 1, "full scissor bigram。上の行と下の行（例 cr）"),
          node("LSB（横の伸ばし）", ["lsb-12", "lsb-23", "lsb-34"], 0, "lateral stretch bigram。隣の指で、2つのキーの列の離れ方が、2つの指のホームの列の離れ方より大きい"),
          node("人差し指と中指", ["lsb-12"], 1, "初期値の割り当てでは、人差し指が中央の列（t g b・y h n）を打つ組（例 te・gd）"),
          node("中指と薬指", ["lsb-23"], 1, "初期値の割り当てでは入る組はない（割り当てを変えたときに入る）"),
          node("薬指と小指", ["lsb-34"], 1, "初期値の割り当てでは、小指が外側の列（[ ] \\ '）を打つ組（例 l'）"),
          NONE
        ])
    },
    triBase: {
      el: document.getElementById("tc-base"),
      idsOf: function (g) { return [FingerMap.trigramBase(g)]; },
      nodes: [
        node("alternate（交互）", ["alternate", "alternate-sf", "alternate-sk"], 0, "左右左・右左右（例 ake・pen）"),
        node("1・3キー目が同じ指", ["alternate-sf"], 1, "1キー目と3キー目が同じ指の別のキー（例 dke）"),
        node("1・3キー目が同じキー", ["alternate-sk"], 1, "1キー目と3キー目が同じキー（例 dkd）"),
        node("roll（ロール）", ["roll-in", "roll-out"], 0, "同じ手の別の指で2キー＋もう片方の手で1キー。向きは同じ手の2キーで決める（例 sdk・kds）"),
        node("内向き", ["roll-in"], 1),
        node("外向き", ["roll-out"], 1),
        node("onehand（一方向）", ["onehand-in", "onehand-out"], 0, "同じ手の別の指で3キー、同じ向き（例 asd・dsa）"),
        node("内向き", ["onehand-in"], 1),
        node("外向き", ["onehand-out"], 1),
        node("redirect（向きが変わる）", ["redirect", "redirect-noindex"], 0, "同じ手の別の指で3キー、途中で向きが変わる（例 era・rse）"),
        node("人差し指を含まない", ["redirect-noindex"], 1, "3キーとも人差し指以外（例 ads・sea）"),
        node("その他", ["other"], 0, "上のどれでもない（同じ手の中に同じ指・同じキーを含むなど。例 ter・ded）"),
        NONE
      ]
    },
    triFeat: {
      el: document.getElementById("tc-feat"),
      idsOf: function (g) {
        if (FingerMap.trigramBase(g) === "none") return ["none"];
        const s = FingerMap.trigramSfs(g);
        return s ? [s] : [];
      },
      nodes: [
        node("SFS（同じ指・別のキー）", ["sfs"], 0, "same-finger skipgram。1キー目と3キー目が同じ指の別のキー（間のキーは問わない。例 dke・ter）"),
        node("SFS（同じキー）", ["sfs-same"], 0, "1キー目と3キー目が同じキー（例 dkd・ded）"),
        NONE
      ]
    }
  };
  const SIDES = {
    bi: { tables: ["biBase", "biFeat"], distEl: document.getElementById("bc-dist"), label: "bigram の分類", selected: null },
    tri: { tables: ["triBase", "triFeat"], distEl: document.getElementById("tc-dist"), label: "trigram の分類", selected: null }
  };
  let classBase = 0; // 色の基準（bigram の表と同じ）

  // 集計した行（NGram.toRows の結果）を、表の行ごとにまとめる。割合の分母は、全部の組を打った回数
  function classRows(table, rows) {
    const byId = new Map();
    let total = 0;
    rows.forEach(function (r) {
      total += r.count;
      table.idsOf(r.gram).forEach(function (id) {
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(r);
      });
    });
    return table.nodes.map(function (n) {
      const grams = [];
      n.ids.forEach(function (id) { (byId.get(id) || []).forEach(function (r) { grams.push(r); }); });
      const values = [];
      const tags = [];
      grams.forEach(function (r) {
        r.values.forEach(function (v, i) { values.push(v); tags.push(r.tags[i]); });
      });
      const count = values.length;
      const avg = count ? values.reduce(function (a, b) { return a + b; }, 0) / count : null;
      const sd = count > 1 ? Math.sqrt(values.reduce(function (a, v) { return a + (v - avg) * (v - avg); }, 0) / (count - 1)) : null;
      const top = grams.slice().sort(function (x, y) { return y.count - x.count; }).slice(0, 3).map(function (r) { return r.gram; });
      return { node: n, gram: n.name, values: values, tags: tags, count: count, avg: avg, sd: sd,
        share: total ? count / total : 0, kinds: grams.length, top: top };
    });
  }

  function drawClasses(allBi, allTri, base) {
    classBase = base;
    [["bi", allBi], ["tri", allTri]].forEach(function (s) {
      const side = SIDES[s[0]];
      side.rows = {};
      side.tables.forEach(function (key) { side.rows[key] = classRows(CLASS_TABLES[key], s[1]); });
      // 分布を出す行：前に選んだ行（同じ表の同じ位置）があればそのまま、なければ基本の表の最初の行
      if (!side.selected || !side.rows[side.selected.table][side.selected.index].count) side.selected = { table: side.tables[0], index: 0 };
      drawClassSide(s[0]);
    });
  }

  function drawClassSide(sideKey) {
    const side = SIDES[sideKey];
    side.tables.forEach(function (key) {
      const el = CLASS_TABLES[key].el;
      el.textContent = "";
      const table = document.createElement("table");
      table.className = "bg-table";
      const hr = document.createElement("tr");
      ["分類", "回数", "割合", "種類", "IKI(ms/打)", "SD(ms)", "多い組"].forEach(function (t) {
        const th = document.createElement("th");
        th.textContent = t;
        hr.appendChild(th);
      });
      table.appendChild(document.createElement("thead")).appendChild(hr);
      const body = table.appendChild(document.createElement("tbody"));
      side.rows[key].forEach(function (r, index) {
        const tr = document.createElement("tr");
        const cell = function (className, text) {
          const td = document.createElement("td");
          if (className) td.className = className;
          td.textContent = text;
          tr.appendChild(td);
          return td;
        };
        const name = cell("fc-name fc-l" + r.node.level, r.node.name);
        if (r.node.desc) name.title = r.node.desc;
        cell("bg-count", r.count.toLocaleString());
        cell("bg-count", (r.share * 100).toFixed(1) + "%");
        cell("bg-count", r.kinds);
        const avg = cell("bg-avg", r.avg === null ? "-" : Math.round(r.avg));
        if (r.avg !== null && classBase) avg.style.color = Rhythm.color(r.avg, classBase);
        cell("bg-sd", r.sd === null ? "-" : Math.round(r.sd));
        cell("fc-top", r.top.join(" "));
        if (r.count) {
          const selected = side.selected.table === key && side.selected.index === index;
          tr.className = "bg-row" + (selected ? " bg-selected" : "");
          tr.tabIndex = 0;
          tr.title = "クリックで IKI の分布を表示";
          const pick = function () {
            side.selected = { table: key, index: index };
            drawClassSide(sideKey);
            side.distEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
          };
          tr.addEventListener("click", pick);
          tr.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
          });
        }
        body.appendChild(tr);
      });
      el.appendChild(table);
    });
    drawClassDist(sideKey);
  }

  // 選んだ分類の IKI の分布（推移は出さない）
  function drawClassDist(sideKey) {
    const side = SIDES[sideKey];
    const r = side.rows && side.selected ? side.rows[side.selected.table][side.selected.index] : null;
    if (r && r.count) NGram.drawDistribution(side.distEl, r, side.label, classBase);
    else side.distEl.textContent = "";
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
