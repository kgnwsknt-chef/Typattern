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
    fillFingers();
  }

  // ---- 指の割り当て（8 本の指ごとの入力欄と、確かめるための配列図。決まりは docs/settings.md） ----
  const fingerInputs = Array.from(document.querySelectorAll("[data-finger]"));
  const fingerMsgEl = document.getElementById("finger-msg");
  const fingerMapEl = document.getElementById("finger-map");
  const HAND_NAME = { L: "左", R: "右" };
  const FINGER_SHORT = { 1: "人", 2: "中", 3: "薬", 4: "小" };
  const FINGER_LONG = { 1: "人差し指", 2: "中指", 3: "薬指", 4: "小指" };
  const fingerName = function (f) { return HAND_NAME[f[0]] + "の" + FINGER_LONG[f[1]]; };
  // 指と行(row)で分ける範囲の初期値（上の行・ホーム行・下の行）。割り当てていないものを知らせるのに使う
  const MAIN_KEYS = "qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";

  function fillFingers() {
    const map = Settings.get("fingerMap");
    fingerInputs.forEach(function (el) { el.value = map[el.dataset.finger]; });
    showFingers();
  }

  // 入力欄の今の内容を確かめ、配列図とメッセージを出す。返り値は { map, conflicts }
  function showFingers() {
    const raw = {};
    fingerInputs.forEach(function (el) { raw[el.dataset.finger] = el.value; });
    const map = Settings.parseFingers(raw);
    const conflicts = Settings.fingerConflicts(map);
    const bad = new Set(conflicts.map(function (c) { return c.key; }));
    fingerInputs.forEach(function (el) {
      el.classList.toggle("tm-warn-input", Array.from(map[el.dataset.finger]).some(function (c) { return bad.has(c); }));
    });
    const owner = {};
    Settings.FINGER_KEYS.forEach(function (f) {
      Array.from(map[f]).forEach(function (c) { if (!owner[c]) owner[c] = f; });
    });
    const missing = Array.from(MAIN_KEYS).filter(function (c) { return !owner[c]; });
    fingerMsgEl.classList.toggle("tm-warn", conflicts.length > 0);
    fingerMsgEl.textContent = conflicts.length
      ? conflicts.map(function (c) { return "「" + c.key + "」が" + c.fingers.map(fingerName).join("と") + "の両方にあります"; }).join("。") +
        "。1つの指にしてください（保存していません）。"
      : missing.length ? "割り当てていないキー（このキーを含む組は「分類しない」）：" + missing.join(" ") : "";
    KeyMap.draw(fingerMapEl, function (number) {
      const c = Keys.label(number);
      const f = c === null ? null : owner[c];
      if (!f) return null;
      return {
        fill: bad.has(c) ? "var(--error-bg)" : "var(--finger-" + f[1] + ")",
        value: HAND_NAME[f[0]] + FINGER_SHORT[f[1]],
        title: c + "：" + (bad.has(c) ? "2つ以上の指に書いています" : fingerName(f))
      };
    });
    return { map: map, conflicts: conflicts };
  }

  fingerInputs.forEach(function (el) {
    el.addEventListener("input", showFingers); // 書いている間も配列図に出す
    el.addEventListener("change", function () {
      const r = showFingers();
      if (r.conflicts.length) {
        msgEl.textContent = "";
        return;
      }
      Settings.set("fingerMap", r.map);
      fingerInputs.forEach(function (x) { x.value = r.map[x.dataset.finger]; }); // 使えない文字を除いた形に直して出す
      msgEl.textContent = "保存しました。";
    });
  });

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

  // 初期値に戻す：2回押しで確かめる（記録を消すのと同じ。確認のダイアログ confirm は、出さないブラウザでは押せなくなるので使わない）。
  // 1回目でボタンを「本当に初期値に戻す」（赤）に変えて注意を出し、8秒たつと元に戻す
  const resetBtn = document.getElementById("settings-reset");
  const RESET_LABEL = resetBtn.textContent;
  let resetArmed = false;
  let resetTimer = 0;

  function disarmReset() {
    resetArmed = false;
    clearTimeout(resetTimer);
    resetBtn.textContent = RESET_LABEL;
    resetBtn.classList.remove("tm-danger");
  }

  resetBtn.addEventListener("click", function () {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = "本当に初期値に戻す";
      resetBtn.classList.add("tm-danger");
      msgEl.textContent = "もう一度押すと、すべての設定を初期値に戻します（登録したキー配列・お題と記録はそのまま）。";
      resetTimer = setTimeout(function () {
        disarmReset();
        msgEl.textContent = "";
      }, 8000);
      return;
    }
    disarmReset();
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
