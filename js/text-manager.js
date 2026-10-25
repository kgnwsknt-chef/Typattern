// お題のページ（text-manager.html）。文章・単語リストのファイルを読み込み、確かめて IndexedDB（texts）に保存する。
// 追加したお題の閲覧・編集・削除もする。読み取りと確かめは js/custom-texts.js。決まりは docs/text-manager.md
// （確認のダイアログ confirm は、出さないブラウザでは押せなくなるので使わない。編集は「編集中」の状態で、削除は2回押しで確かめる）
(function () {
  "use strict";

  const formTitleEl = document.getElementById("tm-form-title");
  const editingEl = document.getElementById("tm-editing");
  const editingTextEl = document.getElementById("tm-editing-text");
  const editCancelBtn = document.getElementById("tm-edit-cancel");
  const langEl = document.getElementById("tm-lang");
  const kindEl = document.getElementById("tm-kind");
  const nameEl = document.getElementById("tm-name");
  const fileEl = document.getElementById("tm-file");
  const formatEl = document.getElementById("tm-format");
  const sourceEl = document.getElementById("tm-source");
  const msgEl = document.getElementById("tm-msg");
  const checkBtn = document.getElementById("tm-check");
  const saveBtn = document.getElementById("tm-save");
  const modeBox = document.getElementById("tm-mode-box");
  const modeEl = document.getElementById("tm-mode");
  const errorsEl = document.getElementById("tm-errors");
  const previewEl = document.getElementById("tm-preview");
  const listEl = document.getElementById("tm-list");
  const builtinEl = document.getElementById("tm-builtin");

  // ページに付けた ?v= の番号（お題のファイルの読み込みにも付けて、古いものを使わないようにする）
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";

  const LANG_NAME = { en: "英語", ja: "日本語" };
  const KIND_NAME = { text: "文章", words: "単語リスト" };

  // 書き方の説明と例（言語・種類ごと）
  const FORMATS = {
    "en/text": ["文をそのまま書きます。改行や連続した空白は、スペース1つにまとめます。US キーボードで打てる文字だけ使えます（“ ” ’ などは打てる形に直します）。",
      "The quick brown fox jumps over the lazy dog."],
    "ja/text": ["「表示する文」と「読み（ひらがな）」を1行ずつ交互に書きます。読みはひらがなと「、」「。」「ー」だけ（カタカナはひらがなに直します）。",
      "クマムシは小さな生き物です。\nくまむしはちいさないきものです。"],
    "en/words": ["1行に1語。全部の語をスペースでつないで300文字以上になる数が必要です。", "apple\nbanana\ncherry"],
    "ja/words": ["1行に1語。「表示する語」と「読み」をタブかスペースで区切ります（かなだけの語は1列でもよい）。全部の読みをスペースでつないで300かな以上になる数が必要です。", "林檎 りんご\n果物 くだもの\nみかん"]
  };

  let builtinNames = { en: [], ja: [] }; // 最初から入っているお題・単語リストの名前（同じ名前は使えない）
  let saved = [];        // 保存したお題
  let checked = null;    // 確かめた結果（保存できるときだけ）{ lang, kind, name, source, parsed }
  let editingId = null;  // 編集中のお題の id（新しく追加するときは null）
  let viewingId = null;  // 閲覧中の、最初から入っているお題の id（"builtin/言語/モード/名前"）
  let lastModeChoice = null; // 「使うモード」で選んだもの（確かめ直しても選んだままにする。フォームを空にしたら null）
  let builtinIndex = { texts: {}, wordlists: {} }; // texts/index.json と wordlists/index.json
  let builtins = [];     // 最初から入っているお題（閲覧用）

  // 書き方の説明と、枠の例
  function showFormat() {
    const f = FORMATS[langEl.value + "/" + kindEl.value];
    formatEl.textContent = "書き方：" + f[0] + "（# で始まる行と空の行は読み飛ばします）";
    sourceEl.placeholder = "ファイルを選ぶか、ここに貼り付けてください。例：\n" + f[1];
  }

  function invalidate() {
    msgEl.classList.remove("tm-warn");
    checked = null;
    saveBtn.disabled = true;
    modeBox.hidden = true;
  }

  // 確かめた文章が長さから文章に当たるときは、そのモードで使うか「その他」で使うかを選べるようにする
  // （単語リストはいつも単語、長さが当たらない文章はいつもその他なので、選ぶものはない）
  function offerModes(lang, kind, auto) {
    if (kind !== "text" || auto === "other") return;
    // 前に選んでいたもの（確かめ直したとき）か、編集中のお題の保存したモードが「その他」なら、その他を選んでおく
    const editing = editingId && findSaved(editingId);
    const preferOther = lastModeChoice === "other" || (lastModeChoice === null && editing && editing.mode === "other");
    modeEl.textContent = "";
    [[auto, CustomTexts.MODE_NAME[auto] + "（長さから自動）"], ["other", "その他"]].forEach(function (o) {
      const opt = document.createElement("option");
      opt.value = o[0];
      opt.textContent = o[1];
      modeEl.appendChild(opt);
    });
    modeEl.value = preferOther ? "other" : auto;
    modeBox.hidden = false;
  }

  // 保存するときのモード（選べるときは選んだもの）
  function chosenMode() {
    return !modeBox.hidden && modeEl.value ? modeEl.value : checked.parsed.mode;
  }

  function showCheckedMessage() {
    const p = checked.parsed;
    const mode = chosenMode();
    msgEl.textContent = summary(checked.lang, checked.kind, p.length, mode) +
      (mode !== p.mode ? "（長さからは" + CustomTexts.MODE_NAME[p.mode] + "）" : "") +
      (checked.kind === "text" && p.mode === "other" ? "。" + otherReason(checked.lang, p.length) : "") +
      "。確かめたら「" + saveBtn.textContent + "」を押してください。";
    msgEl.classList.toggle("tm-warn", checked.kind === "text" && p.mode === "other");
  }

  // 長さが文章に当たらず「その他」になる理由（例「文章（240〜360文字）まで 20文字足りないため、その他になります」）
  function otherReason(lang, length) {
    const unit = lang === "ja" ? "かな" : "文字";
    const n = CustomTexts.RANGES.normal;
    const range = "文章（" + n[0] + "〜" + n[1] + unit + "）";
    if (length < n[0]) return range + "まで " + (n[0] - length) + unit + "足りないため、その他になります";
    return range + "より " + (length - n[1]) + unit + "多いため、その他になります";
  }

  // 最初から入っているお題の名前を読む（texts/index.json と wordlists/index.json）
  function loadBuiltinNames() {
    const get = function (path) {
      return fetch(path + "?v=" + ASSET_VERSION).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    };
    return Promise.all([get("texts/index.json"), get("wordlists/index.json")]).then(function (v) {
      builtinIndex = { texts: v[0], wordlists: v[1] };
      ["en", "ja"].forEach(function (l) { builtinNames[l] = (v[0][l] || []).concat(v[1][l] || []); });
    });
  }

  // 最初から入っているお題の中身を読む（閲覧用）。文章（.txt）・単語リスト
  // 読み取りは追加したお題と同じ（CustomTexts.parse）。モードは長さではなくファイルで決まる
  function loadBuiltinTexts() {
    const get = function (path) {
      return fetch(path + "?v=" + ASSET_VERSION).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    };
    const jobs = [];
    ["en", "ja"].forEach(function (lang) {
      (builtinIndex.texts[lang] || []).forEach(function (name) {
        jobs.push(get("texts/" + lang + "/" + name + ".txt").then(function (src) {
          return src === null ? null : builtinItem(lang, "text", name, "normal", src);
        }));
      });
      (builtinIndex.wordlists[lang] || []).forEach(function (name) {
        jobs.push(get("wordlists/" + lang + "/" + name + ".txt").then(function (src) {
          return src === null ? null : builtinItem(lang, "words", name, "words", src);
        }));
      });
    });
    return Promise.all(jobs).then(function (items) {
      builtins = items.filter(Boolean);
      drawBuiltinList();
    });
  }

  function builtinItem(lang, kind, name, mode, src) {
    const p = CustomTexts.parse(lang, kind, src);
    return { id: "builtin/" + lang + "/" + mode + "/" + name, builtin: true, name: name, lang: lang, kind: kind, mode: mode,
      length: p.length, text: p.text, lines: p.lines, words: p.words, source: src };
  }

  function findBuiltin(id) {
    return builtins.find(function (x) { return x.id === id; });
  }

  // 最初から入っているお題の一覧（閲覧だけ）
  function drawBuiltinList() {
    builtinEl.textContent = "";
    if (builtins.length === 0) {
      addLine(builtinEl, "bg-empty", "読み込み中…");
      return;
    }
    const table = document.createElement("table");
    table.className = "bg-table rk-table tm-table";
    const hr = table.createTHead().insertRow();
    ["名前", "言語", "種類", "長さ", "モード", ""].forEach(function (h) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    const body = table.createTBody();
    builtins.forEach(function (x) {
      const tr = body.insertRow();
      if (x.id === viewingId) tr.className = "bg-selected";
      [x.name, LANG_NAME[x.lang], KIND_NAME[x.kind], CustomTexts.lengthLabel(x.lang, x.kind, x.length),
        CustomTexts.MODE_NAME[x.mode]].forEach(function (v) {
        tr.insertCell().textContent = v;
      });
      const ops = tr.insertCell();
      ops.className = "tm-ops";
      ops.appendChild(button("閲覧", "このお題を上のフォームに出す（最初から入っているお題は編集・保存できません）", function () { startView(x); }));
    });
    builtinEl.appendChild(table);
  }

  function findSaved(id) {
    return saved.find(function (x) { return x.id === id; });
  }

  // 読み込んで確かめる
  function check() {
    invalidate();
    errorsEl.hidden = true;
    errorsEl.textContent = "";
    previewEl.hidden = true;
    const lang = langEl.value;
    const kind = kindEl.value;
    const name = nameEl.value.trim();
    const source = sourceEl.value;
    const id = lang + "/" + name;
    const problems = [];
    if (!name) problems.push("名前を入れてください。");
    else if (/[\/\\]/.test(name)) problems.push("名前に / と \\ は使えません。");
    else if (builtinNames[lang].indexOf(name) !== -1) problems.push("「" + name + "」は最初から入っているお題の名前なので使えません。");
    else if (id !== editingId && findSaved(id)) {
      problems.push("「" + name + "」（" + LANG_NAME[lang] + "）はすでに保存されています。別の名前にするか、一覧の「閲覧・編集」から直してください。");
    }
    if (!source.trim()) problems.push("ファイルを選ぶか、枠に貼り付けてください。");
    const parsed = source.trim() ? CustomTexts.parse(lang, kind, source) : null;
    if (parsed) parsed.errors.forEach(function (e) {
      problems.push((e.no ? e.no + " 行目：" : "") + e.reason + (e.line ? "（" + e.line.slice(0, 40) + "）" : ""));
    });
    if (problems.length) {
      problems.forEach(function (p) {
        const li = document.createElement("li");
        li.textContent = p;
        errorsEl.appendChild(li);
      });
      errorsEl.hidden = false;
      msgEl.textContent = "直してから、もう一度「読み込んで確かめる」を押してください。";
      return;
    }
    checked = { lang: lang, kind: kind, name: name, source: source, parsed: parsed };
    offerModes(lang, kind, parsed.mode);
    saveBtn.disabled = false;
    showCheckedMessage();
    previewEl.textContent = "";
    if (parsed.fixes.length) addLine(previewEl, "tm-fixes", "置き換えた文字：" + parsed.fixes.join("、"));
    drawContent(previewEl, lang, kind, parsed, 4);
    previewEl.hidden = false;
  }

  // 「312文字（文章モードで使います）」のような説明
  function summary(lang, kind, length, mode) {
    return CustomTexts.lengthLabel(lang, kind, length) + "（" + CustomTexts.MODE_NAME[mode] + "モードで使います）";
  }

  function addLine(el, cls, text) {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    el.appendChild(p);
  }

  // お題の中身を el に書く。maxLines を渡すと、日本語の文章はその行数まで・単語は30語までにする
  function drawContent(el, lang, kind, x, maxLines) {
    if (kind === "words") {
      const ws = maxLines ? x.words.slice(0, 30) : x.words;
      addLine(el, "tm-sample", ws.map(function (w) {
        return typeof w === "string" ? w : w.display === w.reading ? w.reading : w.display + "（" + w.reading + "）";
      }).join("　") + (ws.length < x.words.length ? "　…" : ""));
    } else if (lang === "ja") {
      const ls = maxLines ? x.lines.slice(0, maxLines) : x.lines;
      ls.forEach(function (l) {
        addLine(el, "tm-sample", l.display);
        addLine(el, "tm-sample tm-reading", l.reading);
      });
      if (ls.length < x.lines.length) addLine(el, "tm-sample", "…");
    } else {
      addLine(el, "tm-sample", x.text);
    }
  }

  // 保存する。編集中なら上書きし、名前を変えたときは前の名前のお題を消す（名前の付け替え）
  function save() {
    if (!checked) return;
    const c = checked;
    const id = c.lang + "/" + c.name;
    const p = c.parsed;
    const record = {
      id: id, name: c.name, lang: c.lang, kind: c.kind, mode: chosenMode(), length: p.length,
      text: p.text, lines: p.lines, words: p.words, source: c.source, savedAt: new Date().toISOString()
    };
    const renamedFrom = editingId && editingId !== id ? editingId : null;
    const verb = editingId ? "上書き保存しました" : "保存しました";
    Store.saveText(record)
      .then(function () { return renamedFrom ? Store.deleteText(renamedFrom) : null; })
      .then(function () {
        msgEl.textContent = "「" + c.name + "」を" + verb + "（" + summary(c.lang, c.kind, p.length, record.mode) + "）。" +
          // その他になったときは、その理由（長さが当たらない／自分で選んだ）
          (record.mode === "other" && c.kind === "text"
            ? (p.mode === "other" ? otherReason(c.lang, p.length) : "「使うモード」でその他を選んだため、その他になります") + "。"
            : "") +
          (renamedFrom ? "前の名前「" + renamedFrom.split("/").slice(1).join("/") + "」のお題は消しました（その名前で打った記録は残ります）。" : "");
        endEdit(true);
        // 長さが当たらずに「その他」になったとき（選んだ種類「文章」と違うモード）は、メッセージを強調する
        msgEl.classList.toggle("tm-warn", c.kind === "text" && p.mode === "other");
        PageFooter.refreshSize();
        return loadSaved();
      })
      .catch(function (err) {
        console.error(err);
        msgEl.textContent = "保存できませんでした: " + err.message;
      });
  }

  function loadSaved() {
    return Store.getAllTexts().then(function (all) {
      saved = all.sort(function (a, b) { return a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : a.name < b.name ? -1 : 1; });
      drawList();
    });
  }

  // 追加したお題の一覧
  function drawList() {
    listEl.textContent = "";
    if (saved.length === 0) {
      addLine(listEl, "bg-empty", "まだ追加したお題はありません。");
      return;
    }
    const table = document.createElement("table");
    table.className = "bg-table rk-table tm-table";
    const hr = table.createTHead().insertRow();
    ["名前", "言語", "種類", "長さ", "モード", "保存した日", ""].forEach(function (h) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    const body = table.createTBody();
    saved.forEach(function (x) {
      const tr = body.insertRow();
      if (x.id === viewingId || x.id === editingId) tr.className = "bg-selected";
      [x.name, LANG_NAME[x.lang], KIND_NAME[x.kind], CustomTexts.lengthLabel(x.lang, x.kind, x.length),
        CustomTexts.MODE_NAME[x.mode], formatDate(x.savedAt)].forEach(function (v) {
        tr.insertCell().textContent = v;
      });
      const ops = tr.insertCell();
      ops.className = "tm-ops";
      ops.appendChild(button("閲覧・編集", "このお題を上のフォームに出す（直して上書き保存できます）", function () { startEdit(x); }));
      ops.appendChild(deleteButton(x));
    });
    listEl.appendChild(table);
  }

  function button(text, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "text-btn small-btn";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  // 削除は2回押しで確かめる（1回目で「本当に削除」に変わり、4秒たつと元に戻る）
  function deleteButton(x) {
    let armed = false;
    let timer = 0;
    const b = button("削除", "このお題を消す（このお題で打った記録は残ります）", function () {
      if (!armed) {
        armed = true;
        b.textContent = "本当に削除";
        b.classList.add("tm-danger");
        timer = setTimeout(function () {
          armed = false;
          b.textContent = "削除";
          b.classList.remove("tm-danger");
        }, 4000);
        return;
      }
      clearTimeout(timer);
      remove(x);
    });
    return b;
  }

  function remove(x) {
    Store.deleteText(x.id).then(function () {
      msgEl.classList.remove("tm-warn");
      msgEl.textContent = "「" + x.name + "」を削除しました（このお題で打った記録は残ります）。";
      if (editingId === x.id) endEdit(false);
      PageFooter.refreshSize();
      return loadSaved();
    });
  }

  // 最初から入っているお題の閲覧：フォームに出すが、編集・保存はできない（入力欄は読み取りだけにし、確かめ・保存のボタンを隠す）
  function startView(b) {
    endEdit(false);
    viewingId = b.id;
    langEl.value = b.lang;
    kindEl.value = b.kind;
    nameEl.value = b.name;
    sourceEl.value = b.source;
    fileEl.value = "";
    setReadOnly(true);
    formTitleEl.textContent = "お題の閲覧";
    editingTextEl.textContent = "「" + b.name + "」（" + LANG_NAME[b.lang] + "・" + KIND_NAME[b.kind] + "）は最初から入っているお題です。閲覧だけで、編集・保存はできません。";
    editCancelBtn.textContent = "閲覧をやめる";
    editingEl.hidden = false;
    errorsEl.hidden = true;
    previewEl.hidden = true;
    showFormat();
    msgEl.textContent = CustomTexts.lengthLabel(b.lang, b.kind, b.length) + "（" + CustomTexts.MODE_NAME[b.mode] + "モード）";
    drawList();
    drawBuiltinList();
    formTitleEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // 閲覧だけの状態（最初から入っているお題）にするか、ふつうの状態に戻す
  function setReadOnly(on) {
    nameEl.readOnly = on;
    sourceEl.readOnly = on;
    langEl.disabled = on;
    kindEl.disabled = on;
    fileEl.disabled = on;
    checkBtn.hidden = on;
    saveBtn.hidden = on;
    // 編集できない欄は、本文の枠と同じ色にそろえる
    [sourceEl, nameEl, langEl, kindEl].forEach(function (el) { el.classList.toggle("tm-readonly", on); });
  }

  // 閲覧・編集：保存したお題をフォームに出す。保存すると上書きする（名前を変えれば付け替え）
  function startEdit(x) {
    endEdit(false);
    editingId = x.id;
    langEl.value = x.lang;
    kindEl.value = x.kind;
    nameEl.value = x.name;
    sourceEl.value = x.source;
    fileEl.value = "";
    formTitleEl.textContent = "お題の編集";
    editingTextEl.textContent = "「" + x.name + "」（" + LANG_NAME[x.lang] + "）を表示しています（保存 " + formatDate(x.savedAt) + "）。直すときは、直して「読み込んで確かめる」を押し、「上書き保存する」で保存します。ファイルを選び直すこともできます。";
    editCancelBtn.textContent = "編集をやめる";
    editingEl.hidden = false;
    saveBtn.textContent = "上書き保存する";
    showFormat();
    check();
    drawList();
    formTitleEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // 閲覧・編集をやめて、新しく追加する状態に戻す。clear ならフォームの中身も消す
  function endEdit(clear) {
    const wasViewing = viewingId !== null;
    editingId = null;
    lastModeChoice = null;
    viewingId = null;
    setReadOnly(false);
    formTitleEl.textContent = "お題の追加";
    editingEl.hidden = true;
    saveBtn.textContent = "保存する";
    if (clear || wasViewing) {
      // 最初から入っているお題の閲覧をやめたときは、その中身を追加のフォームに残さない
      nameEl.value = "";
      sourceEl.value = "";
      fileEl.value = "";
      errorsEl.hidden = true;
      previewEl.hidden = true;
      if (wasViewing) msgEl.textContent = "";
    }
    invalidate();
    drawList();
    drawBuiltinList();
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
  }

  // ファイルを選んだら枠に読み込む。名前が空ならファイル名（拡張子を除く）を入れる
  fileEl.addEventListener("change", function () {
    const file = fileEl.files[0];
    if (!file) return;
    file.text().then(function (t) {
      sourceEl.value = t;
      if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.[^.]+$/, "");
      check();
    });
  });
  [langEl, kindEl].forEach(function (el) {
    el.addEventListener("change", function () { showFormat(); invalidate(); });
  });
  [nameEl, sourceEl].forEach(function (el) { el.addEventListener("input", invalidate); });
  checkBtn.addEventListener("click", check);
  saveBtn.addEventListener("click", save);
  modeEl.addEventListener("change", function () {
    lastModeChoice = modeEl.value === "other" ? "other" : "auto";
    if (checked) showCheckedMessage();
  });
  editCancelBtn.addEventListener("click", function () {
    const viewing = viewingId !== null;
    endEdit(true);
    msgEl.textContent = viewing ? "" : "編集をやめました。";
  });

  showFormat();
  // バージョン表示と保存データの大きさ
  PageFooter.init();
  drawBuiltinList();
  loadBuiltinNames().then(function () { return Promise.all([loadSaved(), loadBuiltinTexts()]); }).catch(function (err) {
    console.error(err);
    listEl.textContent = "お題を読み込めませんでした: " + err.message;
  });
})();
