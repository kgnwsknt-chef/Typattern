// お題のページで追加するお題（文章・単語リスト）の読み取りと確かめ。お題のページ（js/text-manager.js）と
// タイピング画面（js/app.js）で使う。決まりは docs/text-manager.md
const CustomTexts = (function () {
  "use strict";

  // 長さで振り分けるモード（英語は文字数、日本語は読みのかなの数。組み込みのお題の約300文字に2割の幅）
  const RANGES = { normal: [240, 360] };
  // 単語リストは、全部の語をスペースでつないだ長さがこれ以上必要（単語モードのお題 約300文字を作れるように）
  const WORDS_MIN_TOTAL = 300;
  // 文章の長さの下限（文字数。日本語は読みのかなの数）。数文字では1回のつまずきで平均 IKI が大きく変わり、測る意味が薄いため
  const TEXT_MIN_LENGTH = 30;
  const MODE_NAME = { normal: "文章", words: "単語", other: "その他" };

  // 英語でよくある、US キーボードで打てない文字の置き換え
  const EN_FIXES = [
    [/[“”„«»]/g, "\"", "“ ” → \""],
    [/[‘’‚]/g, "'", "‘ ’ → '"],
    [/[–—−]/g, "-", "– — → -"],
    [/…/g, "...", "… → ..."],
    [/[ 　]/g, " ", "全角スペースなど → 半角スペース"]
  ];

  // 文章のモード。単語リストはいつも単語モード
  function modeFor(kind, length) {
    if (kind === "words") return "words";
    if (length >= RANGES.normal[0] && length <= RANGES.normal[1]) return "normal";
    return "other";
  }

  // # で始まる行と空の行を除いた行 [{ no: 行番号（1から）, s: 中身 }]
  function rows(source) {
    return source.split(/\r?\n/)
      .map(function (s, i) { return { no: i + 1, s: s.trim() }; })
      .filter(function (r) { return r.s && r.s[0] !== "#"; });
  }

  // 英語：よくある文字を置き換え、置き換えた種類を fixes に足す
  function fixEnglish(s, fixes) {
    EN_FIXES.forEach(function (f) {
      if (f[0].test(s)) {
        s = s.replace(f[0], f[1]);
        if (fixes.indexOf(f[2]) === -1) fixes.push(f[2]);
      }
      f[0].lastIndex = 0;
    });
    return s;
  }

  // US キーボードで打てる文字か（スペースと ASCII の記号・英数字）
  function typableEnglish(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0x20 && c <= 0x7e;
  }

  // カタカナをひらがなに直す（ー はそのまま）
  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); });
  }

  // 日本語の読みのうち、ローマ字で打てない位置の文字（記号は「、」「。」「ー」だけ）
  function untypableKana(reading) {
    const bad = [];
    for (let i = 0; i < reading.length; i++) {
      const ch = reading[i];
      const ok = /[ぁ-ゖ、。ー]/.test(ch) && Romaji.options(reading, i).length > 0;
      if (!ok && bad.indexOf(ch) === -1) bad.push(ch);
    }
    return bad;
  }

  // ソース（ファイルの中身）を読み取る
  //   lang："en" か "ja"、kind："text"（文章）か "words"（単語リスト）
  //   返り値 { errors: [{ no, line, reason }], fixes: [説明], length, mode, text, lines, words }
  //   errors が空なら保存できる。length は英語の文章は文字数、日本語の文章は読みのかなの数、単語リストは語数
  function parse(lang, kind, source) {
    const errors = [];
    const fixes = [];
    const rs = rows(source);
    const out = { errors: errors, fixes: fixes, length: 0, mode: null };
    const err = function (r, reason) { errors.push({ no: r ? r.no : null, line: r ? r.s : "", reason: reason }); };

    if (kind === "text" && lang === "en") {
      // 改行や連続した空白はスペース1つにまとめる（組み込みのお題と同じ）
      rs.forEach(function (r) {
        r.s = fixEnglish(r.s, fixes);
        const bad = Array.from(r.s).filter(function (ch) { return !typableEnglish(ch); });
        if (bad.length) err(r, "US キーボードで打てない文字があります：" + uniq(bad).join(" "));
      });
      out.text = rs.map(function (r) { return r.s; }).join(" ").replace(/\s+/g, " ").trim();
      out.length = out.text.length;
    } else if (kind === "text") {
      // 日本語：「表示する文」と「読み（ひらがな）」を1行ずつ交互に書く。読みはスペースなしでつなげる
      if (rs.length % 2 !== 0) err(rs[rs.length - 1], "表示する文と読みの行の数が合いません（最後の行に読みがありません）");
      const lines = [];
      for (let i = 0; i + 1 < rs.length; i += 2) {
        const reading = toHiragana(rs[i + 1].s.replace(/[\s　]+/g, ""));
        if (reading !== rs[i + 1].s) note(fixes, "カタカナ → ひらがな（読み）、読みの中のスペースは除く");
        const bad = untypableKana(reading);
        if (bad.length) err(rs[i + 1], "読みにローマ字で打てない文字があります：" + bad.join(" ") + "（読みはひらがなと「、」「。」「ー」だけ）");
        lines.push({ display: rs[i].s, reading: reading });
      }
      out.lines = lines;
      out.text = lines.map(function (l) { return l.reading; }).join("");
      out.length = out.text.length;
    } else {
      // 単語リスト：1行1語。日本語は「表示する語」と「読み」をタブかスペースで区切る（かなだけの語は1列でもよい）
      const words = [];
      rs.forEach(function (r) {
        if (lang === "en") {
          const w = fixEnglish(r.s, fixes);
          if (/\s/.test(w)) err(r, "1行に1語だけ書いてください（スペースがあります）");
          else if (!Array.from(w).every(typableEnglish)) err(r, "US キーボードで打てない文字があります：" + uniq(Array.from(w).filter(function (ch) { return !typableEnglish(ch); })).join(" "));
          else words.push(w);
        } else {
          const cols = r.s.split(/[\t 　]+/);
          if (cols.length > 2) { err(r, "表示する語と読みの2つに分けられません（区切りが多すぎます）"); return; }
          const reading = toHiragana(cols[1] || cols[0]);
          if (reading !== (cols[1] || cols[0])) note(fixes, "カタカナ → ひらがな（読み）");
          const bad = untypableKana(reading);
          if (bad.length) err(r, "読みにローマ字で打てない文字があります：" + bad.join(" ") + "（読みはひらがなと「、」「。」「ー」だけ）");
          else words.push({ display: cols[0], reading: reading });
        }
      });
      out.words = words;
      out.length = words.length;
      // 単語モードのお題は約300文字。全部の語を並べても届かないリストでは、短いお題になってしまうので保存させない
      const total = words.reduce(function (a, w) { return a + (typeof w === "string" ? w : w.reading).length + 1; }, -1);
      if (!errors.length && total < WORDS_MIN_TOTAL) {
        err(null, "単語が足りません。全部の語をスペースでつないでも " + Math.max(total, 0) + (lang === "ja" ? "かな" : "文字") +
          "で、単語モードのお題（約300文字）を作るには " + WORDS_MIN_TOTAL + " 以上必要です");
      }
    }
    if (kind === "words") {
      if (out.length < 2 && !errors.length) err(null, "単語が2語以上必要です");
    } else if (out.length < TEXT_MIN_LENGTH && !errors.length) {
      err(null, "お題が短すぎます（" + out.length + (lang === "ja" ? "かな" : "文字") + "。" + TEXT_MIN_LENGTH + (lang === "ja" ? "かな" : "文字") + "以上必要です）");
    }
    out.mode = modeFor(kind, out.length);
    return out;
  }

  function uniq(a) {
    return a.filter(function (x, i) { return a.indexOf(x) === i; });
  }

  function note(fixes, s) {
    if (fixes.indexOf(s) === -1) fixes.push(s);
  }

  // 長さの表示（例「312文字」「312かな」「1000語」）
  function lengthLabel(lang, kind, length) {
    return length + (kind === "words" ? "語" : lang === "ja" ? "かな" : "文字");
  }

  return { RANGES: RANGES, MODE_NAME: MODE_NAME, parse: parse, modeFor: modeFor, lengthLabel: lengthLabel };
})();
