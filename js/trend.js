// 推移・ランキングのページの「推移」グラフ。上段に平均 IKI（左軸 ms・右軸 打/s）、
// 下段に正確率（修正後）とミスも数えた正確率を描く
// 決まりは docs/records.md の「推移」を参照
const Trend = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MA_WINDOW = 10; // 移動平均の回数

  // 描画領域（viewBox の座標）
  const W = 760, L = 58, R = 58, T = 20, PH1 = 230, GAP = 30, PH2 = 80, B = 40;
  const H = T + PH1 + GAP + PH2 + B;
  const PW = W - L - R;
  const T2 = T + PH1 + GAP; // 下段の上端

  // sessions：絞り込んだ概要の記録（古い順）。group："run"（1回ごと）か "day"（日ごと）
  function render(container, legendEl, sessions, group) {
    container.textContent = "";
    const list = sessions.filter(function (s) { return s.result.avgIki !== null; });
    if (list.length === 0) {
      legendEl.textContent = "";
      const p = document.createElement("p");
      p.className = "trend-empty";
      p.textContent = "データなし";
      container.appendChild(p);
      return;
    }

    const data = group === "day" ? byDay(list) : byRun(list);
    legendEl.textContent = group === "day"
      ? "● その日の平均（正確率 " + Store.RANK_MIN_ACCURACY + "% 以上の回）／ ◇ その日の最高 ／ ○ その日は " +
        Store.RANK_MIN_ACCURACY + "% 以上の回がない（全回の平均）／ 下段はその日の正確率の平均"
      : "● 1回ごとの平均 IKI ／ ○ 正確率 " + Store.RANK_MIN_ACCURACY + "% 未満（ランキング対象外。移動平均に含めない）／ ━ 移動平均（直近 " +
        MA_WINDOW + " 回）";
    legendEl.textContent += " ／ 下段：● 正確率（修正後）・▪ ミスも数えた正確率（打鍵数 − ミス）÷ 打鍵数";
    // 平均 IKI は、英語は文字あたり、日本語はキーあたり。両方が混ざっているときは注意を出す
    const langs = new Set(list.map(function (s) { return s.lang; }));
    if (langs.size > 1) legendEl.textContent += " ／ ※英語と日本語が混ざっています（平均 IKI は英語が文字あたり、日本語がキーあたり）";

    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "trend-svg", role: "img", "aria-label": "成績の推移" });

    // 横軸
    const xs = data.points.map(function (p) { return p.x; });
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    const xpad = (x1 - x0) * 0.03;
    x0 -= xpad; x1 += xpad;
    const X = function (v) { return L + ((v - x0) / (x1 - x0)) * PW; };

    // 上段の縦軸（平均 IKI。小さいほど上＝速い）
    const ikis = [];
    data.points.forEach(function (p) { ikis.push(p.iki); if (p.best !== undefined) ikis.push(p.best); });
    (data.ma || []).forEach(function (m) { ikis.push(m.v); });
    let lo = Math.min.apply(null, ikis), hi = Math.max.apply(null, ikis);
    const span = Math.max(hi - lo, 20);
    lo = Math.max(1, lo - span * 0.08); hi = hi + span * 0.08;
    const YI = function (v) { return T + ((v - lo) / (hi - lo)) * PH1; };

    // 下段の縦軸（正確率）
    const accs = [];
    data.points.forEach(function (p) { accs.push(p.acc, p.accRaw); });
    const accLo = Math.min(90, Math.floor(Math.min.apply(null, accs) / 5) * 5);
    const YA = function (v) { return T2 + ((100 - v) / (100 - accLo)) * PH2; };

    // 上段：枠・目盛り
    frame(svg, T, PH1);
    const msStep = niceStep(hi - lo, 6, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]);
    for (let v = Math.ceil(lo / msStep) * msStep; v <= hi; v += msStep) {
      hline(svg, YI(v));
      svg.appendChild(text(L - 6, YI(v) + 3, String(v), "end"));
    }
    svg.appendChild(text(L - 6, T - 8, "IKI (ms)", "end", "trend-axis-title"));
    svg.appendChild(text(6, T + 10, "↑速い", "start", "trend-axis-title"));
    // 右軸：打/s = 1000 / IKI。IKI の位置に合わせて置くので、間隔は等間隔にならない
    const kLo = 1000 / hi, kHi = 1000 / lo;
    const kStep = niceStep(kHi - kLo, 6, [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50]);
    for (let k = Math.ceil(kLo / kStep) * kStep; k <= kHi + 1e-9; k += kStep) {
      const y = YI(1000 / k);
      svg.appendChild(line(L + PW, y, L + PW + 4, y, "trend-axis"));
      svg.appendChild(text(L + PW + 7, y + 3, fmtK(k, kStep), "start"));
    }
    svg.appendChild(text(L + PW + 7, T - 8, "打/s", "start", "trend-axis-title"));

    // 上段：移動平均・日ごとの線
    if (data.ma && data.ma.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.ma.map(function (m) { return X(m.x) + "," + YI(m.v); }).join(" "), class: "trend-ma" }));
    }
    if (group === "day" && data.points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.points.map(function (p) { return X(p.x) + "," + YI(p.iki); }).join(" "), class: "trend-line" }));
    }

    // 上段：点
    data.points.forEach(function (p) {
      if (p.best !== undefined) {
        const bx = X(p.x), by = YI(p.best);
        const d = svgEl("polygon", { points: [bx, by - 4, bx + 4, by, bx, by + 4, bx - 4, by].join(" "), class: "trend-best" });
        d.appendChild(title("最高 " + p.best.toFixed(1) + " ms（" + (1000 / p.best).toFixed(2) + " 打/s）"));
        svg.appendChild(d);
      }
      const c = svgEl("circle", { cx: X(p.x), cy: YI(p.iki), r: 3.5, class: "trend-point" + (p.eligible ? "" : " out") });
      c.appendChild(title(p.tip));
      svg.appendChild(c);
    });

    // 下段：正確率
    frame(svg, T2, PH2);
    // 目盛りは 100 から下へ、4本程度
    const accStep = niceStep(100 - accLo, 4, [5, 10, 20, 25, 50]);
    for (let v = 100; v >= accLo; v -= accStep) {
      hline(svg, YA(v));
      svg.appendChild(text(L - 6, YA(v) + 3, String(v), "end"));
    }
    svg.appendChild(text(L - 6, T2 - 8, "正確率 (%)", "end", "trend-axis-title"));
    // ランキング対象の基準
    svg.appendChild(line(L, YA(Store.RANK_MIN_ACCURACY), L + PW, YA(Store.RANK_MIN_ACCURACY), "trend-threshold"));
    if (data.points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.points.map(function (p) { return X(p.x) + "," + YA(p.acc); }).join(" "), class: "trend-acc-line" }));
    }
    // ミスも数えた正確率（オレンジの線と小さい四角）
    if (data.points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.points.map(function (p) { return X(p.x) + "," + YA(p.accRaw); }).join(" "), class: "trend-raw-line" }));
    }
    data.points.forEach(function (p) {
      const sq = svgEl("rect", { x: X(p.x) - 2.5, y: YA(p.accRaw) - 2.5, width: 5, height: 5, class: "trend-raw-point" });
      sq.appendChild(title(p.tip));
      svg.appendChild(sq);
    });
    data.points.forEach(function (p) {
      const c = svgEl("circle", { cx: X(p.x), cy: YA(p.acc), r: 2.5, class: "trend-point" + (p.acc >= Store.RANK_MIN_ACCURACY ? "" : " out") });
      c.appendChild(title(p.tip));
      svg.appendChild(c);
    });

    // 横軸の目盛り
    const axisY = T2 + PH2;
    if (group === "day") {
      const step = niceStep(x1 - x0, 7, [1, 2, 7, 14, 30, 61, 91, 182, 365, 730]);
      for (let d = Math.ceil(x0 / step) * step; d <= x1; d += step) xTick(svg, X(d), axisY, fmtDay(d));
      svg.appendChild(text(L + PW, H - 2, "年月日", "end", "trend-axis-title"));
    } else {
      const step = niceStep(x1 - x0, 10, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
      for (let n = Math.max(step, Math.ceil(x0 / step) * step); n <= x1; n += step) xTick(svg, X(n), axisY, String(n));
      if (x0 < 1 && 1 <= x1 && step > 1) xTick(svg, X(1), axisY, "1");
      svg.appendChild(text(L + PW, H - 2, "回", "end", "trend-axis-title"));
    }

    container.appendChild(svg);
  }

  // 1回ごと：横軸は何回目か。移動平均は正確率が基準以上の回だけで計算する
  function byRun(list) {
    const points = list.map(function (s, i) {
      return {
        x: i + 1,
        iki: s.result.avgIki,
        acc: s.result.accuracy,
        accRaw: rawAccuracy(s),
        eligible: s.result.accuracy >= Store.RANK_MIN_ACCURACY,
        tip: (i + 1) + " 回目 ／ " + fmtDateTime(s.finishedAt) + " ／ " + s.textId + "\n平均 IKI " + s.result.avgIki.toFixed(1) +
          " ms（" + (1000 / s.result.avgIki).toFixed(2) + " 打/s, " + speedText(s) + "）\n正確率 " +
          s.result.accuracy.toFixed(1) + "%（ミスも数えると " + rawAccuracy(s).toFixed(1) + "%）／ ミス " + s.result.misses +
          "（未修正 " + s.result.uncorrected + "）"
      };
    });
    const ma = [];
    const recent = [];
    points.forEach(function (p) {
      if (!p.eligible) return;
      recent.push(p.iki);
      if (recent.length > MA_WINDOW) recent.shift();
      ma.push({ x: p.x, v: recent.reduce(function (a, b) { return a + b; }, 0) / recent.length });
    });
    return { points: points, ma: ma };
  }

  // 日ごと：横軸はこのPCの日付。その日の平均と最高は正確率が基準以上の回で出す
  function byDay(list) {
    const days = new Map();
    list.forEach(function (s) {
      const k = dayNumber(s.finishedAt);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(s);
    });
    const points = Array.from(days, function (entry) {
      const day = entry[0], ss = entry[1];
      const ok = ss.filter(function (s) { return s.result.accuracy >= Store.RANK_MIN_ACCURACY; });
      const use = ok.length ? ok : ss;
      const mean = function (arr, f) { return arr.reduce(function (a, s) { return a + f(s); }, 0) / arr.length; };
      const iki = mean(use, function (s) { return s.result.avgIki; });
      const acc = mean(ss, function (s) { return s.result.accuracy; });
      const accRaw = mean(ss, rawAccuracy);
      const p = {
        x: day,
        iki: iki,
        acc: acc,
        accRaw: accRaw,
        eligible: ok.length > 0,
        tip: fmtDay(day) + " ／ " + ss.length + " 回（うち正確率 " + Store.RANK_MIN_ACCURACY + "% 以上 " + ok.length + " 回）\n平均 IKI " +
          iki.toFixed(1) + " ms（" + (1000 / iki).toFixed(2) + " 打/s）\n正確率の平均 " + acc.toFixed(1) + "%（ミスも数えると " + accRaw.toFixed(1) + "%）"
      };
      if (ok.length) p.best = Math.min.apply(null, ok.map(function (s) { return s.result.avgIki; }));
      return p;
    }).sort(function (a, b) { return a.x - b.x; });
    return { points: points };
  }

  // ---- 補助 ----

  // 速さの表示。英語は WPM、日本語はかな/分（日本語の記録は wpm が null。docs/storage.md）
  function speedText(s) {
    return s.lang === "ja" ? Math.round(s.result.kanaPerMin) + " かな/分" : Math.round(s.result.wpm) + " WPM";
  }

  // ミスも数えた正確率(%) = (打鍵数 - ミス) / 打鍵数。直したミスも含む（正確率は直したミスを含まない）
  function rawAccuracy(s) {
    const k = s.result.keystrokes;
    return k > 0 ? ((k - s.result.misses) / k) * 100 : 100;
  }


  // 範囲を maxTicks 個以内で区切る、steps の中で一番細かい間隔
  function niceStep(range, maxTicks, steps) {
    return steps.find(function (s) { return range / s <= maxTicks; }) || steps[steps.length - 1];
  }

  // このPCの日付での通し日数（1970-01-01 = 0）
  function dayNumber(iso) {
    const d = new Date(iso);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function fmtDay(n) {
    const d = new Date(n * 86400000);
    return d.getUTCFullYear() + "/" + pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate());
  }

  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtK(k, step) {
    return step < 1 ? k.toFixed(step < 0.25 ? 1 : 2).replace(/0$/, "") : String(Math.round(k * 10) / 10);
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function frame(svg, top, height) {
    svg.appendChild(line(L, top + height, L + PW, top + height, "trend-axis"));
    svg.appendChild(line(L, top, L, top + height, "trend-axis"));
    svg.appendChild(line(L + PW, top, L + PW, top + height, "trend-axis"));
  }

  function hline(svg, y) {
    svg.appendChild(line(L, y, L + PW, y, "trend-grid"));
  }

  function xTick(svg, x, y, label) {
    svg.appendChild(line(x, y, x, y + 4, "trend-axis"));
    svg.appendChild(text(x, y + 16, label, "middle"));
  }

  function line(x1, y1, x2, y2, cls) {
    return svgEl("line", { x1: x1, y1: y1, x2: x2, y2: y2, class: cls });
  }

  function text(x, y, str, anchor, cls) {
    const t = svgEl("text", { x: x, y: y, "text-anchor": anchor, class: cls || "trend-label" });
    t.textContent = str;
    return t;
  }

  function title(str) {
    const t = svgEl("title", {});
    t.textContent = str;
    return t;
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  return { render: render };
})();
