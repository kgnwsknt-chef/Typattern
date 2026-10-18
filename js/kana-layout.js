// かな配列の割り当て表（「キーの並び → かな」）の読み込みと、最長一致での変換
// 表の中のキーは US キーボードの QWERTY の文字として読む（Shift ありの文字は Shift ＋ そのキー）。
// 決まりは docs/japanese-input.md
const KanaLayout = (function () {
  "use strict";

  // 割り当て表の文字列を読む。返り値 { entries: [[キーの並び, かな], …], errors: [{ line: 行番号, text: 行, reason: 理由 }, …], romaji: ローマ字から直した行の数 }
  // 1行に1つ。次の2つの形を読める。空の行と、# か // で始まる行は読み飛ばす
  //   {"j'", "ぴ"},      … 波かっこと二重引用符の形（行末のカンマはあってもなくてもよい。\" と \\ が使える）
  //   j'<区切り>ぴ        … 空白区切り。区切りはタブ・半角スペース・全角スペースで、いくつ続いてもよい（例 t<タブ><タブ>を、te うぇ）
  // かなの欄はローマ字で書いてもよい（例 j xtu）。英数字と記号だけなら、ふつうのローマ字入力の決まりでかなに直す（js/romaji.js の toKana）
  // 同じキーの並びが2回出てきたら、後の行を使う
  function parse(text) {
    const map = new Map();
    const errors = [];
    let romaji = 0;
    const BRACE = /^\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\}\s*,?$/;
    const SPACED = /^(\S+)\s+(\S+)$/; // \s はタブ・半角スペース・全角スペースを含む
    const unescape = function (s) { return s.replace(/\\(.)/g, "$1"); };
    text.split(/\r?\n/).forEach(function (raw, i) {
      const line = raw.trim();
      if (!line || line[0] === "#" || line.indexOf("//") === 0) return;
      let keys = null;
      let kana = null;
      const m = BRACE.exec(line);
      const s = m ? null : SPACED.exec(line);
      if (m) {
        keys = unescape(m[1]);
        kana = unescape(m[2]);
      } else if (s) {
        keys = s[1];
        kana = s[2];
      }
      if (!keys || !kana) {
        errors.push({ line: i + 1, text: line, reason: "キーの並びとかなに分けられません" });
        return;
      }
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

    // 段（シフト）の候補。2打の並びの1打目によく出るキーは前置、2打目によく出るキーは後置のシフトとみなす
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

  return { parse: parse, create: create };
})();
