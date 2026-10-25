// IKI 測定モード（練習モード）：設定の文字から意味のない短い語を作り、bigram の IKI を測る。
// 語の作り方・1回目を数えない決まり・結果の表に使う。タイピング画面（js/app.js）と、IKI のページ・苦手な単語の集計で使う。決まりは docs/iki-measurement.md
const IkiMeasurement = (function () {
  "use strict";

  const MODE = "iki-measurement";
  const WORD_COUNT = 10;   // 1回のお題の語の数
  const REPEAT = 5;        // 1語を続けて打つ回数
  const MIN_LENGTH = 3;    // 1語の文字数の下限
  const MAX_LENGTH = 6;    // 1語の文字数の上限
  const MAX_KINDS = 3;     // 1語に使う文字の種類の上限
  const MAX_RUN = 3;       // 同じ文字を続けてよい数の上限（zzz まで）
  const COUNTED_PER_WORD = REPEAT - 1; // 1語を出したとき、数える回数（1回目は数えない）

  function randomInt(n) {
    return Math.floor(Math.random() * n);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 語の末尾に c を足すと、同じ文字が MAX_RUN を超えて続くか
  function runTooLong(w, c) {
    return w.length >= MAX_RUN && w.slice(-MAX_RUN) === c.repeat(MAX_RUN);
  }

  // A：文字列から。文字を3種類（文字列が短ければその数）選び、3〜6文字の語にする（選んだ文字はどれも1回は使う）。
  // 同じ文字が4つ以上続いたら並べ直す
  function randomWord(chars) {
    const kinds = shuffle(Array.from(chars)).slice(0, Math.min(MAX_KINDS, chars.length));
    const length = Math.max(kinds.length, MIN_LENGTH + randomInt(MAX_LENGTH - MIN_LENGTH + 1));
    const letters = kinds.slice();
    while (letters.length < length) letters.push(kinds[randomInt(kinds.length)]);
    let w;
    do {
      w = shuffle(letters).join("");
    } while (Array.from(w).some(function (c, i) { return runTooLong(w.slice(0, i), c); }));
    return w;
  }

  // B：少ない bigram から。counts は bigram → 記録の中の回数（全部の言語・配列。1回目は数えない）。
  // 語ごとに、文字列でできる bigram のうち回数の一番少ないもの（同じならランダム）から始め、
  // 文字の種類が3つまでのうちで、続く bigram の回数が少ない文字を足して6文字にする。
  // 作った語の bigram は、その分（数える回数）を回数に足してから次の語を作る（同じ bigram ばかりにならないように）
  function leastWords(chars, counts) {
    const list = Array.from(chars);
    const count = new Map();
    list.forEach(function (a) {
      list.forEach(function (b) { count.set(a + b, counts.get(a + b) || 0); });
    });
    const words = [];
    let guard = 0;
    while (words.length < WORD_COUNT && guard++ < WORD_COUNT * 20) {
      // 作っている語で使った bigram の分。語の中でも同じ bigram ばかり続かないよう、使うたびに足して比べる
      const added = new Map();
      const use = function (g) { added.set(g, (added.get(g) || 0) + COUNTED_PER_WORD); };
      // 同じ回数のものからランダムに選ぶため、回数に 0.5 未満の乱数を足して比べる
      const score = function (g) { return count.get(g) + (added.get(g) || 0) + Math.random() * 0.5; };
      let seed = null;
      let best = Infinity;
      count.forEach(function (n, g) {
        const s = score(g);
        if (s < best) { best = s; seed = g; }
      });
      let w = seed;
      use(seed);
      while (w.length < MAX_LENGTH) {
        const kinds = new Set(w);
        const last = w[w.length - 1];
        let next = null;
        let nextScore = Infinity;
        list.forEach(function (c) {
          if (!kinds.has(c) && kinds.size >= MAX_KINDS) return;
          if (runTooLong(w, c)) return;
          const s = score(last + c);
          if (s < nextScore) { nextScore = s; next = c; }
        });
        use(last + next);
        w += next;
      }
      if (words.indexOf(w) !== -1) continue; // 同じ語が続くと、5回ずつのまとまりが分からなくなるので作り直す
      words.push(w);
      added.forEach(function (n, g) { count.set(g, count.get(g) + n); });
    }
    return words;
  }

  // お題の語（10語）。pick は設定の「語の作り方」（"least" / "random"）
  function chooseWords(chars, pick, counts) {
    if (pick === "least") return leastWords(chars, counts);
    const words = [];
    let guard = 0;
    while (words.length < WORD_COUNT && guard++ < WORD_COUNT * 20) {
      const w = randomWord(chars);
      if (words.indexOf(w) === -1) words.push(w);
    }
    return words;
  }

  // お題の文字列：語を5回ずつ続けて、スペースでつなぐ
  function textOf(words) {
    const all = [];
    words.forEach(function (w) {
      for (let i = 0; i < REPEAT; i++) all.push(w);
    });
    return all.join(" ");
  }

  // お題を語ごとに分けた並び [{ word, start, rep }]（rep は同じ語の何回目か。0 が1回目）
  function spansOf(text) {
    const spans = [];
    let start = 0;
    let prev = null;
    let rep = 0;
    text.split(" ").forEach(function (w) {
      rep = w === prev ? rep + 1 : 0;
      prev = w;
      spans.push({ word: w, start: start, rep: rep });
      start += w.length + 1;
    });
    return spans;
  }

  // 1回目に打った文字の位置の集まり（IKI の集計で数えない。NGram.accumulate に渡す）
  function firstRepPositions(text) {
    const skip = new Set();
    spansOf(text).forEach(function (s) {
      if (s.rep !== 0) return;
      for (let i = 0; i < s.word.length; i++) skip.add(s.start + i);
    });
    return skip;
  }

  // その記録で数えない位置（IKI 測定モードの回だけ。ほかのモードは null）
  function skipOf(session, raw) {
    return session && session.mode === MODE ? firstRepPositions(raw.text) : null;
  }

  // 結果の表の行：語ごとに、1〜5回目の IKI（語の中の2文字目からの、最後の打鍵の間隔の平均）と、ミスのあった回数。
  // intervals・missed は位置ごとの間隔と、一度でもミスしたか（js/app.js と同じ）
  function results(text, intervals, missed) {
    const rows = [];
    spansOf(text).forEach(function (s) {
      if (s.rep === 0) rows.push({ word: s.word, reps: [], misses: 0, counted: [] });
      const row = rows[rows.length - 1];
      const values = [];
      let miss = false;
      for (let i = s.start; i < s.start + s.word.length; i++) {
        if (missed[i]) miss = true;
        if (i > s.start && intervals[i] !== null && intervals[i] !== undefined) values.push(intervals[i]);
      }
      const avg = values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : null;
      row.reps.push(avg);
      if (miss) row.misses++;
      if (s.rep > 0 && avg !== null) row.counted.push(avg);
    });
    rows.forEach(function (r) {
      r.avg = r.counted.length ? r.counted.reduce(function (a, b) { return a + b; }, 0) / r.counted.length : null;
    });
    return rows;
  }

  return {
    MODE: MODE, REPEAT: REPEAT,
    chooseWords: chooseWords, textOf: textOf, firstRepPositions: firstRepPositions, skipOf: skipOf, results: results
  };
})();
