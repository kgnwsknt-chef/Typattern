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
      if (!byPeriod) {
        const n = WeakWords.recentRuns();
        const counts = new Map();
        picked = picked.slice().reverse().filter(function (s) { // 新しい方から数える
          const key = s.lang + "\t" + s.keyLayout;
          counts.set(key, (counts.get(key) || 0) + 1);
          return counts.get(key) <= n;
        }).reverse();
      }
      summaryEl.textContent = picked.length
        ? Filters.summary(picked).replace("対象", "対象（単語モード）") + " ／ " +
          (byPeriod ? "指定した期間の全部の回で集計" : "言語・配列ごとに直近 " + WeakWords.recentRuns() + " 回で集計（設定の「苦手な単語を数える回数」。練習で選ぶ単語と同じ）")
        : "条件に合う単語モードの記録がありません。単語モードで打つと、ここに苦手な単語が出ます。";
      // 言語・配列が違えば別に数える
      const groups = new Map(); // "言語\t配列" → 単語の集計
      const byId = new Map(picked.map(function (s) { return [s.id, s]; }));
      return Store.eachRaw(new Set(byId.keys()), function (raw) {
        const s = byId.get(raw.id);
        const key = s.lang + "\t" + s.keyLayout;
        if (!groups.has(key)) groups.set(key, new Map());
        WeakWords.add(groups.get(key), raw);
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

  // バージョン表示と、記録の書き出し・読み込み（読み込んだら表示を更新する）
  PageFooter.init({ onImport: update });
  filters.ready.then(update);
})();
