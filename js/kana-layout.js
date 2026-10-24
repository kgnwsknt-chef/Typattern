// かな配列の割り当て表（「キーの並び → かな」）の読み込みと、最長一致での変換。英語の配列の割り当て表（「キー → 文字」）の読み込みも
// 表の中のキーは US キーボードの QWERTY の文字として読む（Shift ありの文字は Shift ＋ そのキー）。
// 決まりは docs/layouts.md の「割り当て表の書き方」（理由は docs/japanese-input.md の「4. かな配列」）
const KanaLayout = (function () {
  "use strict";

  // 割り当て表の文字列を読む。返り値 { entries: [[キーの並び, かな], …], errors: [{ line: 行番号, text: 行, reason: 理由 }, …], romaji: ローマ字から直した行の数 }
  // 1行に1つ。次の2つの形を読める。空の行と、# か // で始まる行は読み飛ばす
  //   {"j'", "ぴ"},      … 波かっこと二重引用符の形（行末のカンマはあってもなくてもよい。\" と \\ が使える）
  //   j'<区切り>ぴ        … 空白区切り。区切りはタブ・半角スペース・全角スペースで、いくつ続いてもよい（例 t<タブ><タブ>を、te うぇ）
  // かなの欄はローマ字で書いてもよい（例 j xtu）。英数字と記号だけなら、ふつうのローマ字入力の決まりでかなに直す（js/romaji.js の toKana）
  // 同じキーの並びが2回出てきたら、後の行を使う
  // 割り当て表の各行を「キーの並び」と「出す文字」に分け、row(keys, out, 行番号, 行) を呼ぶ（かな配列・英語の配列で共通）
  // 分けられない行は errors に足す（理由は what の「キーの並びと○○に分けられません」）
  function readLines(text, what, errors, row) {
    const BRACE = /^\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\}\s*,?$/;
    const SPACED = /^(\S+)\s+(\S+)$/; // \s はタブ・半角スペース・全角スペースを含む
    const unescape = function (s) { return s.replace(/\\(.)/g, "$1"); };
    text.split(/\r?\n/).forEach(function (raw, i) {
      const line = raw.trim();
      if (!line || line[0] === "#" || line.indexOf("//") === 0) return;
      let keys = null;
      let out = null;
      const m = BRACE.exec(line);
      const s = m ? null : SPACED.exec(line);
      if (m) {
        keys = unescape(m[1]);
        out = unescape(m[2]);
      } else if (s) {
        keys = s[1];
        out = s[2];
      }
      if (!keys || !out) {
        errors.push({ line: i + 1, text: line, reason: "キーの並びと" + what + "に分けられません" });
        return;
      }
      row(keys, out, i + 1, line);
    });
  }

  function parse(text) {
    const map = new Map();
    const errors = [];
    let romaji = 0;
    readLines(text, "かな", errors, function (keys, kana, lineNo, line) {
      const i = lineNo - 1;
      if (/^[\x21-\x7e]+$/.test(kana)) {
        // ローマ字で書いたかな
        const converted = Romaji.toKana(kana);
        if (converted === null) {
          errors.push({ line: i + 1, text: line, reason: "「" + kana + "」をかなに直せません" });
          return;
        }
        kana = converted;
        romaji++;
      }
      map.set(keys, kana);
    });
    return { entries: Array.from(map), errors: errors, romaji: romaji };
  }

  // 英語の配列の割り当て表を読む（書き方はかな配列と同じ。決まりは docs/layouts.md の「英語の配列」）。返り値 { entries, errors }
  //   1行は「1キー → 1文字」。キーは QWERTY の1文字（Shift ありの文字は Shift ＋ そのキー）、出す文字も1文字。ローマ字をかなに直すことはしない
  //   英字のキーが英字を出す行があって、そのキーの大文字の行がなければ、大文字どうしの行を足す（s o → S O）
  function parseEng(text) {
    const map = new Map();
    const errors = [];
    readLines(text, "文字", errors, function (keys, out, lineNo, line) {
      if (keys.length !== 1 || !Keys.ofChar(keys)) {
        errors.push({ line: lineNo, text: line, reason: "キーは QWERTY の1文字で書いてください（英語の配列は1キー → 1文字）" });
        return;
      }
      if (Array.from(out).length !== 1) {
        errors.push({ line: lineNo, text: line, reason: "出す文字は1文字で書いてください（英語の配列は1キー → 1文字）" });
        return;
      }
      map.set(keys, out);
    });
    Array.from(map).forEach(function (e) {
      const upperKey = e[0].toUpperCase();
      const upperOut = e[1].toUpperCase();
      if (/^[a-z]$/.test(e[0]) && /^[a-z]$/.test(e[1]) && !map.has(upperKey)) map.set(upperKey, upperOut);
    });
    return { entries: Array.from(map), errors: errors };
  }

  // 英語の配列の割り当て表から、押したキーと文字の行き来を作る（タイピング画面・ミスタイプ・苦手な単語で使う）
  //   toChar(QWERTY の文字)：そのキーで出る文字。表にないキーは QWERTY の文字のまま
  //   toKey(文字)：その文字を出すキーの QWERTY の文字（Shift ありなら Shift ありの文字）。出せなければ null
  function engMap(entries) {
    const table = new Map(entries);
    const byOut = new Map();
    entries.forEach(function (e) { if (!byOut.has(e[1])) byOut.set(e[1], e[0]); });
    return {
      toChar: function (ch) { return table.has(ch) ? table.get(ch) : ch; },
      toKey: function (ch) {
        if (byOut.has(ch)) return byOut.get(ch);
        // 表にない文字は、表で入れ替えていないキー（QWERTY でその文字を出すキー）で出る
        return table.has(ch) ? null : ch;
      }
    };
  }

  // 読み込んだ表から、変換と配列図に使う形を作る
  function create(entries) {
    const table = new Map(entries);
    // あるキーの並びが、表のどれかの並びの始まり（それ自身を含む）になっているか
    const prefixes = new Set();
    entries.forEach(function (e) {
      for (let i = 1; i <= e[0].length; i++) prefixes.add(e[0].slice(0, i));
    });

    // かな → そのかなを打てるキーの並び（表を逆に引く）。タイピング画面の判定（js/typer.js）に使う
    const byKana = new Map();
    let maxKana = 0;
    entries.forEach(function (e) {
      if (!byKana.has(e[1])) byKana.set(e[1], []);
      byKana.get(e[1]).push(e[0]);
      maxKana = Math.max(maxKana, e[1].length);
    });
    // 同じかなを打てる並びが複数あれば、短い並びを先にする
    byKana.forEach(function (list) { list.sort(function (a, b) { return a.length - b.length; }); });

    // お題 text の pos 文字目から打てる打ち方の一覧 [{ seq, len }]（js/typer.js の optionsFn）
    // 「ぴゃ」のように複数のかなを1つの並びで打てるときは、長い方を先にする。表にないかなは空
    function options(text, pos) {
      const res = [];
      // 単語モードの単語の間のスペースは、表になくてもスペースキーで打てる
      if (text[pos] === " " && !byKana.has(" ")) return [{ seq: " ", len: 1 }];
      for (let len = Math.min(maxKana, text.length - pos); len > 0; len--) {
        const list = byKana.get(text.substr(pos, len));
        if (list) list.forEach(function (seq) { res.push({ seq: seq, len: len }); });
      }
      return res;
    }

    // s で始まり、s より長い並びがあるか
    function hasLonger(s) {
      return entries.some(function (e) { return e[0].length > s.length && e[0].indexOf(s) === 0; });
    }

    // シフト面の候補。2打の並びの1打目によく出るキーは前置、2打目によく出るキーは後置のシフトとみなす
    function shiftKeys(minCount) {
      const first = new Map();
      const second = new Map();
      entries.forEach(function (e) {
        if (e[0].length !== 2) return;
        first.set(e[0][0], (first.get(e[0][0]) || 0) + 1);
        second.set(e[0][1], (second.get(e[0][1]) || 0) + 1);
      });
      const pick = function (m) {
        return Array.from(m).filter(function (x) { return x[1] >= minCount; })
          .sort(function (a, b) { return b[1] - a[1]; })
          .map(function (x) { return x[0]; });
      };
      return { prefix: pick(first), postfix: pick(second) };
    }

    // 試し打ち用の変換器。最長一致：続けて押したキーが表のどの並びの始まりにもならなくなったら、
    // それまでの並びを確定する（表にない並びは、打ったキーの文字のまま出す）
    function converter() {
      let pending = "";
      let out = "";

      function flush() {
        if (!pending) return;
        out += table.has(pending) ? table.get(pending) : pending;
        pending = "";
      }

      function press(ch) {
        const s = pending + ch;
        if (prefixes.has(s)) {
          pending = s;
        } else {
          flush();
          if (prefixes.has(ch)) pending = ch;
          else out += ch;
        }
        // それより長い並びがなければ、すぐ確定する
        if (pending && table.has(pending) && !hasLonger(pending)) flush();
      }

      function backspace() {
        if (pending) pending = pending.slice(0, -1);
        else out = Array.from(out).slice(0, -1).join("");
      }

      return {
        press: press,
        backspace: backspace,
        // 打ちかけの並びをそこで確定する（試し打ちの Enter）
        confirm: flush,
        clear: function () { pending = ""; out = ""; },
        // 確定した文字と、打ちかけの並び（とそれだけで確定したときのかな）
        state: function () {
          return { out: out, pending: pending, tentative: table.has(pending) ? table.get(pending) : "" };
        }
      };
    }

    return {
      entries: entries,
      get: function (keys) { return table.has(keys) ? table.get(keys) : null; },
      options: options,
      shiftKeys: shiftKeys,
      converter: converter
    };
  }

  return { parse: parse, parseEng: parseEng, engMap: engMap, create: create };
})();
