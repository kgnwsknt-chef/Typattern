// n-gram（連続して押した n 個のキー。2=bigram、3=trigram）ごとの打鍵間隔(IKI)を集計して一覧表にする
// 行をクリックすると、その n-gram の IKI の分布（ヒストグラム）を表の下に出す
const NGram = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // n 文字ごとの一覧表を1つ作る。並び順は表ごとに持ち、やり直しても維持する
  // distEl を渡すと、行のクリックで分布のグラフをそこに描く
  function create(n, label, distEl) {
    let rows = [];     // 集計結果 { gram, avg, sd, count, values }
    let order = "asc"; // 平均 IKI の並び順
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
      if (selected && !rows.some(function (r) { return r.gram === selected; })) selected = null;
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
      draw();
    }

    function draw() {
      containerEl.textContent = "";
      const sign = order === "asc" ? 1 : -1;
      rows.sort(function (x, y) {
        return sign * (x.avg - y.avg) || y.count - x.count || (x.gram < y.gram ? -1 : 1);
      });

      const table = document.createElement("table");
      table.className = "bg-table";

      const head = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(th(label));
      const sortTh = th("");
      const sortBtn = document.createElement("button");
      sortBtn.type = "button";
      sortBtn.className = "bg-sort";
      sortBtn.textContent = "IKI(ms/打) " + (order === "asc" ? "▲" : "▼");
      sortBtn.title = order === "asc" ? "速い順（クリックで遅い順）" : "遅い順（クリックで速い順）";
      sortBtn.addEventListener("click", function () {
        order = order === "asc" ? "desc" : "asc";
        draw();
      });
      sortTh.setAttribute("aria-sort", order === "asc" ? "ascending" : "descending");
      sortTh.appendChild(sortBtn);
      hr.appendChild(sortTh);
      const sdTh = th("SD(ms)");
      sdTh.title = "IKI の標準偏差（標本標準偏差）。1回しか出ないものは -";
      hr.appendChild(sdTh);
      hr.appendChild(th("回数"));
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

    return { renderRows: renderRows, clear: clear };
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

    // 横軸は基本 0〜500 ms（区間の幅 20 ms）。500 ms を超える値があるときだけ、
    // その値が入るところまで 100 ms 単位で広げ、区間が25個以内になる切りのよい幅にする
    const AXIS_MAX = 500;
    const upper = max < AXIS_MAX ? AXIS_MAX : Math.floor(max / 100) * 100 + 100;
    const steps = [20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const bw = steps.find(function (s) { return upper / s <= 25; }) || 10000;
    const start = 0;
    const nb = Math.ceil(upper / bw);
    const counts = new Array(nb).fill(0);
    values.forEach(function (v) { counts[Math.min(nb - 1, Math.floor((v - start) / bw))]++; });
    const maxCount = Math.max.apply(null, counts);

    // 描画領域
    const W = 360, H = 176, L = 32, R = 10, T = 18, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const x = function (v) { return L + ((v - start) / (nb * bw)) * pw; };
    const y = function (c) { return T + ph - (c / maxCount) * ph; };

    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "dist-svg", role: "img",
      "aria-label": label + " " + row.gram + " の IKI の分布" });

    // 棒
    counts.forEach(function (c, i) {
      if (c === 0) return;
      const x0 = x(start + i * bw), x1 = x(start + (i + 1) * bw);
      const bar = svgEl("rect", { x: x0 + 1, y: y(c), width: Math.max(1, x1 - x0 - 2), height: T + ph - y(c),
        fill: Rhythm.color(start + (i + 0.5) * bw, baseAvg), rx: 1 });
      const tip = svgEl("title", {});
      tip.textContent = (start + i * bw) + "〜" + (start + (i + 1) * bw) + " ms：" + c + " 回";
      bar.appendChild(tip);
      svg.appendChild(bar);
    });

    // 軸
    svg.appendChild(svgEl("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    svg.appendChild(svgEl("line", { x1: L, y1: T, x2: L, y2: T + ph, class: "dist-axis" }));

    // 横軸の目盛りは切りのよい間隔（0〜500 ms なら 100 ms ごと）で6本程度
    const tick = [100, 200, 250, 500, 1000, 2000, 5000, 10000].find(function (s) { return upper / s <= 6; }) || 20000;
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

  return { create: create, accumulate: accumulate, toRows: toRows };
})();
