// ミスタイプの分析（mistype.html で使う）。生データの events から、押したキーごとの正誤と打つべきだったキーを求め、
// 続けて起きたミスの最初だけを押し間違いとして数え、種類に分ける。決まりは docs/analysis_mistype.md
const Mistype = (function () {
  "use strict";

  // 種類（表に出す順）
  const TYPES = [
    { id: "transpose", name: "順番の入れ替え" },
    { id: "omit", name: "抜け" },
    { id: "extra", name: "重ね打ち・余分な1打" },
    { id: "shiftCase", name: "Shift の違い" },
    { id: "prefixForget", name: "前置シフト忘れ" },
    { id: "postfixForget", name: "後置シフト忘れ" },
    { id: "shiftExtra", name: "余計なシフト" },
    { id: "shiftWrong", name: "シフトの取り違え" },
    { id: "adjacent", name: "隣のキー" },
    { id: "mirror", name: "左右の取り違え" },
    { id: "other", name: "その他" },
    { id: "unknown", name: "打つべきキーが分からない" }
  ];
  const TYPE_NAME = {};
  TYPES.forEach(function (t) { TYPE_NAME[t.id] = t.name; });

  // ---- キーの位置（隣のキー・左右の取り違えの判定に使う） ----

  // 物理キーの番号 → キーの中心 { x, y }（キー1個分 = 1）。ロースタッガードの US 配列で求める
  const CENTER = {};
  KeyboardShapes.layout("us-row-stagger").keys.forEach(function (k) {
    const n = Keys.number(k.code);
    if (n && !(n in CENTER)) CENTER[n] = { x: k.x + k.w / 2, y: k.y };
  });

  // 隣のキー：同じ段の左右、または上下の段のすぐ近く（スペースの段は除く）
  function adjacent(a, b) {
    const p = CENTER[a], q = CENTER[b];
    if (!p || !q || a === b || p.y > 3 || q.y > 3) return false;
    const dy = Math.abs(p.y - q.y), dx = Math.abs(p.x - q.x);
    return (dy === 0 && dx <= 1.01) || (dy === 1 && dx <= 1.3);
  }

  // 左右の取り違え：反対の手の同じ指のキー（数字・Q・A・Z の段の、左から1〜10番目の列を左右で入れ替えたもの。q ↔ p、f ↔ j など）
  function mirror(a, b) {
    const ra = a[0], ca = parseInt(a[1], 16);
    if (ra > "3" || !(ca >= 1 && ca <= 10)) return false;
    return b === ra + (11 - ca).toString(16);
  }

  // ---- 1回分の記録を、押したキーの並びにする ----

  // 押したキー1つ { number, shift, ok, bs, expected: { number, shift } か null, keys: 正解だったキーの番号の一覧,
  //   next: 手引きの打ち方でその次に押すキーの文字, pos, time, interval: 直前のキー（Backspace を含む、Shift は除く）からの間隔 }
  //   lang：記録の言語、optionsFn：日本語の打ち方の一覧（ローマ字か、かな配列）
  //   返り値は並び。日本語で判定を再現できないときは null
  //   eng：英語の配列の記録のとき、その配列の KanaLayout.engMap。打つべき文字を割り当て表で逆に引いてキーにする
  function strokesOf(raw, lang, optionsFn, eng) {
    const list = [];
    // 打つべき文字 → そのキーの QWERTY の文字（英語の配列なら割り当て表で逆に引く。出せない文字は null）
    const keyChar = function (c) { return c === null || !eng ? c : eng.toKey(c); };
    let prevTime = null;
    function push(e, s) {
      s.time = e[0];
      s.interval = prevTime === null ? null : e[0] - prevTime;
      prevTime = e[0];
      list.push(s);
    }
    if (lang !== "ja") {
      const shiftDown = new Set();
      const hasUp = raw.events.some(function (e) { return e[1] === "u"; });
      raw.events.forEach(function (e) {
        if (e[1] === "u") { shiftDown.delete(e[2]); return; }
        if (e[1] !== "k") return;
        if (Keys.isShiftNumber(e[2])) { shiftDown.add(e[2]); return; }
        if (e[2] === Keys.BACKSPACE) { push(e, { number: e[2], bs: true }); return; }
        const pos = e[3];
        const want = pos < raw.text.length ? keyChar(raw.text[pos]) : null;
        const exp = want === null ? null : Keys.ofChar(want);
        push(e, {
          number: e[2], shift: shiftDown.size > 0, ok: e[4] === 1, pos: pos,
          expected: exp, keys: exp ? [exp.number] : [],
          next: pos + 1 < raw.text.length ? keyChar(raw.text[pos + 1]) : null
        });
        if (!hasUp) shiftDown.clear();
      });
      return list;
    }
    if (!optionsFn) return null;
    const units = SessionView.replay(raw, optionsFn, function (e, before, r, shiftOn) {
      if (!before) { push(e, { number: e[2], bs: true }); return; }
      // 判定が示すのはその配列で打つ文字（英語の配列なら割り当て表で逆に引いてキーにする）
      const preferred = keyChar(before.preferred);
      const exp = preferred === null ? null : Keys.ofChar(preferred);
      push(e, {
        number: e[2], shift: shiftOn, ok: r.judge === 1, pos: r.pos,
        expected: exp,
        keys: before.keys.map(function (c) { const k = Keys.ofChar(keyChar(c)); return k ? k.number : null; }),
        next: keyChar(before.next),
        mid: before.pending !== "" // 今のかなを打ちかけていたか
      });
    }, eng);
    return units ? list : null;
  }

  // 続けて起きたミスのまとまりの最初に first を付ける（正しい打鍵か Backspace でまとまりが終わる）
  function markFirst(list) {
    let inRun = false;
    list.forEach(function (s) {
      if (s.bs || s.ok) { inRun = false; return; }
      s.first = !inRun;
      inRun = true;
    });
  }

  // ---- 種類分け ----

  function charOf(s) {
    return Keys.charOf(s.number, s.shift);
  }

  // i 番目の押したキーの後に続く、Backspace でない押したキー（なければ null）
  function after(list, i, k) {
    let n = 0;
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].bs) return null; // Backspace で直したら、続きの手がかりにしない
      if (++n === k) return list[j];
    }
    return null;
  }

  // 最初のミス list[i] の種類。ctx { lang, text, shifts: かな配列のシフトのキー { prefix, postfix }（文字）か null }
  function classify(list, i, ctx) {
    const s = list[i];
    if (!s.expected) return "unknown";
    const pressed = charOf(s);
    const n1 = after(list, i, 1);
    const n1c = n1 ? charOf(n1) : null;
    const prev = i > 0 && !list[i - 1].bs ? list[i - 1] : null;

    if (ctx.shifts) {
      // かな配列の前置・後置シフト
      // シフトのキーは、ふつうのかなのキーを兼ねることが多い（月見草などの e・f・s・j）。そのため、
      // 押した位置（かなの始まりか、打ちかけの後か）と続くキーから、シフトとして押した・押すべきだったと言えるときだけシフトの種類にする
      const expChar = Keys.charOf(s.expected.number, s.expected.shift);
      const prefix = function (c) { return ctx.shifts.prefix.indexOf(c) !== -1; };
      const postfix = function (c) { return ctx.shifts.postfix.indexOf(c) !== -1; };
      // 前置シフト忘れ：かなの始まりで前置シフトを押すべきところ、シフトの次に押すキーを押した
      if (!s.mid && prefix(expChar) && pressed === s.next) return "prefixForget";
      // 後置シフト忘れ：打ちかけの後に後置シフトを押すべきところ、押さずに次のかなの始まりのキーを押した
      if (s.mid && postfix(expChar) && pressed === s.next) return "postfixForget";
      // シフトの取り違え：シフトを押すべきところ（かなの始まりの前置、打ちかけの後の後置）で、別のシフトのキーを押した
      if (!s.mid && prefix(expChar) && prefix(pressed)) return "shiftWrong";
      if (s.mid && postfix(expChar) && postfix(pressed)) return "shiftWrong";
      // 余計なシフト：シフトのキーを1つ余分に押し、次に打つべきキーを押した（かなの始まりの前置、打ちかけの後の後置）
      if (n1c === expChar && ((!s.mid && prefix(pressed)) || (s.mid && postfix(pressed)))) return "shiftExtra";
    }
    if (ctx.lang === "ja") {
      if (s.next && pressed === s.next && n1c === Keys.charOf(s.expected.number, s.expected.shift)) return "transpose";
    } else {
      const t = ctx.text, p = s.pos;
      if (pressed === t[p + 1] && n1c === t[p]) return "transpose";
      if (pressed === t[p + 1] && (p + 2 >= t.length || n1c === t[p + 2])) return "omit";
      if ((prev && prev.number === s.number && prev.shift === s.shift) || n1c === t[p]) return "extra";
      if (s.number === s.expected.number && s.shift !== s.expected.shift) return "shiftCase";
    }
    if (adjacent(s.expected.number, s.number)) return "adjacent";
    if (mirror(s.expected.number, s.number)) return "mirror";
    return "other";
  }

  // ---- 集計 ----

  // 新しい集計の入れ物
  function create() {
    return {
      keys: {},   // 物理キーの番号 → { strokes: 押した回数, attempts: 打つべきキーだった回数, misses: 最初のミスの数 }
      pairs: new Map(), // "打つべきキー>押したキー" → { expected, pressed, count, types: { 種類: 回数 } }
      types: {},  // 種類 → 回数
      strokes: 0, // 押したキーの数（Shift・Backspace・ミスも含む。IKI のページの総打鍵数と同じ）
      misses: 0,  // ミスの打鍵の数（続けて起きたものも全部）
      firsts: 0,  // 最初のミスの数（押し間違いとして数えたもの）
      skipped: 0, // 判定を再現できず、数えなかった記録の数（かな配列を削除したなど）
      bigrams: new Map(), // "直前に正しく押したキー＋打つべきキー"（QWERTY の文字2つ）→ { count: 打とうとした回数, misses: 押し間違い }
      intervals: { miss: [], normal: [] } // 押し間違いの直前の間隔・正しい打鍵の間隔(ms)
    };
  }

  // ミスが起きやすい並びに使えるキー：スペース・Backspace・Shift と同時に押したキーは除く（IKI のページと同じ）
  function bigramLabel(number, shift) {
    if (shift || number === Keys.SPACE || number === Keys.BACKSPACE) return null;
    return Keys.label(number);
  }

  // ミスが起きやすい並びと、ミスの直前の間隔を足す。list[i] は正しい打鍵か最初のミス
  //   並び：直前のキーが正しい打鍵のときだけ（直前がミスや Backspace だと、何をしようとしていたか決めにくいため）
  //   間隔：押し間違いは直前が Backspace でないもの、正しい打鍵は直前も正しい打鍵のもの
  function addContext(acc, list, i) {
    const s = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    const prevOk = prev && !prev.bs && prev.ok;
    if (s.interval !== null && prev && !prev.bs && (s.ok ? prevOk : true)) acc.intervals[s.ok ? "normal" : "miss"].push(s.interval);
    if (!prevOk) return;
    const target = s.ok ? { number: s.number, shift: s.shift } : s.expected;
    if (!target) return;
    const a = bigramLabel(prev.number, prev.shift), b = bigramLabel(target.number, target.shift);
    if (a === null || b === null) return;
    const e = acc.bigrams.get(a + b) || { count: 0, misses: 0 };
    e.count++;
    if (!s.ok) e.misses++;
    acc.bigrams.set(a + b, e);
  }

  // 並びの集計を表・2次元ヒストグラムの行 { gram, count, misses, rate } にする
  function bigramRows(acc) {
    return Array.from(acc.bigrams, function (x) {
      return { gram: x[0], count: x[1].count, misses: x[1].misses, rate: x[1].misses / x[1].count };
    });
  }

  // 中央値（空なら null）
  function median(values) {
    if (!values.length) return null;
    const v = values.slice().sort(function (a, b) { return a - b; });
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function keyStat(acc, number) {
    return acc.keys[number] || (acc.keys[number] = { strokes: 0, attempts: 0, misses: 0, runs: new Map() });
  }

  // キーのミス率を、記録（回）ごとにも数える（ミス率の推移に使う）。runs：回 → { attempts, misses, tag }
  function countAttempt(acc, number, miss, tag) {
    const st = keyStat(acc, number);
    st.attempts++;
    if (miss) st.misses++;
    if (!tag) return;
    const r = st.runs.get(tag.run) || { attempts: 0, misses: 0, tag: tag };
    r.attempts++;
    if (miss) r.misses++;
    st.runs.set(tag.run, r);
  }

  // 1回分の記録を足す。optionsFn は日本語の打ち方の一覧（なければ null）、shifts はかな配列のシフトのキー（なければ null）
  //   tag：その記録の印 { run, day, at }（js/point-trend.js の tagsOf。ミス率の推移に使う。なければ推移は数えない）
  //   eng：英語の配列の記録のとき、その配列の KanaLayout.engMap（英語・日本語のローマ字とも）
  function add(acc, raw, lang, optionsFn, shifts, tag, eng) {
    raw.events.forEach(function (e) {
      if (e[1] !== "k") return;
      acc.strokes++;
      keyStat(acc, e[2]).strokes++;
    });
    const list = strokesOf(raw, lang, optionsFn, eng);
    if (!list) { acc.skipped++; return; }
    markFirst(list);
    const ctx = { lang: lang, text: raw.text, shifts: shifts };
    list.forEach(function (s, i) {
      if (s.bs) return;
      if (s.ok) {
        countAttempt(acc, s.number, false, tag);
        addContext(acc, list, i);
        return;
      }
      acc.misses++;
      if (!s.first) return;
      acc.firsts++;
      addContext(acc, list, i);
      const type = classify(list, i, ctx);
      acc.types[type] = (acc.types[type] || 0) + 1;
      if (!s.expected) return;
      countAttempt(acc, s.expected.number, true, tag);
      const id = s.expected.number + (s.expected.shift ? "S" : "") + ">" + s.number + (s.shift ? "S" : "");
      const pair = acc.pairs.get(id) || { expected: s.expected, pressed: { number: s.number, shift: s.shift }, count: 0, types: {} };
      pair.count++;
      pair.types[type] = (pair.types[type] || 0) + 1;
      acc.pairs.set(id, pair);
    });
  }

  // キーの表示名（QWERTY の文字。Shift ありは Shift で出る文字）
  function keyName(k) {
    if (k.number === Keys.SPACE) return "Space";
    if (k.number === Keys.BACKSPACE) return "Back";
    if (Keys.isShiftNumber(k.number)) return "Shift";
    const c = Keys.charOf(k.number, k.shift);
    return c === null ? "（" + k.number + "）" : c;
  }

  return {
    TYPES: TYPES, TYPE_NAME: TYPE_NAME,
    create: create, add: add, keyName: keyName, bigramRows: bigramRows, median: median,
    // 確かめ用
    adjacent: adjacent, mirror: mirror
  };
})();
