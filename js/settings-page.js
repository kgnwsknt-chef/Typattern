// 設定のページ（settings.html）。入力欄と Settings（js/settings.js）の値を結び付ける
(function () {
  "use strict";

  const msgEl = document.getElementById("settings-msg");
  const inputs = Array.from(document.querySelectorAll("[data-setting]"));

  // 保存してある値を入力欄に出す
  function fill() {
    inputs.forEach(function (el) {
      const name = el.dataset.setting;
      if (el.type === "checkbox") el.checked = Settings.get(name);
      else el.value = Settings.get(name);
    });
  }

  inputs.forEach(function (el) {
    const name = el.dataset.setting;
    const item = Settings.ITEMS[name];
    if (item.type === "number") {
      el.min = item.min;
      el.max = item.max;
      el.step = item.step;
      // 説明の後ろに範囲と初期値を書く
      const range = el.closest(".setting").querySelector(".setting-range");
      if (range) range.textContent = "（" + item.min + "〜" + item.max + " " + item.unit + "、" + item.step + " " + item.unit + " 刻み。初期値 " + item.def + " " + item.unit + "）";
    }
    // 数値は打ち終えたとき（change）に保存する。範囲の外なら端に直して出し直す
    el.addEventListener("change", function () {
      const saved = Settings.set(name, el.type === "checkbox" ? el.checked : el.value);
      if (el.type !== "checkbox") el.value = saved;
      msgEl.textContent = "保存しました。";
    });
  });

  // 確認のダイアログは出さない（項目が少なく、すぐ設定し直せるため。ダイアログを出さないブラウザでも効くように）
  document.getElementById("settings-reset").addEventListener("click", function () {
    Settings.reset();
    fill();
    msgEl.textContent = "初期値に戻しました。";
  });

  fill();
  // バージョン表示と、記録の書き出し・読み込み
  PageFooter.init();
})();
