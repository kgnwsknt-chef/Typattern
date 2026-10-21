// キー配列のページ（layouts.html）。キー配列の配列図を描き、試し打ちでキーを押すと図のそのキーの色を変える
// 配列は、最初から入っている QWERTY と、割り当て表を読み込んだかな配列
(function () {
  "use strict";

  // 選んだキーボードの形を覚えておく localStorage のキー
  const SHAPE_STORAGE = "typing-test.keyboardShape";
  const UNIT = 44; // キー1個分の大きさ(px)
  const GAP = 4;   // キーどうしの隙間(px)
  const OUTPUT_MAX = 200; // 試し打ちの欄に残す文字数
  const SHIFT_MIN = 5; // 2打の並びでこの回数以上出てくるキーを、シフト面の候補にする

  const layoutEl = document.getElementById("layout");
  const shapeEl = document.getElementById("shape");
  const viewEl = document.getElementById("view");
  const viewLabelEl = document.getElementById("view-bar"); // シフト面の選択（配列図のすぐ上。かな配列のときだけ出す）
  const legendEl = document.getElementById("kb-legend");
  const viewNowEl = document.getElementById("view-now");
  const keyboardEl = document.getElementById("keyboard");
  const trialEl = document.getElementById("trial");
  const outputEl = document.getElementById("trial-output");
  const hintEl = document.getElementById("trial-hint");
  const lastEl = document.getElementById("trial-last");

  const LEGEND_QWERTY = "左上の小さな数字は物理キーの番号（行＋列。列は16進数）。大きい文字は Shift なし、右上の小さい文字は Shift を押したときの文字。";
  const LEGEND_KANA = "左上の小さな数字は物理キーの番号、右下の小さな文字はそのキーの QWERTY の文字。大きい文字は、表示中のシフト面でそのキーを押したときのかな（右上は Shift を押したとき）。外形線がオレンジのキーは前置シフト、紫のキーは後置シフト（両方なら二重線）。";

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
    // かな配列のシフト用のキー（前置・後置）。外形線の色を変えて示す
    const shifts = layout.type === "kana" ? layout.kana.shiftKeys(SHIFT_MIN) : { prefix: [], postfix: [] };
    keyboardEl.classList.toggle("kb-kana", layout.type === "kana");
    // 「自動」のときだけ、今どのシフト面を出しているかを選択の横に書く（ほかは選択に出ているので書かない）
    viewNowEl.hidden = !view || viewEl.value !== "auto";
    if (view) viewNowEl.textContent = "→ " + view.label;
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
        // かな配列：表示中のシフト面で、このキー（と Shift ＋ このキー）を押したときのかな
        const main = view.kana(plain);
        const sub = view.kana(shifted);
        if (sub) el.appendChild(span("kb-shift", sub));
        if (main) el.appendChild(span("kb-main kb-kana-char", main));
        else el.classList.add("kb-empty");
        el.appendChild(span("kb-qwerty", plain));
        if (shifts.prefix.indexOf(plain) !== -1) el.classList.add("kb-prefix");
        if (shifts.postfix.indexOf(plain) !== -1) el.classList.add("kb-postfix");
        return;
      }
      // QWERTY：英字は Shift ありが大文字になるだけなので、上の段は書かない（Shift を押すと大文字で表示する）
      const letter = shifted !== plain && shifted === plain.toUpperCase();
      if (!letter) el.appendChild(span("kb-shift", shifted));
      el.appendChild(span("kb-main" + (letter ? " kb-letter" : ""), plain));
    });
    keyboardEl.classList.toggle("shift-on", heldShifts.size > 0);
  }

  // かな配列の表示中のシフト面。{ label, kana(ch) }：キーの文字 ch を押したときのかな（なければ null）
  //   自動：試し打ちの打ちかけの並びに続けて押したとき（何も打ちかけていなければ単独）
  //   前置 x：x の次に押したとき。後置 y：そのキーの次に y を押したとき
  function currentView(layout) {
    const v = viewEl.value;
    const get = layout.kana.get;
    if (v === "auto") {
      const st = conv ? conv.state() : { pending: "", tentative: "" };
      const pending = st.pending;
      return {
        label: !pending ? "シフトなし（そのキーだけを押したとき）"
          : "「" + pending + "」の次に押したとき" + (st.tentative ? "（ほかのキーか Enter を押すと「" + st.tentative + "」で確定）" : ""),
        kana: function (ch) { return ch === null ? null : get(pending + ch); }
      };
    }
    const type = v[0];
    const key = v.slice(2);
    if (type === "a") {
      return { label: "シフトなし（そのキーだけを押したとき）", kana: function (ch) { return ch === null ? null : get(ch); } };
    }
    if (type === "p") {
      return { label: "「" + key + "」の次に押したとき（前置）", kana: function (ch) { return ch === null ? null : get(key + ch); } };
    }
    return { label: "押した後に「" + key + "」を押したとき（後置）", kana: function (ch) { return ch === null ? null : get(ch + key); } };
  }

  // シフト面の選び方の選択肢を作る（かな配列のときだけ出す）
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
    add("a:", "シフトなし");
    const shifts = layout.kana.shiftKeys(SHIFT_MIN);
    shifts.prefix.forEach(function (k) { add("p:" + k, "前置シフト「" + k + "」"); });
    shifts.postfix.forEach(function (k) { add("s:" + k, "後置シフト「" + k + "」"); });
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
      else if (e.code === "Enter" || e.code === "NumpadEnter") conv.confirm(); // 打ちかけの並びを確定する
      else if (ch !== null) conv.press(ch);
    } else if (e.code === "Backspace") {
      qwertyOutput = qwertyOutput.slice(0, -1);
    } else if (ch !== null) {
      qwertyOutput = (qwertyOutput + ch).slice(-OUTPUT_MAX);
    }
    renderOutput();
    // 自動のシフト面は、打ちかけの並びに合わせて書き直す
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

  // ---- 保存・削除 ----

  const saveBtn = document.getElementById("layout-save");
  const deleteBtn = document.getElementById("layout-delete");
  const layoutMsgEl = document.getElementById("layout-msg");
  const UNSAVED = "unsaved:"; // 読み込んだだけでまだ保存していない配列の id の頭

  function isUnsaved(layout) {
    return layout.id.indexOf(UNSAVED) === 0;
  }

  // 保存した配列を一覧に入れる（同じ名前の未保存のものは一覧から外す）
  function addSaved(record) {
    for (let i = layouts.length - 1; i >= 0; i--) {
      if (layouts[i].id === record.id || layouts[i].id === UNSAVED + record.id) layouts.splice(i, 1);
    }
    layouts.push({ id: record.id, name: record.name, type: "kana", entries: record.entries, source: record.source, kana: KanaLayout.create(record.entries) });
  }

  // 上書き保存と削除は2回押しで確かめる（確認のダイアログ confirm は、出さないブラウザでは押せなくなるので使わない）。
  // 1回目で注意を出してボタンを「上書きして保存する」「本当に削除する」に変え、6秒たつか配列を変えると元に戻す
  const SAVE_LABEL = saveBtn.textContent;
  const DELETE_LABEL = deleteBtn.textContent;
  let armed = null; // 2回目を待っているボタン
  let armTimer = 0;

  function arm(btn, label) {
    disarm();
    armed = btn;
    btn.textContent = label;
    btn.classList.add("tm-danger");
    armTimer = setTimeout(function () {
      disarm();
      layoutMsgEl.textContent = "";
    }, 6000);
  }

  function disarm() {
    clearTimeout(armTimer);
    armed = null;
    saveBtn.textContent = SAVE_LABEL;
    deleteBtn.textContent = DELETE_LABEL;
    saveBtn.classList.remove("tm-danger");
    deleteBtn.classList.remove("tm-danger");
  }

  function updateActions() {
    const layout = current();
    disarm();
    saveBtn.hidden = !(layout.type === "kana" && isUnsaved(layout));
    deleteBtn.hidden = !(layout.type === "kana" && !isUnsaved(layout));
  }

  saveBtn.addEventListener("click", function () {
    const layout = current();
    const name = layout.name;
    // 最初から入っている配列と同じ名前は使えない（記録の keyLayout が区別できなくなるため）
    if (layouts.some(function (l) { return l.type !== "kana" && l.id.toLowerCase() === name.toLowerCase(); })) {
      layoutMsgEl.textContent = "「" + name + "」は最初から入っている配列の名前なので使えません。別の名前で読み込み直してください。";
      return;
    }
    const exists = layouts.some(function (l) { return l.id === name; });
    const confirmed = armed === saveBtn;
    // その配列で打った記録があっても上書きできる（記録は消さない。記録の keyLayout は配列名なので、上書き後の配列の記録として扱われる）
    Store.countSessionsWithLayout(name).then(function (n) {
      if (exists && !confirmed) {
        arm(saveBtn, "上書きして保存する");
        layoutMsgEl.textContent = "「" + name + "」はすでに保存されています。もう一度押すと上書きします。" +
          (n > 0 ? "この配列で打った記録が " + n + " 件あります。記録は残りますが、前の割り当て表で打ったものと区別できなくなります（区別したいときは、別の名前で読み込み直して保存してください）。" : "");
        return;
      }
      disarm();
      // source は読み込んだ割り当て表の文字列（ローマ字で書いたままの形）。フォームに出し直すのに使う
      const record = { id: name, name: name, type: "kana", entries: layout.entries, source: layout.source, savedAt: new Date().toISOString() };
      return Store.saveLayout(record).then(function () {
        addSaved(record);
        buildLayoutOptions();
        layoutEl.value = name;
        changeLayout();
        layoutMsgEl.textContent = "「" + name + "」を" + (exists ? "上書きして" : "") + "保存しました。";
        PageFooter.refreshSize();
      });
    }).catch(function (err) {
      console.error(err);
      layoutMsgEl.textContent = "保存できませんでした: " + err.message;
    });
  });

  deleteBtn.addEventListener("click", function () {
    const layout = current();
    const confirmed = armed === deleteBtn;
    // その配列で打った記録があっても削除できる。記録は消さず、記録ページでは「配列名（削除済）」と出す
    Store.countSessionsWithLayout(layout.id).then(function (n) {
      if (!confirmed) {
        arm(deleteBtn, "本当に削除する");
        layoutMsgEl.textContent = "もう一度押すと「" + layout.name + "」を削除します。" +
          (n > 0 ? "この配列で打った記録 " + n + " 件は消さずに残ります（記録ページでは「" + layout.name + "（削除済）」と表示します）。" : "");
        return;
      }
      disarm();
      return Store.deleteLayout(layout.id).then(function () {
        layouts.splice(layouts.indexOf(layout), 1);
        buildLayoutOptions();
        layoutEl.value = "qwerty";
        changeLayout();
        layoutMsgEl.textContent = "「" + layout.name + "」を削除しました。";
        PageFooter.refreshSize();
      });
    }).catch(function (err) {
      console.error(err);
      layoutMsgEl.textContent = "削除できませんでした: " + err.message;
    });
  });

  // 保存した配列を読み込んで一覧に入れる
  function loadSaved() {
    return Store.getAllLayouts().then(function (records) {
      records.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      records.forEach(addSaved);
      const selected = layoutEl.value;
      buildLayoutOptions();
      if (layouts.some(function (l) { return l.id === selected; })) layoutEl.value = selected;
      changeLayout();
    }).catch(function (err) {
      console.error(err);
      layoutMsgEl.textContent = "保存した配列を読み込めませんでした: " + err.message;
    });
  }

  // ---- 割り当て表の読み込み ----

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
    showImportErrors(parsed.errors);
    if (parsed.entries.length === 0) {
      importMsgEl.textContent = "割り当て表から1行も読めませんでした。";
      return;
    }
    const id = UNSAVED + name;
    const layout = { id: id, name: name, type: "kana", entries: parsed.entries, source: tableTextEl.value, kana: KanaLayout.create(parsed.entries) };
    const i = layouts.findIndex(function (l) { return l.id === id; });
    if (i === -1) layouts.push(layout);
    else layouts[i] = layout;
    buildLayoutOptions();
    layoutEl.value = id;
    changeLayout();
    layoutMsgEl.textContent = "";
    importMsgEl.textContent = parsed.entries.length + " 行を読み込みました" +
      (parsed.romaji ? "（うち " + parsed.romaji + " 行はローマ字からかなに直しました）" : "") +
      "。まだ保存していません。配列図の上の「この配列を保存する」で保存します。" +
      (parsed.errors.length ? "読めなかった行が " + parsed.errors.length + " 行あります（下の一覧）。" : "");
  });

  // 読めなかった行を、行番号・行の中身・理由の一覧で出す
  function showImportErrors(errors) {
    const el = document.getElementById("import-errors");
    el.textContent = "";
    el.hidden = errors.length === 0;
    errors.forEach(function (e) {
      const li = document.createElement("li");
      li.textContent = e.line + " 行目：" + e.text + " … " + e.reason;
      el.appendChild(li);
    });
  }

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
      o.textContent = l.name + (isUnsaved(l) ? "（未保存）" : "");
      layoutEl.appendChild(o);
    });
  }

  function changeLayout() {
    updateActions();
    buildViewOptions();
    resetTrial();
    drawLabels();
    renderEntries();
    fillForm();
  }

  // 表示中のかな配列の名前と割り当て表を、登録のフォームに出す（直して読み込み直せるように）
  // 割り当て表は、読み込んだときの文字列（ローマ字で書いたならローマ字のまま）。それがない配列は「キーの並び<タブ>かな」で書き出す
  function fillForm() {
    const layout = current();
    if (layout.type !== "kana") return; // QWERTY のときは、書きかけのフォームをそのままにする
    nameEl.value = layout.name;
    tableTextEl.value = layout.source || layout.entries.map(function (e) { return e[0] + "\t" + e[1]; }).join("\n");
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
  layoutEl.addEventListener("change", function () {
    layoutMsgEl.textContent = "";
    changeLayout();
  });
  viewEl.addEventListener("change", drawLabels);

  // バージョン表示と、記録の書き出し・読み込み（全ページ共通。読み込んだら保存した配列を読み直す）
  PageFooter.init({ onImport: loadSaved });
  buildLayoutOptions();
  drawKeyboard();
  changeLayout();
  loadSaved();
})();
