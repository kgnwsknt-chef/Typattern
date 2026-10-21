// ミスタイプのページ（mistype.html）。絞り込んだ記録の生データから、キーごとのストローク回数・ミス率と、
// 打ち間違いの組・種類を集計して表示する。集計は js/mistype.js、決まりは docs/analysis_mistype.md
(function () {
  "use strict";

  // ミス率に色を付けるのは、打つべきキーだった回数がこれ以上のキーだけ（少ないと率がぶれるため）
  const MIN_ATTEMPTS = 20;

  const summaryEl = document.getElementById("stats-summary");
  const mtSummaryEl = document.getElementById("mt-summary");
  const kbStrokesEl = document.getElementById("kb-strokes");
  const kbMissEl = document.getElementById("kb-miss");
  const kbMissLegendEl = document.getElementById("kb-miss-legend");
  const typesEl = document.getElementById("mt-types");
  const pairsEl = document.getElementById("mt-pairs");
  const filters = Filters.init(update);

  const minEl = document.getElementById("f-min"); // ミスが起きやすい並びに出す、打とうとした回数の下限
  const bigramLegendEl = document.getElementById("mt-bigram-legend");
  const hmMissEl = document.getElementById("hm-miss");
  const bigramsEl = document.getElementById("mt-bigrams");
  const intervalSummaryEl = document.getElementById("mt-interval-summary");
  const intervalLegendEl = document.getElementById("mt-interval-legend");
  const intervalEl = document.getElementById("mt-interval");

  const layoutFilterEl = document.getElementById("f-layout");

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号
  let lastAcc = null;
  let kbKana = null; // 配列図に割り当てを書くかな配列 { get, shifts }。QWERTY・「すべて」のときは null
  let pairRows = [];
  let sortKey = "count"; // 打ち間違いの組の並べ替え："expected"・"pressed"・"count"
  let order = "desc";
  let bgRows = [];       // ミスが起きやすい並び（回数の下限で絞ったもの）
  let bgScale = 0;       // 2次元ヒストグラムで一番濃くするミス率
  let bgSelected = null; // 強調している並び
  let bgSortKey = "rate"; // 並べ替え："gram"・"count"・"rate"
  let bgOrder = "desc";

  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    Promise.all([Store.getAllSessions(), Store.getAllLayouts()]).then(function (v) {
      if (myId !== loadId) return;
      const picked = filters.pick(v[0]);
      summaryEl.textContent = Filters.summary(picked);
      // かな配列ごとの打ち方の一覧とシフトのキー
      const kana = {};
      v[1].forEach(function (l) {
        const k = KanaLayout.create(l.entries);
        kana[l.id] = { options: k.options, map: KeyMap.kanaOf(k) };
      });
      // 絞り込みの「配列」でかな配列を選んでいれば、配列図にその配列の割り当て（シフトなしのかな）を書く
      kbKana = kana[layoutFilterEl.value] ? kana[layoutFilterEl.value].map : null;
      const byId = new Map(picked.map(function (s) { return [s.id, s]; }));
      const acc = Mistype.create();
      mtSummaryEl.textContent = picked.length ? "集計中…" : "";
      return Store.eachRaw(new Set(byId.keys()), function (raw) {
        const s = byId.get(raw.id);
        let optionsFn = null;
        let shifts = null;
        if (s.lang === "ja") {
          if (raw.keyLayout === "qwerty") optionsFn = Romaji.options;
          else if (kana[raw.keyLayout]) {
            optionsFn = kana[raw.keyLayout].options;
            shifts = kana[raw.keyLayout].map.shifts;
          }
        }
        Mistype.add(acc, raw, s.lang, optionsFn, shifts);
      }).then(function () {
        if (myId !== loadId) return;
        render(acc);
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

  function render(acc) {
    const pct = function (a, b) { return b ? (a / b * 100).toFixed(1) : "0.0"; };
    mtSummaryEl.textContent = "総打鍵数 " + acc.strokes.toLocaleString() +
      " ／ ミスの打鍵 " + acc.misses.toLocaleString() +
      " ／ 押し間違い（続けて起きたミスの最初）" + acc.firsts.toLocaleString() + "（総打鍵数の " + pct(acc.firsts, acc.strokes) + "%）" +
      (acc.skipped ? " ／ 判定を再現できず数えなかった記録 " + acc.skipped + " 回（かな配列を削除したなど）" : "");
    drawStrokes(acc);
    drawMisses(acc);
    drawTypes(acc);
    pairRows = Array.from(acc.pairs.values());
    drawPairs();
    lastAcc = acc;
    renderBigrams();
    drawIntervals(acc);
  }

  // ---- 配列図（描き方は js/key-map.js） ----

  // 数を短く書く（12345 → 12.3k）
  function short(n) {
    return n >= 10000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  // ストローク回数：多いほど濃い青（n-gram の2次元ヒストグラムの回数と同じ色）
  function drawStrokes(acc) {
    const max = Math.max.apply(null, Object.keys(acc.keys).map(function (n) { return acc.keys[n].strokes; }).concat([1]));
    KeyMap.draw(kbStrokesEl, function (number) {
      const st = acc.keys[number];
      const n = st ? st.strokes : 0;
      const f = n / max;
      return {
        fill: n ? "hsl(215, 75%, " + Math.round(96 - f * 64) + "%)" : null,
        dark: f > 0.55,
        value: short(n),
        title: Mistype.keyName({ number: number, shift: false }) + "：" + n.toLocaleString() + " 回"
      };
    }, kbKana);
  }

  // ミス率 = 押し間違い ÷ 打つべきキーだった回数。高いほど濃い赤。
  // 全体のミス率の3倍で一番濃くする（飛び抜けて高いキーが1つあっても、ほかのキーの違いが見えるように）
  function drawMisses(acc) {
    const rate = function (st) { return st.attempts ? st.misses / st.attempts : 0; };
    let attempts = 0, misses = 0;
    Object.keys(acc.keys).forEach(function (n) { attempts += acc.keys[n].attempts; misses += acc.keys[n].misses; });
    const max = attempts ? 3 * misses / attempts : 0;
    kbMissLegendEl.textContent = "押し間違い ÷ そのキーが打つべきキーだった回数。高いほど濃い赤（全体のミス率 " +
      (attempts ? (misses / attempts * 100).toFixed(1) : "0.0") + "% の3倍＝" + (max * 100).toFixed(1) + "% 以上は一番濃い）／ 打つべきキーだった回数が " +
      MIN_ATTEMPTS + " 回未満のキーは色を付けず、値を薄く表示 ／ マウスを乗せると回数を表示";
    KeyMap.draw(kbMissEl, function (number) {
      const st = acc.keys[number];
      if (!st || !st.attempts) return null;
      const r = rate(st);
      const enough = st.attempts >= MIN_ATTEMPTS;
      const f = max ? Math.min(1, r / max) : 0;
      return {
        fill: enough && r > 0 ? "hsl(0, 75%, " + Math.round(96 - f * 58) + "%)" : null,
        dark: enough && f > 0.6,
        dim: !enough,
        value: (r * 100).toFixed(1) + "%",
        title: Mistype.keyName({ number: number, shift: false }) + "：押し間違い " + st.misses + " ／ 打つべきキーだった回数 " + st.attempts
      };
    }, kbKana);
  }

  // ---- 表 ----

  function th(text) {
    const el = document.createElement("th");
    el.textContent = text;
    return el;
  }

  function td(className, text) {
    const el = document.createElement("td");
    if (className) el.className = className;
    el.textContent = text;
    return el;
  }

  function drawTypes(acc) {
    typesEl.textContent = "";
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    [th("種類"), th("回数"), th("割合")].forEach(function (c) { hr.appendChild(c); });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    const rows = Mistype.TYPES.filter(function (t) { return acc.types[t.id]; })
      .sort(function (a, b) { return acc.types[b.id] - acc.types[a.id]; });
    rows.forEach(function (t) {
      const tr = document.createElement("tr");
      tr.appendChild(td("", t.name));
      tr.appendChild(td("", acc.types[t.id].toLocaleString()));
      tr.appendChild(td("", (acc.types[t.id] / acc.firsts * 100).toFixed(1) + "%"));
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const c = td("", "押し間違いはありません");
      c.colSpan = 3;
      tr.appendChild(c);
      body.appendChild(tr);
    }
    typesEl.appendChild(table);
  }

  // 並べ替えのボタンを入れた見出し（n-gram の表と同じ形）
  //   state：{ key, order } の今の並べ替え。押すと state を変えて redraw を呼ぶ
  function sortHeader(state, key, text, firstOrder, names, redraw) {
    const cell = th("");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bg-sort" + (key === state.key ? " active" : "");
    const now = state.order === "asc" ? 0 : 1;
    if (key === state.key) {
      btn.textContent = text + " " + (state.order === "asc" ? "▲" : "▼");
      btn.title = names[now] + "（クリックで" + names[1 - now] + "）";
      cell.setAttribute("aria-sort", state.order === "asc" ? "ascending" : "descending");
    } else {
      btn.textContent = text;
      btn.title = "クリックで" + names[firstOrder === "asc" ? 0 : 1] + "に並べる";
    }
    btn.addEventListener("click", function () {
      if (key === state.key) state.order = state.order === "asc" ? "desc" : "asc";
      else {
        state.key = key;
        state.order = firstOrder;
      }
      redraw(state);
    });
    cell.appendChild(btn);
    return cell;
  }

  function pairSort() {
    return { key: sortKey, order: order };
  }

  function setPairSort(state) {
    sortKey = state.key;
    order = state.order;
    drawPairs();
  }

  function drawPairs() {
    pairsEl.textContent = "";
    const total = pairRows.reduce(function (a, r) { return a + r.count; }, 0);
    const name = function (k) { return Mistype.keyName(k); };
    const sign = order === "asc" ? 1 : -1;
    const rows = pairRows.slice().sort(function (x, y) {
      if (sortKey === "expected") return sign * name(x.expected).localeCompare(name(y.expected)) || y.count - x.count;
      if (sortKey === "pressed") return sign * name(x.pressed).localeCompare(name(y.pressed)) || y.count - x.count;
      return sign * (x.count - y.count) || name(x.expected).localeCompare(name(y.expected));
    });
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    hr.appendChild(sortHeader(pairSort(), "expected", "打つべきキー", "asc", ["文字の順", "文字の逆順"], setPairSort));
    hr.appendChild(sortHeader(pairSort(), "pressed", "押したキー", "asc", ["文字の順", "文字の逆順"], setPairSort));
    hr.appendChild(sortHeader(pairSort(), "count", "回数", "desc", ["少ない順", "多い順"], setPairSort));
    hr.appendChild(th("割合"));
    hr.appendChild(th("種類"));
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    rows.forEach(function (r) {
      const tr = document.createElement("tr");
      tr.appendChild(td("bg-name", name(r.expected)));
      tr.appendChild(td("bg-name", name(r.pressed)));
      tr.appendChild(td("", String(r.count)));
      tr.appendChild(td("", (r.count / total * 100).toFixed(1) + "%"));
      // 種類：多い順に「隣のキー 3・抜け 1」
      const types = Object.keys(r.types).sort(function (a, b) { return r.types[b] - r.types[a]; })
        .map(function (t) { return Mistype.TYPE_NAME[t] + (Object.keys(r.types).length > 1 ? " " + r.types[t] : ""); });
      tr.appendChild(td("mt-type", types.join("・")));
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const c = td("", "データなし");
      c.colSpan = 5;
      tr.appendChild(c);
      body.appendChild(tr);
    }
    pairsEl.appendChild(table);
  }

  // ---- ミスが起きやすい並び ----

  // 回数の下限で絞り、2次元ヒストグラムと表を描く。色は全体のミス率（全部の並び）の3倍で一番濃くする
  function renderBigrams() {
    const all = Mistype.bigramRows(lastAcc);
    let count = 0, misses = 0;
    all.forEach(function (r) { count += r.count; misses += r.misses; });
    const overall = count ? misses / count : 0;
    bgScale = overall * 3 || 0.01;
    const min = Number(minEl.value);
    bgRows = all.filter(function (r) { return r.count >= min; });
    if (bgSelected && !bgRows.some(function (r) { return r.gram === bgSelected; })) bgSelected = null;
    bigramLegendEl.textContent = "直前に正しく押したキー → 打つべきキー（QWERTY の文字）の並びごとに、打とうとした回数（正しく押した＋押し間違い）と押し間違いを数える。" +
      "直前がミスや Backspace のとき・スペースや Shift と同時に押したキーが絡む並びは除く ／ 全体のミス率 " + (overall * 100).toFixed(1) +
      "%。色はその3倍（" + (bgScale * 100).toFixed(1) + "%）以上が一番濃い赤 ／ マスか行をクリックすると、もう一方でもその並びを強調";
    drawBigramMap();
    drawBigramTable();
  }

  function selectBigram(gram, scroll) {
    bgSelected = gram;
    drawBigramMap();
    drawBigramTable();
    if (scroll) {
      const tr = bigramsEl.querySelector("tr.bg-selected");
      if (tr) bigramsEl.scrollTop = tr.offsetTop - bigramsEl.clientHeight / 2;
    }
  }

  function drawBigramMap() {
    NGram.drawHeatmap(hmMissEl, bgRows, "miss", bgScale, {
      selected: bgSelected,
      onSelect: function (r) { selectBigram(r.gram, true); }
    });
  }

  function drawBigramTable() {
    bigramsEl.textContent = "";
    const state = { key: bgSortKey, order: bgOrder };
    const redraw = function (s) { bgSortKey = s.key; bgOrder = s.order; drawBigramTable(); };
    const sign = bgOrder === "asc" ? 1 : -1;
    const rows = bgRows.slice().sort(function (x, y) {
      if (bgSortKey === "gram") return sign * x.gram.localeCompare(y.gram);
      if (bgSortKey === "count") return sign * (x.count - y.count) || y.rate - x.rate;
      return sign * (x.rate - y.rate) || y.count - x.count;
    });
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    hr.appendChild(sortHeader(state, "gram", "並び", "asc", ["文字の順", "文字の逆順"], redraw));
    hr.appendChild(sortHeader(state, "count", "回数", "desc", ["少ない順", "多い順"], redraw));
    hr.appendChild(th("押し間違い"));
    hr.appendChild(sortHeader(state, "rate", "ミス率", "desc", ["低い順", "高い順"], redraw));
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    rows.forEach(function (r) {
      const tr = document.createElement("tr");
      tr.className = "bg-row" + (r.gram === bgSelected ? " bg-selected" : "");
      tr.tabIndex = 0;
      tr.appendChild(td("bg-name", r.gram));
      tr.appendChild(td("", String(r.count)));
      tr.appendChild(td("", String(r.misses)));
      tr.appendChild(td("", (r.rate * 100).toFixed(1) + "%"));
      tr.addEventListener("click", function () { selectBigram(r.gram, false); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter") selectBigram(r.gram, false);
      });
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const c = td("", "データなし");
      c.colSpan = 4;
      tr.appendChild(c);
      body.appendChild(tr);
    }
    bigramsEl.appendChild(table);
  }

  minEl.addEventListener("change", function () { if (lastAcc) renderBigrams(); });

  // ---- 押し間違いの直前の間隔 ----

  // 押し間違いの直前の間隔と、正しい打鍵の間隔の分布を重ねて描く。それぞれの回数で割った割合（%）で描き、中央値を縦の点線で示す
  //   横軸は 0〜設定の「分布の横軸の最大」（n-gram の分布と同じ）。それ以上は一番右の区間に入れる
  function drawIntervals(acc) {
    const miss = acc.intervals.miss, normal = acc.intervals.normal;
    const mMed = Mistype.median(miss), nMed = Mistype.median(normal);
    intervalEl.textContent = "";
    if (!miss.length || !normal.length) {
      intervalSummaryEl.textContent = "比べられる打鍵がありません。";
      intervalLegendEl.textContent = "";
      return;
    }
    const ratio = mMed / nMed;
    const verdict = ratio < 0.9 ? "押し間違いの直前の方が短い：急いで（リズムより先に）打って間違えることが多い"
      : ratio > 1.1 ? "押し間違いの直前の方が長い：迷って（手が止まってから）間違えることが多い"
      : "差は小さい：速さとは関係なく間違えている";
    intervalSummaryEl.textContent = "中央値　押し間違いの直前 " + Math.round(mMed) + " ms（" + miss.length.toLocaleString() + " 回）／ 正しい打鍵 " +
      Math.round(nMed) + " ms（" + normal.length.toLocaleString() + " 回）→ " + verdict;
    intervalLegendEl.textContent = "押し間違いの直前の間隔 = 押し間違えたキーと、その直前のキーの時刻の差（直前が Backspace のものは除く）。正しい打鍵の間隔 = 直前も正しい打鍵だったもの ／ " +
      "それぞれの回数を 100% とした割合で描く ／ 縦の点線 = 中央値 ／ 中央値の差が 1 割以内なら「差は小さい」";

    const max = Settings.get("ngramMaxMs");
    const BINS = 50;
    const hist = function (values) {
      const h = new Array(BINS).fill(0);
      values.forEach(function (v) { h[Math.min(BINS - 1, Math.floor(v / max * BINS))]++; });
      return h.map(function (c) { return c / values.length * 100; });
    };
    const hm = hist(miss), hn = hist(normal);
    const top = Math.max.apply(null, hm.concat(hn));
    const W = 640, H = 220, L = 40, R = 10, T = 10, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const NS = "http://www.w3.org/2000/svg";
    const el = function (name, attrs, text) {
      const e = document.createElementNS(NS, name);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const x = function (v) { return L + Math.min(v, max) / max * pw; };
    const y = function (p) { return T + ph - p / top * ph; };
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "mt-interval-svg", role: "img", "aria-label": "押し間違いの直前の間隔と、正しい打鍵の間隔の分布" });
    // 正しい打鍵：青い棒
    hn.forEach(function (p, i) {
      svg.appendChild(el("rect", { x: L + i * pw / BINS + 0.5, y: y(p), width: pw / BINS - 1, height: T + ph - y(p), class: "mt-normal-bar" }));
    });
    // 押し間違いの直前：赤い線（階段状）
    let d = "M " + L + " " + y(0);
    hm.forEach(function (p, i) { d += " L " + (L + i * pw / BINS) + " " + y(p) + " L " + (L + (i + 1) * pw / BINS) + " " + y(p); });
    svg.appendChild(el("path", { d: d, class: "mt-miss-line" }));
    // 中央値
    svg.appendChild(el("line", { x1: x(nMed), y1: T, x2: x(nMed), y2: T + ph, class: "mt-normal-med" }));
    svg.appendChild(el("line", { x1: x(mMed), y1: T, x2: x(mMed), y2: T + ph, class: "mt-miss-med" }));
    // 軸と目盛り
    svg.appendChild(el("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    const step = max <= 500 ? 100 : max <= 1000 ? 200 : max <= 2500 ? 500 : 1000;
    for (let v = 0; v <= max; v += step) {
      svg.appendChild(el("text", { x: x(v), y: T + ph + 14, "text-anchor": "middle", class: "dist-label" }, String(v)));
    }
    svg.appendChild(el("text", { x: L + pw, y: T + ph + 28, "text-anchor": "end", class: "dist-label" }, "ms（" + max + " 以上は右端）"));
    svg.appendChild(el("text", { x: L - 4, y: T + 8, "text-anchor": "end", class: "dist-label" }, top.toFixed(0) + "%"));
    svg.appendChild(el("text", { x: L - 4, y: T + ph, "text-anchor": "end", class: "dist-label" }, "0"));
    // 凡例
    svg.appendChild(el("rect", { x: L + pw - 200, y: T + 2, width: 12, height: 8, class: "mt-normal-bar" }));
    svg.appendChild(el("text", { x: L + pw - 184, y: T + 10, class: "dist-label" }, "正しい打鍵"));
    svg.appendChild(el("line", { x1: L + pw - 110, y1: T + 6, x2: L + pw - 96, y2: T + 6, class: "mt-miss-line" }));
    svg.appendChild(el("text", { x: L + pw - 92, y: T + 10, class: "dist-label" }, "押し間違いの直前"));
    intervalEl.appendChild(svg);
  }

  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
