// n-gram（連続して押した n 個のキー。2=bigram、3=trigram）ごとの打鍵間隔(IKI)を集計して一覧表にする
// 行をクリックすると、その n-gram の IKI の分布（ヒストグラム）を表の下に出す
const NGram = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // n 文字ごとの一覧表を1つ作る。並び順は表ごとに持ち、やり直しても維持する
  // distEl を渡すと、行のクリックで分布のグラフをそこに描く
  // onSelect(gram) を渡すと、分布を出す n-gram が変わったときに呼ぶ（閉じたときは null）
  function create(n, label, distEl, onSelect) {
    let rows = [];     // 集計結果 { gram, avg, sd, count, values }
    let sortKey = "avg"; // 並べ替えに使う列："gram"（n-gram の文字）・"avg"（平均 IKI）・"count"（回数）
    let order = "asc";   // その列の並び順
    let baseAvg = 0;   // 色の基準にする全体の平均間隔
    let emptyMessage = ""; // 行がないときに表の中に出す文言
    let selected = null;   // 分布を表示中の n-gram
    let containerEl = null;

    // 集計済みの行（toRows の結果。複数回分をまとめたものでもよい）を一覧表に描く
    // 行がないときは、見出しだけの表に emptyText（省略時は「対象になる … がありません。」）を出す
    function renderRows(container, newRows, avg, emptyText) {
      containerEl = container;
      rows = newRows;
      baseAvg = avg;
      emptyMessage = emptyText || "対象になる " + label + " がありません。";
      // 表示中の n-gram が新しいデータにもあれば、分布を出し続ける
      if (selected && !rows.some(function (r) { return r.gram === selected; })) {
        selected = null;
        if (onSelect) onSelect(null);
      }
      draw();
      return rows.length;
    }

    // 表と分布を消す（やり直しのとき）
    function clear() {
      rows = [];
      selected = null;
      if (containerEl) containerEl.textContent = "";
      if (distEl) distEl.textContent = "";
    }

    function select(gram) {
      selected = selected === gram ? null : gram; // 同じ行をもう一度クリックすると閉じる
      if (onSelect) onSelect(selected);
      draw();
    }

    // 並べ替えのボタンを入れた見出し。今の列ならクリックで昇順・降順を切り替え、別の列なら firstOrder で並べる
    //   names：[昇順の名前, 降順の名前]（ボタンの説明に使う）
    function sortHeader(key, text, firstOrder, names) {
      const cell = th("");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bg-sort" + (key === sortKey ? " active" : "");
      const now = order === "asc" ? 0 : 1;
      if (key === sortKey) {
        btn.textContent = text + " " + (order === "asc" ? "▲" : "▼");
        btn.title = names[now] + "（クリックで" + names[1 - now] + "）";
        cell.setAttribute("aria-sort", order === "asc" ? "ascending" : "descending");
      } else {
        btn.textContent = text;
        btn.title = "クリックで" + names[firstOrder === "asc" ? 0 : 1] + "に並べる";
      }
      btn.addEventListener("click", function () {
        if (key === sortKey) order = order === "asc" ? "desc" : "asc";
        else {
          sortKey = key;
          order = firstOrder;
        }
        draw();
      });
      cell.appendChild(btn);
      return cell;
    }

    function draw() {
      containerEl.textContent = "";
      const sign = order === "asc" ? 1 : -1;
      const byGram = function (x, y) { return x.gram < y.gram ? -1 : x.gram > y.gram ? 1 : 0; };
      rows.sort(function (x, y) {
        // 選んだ列で並べ、同じなら 回数の多い順 → 速い順 → 文字の順
        if (sortKey === "gram") return sign * byGram(x, y);
        if (sortKey === "count") return sign * (x.count - y.count) || x.avg - y.avg || byGram(x, y);
        return sign * (x.avg - y.avg) || y.count - x.count || byGram(x, y);
      });

      const table = document.createElement("table");
      table.className = "bg-table";

      const head = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(sortHeader("gram", label, "asc", ["文字の順", "文字の逆順"]));
      hr.appendChild(sortHeader("avg", "IKI(ms/打)", "asc", ["速い順", "遅い順"]));
      const sdTh = th("SD(ms)");
      sdTh.title = "IKI の標準偏差（標本標準偏差）。1回しか出ないものは -";
      hr.appendChild(sdTh);
      hr.appendChild(sortHeader("count", "回数", "desc", ["少ない順", "多い順"]));
      head.appendChild(hr);
      table.appendChild(head);

      const body = document.createElement("tbody");
      if (rows.length === 0) {
        const tr = document.createElement("tr");
        const cell = td("bg-empty-cell", emptyMessage);
        cell.colSpan = 4;
        tr.appendChild(cell);
        body.appendChild(tr);
      }
      rows.forEach(function (r) {
        const tr = document.createElement("tr");
        tr.appendChild(td("bg-name", r.gram));
        const avgTd = td("bg-avg", Math.round(r.avg));
        avgTd.style.color = Rhythm.color(r.avg, baseAvg);
        tr.appendChild(avgTd);
        tr.appendChild(td("bg-sd", r.sd === null ? "-" : Math.round(r.sd)));
        tr.appendChild(td("bg-count", r.count));
        if (distEl) {
          tr.className = "bg-row" + (r.gram === selected ? " bg-selected" : "");
          tr.tabIndex = 0;
          tr.title = "クリックで IKI の分布を表示";
          tr.addEventListener("click", function () { select(r.gram); });
          tr.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(r.gram); }
          });
        }
        body.appendChild(tr);
      });
      table.appendChild(body);
      containerEl.appendChild(table);

      if (distEl) {
        const row = rows.find(function (r) { return r.gram === selected; });
        if (row) drawDistribution(distEl, row, label, baseAvg, function () { select(row.gram); });
        else distEl.textContent = "";
      }
    }

    // 表の外（bigram の2次元ヒストグラムのマス）から選ぶ。行のクリックと同じく、同じものをもう一度選ぶと閉じる
    // 選んだときは、表の中をその行までスクロールし、分布が見えるところまでページをスクロールする
    function show(gram) {
      select(gram);
      if (selected === null) return;
      const tr = containerEl.querySelector("tr.bg-selected");
      if (tr) containerEl.scrollTop += tr.getBoundingClientRect().top - containerEl.getBoundingClientRect().top - containerEl.clientHeight / 2;
      if (distEl) distEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    return { renderRows: renderRows, clear: clear, show: show, selected: function () { return selected; } };
  }

  // 1つの n-gram の IKI の分布をヒストグラムで描く。平均を点線、1回ごとの値を軸の下の短い線で示す
  function drawDistribution(el, row, label, baseAvg, onClose) {
    el.textContent = "";
    const values = row.values;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);

    // 見出しと閉じるボタン
    const head = document.createElement("div");
    head.className = "dist-head";
    const title = document.createElement("span");
    title.className = "dist-title";
    title.textContent = label + "「" + row.gram + "」の IKI の分布";
    const info = document.createElement("span");
    info.className = "dist-info";
    info.textContent = row.count + " 回 ／ 平均 " + Math.round(row.avg) + " ms ／ SD " +
      (row.sd === null ? "-" : Math.round(row.sd) + " ms") + " ／ 最小 " + Math.round(min) + " ／ 最大 " + Math.round(max);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dist-close";
    close.textContent = "×";
    close.title = "閉じる";
    close.addEventListener("click", onClose);
    head.appendChild(title);
    head.appendChild(info);
    head.appendChild(close);
    el.appendChild(head);

    // 横軸は 0〜設定の最大（js/settings.js の ngramMaxMs。初期値 2000 ms）で、100 個の区間に分ける。最大以上の値は一番右の区間に入れる
    const upper = Settings.get("ngramMaxMs");
    const nb = 100;
    const bw = upper / nb; // 最大は 50 ms 刻みなので、幅は 0.5 ms 刻み（表示は fmt で小数第1位まで）
    const fmt = function (v) { return String(Math.round(v * 10) / 10); };
    const start = 0;
    const counts = new Array(nb).fill(0);
    values.forEach(function (v) { counts[Math.min(nb - 1, Math.floor((v - start) / bw))]++; });
    const maxCount = Math.max.apply(null, counts);

    // 描画領域
    const W = 360, H = 176, L = 32, R = 18, T = 18, B = 34;
    const pw = W - L - R, ph = H - T - B;
    // 最大を超える値（1回ごとの値・平均の線）は右端に描く
    const x = function (v) { return L + ((Math.min(v, upper) - start) / (nb * bw)) * pw; };
    const y = function (c) { return T + ph - (c / maxCount) * ph; };

    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "dist-svg", role: "img",
      "aria-label": label + " " + row.gram + " の IKI の分布" });

    // 棒
    counts.forEach(function (c, i) {
      if (c === 0) return;
      const x0 = x(start + i * bw), x1 = x(start + (i + 1) * bw);
      // 区間が細いので、棒の間はあけない
      const bar = svgEl("rect", { x: x0, y: y(c), width: x1 - x0, height: T + ph - y(c),
        fill: Rhythm.color(start + (i + 0.5) * bw, baseAvg) });
      const tip = svgEl("title", {});
      tip.textContent = (i === nb - 1 ? fmt(start + i * bw) + " ms 以上" : fmt(start + i * bw) + "〜" + fmt(start + (i + 1) * bw) + " ms") +
        "：" + c + " 回";
      bar.appendChild(tip);
      svg.appendChild(bar);
    });

    // 軸
    svg.appendChild(svgEl("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    svg.appendChild(svgEl("line", { x1: L, y1: T, x2: L, y2: T + ph, class: "dist-axis" }));

    // 横軸の目盛りは切りのよい間隔で6本程度
    const tick = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find(function (s) { return upper / s <= 6; }) || 2000;
    for (let v = start; v <= start + nb * bw; v += tick) {
      svg.appendChild(svgEl("line", { x1: x(v), y1: T + ph, x2: x(v), y2: T + ph + 3, class: "dist-axis" }));
      svg.appendChild(svgText(x(v), T + ph + 22, String(v), "middle"));
    }
    svg.appendChild(svgText(L + pw, H - 1, "ms", "end"));

    // 縦軸の目盛り（0 と最大、間に1つ）
    [0, Math.round(maxCount / 2), maxCount].filter(function (c, i, a) { return a.indexOf(c) === i; }).forEach(function (c) {
      svg.appendChild(svgText(L - 4, y(c) + 3, String(c), "end"));
    });
    svg.appendChild(svgText(L - 4, T - 8, "回", "end"));

    // 1回ごとの値（軸のすぐ下の短い線）
    values.forEach(function (v) {
      svg.appendChild(svgEl("line", { x1: x(v), y1: T + ph + 4, x2: x(v), y2: T + ph + 10, class: "dist-rug" }));
    });

    // 平均（点線）
    svg.appendChild(svgEl("line", { x1: x(row.avg), y1: T, x2: x(row.avg), y2: T + ph, class: "dist-mean" }));

    el.appendChild(svg);
  }

  // 軸に並べるキーの順（QWERTY の物理的な並び。数字の行 → Q の行 → A の行 → Z の行）
  const KEY_ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
  const KEY_ORDER = KEY_ROWS.join("");
  function keyRow(ch) {
    for (let i = 0; i < KEY_ROWS.length; i++) if (KEY_ROWS[i].indexOf(ch) >= 0) return i;
    return KEY_ROWS.length;
  }

  // bigram の2次元ヒストグラム（ヒートマップ）。横軸 = 1キー目、縦軸 = 2キー目、マスの色 = 値
  //   kind："count"（回数。0 回は白、一番多いマスが一番濃い。回数に比例）か "iki"（平均 IKI。表と同じ配色、baseAvg が基準）
  //   rows：toRows の結果（bigram）。軸には rows に出てくるキーだけを並べる
  //   opts.selected：枠で囲むマスの bigram。opts.onSelect(row)：データのあるマスをクリック（または Enter）したときに呼ぶ
  function drawHeatmap(el, rows, kind, baseAvg, opts) {
    opts = opts || {};
    el.textContent = "";
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "hm-empty";
      p.textContent = "対象になる bigram がありません。";
      el.appendChild(p);
      return;
    }
    const cells = new Map();
    const used = new Set();
    rows.forEach(function (r) {
      cells.set(r.gram, r);
      used.add(r.gram[0]);
      used.add(r.gram[1]);
    });
    const keys = Array.from(used).sort(function (a, b) {
      const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : 1);
    });
    const maxCount = Math.max.apply(null, rows.map(function (r) { return r.count; }));

    const C = 16;           // マスの大きさ
    const L = 40, T = 34;   // 軸のラベルの場所
    const LEG = 34;         // 下の凡例の場所
    const n = keys.length;
    const W = L + n * C + 6, H = T + n * C + LEG;
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "hm-svg", role: "img",
      "aria-label": "bigram の" + (kind === "count" ? "回数" : "平均 IKI") + "の2次元ヒストグラム" });
    svg.style.maxWidth = (W * 1.6) + "px";

    // 軸のラベル（キーの QWERTY の文字）
    keys.forEach(function (k, i) {
      svg.appendChild(svgText(L + i * C + C / 2, T - 4, k, "middle"));
      svg.appendChild(svgText(L - 4, T + i * C + C / 2 + 3.5, k, "end"));
    });
    svg.appendChild(svgText(L, 10, "1キー目 →", "start"));
    const yTitle = svgText(12, T, "2キー目 →", "start");
    yTitle.setAttribute("transform", "rotate(90 12 " + T + ")");
    svg.appendChild(yTitle);

    // マス
    keys.forEach(function (first, xi) {
      keys.forEach(function (second, yi) {
        const r = cells.get(first + second);
        let fill;
        if (kind === "count") fill = r ? countColor(r.count / maxCount) : "var(--hm-none)";
        else fill = r ? Rhythm.color(r.avg, baseAvg) : "var(--hm-none)";
        const rect = svgEl("rect", { x: L + xi * C, y: T + yi * C, width: C, height: C, fill: fill, class: "hm-cell" });
        const tip = svgEl("title", {});
        tip.textContent = first + second + "：" + (r ? r.count + " 回・平均 " + Math.round(r.avg) + " ms" : "なし");
        rect.appendChild(tip);
        if (r && opts.onSelect) {
          rect.setAttribute("class", "hm-cell hm-click");
          rect.setAttribute("tabindex", "0");
          rect.addEventListener("click", function () { opts.onSelect(r); });
          rect.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect(r); }
          });
        }
        svg.appendChild(rect);
      });
    });

    // キーボードの行が変わるところの区切り線
    for (let i = 1; i < n; i++) {
      if (keyRow(keys[i]) === keyRow(keys[i - 1])) continue;
      svg.appendChild(svgEl("line", { x1: L + i * C, y1: T, x2: L + i * C, y2: T + n * C, class: "hm-sep" }));
      svg.appendChild(svgEl("line", { x1: L, y1: T + i * C, x2: L + n * C, y2: T + i * C, class: "hm-sep" }));
    }
    svg.appendChild(svgEl("rect", { x: L, y: T, width: n * C, height: n * C, class: "hm-frame" }));
    // 分布を表示中のマスを枠で囲む
    if (opts.selected && cells.has(opts.selected)) {
      const sx = keys.indexOf(opts.selected[0]), sy = keys.indexOf(opts.selected[1]);
      svg.appendChild(svgEl("rect", { x: L + sx * C, y: T + sy * C, width: C, height: C, class: "hm-selected" }));
    }

    // 凡例（色の帯と目盛り）
    const ly = T + n * C + 12, lw = Math.min(n * C, 260), lh = 8;
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const f = (i + 0.5) / steps;
      const fill = kind === "count" ? countColor(f) : Rhythm.color(f * 2 * baseAvg, baseAvg);
      svg.appendChild(svgEl("rect", { x: L + (i * lw) / steps, y: ly, width: lw / steps + 0.5, height: lh, fill: fill }));
    }
    const labels = kind === "count"
      ? ["0", String(Math.round(maxCount / 2)), maxCount + " 回"]
      : ["0", "平均 " + Math.round(baseAvg), Math.round(baseAvg * 2) + " ms 以上"];
    svg.appendChild(svgText(L, ly + lh + 11, labels[0], "start"));
    svg.appendChild(svgText(L + lw / 2, ly + lh + 11, labels[1], "middle"));
    svg.appendChild(svgText(L + lw, ly + lh + 11, labels[2], "end"));

    el.appendChild(svg);
  }

  // 回数の色。f = 回数 ÷ 一番多い回数（0〜1）。白に近い青 → 濃い青
  function countColor(f) {
    return "hsl(215, 75%, " + Math.round(96 - f * 64) + "%)";
  }

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

  // 生データの events から、押したキーの並び [{ t, label, ok }] を作る（Shift は並びに入れない）
  //   ok：n-gram に使えるキーか。間違えたキー・Backspace・スペース・文字のないキー・Shift と同時に押したキーは false
  function keySequence(events) {
    const seq = [];
    const shiftDown = new Set(); // 押されている Shift の番号（"u" の行で離す）
    // "u" の行（Shift を離した）を記録する前の記録では、Shift の次の1キーだけを Shift と同時に押したとみなす
    const hasUp = events.some(function (e) { return e[1] === "u"; });
    events.forEach(function (e) {
      if (e[1] === "u") {
        shiftDown.delete(e[2]);
      } else if (e[1] === "k") {
        if (Keys.isShiftNumber(e[2])) {
          shiftDown.add(e[2]);
          return;
        }
        const label = Keys.label(e[2]);
        const ok = e[4] === 1 && shiftDown.size === 0 && label !== null && e[2] !== Keys.SPACE && e[2] !== Keys.BACKSPACE;
        seq.push({ t: e[0], label: label, ok: ok });
        if (!hasUp) shiftDown.clear();
      }
    });
    return seq;
  }

  // 生データの events から、連続する n 個のキーごとの IKI を map に足し込む
  // （複数回分を同じ map に足せば、全記録の集計になる）
  // n-gram の IKI = 中の (n-1) 個のキーの間隔の平均。名前はキーの QWERTY の文字。ルールは docs/analysis.md を参照
  function accumulate(map, n, events) {
    const seq = keySequence(events);
    for (let end = n - 1; end < seq.length; end++) {
      const start = end - n + 1;
      let ok = true;
      for (let i = start; i <= end; i++) {
        if (!seq[i].ok) { ok = false; break; } // 使えないキーが絡んだものは除く
      }
      if (!ok) continue;
      const key = seq.slice(start, end + 1).map(function (k) { return k.label; }).join("");
      const e = map.get(key) || { values: [] };
      e.values.push((seq[end].t - seq[start].t) / (n - 1)); // 1回ごとの値（分布・標準偏差に使う）
      map.set(key, e);
    }
    return map;
  }

  // accumulate の結果を一覧表の行 { gram, avg, sd, count, values } にする
  // sd は IKI の標本標準偏差（n-1 で割る）。1回しか出ないものは null
  function toRows(map) {
    return Array.from(map, function (entry) {
      const values = entry[1].values;
      const count = values.length;
      const avg = values.reduce(function (a, b) { return a + b; }, 0) / count;
      const sd = count > 1
        ? Math.sqrt(values.reduce(function (a, v) { return a + (v - avg) * (v - avg); }, 0) / (count - 1))
        : null;
      return { gram: entry[0], avg: avg, sd: sd, count: count, values: values };
    });
  }

  function th(text) {
    const el = document.createElement("th");
    el.textContent = text;
    return el;
  }

  function td(className, text) {
    const el = document.createElement("td");
    el.className = className;
    el.textContent = text;
    return el;
  }

  return { create: create, accumulate: accumulate, toRows: toRows, drawHeatmap: drawHeatmap };
})();
