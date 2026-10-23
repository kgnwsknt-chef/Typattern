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

  // レベルを出す正確率の下限(%)。ランキングの基準（設定で変えられる）とは別に、95% で固定する
  const MIN_ACCURACY = 95;

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

  // 記録（概要）のレベル。練習モードの回と、正確率が MIN_ACCURACY（95%）未満なら null
  function ofSession(s) {
    if (s.practice || s.result.accuracy < MIN_ACCURACY) return null; // 練習モードの回はレベルを付けない
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

  // 言語・モードの組の達成度（記録ページの表に使う）。sessions は古い順
  //   { count: その組の記録の数, level: 達成レベル, achievedAt: そのレベルに初めて届いた日時,
  //     bestRate: 正確率95%以上の回の一番速い文字/秒, target: 次の目標, gap: 目標まであと何文字/秒 }
  function summary(sessions, lang, mode) {
    const chars = charsFor(lang);
    let count = 0;
    let level = null;
    let achievedAt = null;
    let bestRate = null;
    sessions.forEach(function (s) {
      if (s.lang !== lang || s.mode !== mode) return;
      count++;
      if (s.result.accuracy < MIN_ACCURACY) return;
      const rate = rateOfSession(s);
      if (rate !== null && (bestRate === null || rate > bestRate)) bestRate = rate;
      const l = fromRate(rate, chars);
      if (l && (!level || l.index > level.index)) {
        level = l;
        achievedAt = s.finishedAt;
      }
    });
    const target = next(level);
    const gap = target && bestRate !== null ? minRate(target, chars) - bestRate : null;
    return { count: count, level: level, achievedAt: achievedAt, bestRate: bestRate, target: target, gap: gap };
  }

  // 達成レベルが上がった回の一覧（記録の id → { lang, mode, level }）。sessions は古い順。
  // 言語・モードの組ごとに、それまでの達成レベルを初めて超えた回。短い文章は数えない
  function levelUps(sessions) {
    const best = {};
    const ups = new Map();
    sessions.forEach(function (s) {
      if (COUNTED_MODES.indexOf(s.mode) === -1) return;
      const l = ofSession(s);
      if (!l) return;
      const key = s.lang + "/" + s.mode;
      if (!best[key] || l.index > best[key].index) {
        best[key] = l;
        ups.set(s.id, { lang: s.lang, mode: s.mode, level: l });
      }
    });
    return ups;
  }

  // インジケーターの帯の長さ（0〜PACE_STEPS 段）。今のペースで基準の量（英語 400文字・日本語 280文字）を打つと
  // 何秒かかるかを求め、目標の秒数（maxSec）未満なら満タン。届かなければ、遅れ1秒ごとに1段ずつ短くする
  const PACE_STEPS = 20;

  // インジケーターの色（docs/levels.md）。帯の長さ steps で決める
  //   "ahead"  … 満タン＝目標のペースに届いている（青）
  //   "near"   … 帯の真ん中より長い（黄）
  //   "behind" … 真ん中まで、またはそれより短い（赤）
  function paceState(steps) {
    if (steps >= PACE_STEPS) return "ahead";
    return steps > PACE_STEPS / 2 ? "near" : "behind";
  }

  function paceSteps(rate, target, chars) {
    const sec = chars / rate;
    if (sec < target.maxSec) return PACE_STEPS;
    return Math.max(0, PACE_STEPS - 1 - Math.floor(sec - target.maxSec));
  }

  // 短い文章で打ったときの目標は、文章の目標を使う
  function targetMode(mode) {
    return COUNTED_MODES.indexOf(mode) === -1 ? "normal" : mode;
  }

  return {
    TABLE: TABLE,
    COUNTED_MODES: COUNTED_MODES,
    MIN_ACCURACY: MIN_ACCURACY,
    charsFor: charsFor,
    minRate: minRate,
    rateOf: rateOf,
    fromRate: fromRate,
    rateOfSession: rateOfSession,
    ofSession: ofSession,
    achieved: achieved,
    next: next,
    summary: summary,
    levelUps: levelUps,
    paceState: paceState,
    PACE_STEPS: PACE_STEPS,
    paceSteps: paceSteps,
    targetMode: targetMode
  };
})();
