// 全ページ共通：左上のバージョン表示と保存データの大きさ。記録の書き出し・読み込みのボタンがあるページ（設定のページ）ではその操作も
// （名前は、操作がページ下部にあったころのまま）
const PageFooter = (function () {
  "use strict";

  // index.html などで付けた ?v= の番号（画面にバージョンとして出す）
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";

  // opts.onImport：記録を読み込んだ後に呼ぶ関数（表示を更新したいページで渡す）
  function init(opts) {
    opts = opts || {};
    // 表示は「v0.番号」（?v=28 なら v0.28）
    document.getElementById("version").textContent = ASSET_VERSION ? "v0." + ASSET_VERSION : "";

    refreshSize();

    const importFileEl = document.getElementById("import-file");
    if (!importFileEl) return; // 書き出し・読み込みのボタンがないページ
    document.getElementById("export-btn").addEventListener("click", function () {
      Store.exportFile()
        .then(function (n) { if (n.sessions === 0 && n.layouts === 0) alert("まだ記録も登録したキー配列もありません。"); })
        .catch(function (err) { alert("書き出せませんでした: " + err.message); });
    });
    document.getElementById("import-btn").addEventListener("click", function () {
      importFileEl.value = "";
      importFileEl.click();
    });
    importFileEl.addEventListener("change", function () {
      const file = importFileEl.files[0];
      if (!file) return;
      file.text()
        .then(Store.importFile)
        .then(function (r) {
          alert(r.added + " 件の記録を読み込みました。" + (r.skipped ? "（" + r.skipped + " 件はすでにあるため飛ばしました）" : "") +
            (r.layoutsAdded ? "\nキー配列を " + r.layoutsAdded + " 件読み込みました。" : "") +
            (r.layoutConflicts.length ? "\n同じ名前で中身の違うキー配列があるため、次の配列は読み込まず今のものを残しました：" + r.layoutConflicts.join("、") : ""));
          if (r.added || r.layoutsAdded) {
            refreshSize();
            if (opts.onImport) opts.onImport();
          }
        })
        .catch(function (err) { alert("読み込めませんでした: " + err.message); });
    });
  }

  // 保存しているデータの大きさを出す（タイピング画面のロゴの下と設定のページ。記録やキー配列を保存・削除したときも呼ぶ）
  function refreshSize() {
    const el = document.getElementById("data-size");
    if (!el) return;
    Store.dataSize()
      // data-bare の欄（設定のページ。見出しが別にある）は大きさだけを出す
      .then(function (bytes) { el.textContent = (el.hasAttribute("data-bare") ? "" : "保存データ ") + formatSize(bytes); })
      .catch(function (err) {
        console.error(err);
        el.textContent = "";
      });
  }

  // バイト数を KB・MB で表す（1 KB = 1024 バイト）
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  return { init: init, refreshSize: refreshSize };
})();
