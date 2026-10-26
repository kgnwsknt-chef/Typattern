// キーごとの指の割り当て（ふつうのタッチタイピング）と、それを使った bigram・trigram の分類。
// IKI のページ（js/ngram-page.js）で使う。決まりは docs/analysis_iki.md の「指と段で分けた bigram・trigram」
const FingerMap = (function () {
  "use strict";

  // 分ける範囲は上段・ホーム段・下段の英字と記号のキーだけ（数字の段・スペースなどは分類しない）
  // 指の番号：1 人差し指、2 中指、3 薬指、4 小指（内側から外側へ）。段：1 上段、2 ホーム段、3 下段（奥から手前へ）
  const ROWS = ["qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
  const FINGERS = {
    L: { 4: "qaz", 3: "wsx", 2: "edc", 1: "rtfgvb" },
    R: { 1: "yuhjnm", 2: "ik,", 3: "ol.", 4: "p[]\\;'/" }
  };
  const CENTER = "tgbyhn";  // 人差し指が中央に伸ばす列
  const OUTER = "[]\\'";     // 小指が外側に伸ばす列（左手の外側の列は数字の段だけなので、3段にはない）
  const FINGER_NAME = { 1: "人差し指", 2: "中指", 3: "薬指", 4: "小指" };

  const info = {};
  ROWS.forEach(function (row, r) {
    Array.from(row).forEach(function (ch) { info[ch] = { row: r + 1 }; });
  });
  ["L", "R"].forEach(function (hand) {
    Object.keys(FINGERS[hand]).forEach(function (f) {
      Array.from(FINGERS[hand][f]).forEach(function (ch) {
        info[ch].hand = hand;
        info[ch].finger = Number(f);
      });
    });
  });

  // キー（QWERTY の文字）の { hand, finger, row }。分けないキーは null
  function keyOf(ch) {
    return info[ch] || null;
  }

  // 隣の指の組で、短い方の指（scissors の決まり）。人差し指・中指は人差し指、中指・薬指は薬指、薬指・小指は小指
  function shorterOf(a, b) {
    const lo = Math.min(a.finger, b.finger), hi = Math.max(a.finger, b.finger);
    if (lo === 1) return a.finger === 1 ? a : b;
    return a.finger === hi ? a : b;
  }

  // bigram の分類（どれか1つ）："none" 分類しない／"alternation" 左右交互／"repeat" 同じキーの連打／
  // "sfb-0"・"sfb-1"・"sfb-2" SFB（段の差）／"roll-in"・"roll-out" ロール（同じ手・別の指。小指 → 人差し指の向きが内向き）
  function bigramBase(g) {
    const a = keyOf(g[0]), b = keyOf(g[1]);
    if (!a || !b) return "none";
    if (g[0] === g[1]) return "repeat";
    if (a.hand !== b.hand) return "alternation";
    if (a.finger === b.finger) return "sfb-" + Math.abs(a.row - b.row);
    return a.finger > b.finger ? "roll-in" : "roll-out";
  }

  // bigram の特徴（重なってよい。同じ手・別の指の組だけ）。返り値は特徴の名前の並び
  //   "stagger-inner-ab"・"stagger-outer-ab"：段違い（内側の指が奥／外側の指が奥。ab は指の組 例 "12" 人差し指と中指）
  //   "hsb"・"fsb"：scissors（隣の指で、短い方の指が奥。1段・2段離れる）
  //   "lsb-12"・"lsb-34"：LSB（人差し指が中央の列で中指と／小指が外側の列で薬指と）
  function bigramFeatures(g) {
    const a = keyOf(g[0]), b = keyOf(g[1]);
    if (!a || !b || a.hand !== b.hand || a.finger === b.finger) return [];
    const out = [];
    const inner = a.finger < b.finger ? a : b, outer = inner === a ? b : a;
    const pair = String(inner.finger) + outer.finger;
    if (a.row !== b.row) {
      out.push((inner.row < outer.row ? "stagger-inner-" : "stagger-outer-") + pair);
      if (outer.finger - inner.finger === 1) {
        const shorter = shorterOf(a, b), longer = shorter === a ? b : a;
        if (shorter.row < longer.row) out.push(Math.abs(a.row - b.row) === 1 ? "hsb" : "fsb");
      }
    }
    const chOf = function (k) { return k === a ? g[0] : g[1]; };
    if (pair === "12" && CENTER.indexOf(chOf(inner)) !== -1) out.push("lsb-12");
    if (pair === "34" && OUTER.indexOf(chOf(outer)) !== -1) out.push("lsb-34");
    return out;
  }

  // trigram の分類（どれか1つ）："none" 分類しない／"alternate"・"alternate-sf"・"alternate-sk" 交互（1・3キー目が同じ指・同じキー）／
  // "roll-in"・"roll-out" ロール（同じ手の別の指の2キー ＋ もう片方の手の1キー）／"onehand-in"・"onehand-out" 一方向／
  // "redirect"・"redirect-noindex" 向きが変わる（人差し指を含まない）／"other" その他
  function trigramBase(g) {
    const k = [keyOf(g[0]), keyOf(g[1]), keyOf(g[2])];
    if (!k[0] || !k[1] || !k[2]) return "none";
    if (k[0].hand !== k[1].hand && k[1].hand !== k[2].hand) {
      if (g[0] === g[2]) return "alternate-sk";
      return k[0].finger === k[2].finger ? "alternate-sf" : "alternate";
    }
    if (k[0].hand === k[1].hand && k[1].hand === k[2].hand) {
      const f = [k[0].finger, k[1].finger, k[2].finger];
      if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) return "other";
      if (f[0] > f[1] && f[1] > f[2]) return "onehand-in";
      if (f[0] < f[1] && f[1] < f[2]) return "onehand-out";
      return f.indexOf(1) === -1 ? "redirect-noindex" : "redirect";
    }
    // 2キーが同じ手、1キーがもう片方の手
    const p = k[0].hand === k[1].hand ? [k[0], k[1]] : [k[1], k[2]];
    if (p[0].finger === p[1].finger) return "other";
    return p[0].finger > p[1].finger ? "roll-in" : "roll-out";
  }

  // trigram の特徴：SFS（1・3キー目が同じ指。間のキーは問わない）。"sfs" 別のキー／"sfs-same" 同じキー。なければ null
  function trigramSfs(g) {
    const a = keyOf(g[0]), c = keyOf(g[2]);
    if (!a || !c || !keyOf(g[1]) || a.hand !== c.hand || a.finger !== c.finger) return null;
    return g[0] === g[2] ? "sfs-same" : "sfs";
  }

  return {
    FINGER_NAME: FINGER_NAME, keyOf: keyOf,
    bigramBase: bigramBase, bigramFeatures: bigramFeatures, trigramBase: trigramBase, trigramSfs: trigramSfs
  };
})();
