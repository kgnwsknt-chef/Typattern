// 上位の記録の表。結果画面の「ランキング」タブと記録ページで使う
const Ranking = (function () {
  "use strict";

  const LANG_LABEL = { en: "英語", ja: "日本語" };
  const MODE_LABEL = { normal: "文章", short: "短い文章", words: "単語" };

  // 区分（言語・モード・配列）の表示名（例: 英語・文章・QWERTY、日本語・文章・tsukimisou-v2）
  // 登録したかな配列は、利用者が付けた配列名のまま出す
  function categoryLabel(s) {
    return (LANG_LABEL[s.lang] || s.lang) + "・" + (MODE_LABEL[s.mode] || s.mode) + "・" + layoutLabel(s.keyLayout);
  }

  function layoutLabel(keyLayout) {
    return keyLayout === "qwerty" ? "QWERTY" : keyLayout;
  }

  // rows は平均 IKI の小さい順（同じなら正確率の高い順）の概要の記録。currentId の行を目立たせる
  // opts.category: true なら「区分」の列を出す（区分が混ざった一覧のとき）
  // opts.emptyText: 記録がないときの文言
  // opts.onSelect(session, rank): 行をクリック（または Enter）したときに呼ぶ。opts.selectedId の行は選んだ印を付ける
  function render(container, rows, currentId, opts) {
    opts = opts || {};
    container.textContent = "";
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "bg-empty";
      p.textContent = opts.emptyText || "まだ記録がありません。";
      container.appendChild(p);
      return;
    }

    const table = document.createElement("table");
    table.className = "bg-table rk-table";

    const head = document.createElement("thead");
    const hr = document.createElement("tr");
    const labels = ["順位", "平均 IKI(ms)", "レベル（文字/秒）", "正確率(%)", "ミス", "未修正", "お題"];
    if (opts.category) labels.push("区分");
    labels.push("日時");
    labels.forEach(function (label) {
      const th = document.createElement("th");
      th.textContent = label;
      hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);

    const body = document.createElement("tbody");
    let rank = 0;
    rows.forEach(function (s, i) {
      // 同じ平均 IKI・正確率なら同順位（1, 2, 2, 4 …）
      const prev = rows[i - 1];
      if (!prev || prev.result.avgIki !== s.result.avgIki || prev.result.accuracy !== s.result.accuracy) rank = i + 1;

      const tr = document.createElement("tr");
      if (s.id === currentId) tr.className = "rk-current";
      if (opts.onSelect) {
        const r = rank;
        tr.classList.add("bg-row");
        if (s.id === opts.selectedId) tr.classList.add("bg-selected");
        tr.tabIndex = 0;
        tr.title = "クリックでこの回のキーごとの間隔を表示";
        tr.addEventListener("click", function () { opts.onSelect(s, r); });
        tr.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect(s, r); }
        });
      }
      const cells = [
        rank,
        s.result.avgIki.toFixed(1),
        levelText(s),
        s.result.accuracy.toFixed(1),
        s.result.misses,
        s.result.uncorrected,
        s.textId
      ];
      if (opts.category) cells.push(categoryLabel(s));
      cells.push(formatDate(s.finishedAt));
      cells.forEach(function (v) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    container.appendChild(table);
  }

  // その回のレベルと文字/秒（例「SB（6.78）」）。レベルがなければ「-」（js/levels.js、docs/levels.md）
  // 短い文章は達成レベルに数えないので、ランキングでもレベルを出さない（空欄）
  function levelText(s) {
    if (Levels.COUNTED_MODES.indexOf(s.mode) === -1) return "";
    const level = Levels.ofSession(s);
    const rate = Levels.rateOfSession(s);
    return (level ? level.name : "-") + (rate !== null ? "（" + rate.toFixed(2) + "）" : "");
  }

  // ISO の日時を、このPCの時刻で「2026/10/17 18:12」の形にする
  function formatDate(iso) {
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  return { render: render, categoryLabel: categoryLabel, layoutLabel: layoutLabel };
})();
