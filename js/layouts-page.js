// 配列のページ（layouts.html）。キー配列の配列図を描き、試し打ちでキーを押すと図のそのキーの色を変える
(function () {
  "use strict";

  // 選んだキーボードの形を覚えておく localStorage のキー
  const SHAPE_STORAGE = "typing-test.keyboardShape";
  const UNIT = 44; // キー1個分の大きさ(px)
  const GAP = 4;   // キーどうしの隙間(px)
  const OUTPUT_MAX = 200; // 試し打ちの欄に残す文字数

  const layoutEl = document.getElementById("layout");
  const shapeEl = document.getElementById("shape");
  const keyboardEl = document.getElementById("keyboard");
  const trialEl = document.getElementById("trial");
  const outputEl = document.getElementById("trial-output");
  const hintEl = document.getElementById("trial-hint");
  const lastEl = document.getElementById("trial-last");

  let keyEls = {};          // 配列図のキーの要素。物理キーの番号（番号のないキーは e.code）で引く
  const heldShifts = new Set(); // 押されている Shift の e.code
  let output = "";

  // 配列図のキーを引くための名前。番号のあるキーは番号（JIS の ¥ キーも US の \ と同じ 1d の場所が光る）
  function keyId(code) {
    return Keys.number(code) || code;
  }

  // 配列図を描く。今は QWERTY だけ（各キーに Shift なしと Shift ありの文字を書く）
  function drawKeyboard() {
    const shape = KeyboardShapes.layout(shapeEl.value);
    keyboardEl.textContent = "";
    keyboardEl.style.width = shape.width * UNIT + "px";
    keyboardEl.style.height = shape.height * UNIT + "px";
    keyEls = {};
    shape.keys.forEach(function (k) {
      const el = document.createElement("div");
      el.className = "kb-key";
      // キーどうしの間に GAP の隙間をあける
      el.style.left = k.x * UNIT + GAP / 2 + "px";
      el.style.top = k.y * UNIT + GAP / 2 + "px";
      el.style.width = k.w * UNIT - GAP + "px";
      el.style.height = UNIT - GAP + "px";

      const number = Keys.number(k.code);
      const plain = Keys.char(k.code, false);
      const shifted = Keys.char(k.code, true);
      if (number) el.appendChild(span("kb-num", number));
      if (plain !== null && plain !== " ") {
        // 英字は Shift ありが大文字になるだけなので、上の段は書かない（Shift を押すと大文字で表示する）
        const letter = shifted !== plain && shifted === plain.toUpperCase();
        if (!letter) el.appendChild(span("kb-shift", shifted));
        el.appendChild(span("kb-main" + (letter ? " kb-letter" : ""), plain));
      } else {
        el.classList.add("kb-func");
        el.appendChild(span("kb-name", k.name || ""));
      }
      keyboardEl.appendChild(el);
      keyEls[keyId(k.code)] = el;
    });
    updateShift();
  }

  function span(className, text) {
    const s = document.createElement("span");
    s.className = className;
    s.textContent = text;
    return s;
  }

  // Shift を押している間は、配列図の Shift ありの文字を強調する
  function updateShift() {
    keyboardEl.classList.toggle("shift-on", heldShifts.size > 0);
  }

  function setPressed(code, on) {
    const el = keyEls[keyId(code)];
    if (el) el.classList.toggle("pressed", on);
  }

  function renderOutput() {
    outputEl.textContent = output;
    hintEl.hidden = output !== "" || document.activeElement === trialEl;
  }

  // ---- 試し打ち ----

  trialEl.addEventListener("keydown", function (e) {
    // IME がオンだと key が "Process" になる。かなに変換されてしまうので注意を出す
    if (e.key === "Process" || e.isComposing) {
      e.preventDefault();
      lastEl.textContent = "IME がオンになっています。オフにして（英字入力にして）から打ってください。";
      lastEl.classList.add("trial-warn");
      return;
    }
    lastEl.classList.remove("trial-warn");
    // Ctrl などとの組み合わせ（ページの操作）と Tab（枠から出る）は、ブラウザに任せる
    if (e.ctrlKey || e.altKey || e.metaKey || e.code === "Tab") return;
    e.preventDefault();

    setPressed(e.code, true);
    if (Keys.isShift(e.code)) {
      heldShifts.add(e.code);
      updateShift();
    }

    const number = Keys.number(e.code);
    const ch = Keys.char(e.code, heldShifts.size > 0);
    if (e.code === "Backspace") {
      output = output.slice(0, -1);
    } else if (ch !== null) {
      output = (output + ch).slice(-OUTPUT_MAX);
    }
    renderOutput();
    lastEl.textContent = "押したキー：" + (number ? "番号 " + number + " ／ " : "番号なし ／ ") + "e.code " + e.code +
      (ch !== null && ch !== " " ? " ／ 文字 " + ch : "");
  });

  trialEl.addEventListener("keyup", function (e) {
    setPressed(e.code, false);
    if (Keys.isShift(e.code)) {
      heldShifts.delete(e.code);
      updateShift();
    }
  });

  // 枠から外れたら、押したままのキーの表示を戻す（keyup が来ないため）
  trialEl.addEventListener("blur", function () {
    Object.keys(keyEls).forEach(function (id) { keyEls[id].classList.remove("pressed"); });
    heldShifts.clear();
    updateShift();
    renderOutput();
  });
  trialEl.addEventListener("focus", renderOutput);

  document.getElementById("trial-clear").addEventListener("click", function () {
    output = "";
    lastEl.textContent = "";
    renderOutput();
    trialEl.focus();
  });

  // ---- キーボードの形の選択 ----

  KeyboardShapes.SHAPES.forEach(function (s) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    shapeEl.appendChild(o);
  });
  try {
    const saved = localStorage.getItem(SHAPE_STORAGE);
    if (saved && shapeEl.querySelector('option[value="' + saved + '"]')) shapeEl.value = saved;
  } catch (e) { /* 既定の形を使う */ }
  shapeEl.addEventListener("change", function () {
    try { localStorage.setItem(SHAPE_STORAGE, shapeEl.value); } catch (e) { /* 無視 */ }
    drawKeyboard();
  });
  layoutEl.addEventListener("change", drawKeyboard);

  // バージョン表示と、記録の書き出し・読み込み（全ページ共通）
  PageFooter.init();
  drawKeyboard();
  renderOutput();
})();
