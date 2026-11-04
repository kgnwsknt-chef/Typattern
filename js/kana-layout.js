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
  // キーの並びの + は同時押し（j+k。docs/layouts.md の「同時押し」）。同時押しの中のキーは文字の順に並べてそろえる
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
      // + は同時押しの印。同時押しの中のキーは決まった順に並べてそろえる（k+j も j+k にする）
      const g = groupsOf(keys);
      if (g.error) {
        errors.push({ line: i + 1, text: line, reason: g.error });
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
      map.set(joinGroups(g.groups), kana);
    });
    return { entries: Array.from(map), errors: errors, romaji: romaji };
  }

  // かな配列のキーの並びを、続けて押すまとまりに分ける（+ でつないだキーは1つのまとまり＝同時押し）
  //   "j+kl" → [["j","k"],["l"]]。まとまりの中は文字の順に並べる。返り値 { groups } か { error: 理由 }
  function groupsOf(keys) {
    if (keys.indexOf("+") === -1) return { groups: Array.from(keys).map(function (c) { return [c]; }) };
    if (keys === "+") return { error: "かな配列では + は同時押しの印なので、Shift ＋ = のキーには割り当てられません" };
    const groups = [];
    let join = false;
    for (let i = 0; i < keys.length; i++) {
      const c = keys[i];
      if (c === "+") {
        if (i === 0 || i === keys.length - 1 || keys[i + 1] === "+") return { error: "+ の前後には同時に押すキーを書いてください" };
        join = true;
      } else if (join) {
        const g = groups[groups.length - 1];
        if (g.indexOf(c) !== -1) return { error: "同時押しの中に同じキー「" + c + "」が2回あります" };
        g.push(c);
        join = false;
      } else {
        groups.push([c]);
      }
    }
    groups.forEach(function (g) { g.sort(); });
    return { groups: groups };
  }

  function joinGroups(groups) {
    return groups.map(function (g) { return g.join("+"); }).join("");
  }

  // 割り当て表に同時押しの行があるか（キーの並びに + を含む。英語の配列の + は1キーなので当たらない）
  function hasChord(entries) {
    return entries.some(function (e) { return e[0].length > 1 && e[0].indexOf("+") !== -1; });
  }

  // 押したキーの並びから、同時押しの組がそろったかを見分ける（決まりは docs/measurement.md の「かな配列」）
  //   groups：組の一覧 [["j","k"], …]（options.chords）。term：判定時間(ms)。タイピングの判定（js/typer.js）と IKI の集計（js/ngram.js）で共通
  //   press(num, time, held)：キーを押すたびに呼ぶ。num は物理キーの番号、held は押されているキーの番号の Set（今のキーは含めない）
  //     このキーで組がそろったら、組のキーの数を返す。そろわなければ 0
  //   reset()：Backspace のときに呼ぶ（Backspace の前に押したキーとは組にしない）
  function chordFinder(groups, term) {
    const names = new Set(); // 組（物理キーの番号を並べた名前 "27 28"）
    let max = 0;
    groups.forEach(function (g) {
      names.add(g.map(function (ch) {
        const k = Keys.ofChar(ch);
        return k ? k.number : ch;
      }).sort().join(" "));
      max = Math.max(max, g.length);
    });
    let recent = []; // 直近に押したキー { num, time }
    function formed(num, time, held) {
      for (let n = max; n >= 2; n--) {
        const prev = recent.slice(-(n - 1));
        if (prev.length < n - 1 || time - prev[0].time > term) continue;
        if (!prev.every(function (p) { return held.has(p.num); })) continue;
        const nums = prev.map(function (p) { return p.num; }).concat([num]);
        if (new Set(nums).size === n && names.has(nums.sort().join(" "))) return n;
      }
      return 0;
    }
    return {
      size: names.size,
      press: function (num, time, held) {
        const n = formed(num, time, held);
        recent.push({ num: num, time: time });
        if (recent.length > max) recent.shift();
        return n;
      },
      reset: function () { recent = []; }
    };
  }

  // 同時押しのまとまりを、押す順のすべての並べ方にする（[["j","k"],["l"]] → "jkl"・"kjl"）
  //   返り値 [{ seq: キーの並び（+ なし）, chords: [[始まり, 終わり（含まない）], …]（同時押しの位置。なければ空） }]
  function orders(groups) {
    let res = [{ seq: "", chords: [] }];
    groups.forEach(function (g) {
      const perms = permutations(g);
      const next = [];
      res.forEach(function (r) {
        perms.forEach(function (p) {
          const at = r.seq.length;
          next.push({ seq: r.seq + p.join(""), chords: g.length > 1 ? r.chords.concat([[at, at + g.length]]) : r.chords });
        });
      });
      res = next;
    });
    return res;
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach(function (x, i) {
      permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(function (p) { out.push([x].concat(p)); });
    });
    return out;
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
    // キーの並びを、続けて押すまとまり（1キーか、同時押しの "j+k"）に分ける。英語の配列の "+" は1キー
    const tokensOf = function (keys) {
      return keys.length > 1 && keys.indexOf("+") !== -1
        ? groupsOf(keys).groups.map(function (g) { return g.join("+"); })
        : Array.from(keys);
    };
    // あるキーの並びが、表のどれかの並びの始まり（それ自身を含む）になっているか。まとまりの切れ目で区切る（"j+k" は "j+k+l" の始まりではない）
    const prefixes = new Set();
    const longer = new Set(); // それより長い並びの始まりになっている並び
    entries.forEach(function (e) {
      const t = tokensOf(e[0]);
      for (let i = 1; i <= t.length; i++) {
        prefixes.add(t.slice(0, i).join(""));
        if (i < t.length) longer.add(t.slice(0, i).join(""));
      }
    });

    // かな → そのかなを打てるキーの並び（表を逆に引く）。タイピング画面の判定（js/typer.js）に使う
    const byKana = new Map();
    let maxKana = 0;
    entries.forEach(function (e) {
      if (!byKana.has(e[1])) byKana.set(e[1], []);
      byKana.get(e[1]).push(e[0]);
      maxKana = Math.max(maxKana, e[1].length);
    });
    // 同じかなを打てる並びが複数あれば、短い並び（押すキーの数が少ない並び）を先にする
    const keyCount = function (keys) { return keys.replace(/(.)\+/g, "$1").length; };
    byKana.forEach(function (list) { list.sort(function (a, b) { return keyCount(a) - keyCount(b); }); });

    // 同時押しの組（2キー以上のまとまり）の一覧 [["j","k"], …]。js/typer.js で、順に押す並びと見分けるのに使う
    const chords = [];
    const chordSeen = new Set();
    entries.forEach(function (e) {
      if (e[0].indexOf("+") === -1 || e[0].length === 1) return;
      groupsOf(e[0]).groups.forEach(function (g) {
        if (g.length < 2 || chordSeen.has(g.join("+"))) return;
        chordSeen.add(g.join("+"));
        chords.push(g);
      });
    });

    // キーの並び → 押す順の並べ方の一覧（同時押しのない並びは1つ）
    const orderCache = new Map();
    function ordersOf(keys) {
      if (!orderCache.has(keys)) {
        orderCache.set(keys, keys.length > 1 && keys.indexOf("+") !== -1 ? orders(groupsOf(keys).groups) : [{ seq: keys, chords: [] }]);
      }
      return orderCache.get(keys);
    }

    // お題 text の pos 文字目から打てる打ち方の一覧 [{ seq, len, chords }]（js/typer.js の optionsFn）
    // 「ぴゃ」のように複数のかなを1つの並びで打てるときは、長い方を先にする。表にないかなは空
    // 同時押しの並びは、押す順のすべての並べ方を返す（chords は同時押しの位置。js/typer.js）
    function options(text, pos) {
      const res = [];
      // 単語モードの単語の間のスペースは、表になくてもスペースキーで打てる
      if (text[pos] === " " && !byKana.has(" ")) return [{ seq: " ", len: 1, chords: [] }];
      for (let len = Math.min(maxKana, text.length - pos); len > 0; len--) {
        const list = byKana.get(text.substr(pos, len));
        if (list) list.forEach(function (keys) {
          ordersOf(keys).forEach(function (o) { res.push({ seq: o.seq, len: len, chords: o.chords }); });
        });
      }
      return res;
    }
    // 判定（js/typer.js）が、順に押す並びと同時押しを見分けるのに使う
    options.chords = chords;

    // s で始まり、s より長い並びがあるか
    function hasLonger(s) {
      return longer.has(s);
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

    // 同時押しシフトの一覧 [{ keys: ["d","k"], kana(ch) }]（docs/layouts.md の「配列図」）
    // 2キーの同時押しに minCount 回以上出てくるキーをシフトのキーとし、組む相手とかなが同じキーを1つにまとめる。
    // kana(ch)：シフトのキーと ch を同時に押したときのかな（なければ null）。並びは割り当ての多い順（同じならキーの文字の順）
    function chordShifts(minCount) {
      const partners = new Map(); // キー → (組む相手 → かな)
      const link = function (a, b, kana) {
        if (!partners.has(a)) partners.set(a, new Map());
        partners.get(a).set(b, kana);
      };
      entries.forEach(function (e) {
        if (e[0].length !== 3 || e[0][1] !== "+") return;
        link(e[0][0], e[0][2], e[1]);
        link(e[0][2], e[0][0], e[1]);
      });
      // 2つのキーが、共通の相手 minCount 個以上で、どれも同じかなになるか
      const same = function (a, b) {
        let shared = 0;
        const ok = Array.from(partners.get(a)).every(function (p) {
          if (!partners.get(b).has(p[0])) return true;
          shared++;
          return partners.get(b).get(p[0]) === p[1];
        });
        return ok && shared >= minCount;
      };
      const groups = [];
      Array.from(partners.keys())
        .filter(function (k) { return partners.get(k).size >= minCount; })
        .sort(function (a, b) { return partners.get(b).size - partners.get(a).size || (a < b ? -1 : 1); })
        .forEach(function (k) {
          const g = groups.find(function (x) { return same(x.keys[0], k); });
          if (g) g.keys.push(k);
          else groups.push({ keys: [k] });
        });
      groups.forEach(function (g) {
        g.keys.sort();
        g.kana = function (ch) {
          for (let i = 0; i < g.keys.length; i++) {
            const kana = partners.get(g.keys[i]).get(ch);
            if (kana) return kana;
          }
          return null;
        };
      });
      return groups;
    }

    // 試し打ち用の変換器。最長一致：続けて押したキーが表のどの並びの始まりにもならなくなったら、
    // それまでの並びを確定する（表にない並びは、打ったキーの文字のまま出す）
    // 同時押し（docs/layouts.md の「同時押し」）：同時押しの組に入るキーを押したら、判定時間 term(ms) のあいだ待つ。
    //   その間に組のキーが全部押されれば同時押し（j+k）として並びに足す。時間が過ぎる・組のキーを離す・組に入らないキーを押す、
    //   のどれかで、待っていたキーを順に押したものとして足す。待っている間の時間切れは tick(time) で知らせる
    function converter(term) {
      let pending = "";
      let out = "";
      let wait = [];      // 同時押しかどうか待っているキー（押した順）
      let waitStart = 0;  // 待ち始めたキーを押した時刻

      function flush() {
        if (!pending) return;
        out += table.has(pending) ? table.get(pending) : pending;
        pending = "";
      }

      // 並びにキー（同時押しなら "j+k"）を1つ足す
      function feed(tok) {
        const s = pending + tok;
        if (prefixes.has(s)) {
          pending = s;
        } else {
          flush();
          if (prefixes.has(tok)) pending = tok;
          else out += tok;
        }
        // それより長い並びがなければ、すぐ確定する
        if (pending && table.has(pending) && !hasLonger(pending)) flush();
      }

      const sorted = function (keys) { return keys.slice().sort().join("+"); };
      const chordNames = new Set(chords.map(function (g) { return g.join("+"); }));
      // keys を全部含む同時押しの組があるか（larger なら keys より大きい組だけ）
      const within = function (keys, larger) {
        return chords.some(function (g) {
          return g.length >= keys.length + (larger ? 1 : 0) && keys.every(function (k) { return g.indexOf(k) !== -1; });
        });
      };

      // 待っていたキーを、同時押しの組ならまとめて、そうでなければ順に足す
      function settle() {
        if (!wait.length) return;
        const keys = wait;
        wait = [];
        if (keys.length > 1 && chordNames.has(sorted(keys))) feed(sorted(keys));
        else keys.forEach(feed);
      }

      function press(ch, time) {
        if (wait.length && time - waitStart > term) settle();
        if (wait.length) {
          const next = wait.concat([ch]);
          if (wait.indexOf(ch) === -1 && within(next, false)) {
            wait = next;
            // 組がそろい、それより大きい組もなければ、すぐ決める
            if (chordNames.has(sorted(wait)) && !within(wait, true)) settle();
            return;
          }
          settle();
        }
        if (within([ch], true)) {
          wait = [ch];
          waitStart = time;
          return;
        }
        feed(ch);
      }

      // キーを離した。待っているキーなら、そこで決める
      function release(ch) {
        if (wait.indexOf(ch) !== -1) settle();
      }

      // 待っている間に判定時間が過ぎたら決める。決めたら true
      function tick(time) {
        if (!wait.length || time - waitStart < term) return false;
        settle();
        return true;
      }

      function backspace() {
        settle();
        if (pending) pending = pending.replace(/(.\+)*.$/, "");
        else out = Array.from(out).slice(0, -1).join("");
      }

      return {
        press: press,
        release: release,
        tick: tick,
        backspace: backspace,
        // 打ちかけの並びをそこで確定する（試し打ちの Enter）
        confirm: function () { settle(); flush(); },
        clear: function () { pending = ""; out = ""; wait = []; },
        // 確定した文字と、打ちかけの並び（とそれだけで確定したときのかな）。同時押しを待っているキーは打ちかけの後ろに出す
        state: function () {
          return {
            out: out,
            pending: pending + wait.join(""),
            tentative: !wait.length && table.has(pending) ? table.get(pending) : "",
            waiting: wait.length > 0
          };
        }
      };
    }

    return {
      entries: entries,
      get: function (keys) { return table.has(keys) ? table.get(keys) : null; },
      options: options,
      shiftKeys: shiftKeys,
      chordShifts: chordShifts,
      converter: converter
    };
  }

  return { parse: parse, parseEng: parseEng, engMap: engMap, create: create, hasChord: hasChord, chordFinder: chordFinder };
})();
