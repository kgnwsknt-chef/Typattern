// 記録ページ（推移・ランキング / n-gram）共通の「データの絞り込み」
// 言語・配列・モード・期間で概要の記録を絞り込む。決まりは docs/records.md の「データの絞り込み」
const Filters = (function () {
  "use strict";

  // タイピング画面で選んだキー配列（app.js と同じキー）
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";
  // ページを移っても同じ条件で見られるよう、このタブの間だけ覚えておく
  const FILTER_STORAGE = "typing-test.filters";
  const IDS = { lang: "f-lang", layout: "f-layout", mode: "f-mode", from: "f-from", to: "f-to" };

  // onChange：条件が変わったときに呼ぶ関数
  function init(onChange) {
    const f = {};
    Object.keys(IDS).forEach(function (k) { f[k] = document.getElementById(IDS[k]); });

    // 初期値：このタブで前に選んだ条件。なければ、配列だけタイピング画面で選んでいるもの
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

    function changed() {
      const values = {};
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
    function pick(sessions) {
      const match = function (sel, v) { return !sel.value || sel.value === v; };
      return sessions.filter(function (s) {
        const day = localDate(s.finishedAt);
        return match(f.lang, s.lang) && match(f.layout, s.keyLayout) && match(f.mode, s.mode) &&
          (!f.from.value || day >= f.from.value) && (!f.to.value || day <= f.to.value);
      });
    }

    return { pick: pick };
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

  return { init: init, summary: summary };
})();
