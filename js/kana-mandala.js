// キー配列習得の「覚えたかなの図」（かなの曼荼羅）を SVG で描く。まだどのページからも使っていない（記録のページで使う予定）。
// 決まりは docs/layout-learning.md の「覚えたかなの図」。例の図は docs/images/layout-learning-mandala.svg
const KanaMandala = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // 放射線（行）：中心から外へ、あ段 → お段の順。かなのない位置は空文字
  const ROWS = [
    ["あ", "い", "う", "え", "お"], ["か", "き", "く", "け", "こ"], ["さ", "し", "す", "せ", "そ"], ["た", "ち", "つ", "て", "と"],
    ["な", "に", "ぬ", "ね", "の"], ["は", "ひ", "ふ", "へ", "ほ"], ["ま", "み", "む", "め", "も"], ["や", "", "ゆ", "", "よ"],
    ["ら", "り", "る", "れ", "ろ"], ["わ", "", "", "", "を"], ["が", "ぎ", "ぐ", "げ", "ご"], ["ざ", "じ", "ず", "ぜ", "ぞ"],
    ["だ", "ぢ", "づ", "で", "ど"], ["ば", "び", "ぶ", "べ", "ぼ"], ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"]
  ];
  // 花びら（拗音）：放射線の番号 → い段のかな。その放射線と次の放射線の間に、内側から ゃ・ゅ・ょ の組を置く
  const PETALS = { 1: "き", 2: "し", 3: "ち", 4: "に", 5: "ひ", 6: "み", 8: "り", 10: "ぎ", 11: "じ", 13: "び", 14: "ぴ" }; // ぢゃ・ぢゅ・ぢょ は単位にしない
  const SMALL_YOUON = ["ゃ", "ゅ", "ょ"];
  const CENTER = ["ん", "、", "。", "っ"];
  // 一番外の輪：小書き・ゔ・ー。外来語の組（ふぁ・てぃ など）は、割り当て表にあるものを後ろに足す
  const OUTER = ["ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゃ", "ゅ", "ょ", "ゎ", "ゔ", "ー"];

  // 大きさ（viewBox 700 × 620 のときの座標）
  const W = 700, H = 620;
  const CX = 300, CY = 318;               // 中心
  const R = [58, 88, 118, 148, 178];      // 段の円（あ段〜お段）
  const RP = [202, 226, 250];             // 花びらの ゃ・ゅ・ょ
  const RX = 278;                         // 一番外の輪
  const RC = 24;                          // 中心の輪
  const NODE_R = 9.5, NODE_R_WIDE = 12;   // かなの丸（2文字の組は大きく）
  const STEP = 2 * Math.PI / ROWS.length;

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // あ行は中心から真下、ほかの行は同じ角度ずつ回す
  function rowAngle(i) { return Math.PI / 2 + i * STEP; }
  function pt(r, a) { return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
  function arcPath(r, a1, a2) {
    const p1 = pt(r, a1), p2 = pt(r, a2);
    return "M" + p1[0] + " " + p1[1] + "A" + r + " " + r + " 0 " + (a2 - a1 > Math.PI ? 1 : 0) + " 1 " + p2[0] + " " + p2[1];
  }

  // 図に出す単位の一覧（この配列にあるかどうかは問わない）。youon：割り当て表に拗音の組があるか、foreign：外来語の組
  function allUnits(youon, foreign) {
    const out = [];
    ROWS.forEach(function (row) { row.forEach(function (k) { if (k) out.push(k); }); });
    if (youon) Object.keys(PETALS).forEach(function (i) { SMALL_YOUON.forEach(function (s) { out.push(PETALS[i] + s); }); });
    return out.concat(CENTER, OUTER, foreign || []);
  }

  // el に図を描く。opts：
  //   has(unit)   … その配列に、その単位（かな・組）があるか
  //   learned     … 覚えた単位の Set
  //   youon       … 割り当て表に拗音の組があるか（なければ花びらを描かない）
  //   foreign     … 割り当て表にある外来語の組の並び（一番外の輪の後ろに足す）
  // 返り値 { learned: 覚えた単位の数, total: その配列の単位の数 }
  function draw(container, opts) {
    const has = function (k) { return !!k && opts.has(k); };
    const learned = opts.learned;
    const on = function (k) { return learned.has(k); };
    container.textContent = "";
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "kmd", role: "img", "aria-label": "覚えたかなの図" }, container);
    const guide = el("g", {}, svg), lines = el("g", {}, svg), nodes = el("g", {}, svg), side = el("g", {}, svg);
    const line = function (d, full) { el("path", { d: d, class: full ? "kmd-full" : "kmd-part" }, lines); };
    const node = function (x, y, k) {
      el("circle", { cx: x, cy: y, r: k.length > 1 ? NODE_R_WIDE : NODE_R, class: on(k) ? "kmd-on" : "kmd-off" }, nodes);
      el("text", { x: x, y: y, class: on(k) ? "kmd-on" : "kmd-off" }, nodes).textContent = k;
    };

    // 下書きの円と放射線
    R.concat([RX, RC]).forEach(function (r) { el("circle", { cx: CX, cy: CY, r: r, class: "kmd-guide" }, guide); });
    ROWS.forEach(function (row, i) {
      const p1 = pt(R[0], rowAngle(i)), p2 = pt(R[4], rowAngle(i));
      el("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], class: "kmd-guide" }, guide);
    });

    // 放射線（行）：隣り合う2つを覚えたら線でつなぐ。行を全部覚えたら太い線
    ROWS.forEach(function (row, i) {
      const idx = [0, 1, 2, 3, 4].filter(function (j) { return has(row[j]); });
      const full = idx.every(function (j) { return on(row[j]); });
      for (let t = 0; t + 1 < idx.length; t++) {
        const a = idx[t], b = idx[t + 1];
        if (!on(row[a]) || !on(row[b])) continue;
        const p1 = pt(R[a], rowAngle(i)), p2 = pt(R[b], rowAngle(i));
        line("M" + p1[0] + " " + p1[1] + "L" + p2[0] + " " + p2[1], full);
      }
    });
    // 同心円（段）：同じ段の隣り合う2つを覚えたら弧でつなぐ。段を全部覚えたら太い円
    for (let j = 0; j < 5; j++) {
      const idx = ROWS.map(function (row, i) { return has(row[j]) ? i : -1; }).filter(function (i) { return i >= 0; });
      const full = idx.every(function (i) { return on(ROWS[i][j]); });
      idx.forEach(function (i, t) {
        const n = idx[(t + 1) % idx.length];
        if (!on(ROWS[i][j]) || !on(ROWS[n][j])) return;
        line(arcPath(R[j], rowAngle(i), rowAngle(n) + (n <= i ? 2 * Math.PI : 0)), full);
      });
    }

    // 花びら（拗音）：その行の組が1つもこの配列になければ描かない
    if (opts.youon) {
      Object.keys(PETALS).forEach(function (key) {
        const i = Number(key);
        const ks = SMALL_YOUON.map(function (s) { return PETALS[key] + s; });
        const idx = [0, 1, 2].filter(function (t) { return has(ks[t]); });
        if (!idx.length) return;
        const a = rowAngle(i) + STEP / 2;
        const full = idx.every(function (t) { return on(ks[t]); });
        el("ellipse", { cx: (RP[0] + RP[2]) / 2, cy: 0, rx: (RP[2] - RP[0]) / 2 + 17, ry: 15,
          transform: "translate(" + CX + " " + CY + ") rotate(" + (a * 180 / Math.PI) + ")", class: full ? "kmd-petal-full" : "kmd-petal" }, lines);
        for (let t = 0; t + 1 < idx.length; t++) {
          const p = idx[t], q = idx[t + 1];
          if (!on(ks[p]) || !on(ks[q])) continue;
          const p1 = pt(RP[p], a), p2 = pt(RP[q], a);
          line("M" + p1[0] + " " + p1[1] + "L" + p2[0] + " " + p2[1], full);
        }
        idx.forEach(function (t) { const p = pt(RP[t], a); node(p[0], p[1], ks[t]); });
      });
    }

    // 輪（中心・一番外）：並んだ順に隣どうしをつなぐ。全部覚えたら太い円
    function ring(list, r, a0) {
      const xs = list.filter(has);
      const at = function (t) { return a0 + t * 2 * Math.PI / xs.length; };
      const full = xs.length > 0 && xs.every(on);
      xs.forEach(function (k, t) {
        const n = (t + 1) % xs.length;
        if (xs.length < 2 || !on(k) || !on(xs[n])) return;
        line(arcPath(r, at(t), at(n) + (n <= t ? 2 * Math.PI : 0)), full);
      });
      return { xs: xs, at: at };
    }
    const outerList = OUTER.concat(opts.foreign || []);
    const outer = ring(outerList, RX, Math.PI / 2 + Math.PI / outerList.length);
    const center = ring(CENTER, RC, Math.PI / 4);

    ROWS.forEach(function (row, i) {
      row.forEach(function (k, j) { if (has(k)) { const p = pt(R[j], rowAngle(i)); node(p[0], p[1], k); } });
    });
    outer.xs.forEach(function (k, t) { const p = pt(RX, outer.at(t)); node(p[0], p[1], k); });
    center.xs.forEach(function (k, t) { const p = pt(RC, center.at(t)); node(p[0], p[1], k); });

    // この配列にないかな：図には出さず、右に薄く2列で並べる
    const units = allUnits(opts.youon, opts.foreign);
    const absent = units.filter(function (k) { return !has(k); });
    if (absent.length) {
      el("text", { x: 608, y: 40, class: "kmd-note" }, side).textContent = "この配列に";
      el("text", { x: 608, y: 56, class: "kmd-note" }, side).textContent = "ないかな";
      absent.forEach(function (k, t) {
        const x = 622 + (t % 2) * 34, y = 84 + Math.floor(t / 2) * 30;
        el("circle", { cx: x, cy: y, r: NODE_R_WIDE, class: "kmd-no" }, side);
        el("text", { x: x, y: y, class: "kmd-no" }, side).textContent = k;
      });
    }

    // 覚えた数（その配列の単位のうち）
    const present = units.filter(has);
    const got = present.filter(on).length;
    el("text", { x: 20, y: 28, class: "kmd-count" }, svg).textContent = "覚えた " + got + " / " + present.length;
    return { learned: got, total: present.length };
  }

  return { ROWS: ROWS, PETALS: PETALS, CENTER: CENTER, OUTER: OUTER, allUnits: allUnits, draw: draw };
})();
