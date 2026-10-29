// 記録ページ（記録 / IKI / ミスタイプ）共通の「データの絞り込み」
// 言語・配列・モード・期間で概要の記録を絞り込む。決まりは docs/records.md の「データの絞り込み」
const Filters = (function () {
  "use strict";

  // タイピング画面で選んだキー配列（app.js と同じキー）
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";
  // ページを移っても同じ条件で見られるよう、このタブの間だけ覚えておく
  const FILTER_STORAGE = "typing-test.filters";
  const IDS = { lang: "f-lang", layout: "f-layout", mode: "f-mode", from: "f-from", to: "f-to" };

  // 配列の選択肢に、登録した配列（かな配列・英語の配列）と、記録の中にある配列（配列を消した後の記録も）を足す
  function addLayoutOptions(sel, layouts, sessions) {
    const names = new Map(); // 配列名 → 表示名
    layouts.forEach(function (l) { names.set(l.id, l.name); });
    sessions.forEach(function (s) {
      if (s.keyLayout && !names.has(s.keyLayout)) names.set(s.keyLayout, s.keyLayout + "（削除済）");
    });
    Array.from(names).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }).forEach(function (n) {
      if (hasOption(sel, n[0])) return; // QWERTY など、最初からある選択肢
      const o = document.createElement("option");
      o.value = n[0];
      o.textContent = n[1];
      sel.appendChild(o);
    });
  }

  // onChange：条件が変わったときに呼ぶ関数
  // 返り値の ready は、配列の選択肢を足して前の条件に戻し終えたら解決する（最初の表示はその後にする）
  function init(onChange) {
    const f = {};
    // ページにない選択（苦手な単語のページのモードなど）は使わない（その条件では絞り込まず、覚えた値もそのまま残す）
    Object.keys(IDS).forEach(function (k) {
      const el = document.getElementById(IDS[k]);
      if (el) f[k] = el;
    });

    // 初期値：このタブで前に選んだ条件。なければ、配列だけタイピング画面で選んでいるもの
    function restore() {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(FILTER_STORAGE) || "null"); } catch (e) { /* 使わない */ }
      if (saved) {
        Object.keys(f).forEach(function (k) {
          if (typeof saved[k] === "string" && (f[k].tagName !== "SELECT" || hasOption(f[k], saved[k]))) f[k].value = saved[k];
        });
      } else {
        try {
          const layout = localStorage.getItem(KEY_LAYOUT_STORAGE);
          if (layout && hasOption(f.layout, layout)) f.layout.value = layout;
        } catch (e) { /* 既定の配列を使う */ }
      }
    }
    const ready = Promise.all([Store.getAllLayouts(), Store.getAllSessions()])
      .then(function (v) { addLayoutOptions(f.layout, v[0], v[1]); })
      .catch(function (err) { console.error(err); })
      .then(restore);

    function changed() {
      let values = {};
      try { values = JSON.parse(sessionStorage.getItem(FILTER_STORAGE) || "{}") || {}; } catch (e) { /* 使わない */ }
      Object.keys(f).forEach(function (k) { values[k] = f[k].value; });
      try { sessionStorage.setItem(FILTER_STORAGE, JSON.stringify(values)); } catch (e) { /* 無視 */ }
      onChange();
    }
    Object.keys(f).forEach(function (k) { f[k].addEventListener("change", changed); });
    document.getElementById("f-clear").addEventListener("click", function () {
      f.from.value = "";
      f.to.value = "";
      changed();
    });

    // 概要の記録（古い順）を条件で絞り込む。空の値（「すべて」・期間の指定なし）はその条件で絞り込まない
    //   モードの「練習モード以外」（値 "regular"。IKI・ミスタイプのページ）は、練習モード（practice: true）でない回をまとめて選ぶ。
    //   「IKI 測定以外」（値 "not-iki-measurement"。IKI・ミスタイプのページ）は、IKI 測定でない回（ほかの練習モードも入る）を選ぶ
    function pick(sessions) {
      const match = function (sel, v) { return !sel || !sel.value || sel.value === v; };
      const modeMatch = function (s) {
        if (f.mode && f.mode.value === "regular") return !s.practice;
        if (f.mode && f.mode.value === "not-iki-measurement") return s.mode !== "iki-measurement";
        return match(f.mode, s.mode);
      };
      return sessions.filter(function (s) {
        // キー配列習得の回は、どの記録ページにも入れない（docs/layout-learning.md。状況はキー配列習得のページ）
        if (s.mode === "layout-learning") return false;
        const day = localDate(s.finishedAt);
        return match(f.lang, s.lang) && match(f.layout, s.keyLayout) && modeMatch(s) &&
          (!f.from.value || day >= f.from.value) && (!f.to.value || day <= f.to.value);
      });
    }

    return { pick: pick, ready: ready };
  }

  // 「対象 N 回（YYYY/MM/DD 〜 YYYY/MM/DD）」
  function summary(picked) {
    if (picked.length === 0) return "条件に合う記録がありません。";
    return "対象 " + picked.length + " 回（" + localDate(picked[0].finishedAt).replace(/-/g, "/") + " 〜 " +
      localDate(picked[picked.length - 1].finishedAt).replace(/-/g, "/") + "）";
  }

  // このPCの日付で "YYYY-MM-DD"（input type="date" の値と同じ形）
  function localDate(iso) {
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function hasOption(sel, value) {
    return Array.prototype.some.call(sel.options, function (o) { return o.value === value; });
  }

  return { init: init, summary: summary, localDate: localDate };
})();
