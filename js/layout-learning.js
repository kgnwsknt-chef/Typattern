// キー配列習得（新しいかな配列の割り当てを覚える練習モード）の処理。決まりは docs/layout-learning.md
// 単位の一覧・学習区画・覚えたかどうか・次に覚える単位・お題の言葉の選び方・達成項目を求める
// （タイピング画面 js/app.js と、キー配列習得のページ js/layout-learning-page.js で使う）
const LayoutLearning = (function () {
  "use strict";

  const MODE = "layout-learning";
  const BASIC30 = Array.from("いんうのかたとし、くにてるはなこがっき。ですつあらまをさりも");
  const FIRST8 = BASIC30.slice(0, 8);
  // 覚える対象にしない単位（docs/layout-learning.md の「覚える単位」）
  const EXCLUDED = ["ぢゃ", "ぢゅ", "ぢょ", "ゎ"];
  // 割り当て表に1行としてあれば1つの単位にする組
  const PAIRS = (function () {
    const out = [];
    Array.from("きしちにひみりぎじぢびぴ").forEach(function (k) { Array.from("ゃゅょ").forEach(function (s) { out.push(k + s); }); });
    return out.concat(["ふぁ", "ふぃ", "ふぇ", "ふぉ", "てぃ", "でぃ", "うぃ", "うぇ", "うぉ", "しぇ", "じぇ", "ちぇ"]);
  })();
  const FOREIGN = PAIRS.slice(36);
  const MIN_RECENT = 20;     // 覚えたかどうかを判定する、出てきた回数の下限
  const LEARNED_ACC = 95;    // 覚えたとする正確率（%）
  const FORGET_ACC = 85;     // 覚えた単位を、忘れたとする正確率（%。これ未満で忘れた。覚えるときより低くして、たまたまの間違いでは忘れないようにする）
  const NEW_COUNT = 2;       // いつも足しておく新しい単位の数
  const NEW_WORDS = 20;      // 新しい単位1つごとの言葉の数
  const TARGET_LENGTH = 300; // 1回のお題の長さ（読みの文字数。スペースを含む）
  const MAX_REPEAT = 3;      // 言葉が足りないときに、同じ言葉を出してよい回数（単語リスト D の単位は制限なし）
  const LISTS = ["a", "b", "c", "d"];
  const SHIFT_MIN = 5; // かな配列のシフトのキーの求め方（キー配列のページと同じ）

  function isKana(ch) { return /^[ぁ-ゖー、。]$/.test(ch); }

  // ---- 単語リスト ----

  // 単語リスト A〜D を読む。返り値 { words: [{ display, reading, list }], dUnits: Set（単語リスト D の見出しの単位）}
  function loadLists(fetchText) {
    return Promise.all(LISTS.map(function (x) {
      return fetchText("wordlists/layout-learning/ja-words-" + x + ".txt").then(function (t) { return { list: x, text: t }; });
    })).then(function (loaded) {
      const words = [];
      const dUnits = new Set();
      loaded.forEach(function (f) {
        f.text.split(/\r?\n/).forEach(function (line) {
          line = line.trim();
          if (!line) return;
          if (line[0] === "#") {
            // 単語リスト D の見出し（「# にゃ」など）は、その単位が D の単位であることを示す
            const m = /^#\s+([^\s（]+)(（.*）)?$/.exec(line);
            if (f.list === "d" && m && !/^-/.test(m[1])) dUnits.add(m[1]);
            return;
          }
          const cols = line.split("\t");
          words.push({ display: cols[0].trim(), reading: (cols[1] || cols[0]).trim(), list: f.list });
        });
      });
      return { words: words, dUnits: dUnits };
    });
  }

  // ---- 配列の単位と学習区画 ----

  // かな配列の割り当て表（[キーの並び, かな] の並び）から、その配列の覚え方の情報を作る
  //   units：単位の一覧（割り当て表の順）、keyOf：単位 → それを打つ一番短いキーの並び、areas：学習区画の並び
  function plan(entries) {
    const keyOf = new Map();
    entries.forEach(function (e) {
      const kana = e[1];
      const ok = (kana.length === 1 && isKana(kana)) || PAIRS.indexOf(kana) !== -1;
      if (!ok || EXCLUDED.indexOf(kana) !== -1) return;
      if (!keyOf.has(kana) || e[0].length < keyOf.get(kana).length) keyOf.set(kana, e[0]);
    });
    const units = Array.from(keyOf.keys());
    const unitSet = new Set(units);
    const shifts = KanaLayout.create(entries).shiftKeys(SHIFT_MIN);
    const shiftKeys = shifts.prefix.concat(shifts.postfix.filter(function (k) { return shifts.prefix.indexOf(k) === -1; }));

    // 単位のある面（シフトキー。シフトなしは ""）と、行（数字キーの行 0・上の行 1・ホーム行 2・下の行 3）
    function place(unit) {
      const seq = keyOf.get(unit);
      let shift = "";
      let base = seq[0];
      if (seq.length >= 2) {
        if (shiftKeys.indexOf(seq[0]) !== -1 && shifts.prefix.indexOf(seq[0]) !== -1) { shift = seq[0]; base = seq[1]; }
        else if (shifts.postfix.indexOf(seq[1]) !== -1) { shift = seq[1]; base = seq[0]; }
      }
      // Shift と押す文字（大文字・記号）は、Shift のシフト面とする
      const k = Keys.ofChar(base);
      if (!shift && k && k.shift) shift = "Shift";
      const number = k ? k.number : null;
      return { shift: shift, row: number ? Number(number[0]) : 9 };
    }

    const ROWS = [[2, "ホーム行"], [1, "上の行"], [3, "下の行"], [0, "数字キーの行"]];
    const byFace = new Map();
    units.forEach(function (u) {
      const p = place(u);
      if (!byFace.has(p.shift)) byFace.set(p.shift, []);
      byFace.get(p.shift).push({ unit: u, row: p.row });
    });
    const faces = Array.from(byFace.keys()).filter(function (s) { return s; })
      .sort(function (a, b) { return byFace.get(b).length - byFace.get(a).length; });
    const areas = [];
    function addRows(list, face, faceName) {
      ROWS.forEach(function (r) {
        const us = list.filter(function (x) { return x.row === r[0]; }).map(function (x) { return x.unit; });
        if (us.length) areas.push({ name: faceName + "・" + r[1], face: face, units: us });
      });
      const rest = list.filter(function (x) { return ROWS.every(function (r) { return r[0] !== x.row; }); }).map(function (x) { return x.unit; });
      if (rest.length) areas.push({ name: faceName + "・そのほか", face: face, units: rest });
    }
    addRows(byFace.get("") || [], "", "シフトなしの面");
    if (faces.length === 1) {
      // シフトキーが1つの配列（2-2B）：シフト面を行ごとに分ける
      addRows(byFace.get(faces[0]), faces[0], "シフト面");
    } else {
      // シフトキーが複数ある配列（2-2A）：シフトキーごとに1つの学習区画
      faces.forEach(function (s, i) {
        areas.push({ name: "シフト面" + (i + 1) + "（" + s + "）", face: s, units: byFace.get(s).map(function (x) { return x.unit; }) });
      });
    }
    return { units: units, unitSet: unitSet, keyOf: keyOf, areas: areas, faces: faces };
  }

  // 読みを単位に分ける（割り当て表に組の行があれば組、なければ1文字ずつ）。返り値 [{ unit, pos, len }]。
  // 配列の単位にない文字（スペースなど）は unit を null にする
  function segment(reading, unitSet) {
    const out = [];
    for (let i = 0; i < reading.length;) {
      const two = reading.substr(i, 2);
      if (two.length === 2 && unitSet.has(two)) { out.push({ unit: two, pos: i, len: 2 }); i += 2; continue; }
      const one = reading[i];
      out.push({ unit: unitSet.has(one) ? one : null, pos: i, len: 1 });
      i++;
    }
    return out;
  }

  // お題 text と、位置ごとに一度でもミスしたか missed から、単位ごとの { 出てきた回数, 正しく打った回数 } を数える（保存用）
  function tally(text, missed, unitSet) {
    const out = {};
    segment(text, unitSet).forEach(function (s) {
      if (!s.unit) return;
      const e = out[s.unit] || (out[s.unit] = [0, 0]);
      e[0]++;
      let ok = true;
      for (let j = 0; j < s.len; j++) if (missed[s.pos + j]) ok = false;
      if (ok) e[1]++;
    });
    return out;
  }

  // ---- 覚えたかどうか ----

  // その配列のキー配列習得の記録（古い順でなくてよい）から、単位ごとの状態を求める
  //   返り値 Map 単位 → { learned, everLearned, count（判定に使った回数）, acc（%。判定できなければ null）}
  function status(sessions) {
    const list = sessions.filter(function (s) { return s.learning && s.learning.units; })
      .slice().sort(function (a, b) { return a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0; });
    const byUnit = new Map(); // 単位 → [[回数, 正しい回数], …]（古い順）
    list.forEach(function (s) {
      Object.keys(s.learning.units).forEach(function (u) {
        if (!byUnit.has(u)) byUnit.set(u, []);
        byUnit.get(u).push(s.learning.units[u]);
      });
    });
    const out = new Map();
    byUnit.forEach(function (rows, u) {
      // i 番目のセッションまでで判定する：新しい方から、回数が MIN_RECENT 以上になるまでさかのぼる（セッションの途中では区切らない）
      const judge = function (i) {
        let n = 0;
        let ok = 0;
        for (let j = i; j >= 0 && n < MIN_RECENT; j--) { n += rows[j][0]; ok += rows[j][1]; }
        return { count: n, acc: n >= MIN_RECENT ? ok / n * 100 : null };
      };
      // 古い回から順に、まだ覚えていなければ LEARNED_ACC 以上で「覚えた」、覚えていれば FORGET_ACC 未満で「忘れた」にする
      let ever = false;
      let learned = false;
      for (let i = 0; i < rows.length; i++) {
        const r = judge(i);
        if (r.acc === null) continue;
        if (!learned && r.acc >= LEARNED_ACC) { learned = true; ever = true; }
        else if (learned && r.acc < FORGET_ACC) learned = false;
      }
      const now = judge(rows.length - 1);
      out.set(u, { learned: learned, everLearned: ever, count: now.count, acc: now.acc });
    });
    return out;
  }

  // 今覚えている単位の Set
  function learnedSet(st) {
    const s = new Set();
    st.forEach(function (v, u) { if (v.learned) s.add(u); });
    return s;
  }

  // 一度でも覚えたことのある単位の Set（段階と達成項目は、これで決める。忘れても戻さない）
  function everSet(st) {
    const s = new Set();
    st.forEach(function (v, u) { if (v.everLearned) s.add(u); });
    return s;
  }

  // ---- 次に覚える単位 ----

  // 言葉の単位の一覧（配列の単位にない文字があれば null）
  function unitsOfWord(w, unitSet, cache) {
    if (cache.has(w.reading)) return cache.get(w.reading);
    const segs = segment(w.reading, unitSet);
    const us = segs.some(function (s) { return !s.unit; }) ? null : Array.from(new Set(segs.map(function (s) { return s.unit; })));
    cache.set(w.reading, us);
    return us;
  }

  // 学習の状態をまとめる。lists は loadLists の結果、sessions はその配列のキー配列習得の記録
  //   返り値 { stage: "1-1" | "1-2" | "2" | "done", areaIndex, newUnits, learned, status, words, plan, eligible(u) }
  function state(p, lists, sessions) {
    const st = status(sessions);
    const learned = learnedSet(st);
    const cache = new Map();
    const basic = BASIC30.filter(function (c) { return p.unitSet.has(c); });
    const first = FIRST8.filter(function (c) { return p.unitSet.has(c); });
    // 段階は、一度たどり着いたら戻さない（単位を忘れても、一度そろえた最初の8字・基本30字の段階には戻らない）
    const ever = everSet(st);
    const reached = function (arr) { return arr.every(function (u) { return ever.has(u); }); };
    const stage = !reached(first) ? "1-1" : !reached(basic) ? "1-2" : p.units.every(function (u) { return learned.has(u); }) ? "done" : "2";
    // 言葉は、どの段階も単語リスト A〜D から、使える単位だけでできたものを選ぶ（段階でリストを分けない）
    const pool = lists.words.filter(function (w) { return unitsOfWord(w, p.unitSet, cache) !== null; });

    // その単位を含み、覚えた単位とその単位だけでできた言葉
    function wordsFor(u, known) {
      return pool.filter(function (w) {
        const us = unitsOfWord(w, p.unitSet, cache);
        return us.indexOf(u) !== -1 && us.every(function (x) { return x === u || known.has(x); });
      });
    }
    // 候補の条件：単語リスト D の単位は、D の言葉の単位を全部覚えていること。ほかは言葉が 20 語以上あること
    function eligible(u) {
      if (lists.dUnits.has(u)) {
        const dw = pool.filter(function (w) { return w.list === "d" && unitsOfWord(w, p.unitSet, cache).indexOf(u) !== -1; });
        return dw.length > 0 && dw.every(function (w) {
          return unitsOfWord(w, p.unitSet, cache).every(function (x) { return x === u || learned.has(x); });
        });
      }
      return wordsFor(u, learned).length >= NEW_WORDS;
    }

    // 前の回で練習していた新しい単位（まだ覚えていないもの）は続けて練習する
    const last = sessions.filter(function (s) { return s.learning; })
      .sort(function (a, b) { return a.finishedAt < b.finishedAt ? 1 : -1; })[0];
    const carried = (last && last.learning.newUnits || []).filter(function (u) { return p.unitSet.has(u) && !learned.has(u); });
    let newUnits = [];
    let areaIndex = -1;
    const shuffle = function (a) {
      a = a.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    };
    const forgotten = p.units.filter(function (u) { const s = st.get(u); return s && s.everLearned && !s.learned; });
    if (stage === "1-1") {
      newUnits = first.filter(function (u) { return !learned.has(u); });
    } else if (stage === "1-2") {
      const rest = basic.filter(function (u) { return !learned.has(u); });
      // 忘れた単位 → 前の回から続けている単位 → 残りの字 の順に選ぶ
      shuffle(forgotten.filter(function (u) { return rest.indexOf(u) !== -1; }))
        .concat(carried.filter(function (u) { return rest.indexOf(u) !== -1; }), shuffle(rest)).forEach(function (u) {
        if (newUnits.length < NEW_COUNT && newUnits.indexOf(u) === -1) newUnits.push(u);
      });
    } else if (stage === "2") {
      // 今の学習区画：覚えていない単位のうち候補の条件を満たすものがある、最初の学習区画（基本30字は段階 1 で覚えた）
      const open = function (u) { return !learned.has(u) && basic.indexOf(u) === -1; };
      for (let i = 0; i < p.areas.length; i++) {
        if (p.areas[i].units.some(function (u) { return open(u) && eligible(u); })) { areaIndex = i; break; }
      }
      const upTo = areaIndex === -1 ? p.areas.length - 1 : areaIndex;
      const reached = [];
      const skipped = [];
      let later = []; // 今の学習区画より後の候補（学習区画の順。学習区画の中はランダム）
      p.areas.forEach(function (a, i) {
        const here = a.units.filter(function (u) { return open(u) && eligible(u); });
        if (i < upTo) skipped.push.apply(skipped, here);
        else if (i === upTo) reached.push.apply(reached, here);
        else later = later.concat(shuffle(here));
      });
      // 忘れた単位 → 前の回から続けている単位 → 前に飛ばした単位 → 今の学習区画の単位 の順に選ぶ。
      // 枠が空いたら、次の学習区画の単位で埋める（今の学習区画を覚え終えると、その学習区画に進む）
      shuffle(forgotten.filter(eligible)).concat(carried, shuffle(skipped), shuffle(reached), later).forEach(function (u) {
        if (newUnits.length < NEW_COUNT && newUnits.indexOf(u) === -1) newUnits.push(u);
      });
    }
    return {
      stage: stage, areaIndex: areaIndex, newUnits: newUnits, learned: learned, status: st, pool: pool,
      plan: p, eligible: eligible, wordsFor: wordsFor, unitsOf: function (w) { return unitsOfWord(w, p.unitSet, cache); }
    };
  }

  // ---- お題 ----

  // 読みの中に、その単位（1文字）が出てくる回数
  function countIn(reading, u) {
    return reading.split(u).length - 1;
  }

  // 1回のお題の言葉を選ぶ。返り値は言葉 { display, reading } の並び（並べ替え済み）
  function chooseWords(s, dUnits) {
    const used = new Set();
    const picked = [];
    let length = 0;
    const add = function (w) {
      picked.push(w);
      used.add(w.reading);
      length += (length ? 1 : 0) + w.reading.length;
    };
    const shuffle = function (a) {
      a = a.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    };
    const known = new Set(s.learned);
    if (s.stage === "1-1") {
      // 最初の8字の段階：全部をこの8字だけでできた言葉にする。まだ覚えていない字は、言葉の少ない字から順に、
      // その字が NEW_WORDS 回ほど出てくるまで、その字を含む言葉を先に入れる（足りなければ同じ言葉を MAX_REPEAT 回まで）
      const first = new Set(FIRST8);
      const base = s.pool.filter(function (w) { return s.unitsOf(w).every(function (u) { return first.has(u); }); });
      const containing = function (u) { return base.filter(function (w) { return s.unitsOf(w).indexOf(u) !== -1; }); };
      const occurs = function (u) {
        return picked.reduce(function (n, w) { return n + countIn(w.reading, u); }, 0);
      };
      s.newUnits.slice().sort(function (a, b) { return containing(a).length - containing(b).length; }).forEach(function (u) {
        const ws = shuffle(containing(u));
        for (let k = 0; ws.length && occurs(u) < NEW_WORDS && k < ws.length * MAX_REPEAT && length < TARGET_LENGTH; k++) {
          const w = ws[k % ws.length];
          if (k < ws.length && used.has(w.reading)) continue;
          picked.push(w);
          used.add(w.reading);
          length += (length ? 1 : 0) + w.reading.length;
        }
      });
      shuffle(base).forEach(function (w) {
        if (length < TARGET_LENGTH && !used.has(w.reading)) add(w);
      });
    } else {
      // 新しい単位1つごとに 20 語（足りなければ同じ言葉を MAX_REPEAT 回まで。単語リスト D の単位は何回でも）
      s.newUnits.forEach(function (u) {
        const ws = shuffle(s.wordsFor(u, known).filter(function (w) { return !used.has(w.reading); }));
        if (!ws.length) return;
        const limit = dUnits.has(u) ? Infinity : MAX_REPEAT;
        for (let n = 0, k = 0; n < NEW_WORDS; k++) {
          const w = ws[k % ws.length];
          if (Math.floor(k / ws.length) >= limit) break;
          picked.push(w);
          length += (length ? 1 : 0) + w.reading.length;
          n++;
        }
        ws.forEach(function (w) { used.add(w.reading); });
      });
      // 残り：すでに覚えた単位だけでできた言葉（確かめる分）
      shuffle(s.pool.filter(function (w) { return s.unitsOf(w).every(function (u) { return known.has(u); }); })).forEach(function (w) {
        if (length < TARGET_LENGTH && !used.has(w.reading)) add(w);
      });
    }
    // 並べ替え、同じ言葉が続かないようにする
    const out = shuffle(picked);
    for (let i = 1; i < out.length; i++) {
      if (out[i].reading !== out[i - 1].reading) continue;
      for (let j = i + 1; j < out.length; j++) {
        if (out[j].reading !== out[i - 1].reading && (j + 1 >= out.length || out[j + 1].reading !== out[i].reading)) {
          const t = out[i]; out[i] = out[j]; out[j] = t;
          break;
        }
      }
    }
    return out.map(function (w) { return { display: w.display, reading: w.reading }; });
  }

  // ---- 達成項目 ----

  // 達成項目（マイルストーン）の一覧 [{ name, done, got, total }]。どれも、その範囲の単位を全部覚えたときに達成
  function milestones(p, learned) {
    // 範囲の単位から { name, done, got（覚えた数）, total（単位の数）} を作る
    const item = function (name, arr) {
      const got = arr.filter(function (u) { return learned.has(u); }).length;
      return { name: name, done: arr.length > 0 && got === arr.length, got: got, total: arr.length };
    };
    const inFace = function (f) {
      return [].concat.apply([], p.areas.filter(function (a) { return a.face === f; }).map(function (a) { return a.units; }));
    };
    const list = [
      item("最初の8字", FIRST8.filter(function (u) { return p.unitSet.has(u); })),
      item("基本30字", BASIC30.filter(function (u) { return p.unitSet.has(u); })),
      item("シフトなしの面", inFace(""))
    ];
    p.faces.forEach(function (f, i) {
      list.push(item(p.faces.length === 1 ? "シフト面" : "シフト面" + (i + 1) + "（" + f + "）", inFace(f)));
    });
    list.push(item("習得完了", p.units));
    return list;
  }
  // 覚えたかなの図（js/kana-mandala.js）に渡す情報
  function mandalaOpts(p, learned) {
    return {
      has: function (u) { return p.unitSet.has(u); },
      learned: learned,
      youon: PAIRS.slice(0, 36).some(function (u) { return p.unitSet.has(u); }),
      foreign: FOREIGN.filter(function (u) { return p.unitSet.has(u); })
    };
  }

  return {
    MODE: MODE, MIN_RECENT: MIN_RECENT, LEARNED_ACC: LEARNED_ACC, FORGET_ACC: FORGET_ACC, NEW_WORDS: NEW_WORDS,
    loadLists: loadLists, plan: plan, segment: segment, tally: tally, status: status, learnedSet: learnedSet, everSet: everSet,
    state: state, chooseWords: chooseWords, milestones: milestones, mandalaOpts: mandalaOpts
  };
})();
