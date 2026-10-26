// 苦手な単語のページ（weak-words.html）。絞り込んだ単語モードの記録から、遅い単語・ミスの多い単語を 30 語ずつ表にする
// 集計は js/weak-words.js、決まりは docs/weak-words.md
(function () {
  "use strict";

  const summaryEl = document.getElementById("stats-summary");
  const wwSummaryEl = document.getElementById("ww-summary");
  const slowEl = document.getElementById("ww-slow");
  const missEl = document.getElementById("ww-miss");
  const filters = Filters.init(update);
  const LANG_NAME = { en: "英語", ja: "日本語" };
  const bigramEl = document.getElementById("ww-bigram"); // 言語・配列で差のある bigram
  const compareEl = document.getElementById("ww-bigram-dist"); // 表で選んだ bigram の IKI の分布の比べ
  let biGroupsShown = new Map(); // 表を作った集計（"言語\t配列" → bigram → { values }）。比べる図に使う
  let biRows = [];               // 表の行（WeakWords.bigramGaps の結果）
  let biSelected = 0;            // 比べる図に出している行の番号
  const KIND_NAME = { lang: "言語", layout: "配列", both: "言語と配列" };
  const fromEl = document.getElementById("f-from"); // 絞り込みの期間（指定したときだけ、その期間の全部の回で集計する）
  const toEl = document.getElementById("f-to");

  let loadId = 0; // 古い読み込みの結果で上書きしないための番号

  function update() {
    const myId = ++loadId;
    summaryEl.textContent = "集計中…";
    Store.getAllSessions().then(function (sessions) {
      if (myId !== loadId) return;
      // 単語モードの記録だけを使う（練習モードの回は使わない）
      let picked = filters.pick(sessions).filter(function (s) { return s.mode === "words" && !s.practice; });
      // 期間を指定しないときは、言語・配列ごとに直近 N 回だけ（練習の候補と同じ）。指定したときは、その期間の全部の回
      const byPeriod = !!(fromEl.value || toEl.value);
      if (!byPeriod) picked = WeakWords.recentPerGroup(picked);
      // 言語・配列で差のある bigram：練習モード以外のすべてのモードの記録。絞り込みの言語・配列は効かせず、期間だけを使う
      let biPicked = sessions.filter(function (s) {
        if (s.practice) return false;
        const day = Filters.localDate(s.finishedAt);
        return (!fromEl.value || day >= fromEl.value) && (!toEl.value || day <= toEl.value);
      });
      if (!byPeriod) biPicked = WeakWords.recentPerGroup(biPicked);
      const biById = new Map(biPicked.map(function (s) { return [s.id, s]; }));
      const biGroups = new Map(); // "言語\t配列" → bigram の集計
      summaryEl.textContent = picked.length
        ? Filters.summary(picked).replace("対象", "対象（単語モード）") + " ／ " +
          (byPeriod ? "指定した期間の全部の回で集計" : "言語・配列ごとに直近 " + WeakWords.recentRuns() + " 回で集計（設定の「苦手な単語を数える回数」。練習で選ぶ単語と同じ）")
        : "条件に合う単語モードの記録がありません。単語モードで打つと、ここに苦手な単語が出ます。";
      // 言語・配列が違えば別に数える
      const groups = new Map(); // "言語\t配列" → 単語の集計
      const byId = new Map(picked.map(function (s) { return [s.id, s]; }));
      const ids = new Set(Array.from(byId.keys()).concat(Array.from(biById.keys())));
      return Store.eachRaw(ids, function (raw) {
        const s = byId.get(raw.id);
        if (s) {
          const key = s.lang + "\t" + s.keyLayout;
          if (!groups.has(key)) groups.set(key, new Map());
          WeakWords.add(groups.get(key), raw);
        }
        const b = biById.get(raw.id);
        if (b) {
          const key = b.lang + "\t" + b.keyLayout;
          if (!biGroups.has(key)) biGroups.set(key, new Map());
          NGram.accumulate(biGroups.get(key), 2, raw.events);
        }
      }).then(function () {
        const all = [];
        groups.forEach(function (map, key) {
          const k = key.split("\t");
          WeakWords.rows(map).forEach(function (r) {
            r.lang = k[0];
            r.layout = k[1];
            all.push(r);
          });
        });
        const hasJa = all.some(function (r) { return r.lang === "ja"; });
        return WeakWords.loadDisplays(hasJa ? "ja" : "en").then(function (displays) {
          if (myId !== loadId) return;
          const many = groups.size > 1; // 言語・配列が複数あれば、どれの単語かも書く
          wwSummaryEl.textContent = picked.length ? "候補（" + WeakWords.MIN_COUNT + " 回以上打った単語）" + all.length + " 語" +
            (many ? " ／ 言語・配列が複数あるので、単語の横に書く" : "") : "";
          drawTable(slowEl, WeakWords.slowList(all), displays, many);
          drawTable(missEl, WeakWords.missList(all), displays, many);
          biGroupsShown = biGroups;
          biSelected = 0; // 集計し直したら、差が一番大きい行から
          drawBigrams(WeakWords.bigramGaps(biGroups));
        });
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
  }

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

  // 表：順位・単語・遅さ・ミスの割合・回数。日本語は表示する語と読みを出す
  function drawTable(el, rows, displays, many) {
    el.textContent = "";
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    [th("順位"), th("単語"), th("遅さ(ms/文字)"), th("ミスの割合"), th("回数")].forEach(function (c) { hr.appendChild(c); });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    rows.forEach(function (r, i) {
      const tr = document.createElement("tr");
      tr.appendChild(td("", String(i + 1)));
      const word = td("ww-word", "");
      const display = r.lang === "ja" ? displays.get(r.word) : null;
      if (display && display !== r.word) {
        word.appendChild(document.createTextNode(display + " "));
        const reading = document.createElement("span");
        reading.className = "ww-reading";
        reading.textContent = r.word;
        word.appendChild(reading);
      } else {
        word.textContent = r.word;
      }
      if (many) {
        const tag = document.createElement("span");
        tag.className = "ww-tag";
        tag.textContent = LANG_NAME[r.lang] + "・" + (r.layout === "qwerty" ? "QWERTY" : r.layout);
        word.appendChild(tag);
      }
      tr.appendChild(word);
      tr.appendChild(td("", String(Math.round(r.slow))));
      tr.appendChild(td("", (r.missRate * 100).toFixed(0) + "%"));
      tr.appendChild(td("", String(r.count)));
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const c = td("", "まだありません");
      c.colSpan = 5;
      tr.appendChild(c);
      body.appendChild(tr);
    }
    el.appendChild(table);
  }

  function groupName(g) {
    return LANG_NAME[g.lang] + "・" + (g.layout === "qwerty" ? "QWERTY" : g.layout);
  }

  // 言語・配列で差のある bigram の表：順位・bigram・違い・遅い方（言語・配列・IKI・回数）・速い方（同じ）・差
  function drawBigrams(rows) {
    biRows = rows;
    bigramEl.textContent = "";
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    ["順位", "bigram", "違い", "遅い方の言語・配列", "IKI(ms)", "回数", "速い方の言語・配列", "IKI(ms)", "回数", "差(ms)"]
      .forEach(function (t) { hr.appendChild(th(t)); });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    rows.forEach(function (r, i) {
      const tr = document.createElement("tr");
      [
        td("", String(i + 1)), td("ww-word", r.gram), td("ww-text", KIND_NAME[r.kind]),
        td("ww-text", groupName(r.slow)), td("", String(Math.round(r.slow.avg))), td("", String(r.slow.count)),
        td("ww-text", groupName(r.fast)), td("", String(Math.round(r.fast.avg))), td("", String(r.fast.count)),
        td("", String(Math.round(r.diff)))
      ].forEach(function (c) { tr.appendChild(c); });
      // クリック（または Enter）で、表の上の図をその bigram の分布の比べに切り替える
      tr.className = "bg-row" + (i === biSelected ? " bg-selected" : "");
      tr.tabIndex = 0;
      tr.title = "クリックで、表の上に言語・配列ごとの IKI の分布を重ねて表示";
      const pick = function () {
        biSelected = i;
        drawBigrams(biRows);
        compareEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
      body.appendChild(tr);
    });
    drawCompare(rows[biSelected] || null);
    if (!rows.length) {
      const tr = document.createElement("tr");
      const c = td("", "2つ以上の言語・配列で" + WeakWords.BIGRAM_MIN + "回以上打った bigram が、まだありません");
      c.colSpan = 10;
      tr.appendChild(c);
      body.appendChild(tr);
    }
    bigramEl.appendChild(table);
  }

  // ---- 選んだ bigram の IKI の分布を、言語・配列ごとに重ねて比べる図（決まりは docs/weak-words.md） ----
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COMPARE_BINS = 50; // 横軸の区間の数（0〜設定の「分布の横軸の最大」）
  // 重ねる順と色：遅い方・速い方・そのほかの言語・配列（style.css の --cmp-*）
  const COMPARE_COLORS = ["var(--cmp-slow)", "var(--cmp-fast)", "var(--cmp-3)", "var(--cmp-4)", "var(--cmp-5)"];

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

  // その bigram を BIGRAM_MIN 回以上打った言語・配列ごとの { lang, layout, values, avg, sd, role }。遅い方・速い方・そのほか（速い順）の順
  function compareGroups(row) {
    const list = [];
    biGroupsShown.forEach(function (map, key) {
      const e = map.get(row.gram);
      if (!e || e.values.length < WeakWords.BIGRAM_MIN) return;
      const k = key.split("\t");
      const n = e.values.length;
      const avg = e.values.reduce(function (a, b) { return a + b; }, 0) / n;
      const sd = Math.sqrt(e.values.reduce(function (a, v) { return a + (v - avg) * (v - avg); }, 0) / (n - 1));
      const role = k[0] === row.slow.lang && k[1] === row.slow.layout ? 0 : k[0] === row.fast.lang && k[1] === row.fast.layout ? 1 : 2;
      list.push({ lang: k[0], layout: k[1], values: e.values, avg: avg, sd: sd, role: role });
    });
    return list.sort(function (a, b) { return a.role - b.role || a.avg - b.avg; });
  }

  function drawCompare(row) {
    compareEl.textContent = "";
    if (!row) return;
    const groups = compareGroups(row);
    const upper = Settings.get("ngramMaxMs");
    const bw = upper / COMPARE_BINS;
    // 区間ごとの割合（その言語・配列の回数のうち、何 % が入ったか）。最大を超える値は一番右の区間に入れる
    groups.forEach(function (g) {
      g.share = new Array(COMPARE_BINS).fill(0);
      g.values.forEach(function (v) { g.share[Math.min(COMPARE_BINS - 1, Math.floor(v / bw))] += 100 / g.values.length; });
    });
    const maxShare = Math.max.apply(null, groups.map(function (g) { return Math.max.apply(null, g.share); }));

    // 見出しと、言語・配列ごとの凡例（色・回数・平均・SD）
    const head = document.createElement("div");
    head.className = "dist-head";
    const title = document.createElement("span");
    title.className = "dist-title";
    title.textContent = "bigram「" + row.gram + "」の IKI の分布（言語・配列ごと）";
    head.appendChild(title);
    compareEl.appendChild(head);
    const legend = document.createElement("div");
    legend.className = "cmp-legend";
    groups.forEach(function (g, i) {
      const item = document.createElement("span");
      item.className = "cmp-item";
      const swatch = document.createElement("span");
      swatch.className = "cmp-swatch";
      swatch.style.background = COMPARE_COLORS[i] || COMPARE_COLORS[COMPARE_COLORS.length - 1];
      item.appendChild(swatch);
      item.append(groupName(g) + (g.role === 0 ? "（遅い方）" : g.role === 1 ? "（速い方）" : "") + " " + g.values.length + " 回 ／ 平均 " +
        Math.round(g.avg) + " ms ／ SD " + Math.round(g.sd) + " ms");
      legend.appendChild(item);
    });
    compareEl.appendChild(legend);

    const W = 560, H = 200, L = 48, R = 18, T = 12, B = 34; // L は縦軸の名前（90度回して軸の左）と目盛りの分
    const pw = W - L - R, ph = H - T - B;
    const x = function (v) { return L + (Math.min(v, upper) / upper) * pw; };
    const y = function (s) { return T + ph - (s / maxShare) * ph; };
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "dist-svg", role: "img",
      "aria-label": "bigram " + row.gram + " の IKI の分布を言語・配列ごとに重ねた図" });

    // 棒（半透明で重ねる。区間が細いので、棒の間はあけない）
    groups.forEach(function (g, gi) {
      const color = COMPARE_COLORS[gi] || COMPARE_COLORS[COMPARE_COLORS.length - 1];
      g.share.forEach(function (s, i) {
        if (s === 0) return;
        const bar = svgEl("rect", { x: x(i * bw), y: y(s), width: x((i + 1) * bw) - x(i * bw), height: T + ph - y(s),
          fill: color, class: "cmp-bar" });
        const tip = svgEl("title", {});
        tip.textContent = groupName(g) + "：" + (i === COMPARE_BINS - 1 ? Math.round(i * bw) + " ms 以上" : Math.round(i * bw) + "〜" + Math.round((i + 1) * bw) + " ms") +
          " " + s.toFixed(1) + "%";
        bar.appendChild(tip);
        svg.appendChild(bar);
      });
    });

    // 軸と目盛り
    svg.appendChild(svgEl("line", { x1: L, y1: T + ph, x2: L + pw, y2: T + ph, class: "dist-axis" }));
    svg.appendChild(svgEl("line", { x1: L, y1: T, x2: L, y2: T + ph, class: "dist-axis" }));
    const tick = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find(function (s) { return upper / s <= 6; }) || 2000;
    for (let v = 0; v <= upper; v += tick) {
      svg.appendChild(svgEl("line", { x1: x(v), y1: T + ph, x2: x(v), y2: T + ph + 3, class: "dist-axis" }));
      svg.appendChild(svgText(x(v), T + ph + 16, String(v), "middle"));
    }
    svg.appendChild(svgText(L + pw, H - 1, "IKI (ms)", "end"));
    [0, maxShare / 2, maxShare].forEach(function (s) {
      svg.appendChild(svgText(L - 4, y(s) + 3, Math.round(s) + "", "end"));
    });
    // 縦軸の名前は90度回し（下から上へ読む）、目盛りの数字のさらに左、軸の高さの真ん中に置く
    const yName = svgText(12, T + ph / 2, "頻度 (%)", "middle");
    yName.setAttribute("transform", "rotate(-90 12 " + (T + ph / 2) + ")");
    svg.appendChild(yName);

    // 平均（言語・配列ごとの色の点線）
    groups.forEach(function (g, gi) {
      svg.appendChild(svgEl("line", { x1: x(g.avg), y1: T, x2: x(g.avg), y2: T + ph, class: "cmp-mean",
        stroke: COMPARE_COLORS[gi] || COMPARE_COLORS[COMPARE_COLORS.length - 1] }));
    });
    compareEl.appendChild(svg);
  }

  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
