// 記録のページの「推移」グラフ。上段に平均 IKI（左軸 ms・右軸 打/s）、
// 下段に正確率（修正後）とミスも数えた正確率（日ごと・月ごとは回数の棒も）を描く
// 決まりは docs/records.md の「推移」を参照
const Trend = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MA_WINDOW = 10; // 移動平均の回数

  // 描画領域（viewBox の座標）
  const W = 760, L = 58, R = 58, T = 20, PH1 = 230, GAP = 44, PH2 = 160, B = 40;
  const H = T + PH1 + GAP + PH2 + B;
  const PW = W - L - R;
  const T2 = T + PH1 + GAP; // 下段の上端

  // sessions：絞り込んだ概要の記録（古い順）。group："run"（1回ごと）・"day"（日ごと）・"month"（月ごと）
  // opts.levelUps：達成レベルが上がった回（Levels.levelUps の結果）。その点に「英語・単語 SB達成」のように書く
  // opts.selectedId：記録のページのランキングで選んだ回の id。1回ごとのときだけ、上段と下段のその回の位置に緑の縦線を引く（日ごと・月ごとでは引かない）
  function render(container, legendEl, sessions, group, opts) {
    const ups = (opts && opts.levelUps) || new Map();
    const period = PERIODS[group] || null; // 日ごと・月ごとのまとめ方（1回ごとなら null）
    const selectedId = period ? null : (opts && opts.selectedId) || null;
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

    const data = period ? byPeriod(list, ups, period) : byRun(list, ups);
    const that = period ? "その" + period.name : "";
    legendEl.textContent = period
      ? "● " + that + "の平均（正確率 " + Store.RANK_MIN_ACCURACY + "% 以上の回）／ ◇ " + that + "の最高 ／ ○ " + that + "は " +
        Store.RANK_MIN_ACCURACY + "% 以上の回がない（全回の平均）／ 下段は" + that + "の正確率の平均"
      : "● 1回ごとの平均 IKI ／ ○ 正確率 " + Store.RANK_MIN_ACCURACY + "% 未満（ランキング対象外。移動平均に含めない）／ ━ 移動平均（直近 " +
        MA_WINDOW + " 回）";
    if (selectedId) legendEl.textContent += " ／ 緑の縦線：ランキングで選んだ回";
    legendEl.textContent += " ／ 下段：● 正確率（修正後）、▪ ミスも数えた正確率（打鍵数 − ミス）÷ 打鍵数";
    if (period) legendEl.textContent += "、棒：" + that + "の回数（右軸）";

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
    // 達成した回の印（日ごと・月ごとでは平均の点と高さが違う）も範囲に入れる
    data.points.forEach(function (p) { ikis.push(p.iki); if (p.best !== undefined) ikis.push(p.best); p.marks.forEach(function (m) { ikis.push(m.iki); }); });
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

    // 上段：日ごと（月ごと）の線
    if (period && data.points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.points.map(function (p) { return X(p.x) + "," + YI(p.iki); }).join(" "), class: "trend-line" }));
    }

    // ランキングで選んだ回：上段と下段に、その回の位置の縦線を引く（点より下に描く）
    const selPoint = selectedId ? data.points.find(function (p) { return p.ids.indexOf(selectedId) !== -1; }) : null;
    function selectedLine(top, height) {
      if (!selPoint) return;
      const v = line(X(selPoint.x), top, X(selPoint.x), top + height, "trend-selected-line");
      v.appendChild(title("ランキングで選んだ回\n" + selPoint.tip));
      svg.appendChild(v);
    }
    selectedLine(T, PH1);

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

    // 上段：移動平均（点より前に描く）
    if (data.ma && data.ma.length > 1) {
      svg.appendChild(svgEl("polyline", { points: data.ma.map(function (m) { return X(m.x) + "," + YI(m.v); }).join(" "), class: "trend-ma" }));
    }

    // 達成レベルが上がった回：その回の平均 IKI の高さを輪で囲み、上に「英語・単語 SB達成」と書く。移動平均の線に隠れないよう、線の後に描く
    //   日ごと・月ごとでは、平均の点ではなく、達成した回それぞれの高さに赤い点を描く（文字が重なるときは上へずらす）
    data.points.forEach(function (p) {
      if (!p.marks.length) return;
      const lx = X(p.x);
      // 端の点では、文字が枠からはみ出さないよう寄せる
      const anchor = lx > L + PW - 60 ? "end" : lx < L + 60 ? "start" : "middle";
      let lastY = Infinity;
      // 下にある印から描き、文字は前の文字より上に置く
      p.marks.slice().sort(function (a, b) { return YI(b.iki) - YI(a.iki); }).forEach(function (m) {
        const cy = YI(m.iki);
        // 1回ごとは点そのものを赤い輪で囲む。日ごと・月ごとは、達成した回の高さに赤い点だけを描く（輪は付けない）
        if (m.dot) svg.appendChild(svgEl("circle", { cx: lx, cy: cy, r: 3.5, class: "trend-levelup-dot" }));
        else svg.appendChild(svgEl("circle", { cx: lx, cy: cy, r: 7, class: "trend-levelup-ring" }));
        const ly = Math.min(cy - (m.dot ? 8 : 11), lastY - 12);
        lastY = ly;
        const label = text(lx, ly, m.label, anchor, "trend-levelup");
        label.appendChild(title(m.tip));
        svg.appendChild(label);
      });
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
    // 日ごと・月ごと：その日（その月）の回数の棒（右軸。正確率の線より下に描く）
    if (period) {
      const cMax = Math.max.apply(null, data.points.map(function (p) { return p.count; }));
      const cStep = niceStep(cMax, 4, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]);
      const cTop = Math.max(1, Math.ceil(cMax / cStep)) * cStep;
      const YC = function (v) { return T2 + PH2 - (v / cTop) * PH2; };
      const bw = Math.min(24, Math.max(1, (PW / (x1 - x0)) * 0.7));
      data.points.forEach(function (p) {
        const r = svgEl("rect", { x: X(p.x) - bw / 2, y: YC(p.count), width: bw, height: T2 + PH2 - YC(p.count), class: "trend-count" });
        r.appendChild(title(p.tip));
        svg.appendChild(r);
      });
      for (let v = 0; v <= cTop; v += cStep) {
        svg.appendChild(line(L + PW, YC(v), L + PW + 4, YC(v), "trend-axis"));
        svg.appendChild(text(L + PW + 7, YC(v) + 3, String(v), "start"));
      }
      svg.appendChild(text(L + PW + 7, T2 - 8, "回数", "start", "trend-axis-title"));
    }
    // ランキング対象の基準
    svg.appendChild(line(L, YA(Store.RANK_MIN_ACCURACY), L + PW, YA(Store.RANK_MIN_ACCURACY), "trend-threshold"));
    selectedLine(T2, PH2);
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

    xAxis(svg, X, x0, x1, period);

    container.appendChild(svg);
  }

  // ノーミス連続タイプの推移（記録のページでモードに「ノーミス連続タイプ」を選んだとき。docs/no-mistype.md）
  // 上段：ミスなしで打てた文字数（多いほど上）。1回ごとは自己ベストの線、日ごと・月ごとはその日（月）の平均の点と最高の ◇
  // 下段：平均 IKI（ms。小さいほど上）
  function renderStreak(container, legendEl, sessions, group) {
    const period = PERIODS[group] || null;
    container.textContent = "";
    if (sessions.length === 0) {
      legendEl.textContent = "";
      const p = document.createElement("p");
      p.className = "trend-empty";
      p.textContent = "データなし";
      container.appendChild(p);
      return;
    }
    const mean = function (arr) { return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length; };
    const ikiOf = function (ss) {
      const v = ss.map(function (s) { return s.result.avgIki; }).filter(function (x) { return x !== null; });
      return v.length ? mean(v) : null;
    };
    let points;
    if (period) {
      const groups = new Map();
      sessions.forEach(function (s) {
        const k = period.key(s.finishedAt);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      });
      points = Array.from(groups, function (e) {
        const ss = e[1];
        const chars = mean(ss.map(function (s) { return s.textLength; }));
        const best = Math.max.apply(null, ss.map(function (s) { return s.textLength; }));
        const iki = ikiOf(ss);
        return {
          x: e[0], chars: chars, best: best, iki: iki,
          tip: period.fmt(e[0]) + " ／ " + ss.length + " 回\n文字数の平均 " + chars.toFixed(1) + " ／ 最高 " + best +
            "\n平均 IKI の平均 " + (iki === null ? "-" : iki.toFixed(1) + " ms")
        };
      }).sort(function (a, b) { return a.x - b.x; });
    } else {
      points = sessions.map(function (s, i) {
        const r = s.result;
        return {
          x: i + 1, chars: s.textLength, iki: r.avgIki,
          tip: (i + 1) + " 回目 ／ " + fmtDateTime(s.finishedAt) + " ／ " + LANG_NAME[s.lang] + "・" + (s.keyLayout === "qwerty" ? "QWERTY配列" : s.keyLayout) +
            "\nミスなしで " + s.textLength + " 文字（打鍵 " + (s.lang === "ja" ? r.correctKeys : s.textLength) + " ／ " + r.timeSec.toFixed(1) + " 秒）" +
            "\n平均 IKI " + (r.avgIki === null ? "-" : r.avgIki.toFixed(1) + " ms") + "（" + speedText(s) + "）"
        };
      });
    }
    // 1回ごと：その回までの自己ベスト（それまでの最高の文字数）の線
    const bestLine = [];
    if (!period) {
      let m = 0;
      points.forEach(function (p) {
        m = Math.max(m, p.chars);
        bestLine.push({ x: p.x, v: m });
      });
    }
    legendEl.textContent = period
      ? "上段：● " + "その" + period.name + "の文字数の平均 ／ ◇ その" + period.name + "の最高 ／ 下段：その" + period.name + "の平均 IKI の平均"
      : "上段：● 1回ごとのミスなしで打てた文字数 ／ ━ 自己ベスト（その回までの最高）／ 下段：1回ごとの平均 IKI";

    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "trend-svg", role: "img", "aria-label": "ノーミス連続タイプの推移" });
    const xs = points.map(function (p) { return p.x; });
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    const xpad = (x1 - x0) * 0.03;
    x0 -= xpad; x1 += xpad;
    const X = function (v) { return L + ((v - x0) / (x1 - x0)) * PW; };

    // 上段：文字数（0 から、最高の少し上まで）
    const top = Math.max.apply(null, points.map(function (p) { return p.best !== undefined ? p.best : p.chars; }));
    const cHi = Math.max(10, top * 1.08);
    const YC = function (v) { return T + PH1 - (v / cHi) * PH1; };
    frame(svg, T, PH1);
    const cStep = niceStep(cHi, 6, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]);
    for (let v = 0; v <= cHi; v += cStep) {
      hline(svg, YC(v));
      svg.appendChild(text(L - 6, YC(v) + 3, String(v), "end"));
    }
    svg.appendChild(text(L - 6, T - 8, "文字数", "end", "trend-axis-title"));
    if (bestLine.length > 1) {
      svg.appendChild(svgEl("polyline", { points: bestLine.map(function (m) { return X(m.x) + "," + YC(m.v); }).join(" "), class: "trend-ma" }));
    }
    if (period && points.length > 1) {
      svg.appendChild(svgEl("polyline", { points: points.map(function (p) { return X(p.x) + "," + YC(p.chars); }).join(" "), class: "trend-line" }));
    }
    points.forEach(function (p) {
      if (p.best !== undefined) {
        const bx = X(p.x), by = YC(p.best);
        const d = svgEl("polygon", { points: [bx, by - 4, bx + 4, by, bx, by + 4, bx - 4, by].join(" "), class: "trend-best" });
        d.appendChild(title(p.tip));
        svg.appendChild(d);
      }
      const c = svgEl("circle", { cx: X(p.x), cy: YC(p.chars), r: 3.5, class: "trend-point" });
      c.appendChild(title(p.tip));
      svg.appendChild(c);
    });

    // 下段：平均 IKI（小さいほど上）
    const ikis = points.map(function (p) { return p.iki; }).filter(function (v) { return v !== null; });
    frame(svg, T2, PH2);
    svg.appendChild(text(L - 6, T2 - 8, "IKI (ms)", "end", "trend-axis-title"));
    if (ikis.length) {
      let lo = Math.min.apply(null, ikis), hi = Math.max.apply(null, ikis);
      const span = Math.max(hi - lo, 20);
      lo = Math.max(1, lo - span * 0.1); hi = hi + span * 0.1;
      const YI = function (v) { return T2 + ((v - lo) / (hi - lo)) * PH2; };
      const iStep = niceStep(hi - lo, 4, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]);
      for (let v = Math.ceil(lo / iStep) * iStep; v <= hi; v += iStep) {
        hline(svg, YI(v));
        svg.appendChild(text(L - 6, YI(v) + 3, String(v), "end"));
      }
      const withIki = points.filter(function (p) { return p.iki !== null; });
      if (withIki.length > 1) {
        svg.appendChild(svgEl("polyline", { points: withIki.map(function (p) { return X(p.x) + "," + YI(p.iki); }).join(" "), class: "trend-acc-line" }));
      }
      withIki.forEach(function (p) {
        const c = svgEl("circle", { cx: X(p.x), cy: YI(p.iki), r: 2.5, class: "trend-point" });
        c.appendChild(title(p.tip));
        svg.appendChild(c);
      });
    }

    xAxis(svg, X, x0, x1, period);
    container.appendChild(svg);
  }

  // 1回ごと：横軸は何回目か。移動平均は正確率が基準以上の回だけで計算する
  function byRun(list, ups) {
    const points = list.map(function (s, i) {
      const up = ups.get(s.id);
      return {
        ids: [s.id],
        x: i + 1,
        iki: s.result.avgIki,
        acc: s.result.accuracy,
        accRaw: rawAccuracy(s),
        eligible: s.result.accuracy >= Store.RANK_MIN_ACCURACY,
        marks: [], // 達成レベルが上がった印（下で足す）
        tip: (i + 1) + " 回目 ／ " + fmtDateTime(s.finishedAt) + " ／ " + s.textId + "\n平均 IKI " + s.result.avgIki.toFixed(1) +
          " ms（" + (1000 / s.result.avgIki).toFixed(2) + " 打/s, " + speedText(s) + "）\n正確率 " +
          s.result.accuracy.toFixed(1) + "%（修正したミスも数えると " +rawAccuracy(s).toFixed(1) + "%）／ ミス " + s.result.misses +
          "（未修正 " + s.result.uncorrected + "）\n" + levelTip(s) + (up ? "\n" + upText(up) : "")
      };
    }).map(function (p, i) {
      const up = ups.get(list[i].id);
      // 1回ごとでは、点そのものを輪で囲む（中の点は描かない）
      if (up) p.marks.push({ iki: p.iki, label: upLabel(up), tip: p.tip, dot: false });
      return p;
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

  // 日ごと・月ごとのまとめ方。key：記録の日時 → 通し番号（横軸の値）、fmt：通し番号 → 目盛りの文字、steps：目盛りの間隔の候補
  const PERIODS = {
    day: { name: "日", key: dayNumber, fmt: fmtDay, steps: [1, 2, 7, 14, 30, 61, 91, 182, 365, 730] },
    month: { name: "月", key: monthNumber, fmt: fmtMonth, steps: [1, 2, 3, 6, 12, 24, 60, 120] }
  };

  // 日ごと・月ごと：横軸はこのPCの日付（の月）。その日（その月）の平均と最高は正確率が基準以上の回で出す
  function byPeriod(list, ups, period) {
    const days = new Map();
    list.forEach(function (s) {
      const k = period.key(s.finishedAt);
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
      // その日（その月）に達成レベルが上がった回（言語・モードごとに、その日の最後に届いたレベル）
      const dayUps = new Map();
      ss.forEach(function (s) {
        const up = ups.get(s.id);
        if (up) dayUps.set(up.lang + "/" + up.mode, { up: up, s: s });
      });
      const upList = Array.from(dayUps.values()).map(function (u) { return u.up; });
      // 印は、達成したその回の平均 IKI の高さに、赤い点で描く（輪では囲まない）
      const marks = Array.from(dayUps.values()).map(function (u) {
        return { iki: u.s.result.avgIki, label: upLabel(u.up), dot: true,
          tip: upText(u.up) + "\n" + fmtDateTime(u.s.finishedAt) + " ／ 平均 IKI " + u.s.result.avgIki.toFixed(1) + " ms" };
      });
      const p = {
        ids: ss.map(function (s) { return s.id; }),
        x: day,
        count: ss.length,
        iki: iki,
        acc: acc,
        accRaw: accRaw,
        eligible: ok.length > 0,
        marks: marks,
        tip: period.fmt(day) + " ／ " + ss.length + " 回（うち正確率 " + Store.RANK_MIN_ACCURACY + "% 以上 " + ok.length + " 回）\n平均 IKI " +
          iki.toFixed(1) + " ms（" + (1000 / iki).toFixed(2) + " 打/s）\n正確率の平均 " + acc.toFixed(1) + "%（修正したミスも数えると " +accRaw.toFixed(1) + "%）" +
          upList.map(function (u) { return "\n" + upText(u); }).join("")
      };
      if (ok.length) p.best = Math.min.apply(null, ok.map(function (s) { return s.result.avgIki; }));
      return p;
    }).sort(function (a, b) { return a.x - b.x; });
    return { points: points };
  }

  // ---- 補助 ----

  const LANG_NAME = { en: "英語", ja: "日本語" };
  const MODE_NAME = { normal: "文章", words: "単語", other: "その他" };

  // その回のレベルと文字/秒（docs/levels.md）
  function levelTip(s) {
    const level = Levels.ofSession(s);
    const rate = Levels.rateOfSession(s);
    return "レベル " + (level ? level.name : "なし") + (rate !== null ? "（" + rate.toFixed(2) + " 文字/秒）" : "");
  }

  // グラフの点の上に書く文字（例「英語・単語 SB達成」）
  function upLabel(up) {
    return LANG_NAME[up.lang] + "・" + MODE_NAME[up.mode] + " " + up.level.name + "達成";
  }

  // 達成レベルが上がったことの説明（例「日本語・文章で SB を達成」）
  function upText(up) {
    return LANG_NAME[up.lang] + "・" + MODE_NAME[up.mode] + "で " + up.level.name + " を達成";
  }

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

  // このPCの日付での通し月数（0 年 1 月 = 0）
  function monthNumber(iso) {
    const d = new Date(iso);
    return d.getFullYear() * 12 + d.getMonth();
  }

  function fmtMonth(n) {
    return Math.floor(n / 12) + "/" + pad(n % 12 + 1);
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

  // 横軸の目盛り。上段と下段のそれぞれの下に、同じ目盛りを書く（軸の名前「回」は下段の下だけ）
  function xAxis(svg, X, x0, x1, period) {
    [T + PH1, T2 + PH2].forEach(function (axisY) {
      if (period) {
        const step = niceStep(x1 - x0, 7, period.steps);
        for (let d = Math.ceil(x0 / step) * step; d <= x1; d += step) xTick(svg, X(d), axisY, period.fmt(d));
      } else {
        const step = niceStep(x1 - x0, 10, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
        for (let n = Math.max(step, Math.ceil(x0 / step) * step); n <= x1; n += step) xTick(svg, X(n), axisY, String(n));
        if (x0 < 1 && 1 <= x1 && step > 1) xTick(svg, X(1), axisY, "1");
      }
    });
    if (!period) svg.appendChild(text(L + PW, H - 2, "回", "end", "trend-axis-title"));
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

  return { render: render, renderStreak: renderStreak };
})();
