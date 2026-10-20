// お題のページ（text-manager.html）。文章・単語リストのファイルを読み込み、確かめて IndexedDB（texts）に保存する
// 読み取りと確かめは js/custom-texts.js。決まりは docs/text-manager.md
(function () {
  "use strict";

  const langEl = document.getElementById("tm-lang");
  const kindEl = document.getElementById("tm-kind");
  const nameEl = document.getElementById("tm-name");
  const fileEl = document.getElementById("tm-file");
  const formatEl = document.getElementById("tm-format");
  const sourceEl = document.getElementById("tm-source");
  const msgEl = document.getElementById("tm-msg");
  const checkBtn = document.getElementById("tm-check");
  const saveBtn = document.getElementById("tm-save");
  const errorsEl = document.getElementById("tm-errors");
  const previewEl = document.getElementById("tm-preview");
  const listEl = document.getElementById("tm-list");

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
  let saved = [];      // 保存したお題
  let checked = null;  // 確かめた結果（保存できるときだけ）{ lang, kind, name, source, parsed }

  // 書き方の説明と、枠の例
  function showFormat() {
    const f = FORMATS[langEl.value + "/" + kindEl.value];
    formatEl.textContent = "書き方：" + f[0] + "（# で始まる行と空の行は読み飛ばします）";
    sourceEl.placeholder = "ファイルを選ぶか、ここに貼り付けてください。例：\n" + f[1];
  }

  function invalidate() {
    checked = null;
    saveBtn.disabled = true;
  }

  // 最初から入っているお題の名前を読む（texts/index.json と wordlists/index.json）
  function loadBuiltinNames() {
    const get = function (path) {
      return fetch(path).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    };
    return Promise.all([get("texts/index.json"), get("wordlists/index.json")]).then(function (v) {
      ["en", "ja"].forEach(function (l) { builtinNames[l] = (v[0][l] || []).concat(v[1][l] || []); });
    });
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
    const problems = [];
    if (!name) problems.push("名前を入れてください。");
    else if (/[\/\\]/.test(name)) problems.push("名前に / と \\ は使えません。");
    else if (builtinNames[lang].indexOf(name) !== -1) problems.push("「" + name + "」は最初から入っているお題の名前なので使えません。");
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
    saveBtn.disabled = false;
    msgEl.textContent = summary(lang, kind, parsed.length, parsed.mode) + "。確かめたら「保存する」を押してください。";
    showPreview(lang, kind, parsed);
  }

  // 「312文字（文章モードで使います）」のような説明
  function summary(lang, kind, length, mode) {
    return CustomTexts.lengthLabel(lang, kind, length) + "（" + CustomTexts.MODE_NAME[mode] + "モードで使います）";
  }

  // プレビュー：置き換えた文字と、お題の初め
  function showPreview(lang, kind, parsed) {
    previewEl.textContent = "";
    const add = function (cls, text) {
      const p = document.createElement("p");
      p.className = cls;
      p.textContent = text;
      previewEl.appendChild(p);
    };
    if (parsed.fixes.length) add("tm-fixes", "置き換えた文字：" + parsed.fixes.join("、"));
    if (kind === "words") {
      add("tm-sample", parsed.words.slice(0, 30).map(function (w) {
        return typeof w === "string" ? w : w.display === w.reading ? w.reading : w.display + "（" + w.reading + "）";
      }).join("　") + (parsed.words.length > 30 ? "　…" : ""));
    } else if (lang === "ja") {
      parsed.lines.slice(0, 4).forEach(function (l) {
        add("tm-sample", l.display);
        add("tm-sample tm-reading", l.reading);
      });
      if (parsed.lines.length > 4) add("tm-sample", "…");
    } else {
      add("tm-sample", parsed.text);
    }
    previewEl.hidden = false;
  }

  // 保存する（同じ名前のお題があれば、確かめてから上書き）
  function save() {
    if (!checked) return;
    const c = checked;
    const id = c.lang + "/" + c.name;
    const exists = saved.some(function (x) { return x.id === id; });
    if (exists && !confirm("「" + c.name + "」（" + LANG_NAME[c.lang] + "）はすでに保存されています。上書きしますか？")) return;
    const p = c.parsed;
    const record = {
      id: id, name: c.name, lang: c.lang, kind: c.kind, mode: p.mode, length: p.length,
      text: p.text, lines: p.lines, words: p.words, source: c.source, savedAt: new Date().toISOString()
    };
    Store.saveText(record).then(function () {
      msgEl.textContent = "「" + c.name + "」を保存しました（" + summary(c.lang, c.kind, p.length, p.mode) + "）。";
      invalidate();
      PageFooter.refreshSize();
      return loadSaved();
    }).catch(function (err) {
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
      const p = document.createElement("p");
      p.className = "bg-empty";
      p.textContent = "まだ追加したお題はありません。";
      listEl.appendChild(p);
      return;
    }
    const table = document.createElement("table");
    table.className = "bg-table rk-table tm-table";
    const hr = table.createTHead().insertRow();
    ["名前", "言語", "種類", "長さ", "モード", "追加した日", ""].forEach(function (h) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    const body = table.createTBody();
    saved.forEach(function (x) {
      const tr = body.insertRow();
      [x.name, LANG_NAME[x.lang], KIND_NAME[x.kind], CustomTexts.lengthLabel(x.lang, x.kind, x.length),
        CustomTexts.MODE_NAME[x.mode], formatDate(x.savedAt)].forEach(function (v) {
        tr.insertCell().textContent = v;
      });
      const ops = tr.insertCell();
      ops.className = "tm-ops";
      ops.appendChild(button("表示", "この内容をフォームに出す（直して保存し直せます）", function () { showSaved(x); }));
      ops.appendChild(button("削除", "このお題を消す（このお題で打った記録は残ります）", function () { remove(x); }));
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

  // 保存したお題をフォームに出す
  function showSaved(x) {
    langEl.value = x.lang;
    kindEl.value = x.kind;
    nameEl.value = x.name;
    sourceEl.value = x.source;
    fileEl.value = "";
    showFormat();
    check();
    sourceEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function remove(x) {
    if (!confirm("「" + x.name + "」（" + LANG_NAME[x.lang] + "）を削除しますか？このお題で打った記録は残ります。")) return;
    Store.deleteText(x.id).then(function () {
      msgEl.textContent = "「" + x.name + "」を削除しました。";
      PageFooter.refreshSize();
      return loadSaved();
    });
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

  showFormat();
  // バージョン表示と保存データの大きさ
  PageFooter.init();
  loadBuiltinNames().then(loadSaved).catch(function (err) {
    console.error(err);
    listEl.textContent = "お題を読み込めませんでした: " + err.message;
  });
})();
