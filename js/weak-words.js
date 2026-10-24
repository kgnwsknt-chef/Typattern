// 苦手な単語：単語モードの記録から、単語ごとの遅さ（文字ごとの最後の打鍵の間隔の平均）とミスの割合を求め、
// 遅い単語・ミスの多い単語を選ぶ（苦手な単語のページとタイピング画面の「苦手な単語」モードで使う）。決まりは docs/weak-words.md
const WeakWords = (function () {
  "use strict";

  const MIN_COUNT = 2;       // 候補にする単語の、打った回数の下限
  const LIST_SIZE = 30;      // 遅い単語・ミスの多い単語の一覧に出す数（練習の候補）
  const PRACTICE_WORDS = 10; // 練習で選ぶ単語の数
  const REPEAT = 5;          // 練習で1語を続けて打つ回数

  // お題 text の pos 文字目から end の手前までを1語として、その間隔とミスを entry に足す
  function addSpan(entry, start, end, intervals, missed) {
    entry.count++;
    let hit = false;
    for (let i = start; i < end; i++) {
      const v = intervals[i];
      if (v !== null && v !== undefined) {
        entry.sum += v;
        entry.n++;
      }
      if (missed(i)) hit = true;
    }
    if (hit) entry.misses++;
  }

  // お題をスペースで区切った単語ごとに fn(word, start, end) を呼ぶ
  function eachWord(text, fn) {
    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === " ") {
        if (i > start) fn(text.slice(start, i), start, i);
        start = i + 1;
      }
    }
  }

  // 1回分の生データ（単語モードの記録）の単語を map（単語 → { count, sum, n, misses }）に足す
  function add(map, raw) {
    const missed = new Set(raw.missedPositions);
    eachWord(raw.text, function (word, start, end) {
      const e = map.get(word) || { count: 0, sum: 0, n: 0, misses: 0 };
      addSpan(e, start, end, raw.intervals, function (i) { return missed.has(i); });
      map.set(word, e);
    });
  }

  // 候補の行 { word, count, slow: 遅さ(ms/文字), misses: ミスした回数, missRate }（MIN_COUNT 回以上打った単語）
  function rows(map) {
    const out = [];
    map.forEach(function (e, word) {
      if (e.count < MIN_COUNT || !e.n) return;
      out.push({ word: word, count: e.count, slow: e.sum / e.n, misses: e.misses, missRate: e.misses / e.count });
    });
    return out;
  }

  // 遅い単語：遅さの大きい順（同じなら回数の多い順）に LIST_SIZE 語
  function slowList(all) {
    return all.slice().sort(function (a, b) { return b.slow - a.slow || b.count - a.count; }).slice(0, LIST_SIZE);
  }

  // ミスの多い単語：ミスの割合の大きい順（同じならミスした回数の多い順 → 回数の多い順）に LIST_SIZE 語。ミスのない単語は入れない
  function missList(all) {
    return all.filter(function (r) { return r.misses > 0; })
      .sort(function (a, b) { return b.missRate - a.missRate || b.misses - a.misses || b.count - a.count; })
      .slice(0, LIST_SIZE);
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 練習する単語を選ぶ。kind："slow"（遅い単語）・"miss"（ミスの多い単語）・"both"（両方から半分ずつ）
  // 一覧の LIST_SIZE 語からランダムに PRACTICE_WORDS 語（足りなければあるだけ）。並びもランダム
  function choose(slow, miss, kind) {
    if (kind === "slow") return shuffle(slow).slice(0, PRACTICE_WORDS).map(function (r) { return r.word; });
    if (kind === "miss") return shuffle(miss).slice(0, PRACTICE_WORDS).map(function (r) { return r.word; });
    const half = PRACTICE_WORDS / 2;
    const picked = shuffle(slow).slice(0, half).map(function (r) { return r.word; });
    // ミスの多い単語から半分。遅い単語と重なったものは飛ばして、次の候補から選び直す
    shuffle(miss).forEach(function (r) {
      if (picked.length < half * 2 && picked.indexOf(r.word) === -1) picked.push(r.word);
    });
    return shuffle(picked);
  }

  // 選んだ単語を、それぞれ REPEAT 回続けて並べた単語の並び
  function practiceWords(words) {
    const out = [];
    words.forEach(function (w) { for (let i = 0; i < REPEAT; i++) out.push(w); });
    return out;
  }

  // 練習の結果：お題 text の単語ごと（最初に出た順）に { word, slow: 平均 IKI(ms/文字), misses: ミスした回数, count }
  //   intervals・missed は位置ごとの最後の打鍵の間隔とミスの有無（結果画面と同じもの）
  function results(text, intervals, missed) {
    const map = new Map();
    eachWord(text, function (word, start, end) {
      const e = map.get(word) || { count: 0, sum: 0, n: 0, misses: 0 };
      addSpan(e, start, end, intervals, function (i) { return !!missed[i]; });
      map.set(word, e);
    });
    return Array.from(map, function (x) {
      return { word: x[0], slow: x[1].n ? x[1].sum / x[1].n : null, misses: x[1].misses, count: x[1].count };
    });
  }

  // 苦手な単語を数える回数（設定の「苦手な単語を数える回数」。言語・配列ごとに、単語モードの記録の新しい方から）
  function recentRuns() {
    return Settings.get("weakRecentRuns");
  }

  // 記録（古い順）のうち、言語・配列ごとに新しい方から recentRuns() 回だけを残す（並びは古い順のまま）
  function recentPerGroup(sessions) {
    const n = recentRuns();
    const counts = new Map();
    return sessions.slice().reverse().filter(function (s) {
      const key = s.lang + "\t" + s.keyLayout;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts.get(key) <= n;
    }).reverse();
  }

  const BIGRAM_MIN = 5; // 言語・配列で差のある bigram：その言語・配列で比べるのに必要な出現回数

  // 言語・配列で差のある bigram。groups は "言語\t配列" → NGram.accumulate(…, 2, …) の map
  // bigram ごとに、BIGRAM_MIN 回以上出てきた言語・配列が2つ以上あれば、一番速いものを基準にして、ほかのそれぞれを1行にする
  // 行 { gram, diff, kind: "lang"・"layout"・"both", slow: { lang, layout, avg, count }, fast: 同じ形 }。差の大きい順に LIST_SIZE 行
  function bigramGaps(groups) {
    const byGram = new Map(); // bigram → [{ lang, layout, avg, count }]
    groups.forEach(function (map, key) {
      const k = key.split("\t");
      map.forEach(function (e, gram) {
        if (e.values.length < BIGRAM_MIN) return;
        const avg = e.values.reduce(function (a, b) { return a + b; }, 0) / e.values.length;
        if (!byGram.has(gram)) byGram.set(gram, []);
        byGram.get(gram).push({ lang: k[0], layout: k[1], avg: avg, count: e.values.length });
      });
    });
    const out = [];
    byGram.forEach(function (list, gram) {
      if (list.length < 2) return;
      const fast = list.reduce(function (a, b) { return b.avg < a.avg ? b : a; });
      list.forEach(function (slow) {
        if (slow === fast || slow.avg <= fast.avg) return;
        const kind = slow.layout === fast.layout ? "lang" : slow.lang === fast.lang ? "layout" : "both";
        out.push({ gram: gram, diff: slow.avg - fast.avg, kind: kind, slow: slow, fast: fast });
      });
    });
    return out.sort(function (a, b) {
      return b.diff - a.diff || b.slow.count - a.slow.count || (a.gram < b.gram ? -1 : a.gram > b.gram ? 1 : 0);
    }).slice(0, LIST_SIZE);
  }

  // 言語・配列の、直近 recentRuns() 回の単語モードの記録から候補の行を求める（Promise）
  function load(lang, keyLayout) {
    return Store.getAllSessions().then(function (sessions) {
      const ids = new Set(sessions.filter(function (s) {
        return s.mode === "words" && !s.practice && s.lang === lang && s.keyLayout === keyLayout; // 練習モードの回は使わない
      }).slice(-recentRuns()).map(function (s) { return s.id; })); // getAllSessions は古い順なので、後ろから
      const map = new Map();
      return Store.eachRaw(ids, function (raw) { add(map, raw); }).then(function () { return rows(map); });
    });
  }

  // 日本語：読み → 表示する語（漢字など）の表（Promise）。単語リスト（wordlists/ja/）と、お題のページで追加した単語リストから引く
  // 英語は空の表（単語そのものを出す）
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";
  function loadDisplays(lang) {
    const map = new Map();
    if (lang !== "ja") return Promise.resolve(map);
    const addWord = function (display, reading) { if (!map.has(reading)) map.set(reading, display); };
    const builtin = fetch("wordlists/index.json?v=" + ASSET_VERSION).then(function (r) { return r.json(); }).then(function (index) {
      return Promise.all((index.ja || []).map(function (name) {
        return fetch("wordlists/ja/" + name + ".txt?v=" + ASSET_VERSION).then(function (r) { return r.text(); }).then(function (t) {
          t.split(/\r?\n/).forEach(function (line) {
            const s = line.trim();
            if (!s || s[0] === "#") return;
            const cols = s.split("\t"); // 「表示する語<タブ>読み」。かなだけの語は1列
            addWord(cols[0].trim(), (cols[1] || cols[0]).trim());
          });
        });
      }));
    }).catch(function (err) { console.warn(err); });
    const custom = Store.getAllTexts().then(function (all) {
      all.forEach(function (x) {
        if (x.lang === "ja" && x.kind === "words") x.words.forEach(function (w) { addWord(w.display, w.reading); });
      });
    }).catch(function (err) { console.warn(err); });
    return Promise.all([builtin, custom]).then(function () { return map; });
  }

  return {
    MIN_COUNT: MIN_COUNT, LIST_SIZE: LIST_SIZE, PRACTICE_WORDS: PRACTICE_WORDS, REPEAT: REPEAT, BIGRAM_MIN: BIGRAM_MIN,
    add: add, rows: rows, slowList: slowList, missList: missList, choose: choose,
    practiceWords: practiceWords, results: results, load: load, loadDisplays: loadDisplays, recentRuns: recentRuns,
    recentPerGroup: recentPerGroup, bigramGaps: bigramGaps
  };
})();
