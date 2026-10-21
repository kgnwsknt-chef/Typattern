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

  // 記録を消す：元に戻せないので2回押しで確かめる（確認のダイアログ confirm は、出さないブラウザでは押せなくなるので使わない）。
  // 1回目で記録の数を出してボタンを「本当に全部消す」（赤）に変え、8秒たつと元に戻す
  const clearBtn = document.getElementById("clear-btn");
  const clearMsgEl = document.getElementById("clear-msg");
  const CLEAR_LABEL = clearBtn.textContent;
  let clearArmed = false;
  let clearTimer = 0;

  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    clearBtn.textContent = CLEAR_LABEL;
    clearBtn.classList.remove("tm-danger");
  }

  clearBtn.addEventListener("click", function () {
    if (!clearArmed) {
      Store.count().then(function (n) {
        if (n === 0) {
          clearMsgEl.textContent = "消す記録はありません。";
          return;
        }
        clearArmed = true;
        clearBtn.textContent = "本当に全部消す（" + n + " 回分）";
        clearBtn.classList.add("tm-danger");
        clearMsgEl.textContent = "もう一度押すと、" + n + " 回分の記録をすべて消します。元に戻せません。";
        clearTimer = setTimeout(function () {
          disarmClear();
          clearMsgEl.textContent = "";
        }, 8000);
      });
      return;
    }
    disarmClear();
    Store.count().then(function (n) {
      return Store.clearRecords().then(function () {
        clearMsgEl.textContent = n + " 回分の記録を消しました。";
        PageFooter.refreshSize();
      });
    }).catch(function (err) {
      console.error(err);
      clearMsgEl.textContent = "消せませんでした: " + err.message;
    });
  });

  fill();
  // バージョン表示と、記録の書き出し・読み込み
  PageFooter.init();
})();
