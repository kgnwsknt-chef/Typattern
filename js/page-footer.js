// 全ページ共通：左上のバージョン表示と、ページ下部の操作（記録の書き出し・読み込み）
const PageFooter = (function () {
  "use strict";

  // index.html などで付けた ?v= の番号（画面にバージョンとして出す）
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";

  // opts.onImport：記録を読み込んだ後に呼ぶ関数（表示を更新したいページで渡す）
  function init(opts) {
    opts = opts || {};
    // 表示は「v0.番号」（?v=28 なら v0.28）
    document.getElementById("version").textContent = ASSET_VERSION ? "v0." + ASSET_VERSION : "";

    const importFileEl = document.getElementById("import-file");
    document.getElementById("export-btn").addEventListener("click", function () {
      Store.exportFile()
        .then(function (n) { if (n === 0) alert("まだ記録がありません。"); })
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
          alert(r.added + " 件の記録を読み込みました。" + (r.skipped ? "（" + r.skipped + " 件はすでにあるため飛ばしました）" : ""));
          if (r.added && opts.onImport) opts.onImport();
        })
        .catch(function (err) { alert("読み込めませんでした: " + err.message); });
    });
  }

  return { init: init };
})();
