// 回ごと・日ごとの値の推移を、点と移動平均の線で描く（IKI のページの n-gram の IKI、ミスタイプのページのキーのミス率で使う）
// 横軸は回数（絞り込んだ記録の古い順の通し番号）か日付（このPCの日付）。決まりは docs/analysis_iki.md の「IKI の推移」
const PointTrend = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const DAY_MS = 86400000;
  const MA_POINTS = 10; // 移動平均にする点の数（直近10点）

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function svgText(x, y, text, anchor) {
    const t = svgEl("text", { x: x, y: y, "text-anchor": anchor, class: "dist-label" });
    t.textContent = text;
    return t;
  }

  // "YYYY-MM-DD" を、日の通し番号にする（このPCの日付の0時。日の差を数えるのに使う）
  function dayIndex(day) {
    const p = day.split("-").map(Number);
    return Math.round(new Date(p[0], p[1] - 1, p[2]).getTime() / DAY_MS);
  }

  function fmtDay(day) {
    return day.replace(/-/g, "/");
  }

  // 記録の印 tag { run: 何回目か, day: "YYYY-MM-DD", at: 打ち終わりの日時 } を作る。sessions は絞り込んだ記録（古い順）
  function tagsOf(sessions, localDate) {
    const tags = new Map();
    sessions.forEach(function (s, i) {
      tags.set(s.id, { run: i + 1, day: localDate(s.finishedAt), at: s.finishedAt });
    });
    return tags;
  }

  // 横軸の決め方 { mode, runs, firstDay, lastDay }。mode は "run"（回数）か "day"（日付）
  function axisOf(mode, sessions, localDate) {
    return {
      mode: mode,
      runs: sessions.length,
      firstDay: sessions.length ? localDate(sessions[0].finishedAt) : null,
      lastDay: sessions.length ? localDate(sessions[sessions.length - 1].finishedAt) : null
    };
  }

  // el の下に、見出しと推移の図を足す
  //   groups：Map（回なら tag.run、日なら tag.day → { sum, count, tag }。点の値は sum ÷ count）
  //   opts：{ axis, title, info(点の数, 回数か) → 見出しの横の文, pointWhat（点の値の名前。「平均」など）, unit（縦軸の単位）, cap（縦軸の上限）,
  //           tip(点) → マウスを乗せたときの値の文, ariaLabel }
  function draw(el, groups, opts) {
    const axis = opts.axis;
    const byRun = axis.mode === "run";
    const firstX = byRun ? 1 : dayIndex(axis.firstDay);
    const lastX = byRun ? axis.runs : dayIndex(axis.lastDay);
    const points = Array.from(groups.values()).map(function (g) {
      return { x: byRun ? g.tag.run : dayIndex(g.tag.day), value: g.sum / g.count, sum: g.sum, count: g.count, tag: g.tag };
    }).sort(function (a, b) { return a.x - b.x; });
    // 移動平均（その点までの直近 MA_POINTS 点の値の平均）
    points.forEach(function (p, i) {
      const part = points.slice(Math.max(0, i - MA_POINTS + 1), i + 1);
      p.ma = part.reduce(function (a, q) { return a + q.value; }, 0) / part.length;
    });

    const head = document.createElement("div");
    head.className = "dist-head trend-head";
    const title = document.createElement("span");
    title.className = "dist-title";
    title.textContent = opts.title;
    const info = document.createElement("span");
    info.className = "dist-info";
    info.textContent = opts.info(points.length, byRun) + " ／ 点 = " + (byRun ? "1回" : "1日") + "の" + opts.pointWhat + " ／ 線 = 直近 " + MA_POINTS + " 点の移動平均";
    head.appendChild(title);
    head.appendChild(info);
    el.appendChild(head);

    // 縦軸は 0〜描く値の最大（の 1.05 倍）。cap で頭打ちにし、それより大きい点は上端に描く
    const top = Math.min(opts.cap, Math.max.apply(null, points.map(function (p) { return p.value; }).concat([0])) * 1.05) || 1;
    const W = 360, H = 176, L = 36, R = 14, T = 14, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const span = Math.max(1, lastX - firstX);
    const x = function (v) { return L + (lastX === firstX ? pw / 2 : (v - firstX) / span * pw); };
    const y = function (v) { return T + ph - Math.min(v, top) / top * ph; };
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "dist-svg ngram-trend", role: "img", "aria-label": opts.ariaLabel });

    // 軸と目盛り
    svg.appendChild(svgEl("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    svg.appendChild(svgEl("line", { x1: L, y1: T, x2: L, y2: T + ph, class: "dist-axis" }));
    const yStep = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(function (s) { return top / s <= 5; }) || 2000;
    for (let v = 0; v <= top; v += yStep) {
      svg.appendChild(svgEl("line", { x1: L, y1: y(v), x2: L + pw, y2: y(v), class: "trend-grid" }));
      svg.appendChild(svgText(L - 4, y(v) + 3, String(v), "end"));
    }
    svg.appendChild(svgText(L - 4, T - 4, opts.unit, "end"));
    if (byRun) {
      const xStep = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(function (s) { return span / s <= 6; }) || 2000;
      for (let v = 0; v <= lastX; v += xStep) {
        if (v < firstX) continue;
        svg.appendChild(svgText(x(v), T + ph + 14, String(v), "middle"));
      }
      svg.appendChild(svgText(L + pw, H - 2, "回目", "end"));
    } else {
      // 日付：最初と最後の日（間が4日以上なら真ん中も）
      const days = [firstX, lastX];
      if (span >= 4) days.splice(1, 0, firstX + Math.round(span / 2));
      const p0 = axis.firstDay.split("-").map(Number);
      days.filter(function (d, i, a) { return a.indexOf(d) === i; }).forEach(function (d, i, a) {
        const dt = new Date(p0[0], p0[1] - 1, p0[2] + (d - firstX)); // 最初の日から数えた日（時差で日がずれないように）
        svg.appendChild(svgText(x(d), T + ph + 14, (dt.getMonth() + 1) + "/" + dt.getDate(), a.length > 1 && i === 0 ? "start" : a.length > 1 && i === a.length - 1 ? "end" : "middle"));
      });
      svg.appendChild(svgText(L + pw, H - 2, "日付", "end"));
    }

    // 移動平均の線
    if (points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: points.map(function (p) { return x(p.x) + "," + y(p.ma); }).join(" "), class: "ngram-trend-ma" }));
    }
    // 点
    points.forEach(function (p) {
      const c = svgEl("circle", { cx: x(p.x), cy: y(p.value), r: 3, class: "ngram-trend-point" });
      const tip = svgEl("title", {});
      const when = byRun
        ? p.x + " 回目（" + fmtDay(p.tag.day) + " " + new Date(p.tag.at).toTimeString().slice(0, 5) + "）"
        : fmtDay(p.tag.day);
      tip.textContent = when + "：" + opts.tip(p) + (p.value > top ? "。上端より大きい" : "");
      c.appendChild(tip);
      svg.appendChild(c);
    });
    el.appendChild(svg);
  }

  return { draw: draw, tagsOf: tagsOf, axisOf: axisOf };
})();
