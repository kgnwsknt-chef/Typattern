// キーごとの値と頻度の散布図（IKI のページのキーごとの IKI と頻度、ミスタイプのページのキーごとのミス率と頻度で使う）。
// 点は1キー。横軸は頻度（全キーに対する割合 %、対数の目盛り）、縦軸はキーごとの値。点の色は指・行(row)・手（js/finger-map.js）。
// 決まりは docs/analysis_iki.md の「キーごとの IKI と頻度」
const KeyScatter = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  // 色分けごとの組 [値, 名前, 色]。FingerMap.keyOf の値で引く。割り当てのないキーは灰色
  const GROUPS = {
    finger: { of: function (k) { return k.finger; }, list: [[1, "人差し指", "var(--cmp-fast)"], [2, "中指", "var(--cmp-3)"], [3, "薬指", "var(--cmp-4)"], [4, "小指", "var(--cmp-5)"]] },
    row: { of: function (k) { return k.row; }, list: [[0, "数字の行", "var(--cmp-slow)"], [1, "上の行", "var(--cmp-4)"], [2, "ホーム行", "var(--cmp-3)"], [3, "下の行", "var(--cmp-5)"]] },
    hand: { of: function (k) { return k.hand; }, list: [["L", "左手", "var(--cmp-fast)"], ["R", "右手", "var(--cmp-4)"]] }
  };
  const NONE = ["割り当てなし", "var(--sub)"];

  function svgNode(name, attrs, text) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // el に描く。points：[{ key: QWERTY の文字, count: 頻度に数える回数, value: 縦軸の値, weak: 白抜きにするか, tip: マウスを乗せたときの文（キー名などの後に続ける） }]
  //   opts：colorBy（"finger"・"row"・"hand"）、unit（縦軸の単位。「ms」「%」）、fromZero（縦軸を 0 から始める）、ariaLabel、emptyText
  function draw(el, points, opts) {
    el.textContent = "";
    const total = points.reduce(function (a, p) { return a + p.count; }, 0);
    const pts = points.filter(function (p) { return p.count > 0; }).map(function (p) {
      return { key: p.key, count: p.count, share: p.count / total * 100, value: p.value, weak: !!p.weak, tip: p.tip };
    });
    const group = GROUPS[opts.colorBy] || GROUPS.finger;
    const colorOf = function (key) {
      const k = FingerMap.keyOf(key);
      const g = k ? group.list.find(function (x) { return x[0] === group.of(k); }) : null;
      return g ? { name: g[1], color: g[2] } : { name: NONE[0], color: NONE[1] };
    };

    // 図の上：キーの数と、色の凡例（題は HTML の見出し）
    const head = document.createElement("div");
    head.className = "dist-head";
    const info = document.createElement("span");
    info.className = "dist-info";
    info.textContent = "キー " + pts.length + " 個";
    head.append(info);
    el.appendChild(head);
    if (pts.length === 0) {
      const p = document.createElement("p");
      p.className = "hm-empty";
      p.textContent = opts.emptyText || "対象になるキーがありません。";
      el.appendChild(p);
      return;
    }
    const legend = document.createElement("div");
    legend.className = "kf-legend";
    const used = new Set(pts.map(function (p) { return colorOf(p.key).name; }));
    group.list.map(function (g) { return [g[1], g[2]]; }).concat([NONE]).forEach(function (g) {
      if (!used.has(g[0])) return;
      const item = document.createElement("span");
      const sw = document.createElement("span");
      sw.className = "kf-swatch";
      sw.style.background = g[1];
      item.append(sw, g[0]);
      legend.appendChild(item);
    });
    el.appendChild(legend);

    // 横軸：割合の対数（切りのよい 1・2・5 の目盛り）。縦軸：キーの値の範囲に少し余白（fromZero なら 0 から）
    const W = 560, H = 300, L = 44, R = 16, T = 12, B = 34;
    const pw = W - L - R, ph = H - T - B;
    let x0 = Math.log10(Math.min.apply(null, pts.map(function (p) { return p.share; })));
    let x1 = Math.log10(Math.max.apply(null, pts.map(function (p) { return p.share; })));
    if (x1 - x0 < 0.5) { x0 -= 0.25; x1 += 0.25; }
    const xpad = (x1 - x0) * 0.05;
    x0 -= xpad; x1 += xpad;
    const ys = pts.map(function (p) { return p.value; });
    let y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const ypad = Math.max(opts.unit === "%" ? 0.5 : 10, (y1 - y0) * 0.08);
    y0 = opts.fromZero ? 0 : Math.max(0, y0 - ypad);
    y1 += ypad;
    const X = function (share) { return L + (Math.log10(share) - x0) / (x1 - x0) * pw; };
    const Y = function (v) { return T + ph - (v - y0) / (y1 - y0) * ph; };
    const svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, class: "dist-svg kf-svg", role: "img", "aria-label": opts.ariaLabel });
    svg.appendChild(svgNode("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    svg.appendChild(svgNode("line", { x1: L, y1: T, x2: L, y2: T + ph, class: "dist-axis" }));
    for (let d = Math.floor(x0); d <= Math.ceil(x1); d++) {
      [1, 2, 5].forEach(function (m) {
        const v = m * Math.pow(10, d), lv = Math.log10(v);
        if (lv < x0 || lv > x1) return;
        svg.appendChild(svgNode("line", { x1: X(v), y1: T, x2: X(v), y2: T + ph, class: "trend-grid" }));
        svg.appendChild(svgNode("text", { x: X(v), y: T + ph + 13, "text-anchor": "middle", class: "dist-label" }, String(Number(v.toPrecision(2)))));
      });
    }
    svg.appendChild(svgNode("text", { x: L + pw, y: H - 4, "text-anchor": "end", class: "dist-label" }, "頻度（全体に対する割合 %、対数）→"));
    const yStep = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200].find(function (s) { return (y1 - y0) / s <= 6; }) || 500;
    for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
      svg.appendChild(svgNode("line", { x1: L, y1: Y(v), x2: L + pw, y2: Y(v), class: "trend-grid" }));
      svg.appendChild(svgNode("text", { x: L - 5, y: Y(v) + 3, "text-anchor": "end", class: "dist-label" }, String(Number(v.toPrecision(3)))));
    }
    svg.appendChild(svgNode("text", { x: L - 5, y: T - 2, "text-anchor": "end", class: "dist-label" }, opts.unit));

    // 点と文字（白抜きの点は、枠だけ色を付ける）
    pts.forEach(function (p) {
      const c = colorOf(p.key);
      const g = svgNode("g", { class: "kf-point" + (p.weak ? " kf-weak" : "") });
      g.appendChild(svgNode("circle", p.weak
        ? { cx: X(p.share), cy: Y(p.value), r: 3.5, fill: "var(--bg)", stroke: c.color, "stroke-width": 1.5 }
        : { cx: X(p.share), cy: Y(p.value), r: 4, fill: c.color }));
      g.appendChild(svgNode("text", { x: X(p.share) + 6, y: Y(p.value) + 4, class: "kf-label" }, p.key));
      const num = Keys.ofChar(p.key);
      g.appendChild(svgNode("title", {}, p.key + "（" + (num ? num.number : "-") + "・" + c.name + "）：" + p.tip +
        "（頻度 " + p.share.toFixed(2) + "%）"));
      svg.appendChild(g);
    });
    el.appendChild(svg);
  }

  return { draw: draw };
})();
