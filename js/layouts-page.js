// キー配列のページ（layouts.html）。キー配列の配列図を描き、試し打ちでキーを押すと図のそのキーの色を変える
// 配列は、最初から入っている QWERTY と、割り当て表を読み込んだかな配列
(function () {
  "use strict";

  // 選んだキーボードの形を覚えておく localStorage のキー
  const SHAPE_STORAGE = "typing-test.keyboardShape";
  const UNIT = 44; // キー1個分の大きさ(px)
  const GAP = 4;   // キーどうしの隙間(px)
  const OUTPUT_MAX = 200; // 試し打ちの欄に残す文字数
  const SHIFT_MIN = 5; // 2打の並びでこの回数以上出てくるキーを、シフトの段の候補にする

  const layoutEl = document.getElementById("layout");
  const shapeEl = document.getElementById("shape");
  const viewEl = document.getElementById("view");
  const viewLabelEl = document.getElementById("view-label");
  const legendEl = document.getElementById("kb-legend");
  const viewNowEl = document.getElementById("view-now");
  const keyboardEl = document.getElementById("keyboard");
  const trialEl = document.getElementById("trial");
  const outputEl = document.getElementById("trial-output");
  const hintEl = document.getElementById("trial-hint");
  const lastEl = document.getElementById("trial-last");

  const LEGEND_QWERTY = "左上の小さな数字は物理キーの番号（行＋列。列は16進数）。大きい文字は Shift なし、右上の小さい文字は Shift を押したときの文字。";
  const LEGEND_KANA = "左上の小さな数字は物理キーの番号、右下の小さな文字はそのキーの QWERTY の文字。大きい文字は、表示中の段でそのキーを押したときのかな（右上は Shift を押したとき）。";

  // 配列の一覧。QWERTY は最初から入っている。かな配列は割り当て表を読み込むと足す（まだ保存はしない）
  const layouts = [{ id: "qwerty", name: "QWERTY", type: "qwerty" }];

  let shape = null;         // 今のキーボードの形（KeyboardShapes.layout の結果）
  let keyEls = {};          // 配列図のキーの要素。物理キーの番号（番号のないキーは e.code）で引く
  const heldShifts = new Set(); // 押されている Shift の e.code
  let qwertyOutput = "";    // QWERTY の試し打ちの結果
  let conv = null;          // かな配列の試し打ちの変換器

  function current() {
    return layouts.filter(function (l) { return l.id === layoutEl.value; })[0] || layouts[0];
  }

  // 配列図のキーを引くための名前。番号のあるキーは番号（JIS の ¥ キーも US の \ と同じ 1d の場所が光る）
  function keyId(code) {
    return Keys.number(code) || code;
  }

  // ---- 配列図 ----

  // キーボードの形に合わせてキーの枠を並べる（中の文字は drawLabels で書く）
  function drawKeyboard() {
    shape = KeyboardShapes.layout(shapeEl.value);
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
      keyboardEl.appendChild(el);
      keyEls[keyId(k.code)] = el;
      k.el = el;
    });
    drawLabels();
  }

  // 各キーの中の文字を書く
  function drawLabels() {
    const layout = current();
    const view = layout.type === "kana" ? currentView(layout) : null;
    keyboardEl.classList.toggle("kb-kana", layout.type === "kana");
    viewNowEl.hidden = !view;
    if (view) viewNowEl.textContent = "表示中の段：" + view.label;
    shape.keys.forEach(function (k) {
      const el = k.el;
      const pressed = el.classList.contains("pressed");
      el.textContent = "";
      el.className = "kb-key" + (pressed ? " pressed" : "");
      const number = Keys.number(k.code);
      const plain = Keys.char(k.code, false);
      const shifted = Keys.char(k.code, true);
      if (number) el.appendChild(span("kb-num", number));
      if (plain === null || plain === " ") {
        el.classList.add("kb-func");
        el.appendChild(span("kb-name", k.name || ""));
        return;
      }
      if (layout.type === "kana") {
        // かな配列：表示中の段で、このキー（と Shift ＋ このキー）を押したときのかな
        const main = view.kana(plain);
        const sub = view.kana(shifted);
        if (sub) el.appendChild(span("kb-shift", sub));
        if (main) el.appendChild(span("kb-main kb-kana-char", main));
        else el.classList.add("kb-empty");
        el.appendChild(span("kb-qwerty", plain));
        return;
      }
      // QWERTY：英字は Shift ありが大文字になるだけなので、上の段は書かない（Shift を押すと大文字で表示する）
      const letter = shifted !== plain && shifted === plain.toUpperCase();
      if (!letter) el.appendChild(span("kb-shift", shifted));
      el.appendChild(span("kb-main" + (letter ? " kb-letter" : ""), plain));
    });
    keyboardEl.classList.toggle("shift-on", heldShifts.size > 0);
  }

  // かな配列の表示中の段。{ label, kana(ch) }：キーの文字 ch を押したときのかな（なければ null）
  //   自動：試し打ちの打ちかけの並びに続けて押したとき（何も打ちかけていなければ単独）
  //   前置 x：x の次に押したとき。後置 y：そのキーの次に y を押したとき
  function currentView(layout) {
    const v = viewEl.value;
    const get = layout.kana.get;
    if (v === "auto") {
      const st = conv ? conv.state() : { pending: "", tentative: "" };
      const pending = st.pending;
      return {
        label: !pending ? "単独で押したとき"
          : "「" + pending + "」の次に押したとき" + (st.tentative ? "（ほかのキーを押すと「" + st.tentative + "」で確定）" : ""),
        kana: function (ch) { return ch === null ? null : get(pending + ch); }
      };
    }
    const type = v[0];
    const key = v.slice(2);
    if (type === "a") {
      return { label: "単独で押したとき", kana: function (ch) { return ch === null ? null : get(ch); } };
    }
    if (type === "p") {
      return { label: "「" + key + "」の次に押したとき（前置）", kana: function (ch) { return ch === null ? null : get(key + ch); } };
    }
    return { label: "押した後に「" + key + "」を押したとき（後置）", kana: function (ch) { return ch === null ? null : get(ch + key); } };
  }

  // 段の選び方の選択肢を作る（かな配列のときだけ出す）
  function buildViewOptions() {
    const layout = current();
    const isKana = layout.type === "kana";
    viewLabelEl.hidden = !isKana;
    legendEl.textContent = isKana ? LEGEND_KANA : LEGEND_QWERTY;
    viewEl.textContent = "";
    if (!isKana) return;
    const add = function (value, text) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      viewEl.appendChild(o);
    };
    add("auto", "自動（試し打ちに合わせる）");
    add("a:", "単独");
    const shifts = layout.kana.shiftKeys(SHIFT_MIN);
    shifts.prefix.forEach(function (k) { add("p:" + k, "前置「" + k + "」"); });
    shifts.postfix.forEach(function (k) { add("s:" + k, "後置「" + k + "」"); });
  }

  function span(className, text) {
    const s = document.createElement("span");
    s.className = className;
    s.textContent = text;
    return s;
  }

  function setPressed(code, on) {
    const el = keyEls[keyId(code)];
    if (el) el.classList.toggle("pressed", on);
  }

  // ---- 試し打ち ----

  function renderOutput() {
    outputEl.textContent = "";
    if (current().type === "kana") {
      const st = conv.state();
      outputEl.appendChild(document.createTextNode(st.out));
      if (st.pending) {
        // 打ちかけの並び（それだけで確定したときのかながあれば、そのかなを薄く出す）
        outputEl.appendChild(span("trial-pending", st.tentative || st.pending));
      }
      hintEl.hidden = st.out !== "" || st.pending !== "" || document.activeElement === trialEl;
    } else {
      outputEl.textContent = qwertyOutput;
      hintEl.hidden = qwertyOutput !== "" || document.activeElement === trialEl;
    }
  }

  function resetTrial() {
    qwertyOutput = "";
    const layout = current();
    conv = layout.type === "kana" ? layout.kana.converter() : null;
    lastEl.textContent = "";
    renderOutput();
  }

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
    if (Keys.isShift(e.code)) heldShifts.add(e.code);

    const number = Keys.number(e.code);
    const ch = Keys.char(e.code, heldShifts.size > 0);
    if (conv) {
      if (e.code === "Backspace") conv.backspace();
      else if (ch !== null) conv.press(ch);
    } else if (e.code === "Backspace") {
      qwertyOutput = qwertyOutput.slice(0, -1);
    } else if (ch !== null) {
      qwertyOutput = (qwertyOutput + ch).slice(-OUTPUT_MAX);
    }
    renderOutput();
    // 自動の段は、打ちかけの並びに合わせて書き直す
    drawLabels();
    lastEl.textContent = "押したキー：" + (number ? "番号 " + number + " ／ " : "番号なし ／ ") + "e.code " + e.code +
      (ch !== null && ch !== " " ? " ／ 文字 " + ch : "");
  });

  trialEl.addEventListener("keyup", function (e) {
    setPressed(e.code, false);
    if (Keys.isShift(e.code)) {
      heldShifts.delete(e.code);
      keyboardEl.classList.toggle("shift-on", heldShifts.size > 0);
    }
  });

  // 枠から外れたら、押したままのキーの表示を戻す（keyup が来ないため）
  trialEl.addEventListener("blur", function () {
    Object.keys(keyEls).forEach(function (id) { keyEls[id].classList.remove("pressed"); });
    heldShifts.clear();
    keyboardEl.classList.remove("shift-on");
    renderOutput();
  });
  trialEl.addEventListener("focus", renderOutput);

  document.getElementById("trial-clear").addEventListener("click", function () {
    resetTrial();
    drawLabels();
    trialEl.focus();
  });

  // ---- 割り当て表の読み込み（段階2：まだ保存しない） ----

  const nameEl = document.getElementById("import-name");
  const tableFileEl = document.getElementById("import-table-file");
  const tableTextEl = document.getElementById("import-table-text");
  const importMsgEl = document.getElementById("import-msg");
  const entriesEl = document.getElementById("entries");

  tableFileEl.addEventListener("change", function () {
    const file = tableFileEl.files[0];
    if (!file) return;
    file.text().then(function (t) {
      tableTextEl.value = t;
      if (!nameEl.value) nameEl.value = file.name.replace(/\.[^.]*$/, "");
    });
  });

  document.getElementById("import-show").addEventListener("click", function () {
    const name = nameEl.value.trim();
    if (!name) {
      importMsgEl.textContent = "配列名を入れてください。";
      return;
    }
    const parsed = KanaLayout.parse(tableTextEl.value);
    if (parsed.entries.length === 0) {
      importMsgEl.textContent = "割り当て表から1行も読めませんでした。";
      return;
    }
    const id = "unsaved:" + name;
    const layout = { id: id, name: name, type: "kana", kana: KanaLayout.create(parsed.entries) };
    const i = layouts.findIndex(function (l) { return l.id === id; });
    if (i === -1) layouts.push(layout);
    else layouts[i] = layout;
    buildLayoutOptions();
    layoutEl.value = id;
    changeLayout();
    importMsgEl.textContent = parsed.entries.length + " 行を読み込みました（まだ保存していません）。" +
      (parsed.errors.length ? "読めなかった行：" + parsed.errors.slice(0, 20).join("・") + (parsed.errors.length > 20 ? " ほか" : "") : "");
  });

  // 割り当て表の一覧（キーの並びの順）
  function renderEntries() {
    const layout = current();
    entriesEl.textContent = "";
    entriesEl.parentElement.hidden = layout.type !== "kana";
    if (layout.type !== "kana") return;
    const rows = layout.kana.entries.slice().sort(function (a, b) {
      return a[0].length - b[0].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    });
    document.getElementById("entries-count").textContent = rows.length;
    rows.forEach(function (r) {
      const item = document.createElement("span");
      item.className = "entry";
      item.appendChild(span("entry-keys", r[0]));
      item.appendChild(span("entry-kana", r[1]));
      entriesEl.appendChild(item);
    });
  }

  // ---- 配列・キーボードの形の選択 ----

  function buildLayoutOptions() {
    layoutEl.textContent = "";
    layouts.forEach(function (l) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name + (l.id.indexOf("unsaved:") === 0 ? "（未保存）" : "");
      layoutEl.appendChild(o);
    });
  }

  function changeLayout() {
    buildViewOptions();
    resetTrial();
    drawLabels();
    renderEntries();
  }

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
  layoutEl.addEventListener("change", changeLayout);
  viewEl.addEventListener("change", drawLabels);

  // バージョン表示と、記録の書き出し・読み込み（全ページ共通）
  PageFooter.init();
  buildLayoutOptions();
  drawKeyboard();
  changeLayout();
})();
