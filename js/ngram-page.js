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
  const hmGridEl = document.getElementById("hm-grid");   // 2枚を入れる枠
  const HM_SIDE_MAX = 32; // 軸のキーと組の数がこれ以下なら2枚を横に、超えたら上下に並べる
  let hmRows = [];        // 2次元ヒストグラムに描いている bigram
  let hmBase = 0;         // 色の基準
  // bigram の表で分布を出す行が変わったら、2次元ヒストグラムのそのマスを枠で囲み直し、散布図のその点を強調し直す
  const bigramTable = NGram.create(2, "bigram", document.getElementById("bigram-dist"), function () {
    redrawHeatmaps();
    drawBigramFreq();
  });
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
  // 同時押し（決まりは docs/analysis_iki.md の「同時押しのあるかな配列」）。どれも同時押しの記録があるときだけ出す
  const biKindBoxEl = document.getElementById("f-bi-kind-box");
  const biKindEl = document.getElementById("f-bi-kind"); // bigram の表の種類の絞り込み
  const chordSectionEl = document.getElementById("chord-section");
  const chordTableEl = document.getElementById("chord-table");
  const chordDistEl = document.getElementById("chord-dist");
  let biRows = [];        // bigram の表に出せる行（「回数」で絞ったもの。種類の絞り込みの前）
  let biBase = 0;         // bigram の表の色の基準
  let biTotal = 0;        // 全部の bigram（「回数」で絞る前）の回数の合計。散布図の頻度の分母
  let lastPickedCount = 0; // 絞り込んだ記録の回数（書き出しに入れる）
  let chordRows = [];     // 同時押しの表の行
  let chordUpper = 0;     // ずれの分布の横軸の最大（選んだ記録の判定時間の最大）
  let chordSelected = null; // ずれの分布を出している組

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
      lastPickedCount = picked.length;
      // IKI の推移の横軸：絞り込んだ記録の古い順の通し番号（回数）と、その記録の日（このPCの日付）
      const tags = PointTrend.tagsOf(picked, Filters.localDate);
      trendInfo = PointTrend.axisOf(trendEl.value, picked, Filters.localDate);
      NGram.setTrend(trendInfo);
      if (picked.length === 0) {
        ngramSummaryEl.textContent = "";
        drawBigrams([], 0);
        trigramTable.renderRows(trigramEl, [], 0, "データなし");
        drawKeyIki([], 0, kana);
        drawHeatmaps([], 0);
        drawClasses([], [], 0);
        drawCorr([], []);
        drawChords([], 0);
        drawKana(new Map(), 0, 1);
        return;
      }

      const byId = new Map(picked.map(function (s) { return [s.id, s]; }));
      const ids = new Set(byId.keys());
      const bigrams = new Map();
      let strokes = 0; // 総打鍵数：選んだ記録の、押したキー（events の "k" の行）の数。Shift・Backspace・間違えたキーも数える
      const trigrams = new Map();
      const spreads = new Map(); // 同時押しの組 → ずれ
      const kanaBigrams = new Map(); // 日本語の回の bigram → かなの中・境目の IKI
      let maxTerm = 0;           // 選んだ記録の判定時間の最大
      ngramSummaryEl.textContent = "集計中…";
      return Store.eachRaw(ids, function (raw) {
        // 押したキーの記録（events の "k" の行）から数える。英語も日本語も同じ。IKI 測定モードの回は、各語の1回目を数えない
        const skip = IkiMeasurement.skipOf(byId.get(raw.id), raw);
        const chords = NGram.chordsOf(raw, v[1]); // 同時押しの組は1打として数える
        NGram.accumulate(bigrams, 2, raw.events, tags.get(raw.id), skip, chords);
        NGram.accumulate(trigrams, 3, raw.events, tags.get(raw.id), skip, chords);
        if (chords) {
          NGram.accumulateSpreads(spreads, raw.events, skip, chords);
          maxTerm = Math.max(maxTerm, chords.term || 0);
        }
        if (byId.get(raw.id).lang === "ja") NGram.accumulateKana(kanaBigrams, raw.events, skip, chords);
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
        // キーごとの IKI・相関の図は、同時押しの組を含まないものだけを使う
        const single = function (r) { return !r.chord; };
        const singleBi = allBi.filter(single);
        drawClasses(allBi, allTri, base); // 指と行(row)で分けた分類は「回数」で絞らない
        biTotal = allBi.reduce(function (a, r) { return a + r.count; }, 0);
        drawBigrams(bi, base);
        trigramTable.renderRows(trigramEl, tri, base);
        drawKeyIki(singleBi, base, kana);
        drawHeatmaps(bi, base);
        drawCorr(tri.filter(single), singleBi);
        drawChords(NGram.toRows(spreads).filter(keep), maxTerm);
        drawKana(kanaBigrams, base, min);
        ngramSummaryEl.textContent = "総打鍵数 " + strokes.toLocaleString() + " ／ bigram " + bi.length + " 種類・trigram " + tri.length + " 種類 ／ 打鍵間隔の平均 " + Math.round(base) + " ms";
      });
    }).catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    }).then(function () {
      if (myId === loadId) loadingEl.hidden = true;
    });
  }

  // bigram の表を描く。同時押しの組を含む行があるときだけ、種類の絞り込みを出す
  function drawBigrams(rows, base) {
    biRows = rows;
    biBase = base;
    biKindBoxEl.hidden = !rows.some(function (r) { return r.chord; });
    if (biKindBoxEl.hidden) biKindEl.value = "all";
    renderBigrams();
  }

  function renderBigrams() {
    const kind = biKindEl.value;
    const rows = kind === "all" ? biRows.slice() : biRows.filter(function (r) { return r.kind === kind; });
    bigramTable.renderRows(bigramEl, rows, biBase, biRows.length ? undefined : "データなし");
    drawBigramFreq();
  }

  // ---- bigram の IKI と頻度の散布図（決まりは docs/analysis_iki.md の「bigram の IKI と頻度」） ----
  const bigramFreqEl = document.getElementById("bigram-freq");
  const bfColorEl = document.getElementById("f-bf-color"); // 色分け：分類・SFB の行の差・手の組
  const BF_WEAK = 20; // これより少ない回数の点は白抜き
  const OTHER = "var(--sub)";
  // 色分けごとの [名前, 色] と、bigram → 名前
  const BF_COLORINGS = {
    class: {
      legend: [["alternation（左右交互）", "var(--cmp-fast)"], ["roll（内向き）", "var(--cmp-3)"], ["roll（外向き）", "var(--cmp-4)"],
        ["SFB（同指異鍵）", "var(--cmp-slow)"], ["repeat（連打）", "var(--cmp-5)"], ["分類なし", OTHER]],
      nameOf: function (g) {
        const c = FingerMap.bigramBase(g);
        return { alternation: "alternation（左右交互）", "roll-in": "roll（内向き）", "roll-out": "roll（外向き）", repeat: "repeat（連打）",
          "sfb-0": "SFB（同指異鍵）", "sfb-1": "SFB（同指異鍵）", "sfb-2": "SFB（同指異鍵）" }[c] || "分類なし";
      }
    },
    sfb: {
      legend: [["SFB・同じ行", "var(--cmp-fast)"], ["SFB・1行", "var(--cmp-4)"], ["SFB・2行以上", "var(--cmp-slow)"], ["SFB 以外", OTHER]],
      nameOf: function (g) {
        return { "sfb-0": "SFB・同じ行", "sfb-1": "SFB・1行", "sfb-2": "SFB・2行以上" }[FingerMap.bigramBase(g)] || "SFB 以外";
      }
    },
    hand: {
      legend: [["左 → 左", "var(--cmp-fast)"], ["左 → 右", "var(--cmp-3)"], ["右 → 左", "var(--cmp-4)"], ["右 → 右", "var(--cmp-5)"], ["割り当てなし", OTHER]],
      nameOf: function (g) {
        const a = FingerMap.keyOf(g[0]), b = FingerMap.keyOf(g[1]);
        if (!a || !b) return "割り当てなし";
        const h = { L: "左", R: "右" };
        return h[a.hand] + " → " + h[b.hand];
      }
    }
  };
  function drawBigramFreq() {
    const def = BF_COLORINGS[bfColorEl.value] || BF_COLORINGS.class;
    const colorOf = {};
    def.legend.forEach(function (g) { colorOf[g[0]] = g[1]; });
    const kind = biKindEl.value;
    const rows = biRows.filter(function (r) { return !r.chord && (kind === "all" || r.kind === kind); });
    KeyScatter.draw(bigramFreqEl, rows.map(function (r) {
      return { key: r.gram, count: r.count, value: r.avg, weak: r.count < BF_WEAK,
        tip: "平均 " + Math.round(r.avg) + " ms ／ " + r.count.toLocaleString() + " 回" };
    }), {
      coloring: {
        legend: def.legend,
        colorOf: function (p) {
          const name = def.nameOf(p.key);
          return { name: name, color: colorOf[name], back: colorOf[name] === OTHER };
        }
      },
      unit: "ms", labels: false, total: biTotal, noun: "bigram",
      selected: bigramTable.selected(),
      onSelect: function (gram) { bigramTable.show(gram); },
      ariaLabel: "bigram の IKI と頻度の散布図",
      emptyText: biRows.length ? "同時押しの組を含まない bigram がありません。" : "データなし"
    });
  }
  bfColorEl.addEventListener("change", drawBigramFreq);

  // 表に出ている bigram（絞り込み・「回数」・種類が表と同じ）の 1回ごとの IKI を JSON で書き出す（区間に分けず、すべての値をそのまま）。形は docs/bigram_export.md
  // bigram の2打それぞれの物理キーの番号（"1a" など。js/keys.js）。同時押しの組は "27+28" のように + でつなぐ
  function keyNumbers(r) {
    const strokes = r.chord ? r.gram.split(" → ") : Array.from(r.gram);
    return strokes.map(function (s) {
      return s.split("+").map(function (ch) {
        const k = Keys.ofChar(ch);
        return k ? k.number : null;
      }).join("+");
    });
  }

  function exportBigrams() {
    const msgEl = document.getElementById("bi-export-msg");
    const kind = biKindEl.value;
    const rows = (kind === "all" ? biRows : biRows.filter(function (r) { return r.kind === kind; })).slice()
      .sort(function (a, b) { return a.gram < b.gram ? -1 : a.gram > b.gram ? 1 : 0; });
    if (!rows.length) {
      msgEl.textContent = "書き出す bigram がありません。";
      return;
    }
    const val = function (id) { return document.getElementById(id).value || null; };
    const round1 = function (v) { return Math.round(v * 10) / 10; };
    const data = {
      app: "Typattern",
      version: document.getElementById("version").textContent,
      exportedAt: new Date().toISOString(),
      filters: {
        lang: val("f-lang"), keyLayout: val("f-layout"), mode: val("f-mode"),
        from: val("f-from"), to: val("f-to"),
        minCount: Number(minEl.value), kind: biKindBoxEl.hidden ? null : kind
      },
      sessions: lastPickedCount,
      bigrams: rows.map(function (r) {
        return {
          bigram: r.gram, keys: keyNumbers(r), chord: r.chord, count: r.count, meanMs: round1(r.avg), sdMs: r.sd === null ? null : round1(r.sd),
          values: r.values.map(Math.round)
        };
      })
    };
    // 1 bigram を1行にする（開いたときに読みやすく、大きさはほとんど変わらない）
    const text = "{\n" + Object.keys(data).filter(function (k) { return k !== "bigrams"; }).map(function (k) {
      return "  " + JSON.stringify(k) + ": " + JSON.stringify(data[k]) + ",\n";
    }).join("") + '  "bigrams": [\n' + data.bigrams.map(function (b) { return "    " + JSON.stringify(b); }).join(",\n") + "\n  ]\n}\n";
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, "0"); };
    a.href = URL.createObjectURL(blob);
    a.download = "typattern-bigram-iki-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    msgEl.textContent = "bigram " + rows.length + " 種類を書き出しました。";
  }
  document.getElementById("bi-export").addEventListener("click", exportBigrams);

  // 同時押しの表：組ごとの回数とずれの中央値。行をクリックすると、その組のずれの分布を出す
  function drawChords(rows, upper) {
    chordRows = rows.slice().sort(function (x, y) { return y.count - x.count || (x.gram < y.gram ? -1 : 1); });
    chordUpper = upper;
    chordSectionEl.hidden = upper === 0;
    if (!chordRows.some(function (r) { return r.gram === chordSelected; })) chordSelected = chordRows.length ? chordRows[0].gram : null;
    redrawChords();
  }

  function median(values) {
    const s = values.slice().sort(function (a, b) { return a - b; });
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function redrawChords() {
    chordTableEl.textContent = "";
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    ["組", "回数", "ずれの中央値(ms)"].forEach(function (t) {
      hr.appendChild(document.createElement("th")).textContent = t;
    });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    const cell = function (tr, className, text) {
      const td = tr.appendChild(document.createElement("td"));
      td.className = className;
      td.textContent = text;
      return td;
    };
    if (!chordRows.length) {
      cell(body.appendChild(document.createElement("tr")), "bg-empty-cell", "データなし").colSpan = 3;
    }
    chordRows.forEach(function (r) {
      const tr = body.appendChild(document.createElement("tr"));
      cell(tr, "bg-name", r.gram);
      cell(tr, "bg-count", r.count);
      cell(tr, "bg-count", Math.round(median(r.values)));
      tr.className = "bg-row" + (r.gram === chordSelected ? " bg-selected" : "");
      tr.tabIndex = 0;
      tr.title = "クリックでずれの分布を表示";
      const pick = function () {
        chordSelected = r.gram;
        redrawChords();
        chordDistEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    });
    chordTableEl.appendChild(table);
    const row = chordRows.find(function (r) { return r.gram === chordSelected; });
    // 棒の色は、判定時間の半分を基準にする（0 に近いほど青、判定時間で赤）
    if (row) NGram.drawDistribution(chordDistEl, row, "同時押し", chordUpper / 2, { what: "ずれ", upper: chordUpper });
    else chordDistEl.textContent = "";
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
    keyFreqData = byKey;
    drawKeyFreq();
  }

  // ---- キーごとの IKI と頻度の散布図（決まりは docs/analysis_iki.md の「キーごとの IKI と頻度」） ----
  const keyFreqEl = document.getElementById("key-freq");
  const kfColorEl = document.getElementById("f-kf-color"); // 色分け：指・行・手
  let keyFreqData = {}; // QWERTY の文字 → { sum, count }（キーごとの IKI と同じもの）
  function drawKeyFreq() {
    KeyScatter.draw(keyFreqEl, Object.keys(keyFreqData).map(function (k) {
      const e = keyFreqData[k];
      const avg = e.count ? e.sum / e.count : 0;
      return { key: k, count: e.count, value: avg, tip: "平均 " + Math.round(avg) + " ms ／ " + e.count.toLocaleString() + " 回" };
    }), { colorBy: kfColorEl.value, unit: "ms", ariaLabel: "キーごとの IKI と頻度の散布図" });
  }
  kfColorEl.addEventListener("change", drawKeyFreq);

  // 2次元ヒストグラム2枚を描く。マスをクリックすると、その bigram の分布を表の行のクリックと同じ場所（bigram の表の下）に出す
  function drawHeatmaps(rows, base) {
    hmRows = rows;
    hmBase = base;
    redrawHeatmaps();
  }

  function redrawHeatmaps() {
    // W A S D で動かしたとき（byKey）はページをスクロールしない。データのないマスに止まったら（r が null）分布を消す
    const opts = { selected: bigramTable.selected(), keyMove: true, onSelect: function (r, byKey) {
      // 種類の絞り込みで表から外れている行を選んだら、絞り込みを外す
      if (r && biKindEl.value !== "all" && biKindEl.value !== r.kind) {
        biKindEl.value = "all";
        renderBigrams();
      }
      bigramTable.show(r ? r.gram : null, byKey);
    } };
    const n = NGram.drawHeatmap(hmCountEl, hmRows, "count", hmBase, opts);
    NGram.drawHeatmap(hmIkiEl, hmRows, "iki", hmBase, opts);
    hmGridEl.classList.toggle("hm-stack", n > HM_SIDE_MAX);
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
  const NONE = node("分類しない", ["none"], 0, "指を割り当てていないキー（初期値では数字キーの行など）や、同時押しの組を含む組");
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
      (r.chord ? ["none"] : table.idsOf(r.gram)).forEach(function (id) {
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

  // ---- かなの中と境目（決まりは docs/analysis_iki.md の「かなの中と境目」） ----
  const kbSumEl = document.getElementById("kb-sum");
  const kbDistEl = document.getElementById("kb-dist");
  const kbPairsEl = document.getElementById("kb-pairs");
  let kbRows = [];          // まとめの表の行（かなの中・かなの境目）
  let kbSelected = 0;       // 分布を出している行
  let kbBase = 0;           // 色の基準

  // IKI の並びから、平均と SD（標本標準偏差。1回だけなら null）
  function meanSd(values) {
    const n = values.length;
    if (!n) return { avg: null, sd: null };
    const avg = values.reduce(function (a, b) { return a + b; }, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce(function (a, v) { return a + (v - avg) * (v - avg); }, 0) / (n - 1)) : null;
    return { avg: avg, sd: sd };
  }

  // map：bigram → { inside, boundary }（NGram.accumulateKana の結果）。min：同じ bigram の比べに出す回数の下限
  function drawKana(map, base, min) {
    kbBase = base;
    const inside = [], boundary = [];
    map.forEach(function (e) {
      e.inside.forEach(function (v) { inside.push(v); });
      e.boundary.forEach(function (v) { boundary.push(v); });
    });
    const total = inside.length + boundary.length;
    kbRows = [["かなの中", inside], ["かなの境目", boundary]].map(function (x) {
      const s = meanSd(x[1]);
      return { gram: x[0], values: x[1], count: x[1].length, share: total ? x[1].length / total : 0, avg: s.avg, sd: s.sd };
    });
    drawKanaSum();

    // 同じ bigram の比べ
    kbPairsEl.textContent = "";
    const pairs = [];
    map.forEach(function (e, gram) {
      if (e.inside.length < min || e.boundary.length < min) return;
      const a = meanSd(e.inside), b = meanSd(e.boundary);
      pairs.push({ gram: gram, inside: a.avg, inCount: e.inside.length, boundary: b.avg, outCount: e.boundary.length, diff: b.avg - a.avg });
    });
    pairs.sort(function (x, y) { return y.diff - x.diff || (x.gram < y.gram ? -1 : 1); });
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    ["bigram", "中の IKI(ms)", "回数", "境目の IKI(ms)", "回数", "差(ms)"].forEach(function (t) {
      const th = document.createElement("th");
      th.textContent = t;
      hr.appendChild(th);
    });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    pairs.forEach(function (p) {
      const tr = document.createElement("tr");
      const cell = function (className, text, color) {
        const td = document.createElement("td");
        td.className = className;
        td.textContent = text;
        if (color) td.style.color = color;
        tr.appendChild(td);
      };
      cell("bg-name", p.gram);
      cell("bg-avg", Math.round(p.inside), Rhythm.color(p.inside, base));
      cell("bg-count", p.inCount.toLocaleString());
      cell("bg-avg", Math.round(p.boundary), Rhythm.color(p.boundary, base));
      cell("bg-count", p.outCount.toLocaleString());
      cell("bg-count", (p.diff > 0 ? "+" : "") + Math.round(p.diff));
      body.appendChild(tr);
    });
    if (!pairs.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "bg-empty-cell";
      td.textContent = total ? "かなの中にも境目にも「回数」以上出てくる bigram がありません" : "データなし（日本語の記録がありません）";
      tr.appendChild(td);
      body.appendChild(tr);
    }
    kbPairsEl.appendChild(table);
  }

  function drawKanaSum() {
    kbSumEl.textContent = "";
    const table = document.createElement("table");
    table.className = "bg-table";
    const hr = document.createElement("tr");
    ["区分", "回数", "割合", "IKI(ms/打)", "SD(ms)"].forEach(function (t) {
      const th = document.createElement("th");
      th.textContent = t;
      hr.appendChild(th);
    });
    table.appendChild(document.createElement("thead")).appendChild(hr);
    const body = table.appendChild(document.createElement("tbody"));
    kbRows.forEach(function (r, index) {
      const tr = document.createElement("tr");
      const cell = function (className, text) {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = text;
        tr.appendChild(td);
        return td;
      };
      cell("fc-name", r.gram);
      cell("bg-count", r.count.toLocaleString());
      cell("bg-count", (r.share * 100).toFixed(1) + "%");
      const avg = cell("bg-avg", r.avg === null ? "-" : Math.round(r.avg));
      if (r.avg !== null && kbBase) avg.style.color = Rhythm.color(r.avg, kbBase);
      cell("bg-sd", r.sd === null ? "-" : Math.round(r.sd));
      if (r.count) {
        tr.className = "bg-row" + (kbSelected === index ? " bg-selected" : "");
        tr.tabIndex = 0;
        tr.title = "クリックで IKI の分布を表示";
        const pick = function () {
          kbSelected = index;
          drawKanaSum();
          kbDistEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        };
        tr.addEventListener("click", pick);
        tr.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
        });
      }
      body.appendChild(tr);
    });
    kbSumEl.appendChild(table);
    const r = kbRows[kbSelected];
    if (r && r.count) NGram.drawDistribution(kbDistEl, r, "bigram の区分", kbBase);
    else kbDistEl.textContent = "";
  }

  minEl.addEventListener("change", update);
  biKindEl.addEventListener("change", renderBigrams);
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
