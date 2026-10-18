// 習熟度のレベル（43段階）。決まりは docs/levels.md
// レベルは、決まった量（英語 400文字・日本語 280文字（かな））を打つ秒数（基準の秒数）で区切る。その秒数を
// 「1秒あたりの文字数（文字/秒）」に直して基準にし、その回の文字/秒と比べる。
const Levels = (function () {
  "use strict";

  // 4つのまとまり（Amateur 206〜76秒、Professional 76〜56秒、Genius 56〜36秒、Machine 36秒〜）を、
  // まとまりの中で均等に区切ったもの。[名前, 秒数の上限（この秒数より速ければこのレベル）, まとまり]。遅い順
  const TABLE = (function () {
    const rows = [];
    "JIHGFEDCBA".split("").forEach(function (n, i) { rows.push([n, 206 - 13 * i, "Amateur"]); });
    ["SJ", "SI", "SH", "SG", "SF", "SE", "SD", "SC", "SB", "SA"].forEach(function (n, i) { rows.push([n, 76 - 2 * i, "Professional"]); });
    ["SS", "XJ", "XI", "XH", "XG", "XF", "XE", "XD", "XC", "XB"].forEach(function (n, i) { rows.push([n, 56 - 2 * i, "Genius"]); });
    // Machine は2秒ごとに ZA まで続け、ZA より速くても ZA とする
    ["XA", "XS", "XX", "ZJ", "ZI", "ZH", "ZG", "ZF", "ZE", "ZD", "ZC", "ZB", "ZA"].forEach(function (n, i) { rows.push([n, 36 - 2 * i, "Machine"]); });
    return rows.map(function (r, i) { return { name: r[0], maxSec: r[1], category: r[2], index: i }; });
  })();

  // 達成レベルに数えるモード（短い文章は短くて速く出やすいので数えない。その回のレベルは出す）
  const COUNTED_MODES = ["normal", "words"];

  // 基準の量（1回分の文字数）。英語は 400文字、日本語は 280文字（かな。配列によらない）
  function charsFor(lang) {
    return lang === "ja" ? 280 : 400;
  }

  // そのレベルになる文字/秒の下限（これより速ければそのレベル以上）
  function minRate(level, chars) {
    return chars / level.maxSec;
  }

  // その回の文字/秒 ＝ (お題の文字数 − 1) ÷ 経過秒数。ミスや Backspace の時間も含む。
  // 英語は 1000 ÷ 平均 IKI と同じ。日本語の文字数はかなの数
  function rateOf(textLength, timeSec) {
    if (textLength < 2 || !(timeSec > 0)) return null;
    return (textLength - 1) / timeSec;
  }

  // 文字/秒からレベルを求める。J より遅い（206秒以上に当たる）・求められないときは null
  function fromRate(rate, chars) {
    if (rate === null || !(rate > 0)) return null;
    let hit = null;
    TABLE.forEach(function (l) { if (rate > minRate(l, chars)) hit = l; });
    return hit;
  }

  // 記録（概要）の文字/秒
  function rateOfSession(s) {
    return rateOf(s.textLength, s.result.timeSec);
  }

  // 記録（概要）のレベル。正確率がランキングの基準（95%）未満なら null
  function ofSession(s) {
    if (s.result.accuracy < Store.RANK_MIN_ACCURACY) return null;
    return fromRate(rateOfSession(s), charsFor(s.lang));
  }

  // 達成レベル：その言語・モードの記録のうち、一番よいレベル（なければ null）。短い文章は数えない
  function achieved(sessions, lang, mode) {
    if (COUNTED_MODES.indexOf(mode) === -1) return null;
    let best = null;
    sessions.forEach(function (s) {
      if (s.lang !== lang || s.mode !== mode) return;
      const l = ofSession(s);
      if (l && (!best || l.index > best.index)) best = l;
    });
    return best;
  }

  // 目標：達成レベルの1つ上（達成がなければ J。一番上の ZA を達成していれば null）
  function next(level) {
    if (!level) return TABLE[0];
    return TABLE[level.index + 1] || null;
  }

  // 短い文章で打ったときの目標は、文章の目標を使う
  function targetMode(mode) {
    return COUNTED_MODES.indexOf(mode) === -1 ? "normal" : mode;
  }

  return {
    TABLE: TABLE,
    COUNTED_MODES: COUNTED_MODES,
    charsFor: charsFor,
    minRate: minRate,
    rateOf: rateOf,
    fromRate: fromRate,
    rateOfSession: rateOfSession,
    ofSession: ofSession,
    achieved: achieved,
    next: next,
    targetMode: targetMode
  };
})();
