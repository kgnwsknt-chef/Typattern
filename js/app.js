(function () {
  "use strict";

  // お題の言語（"en" 英語 / "ja" 日本語）。画面上部の「言語」で選ぶ
  let lang = "en";
  // お題ファイルの置き場所。texts/<言語>/<題材名>.txt、短縮版は <題材名>_short.txt
  function textDir() { return "texts/" + lang + "/"; }
  // 単語モードの単語リストの置き場所。wordlists/<言語>/<リスト名>.txt（1行1語、# の行は読み飛ばす）
  function wordlistDir() { return "wordlists/" + lang + "/"; }
  // 単語モードのお題の長さ（文字数）の目安
  const WORDS_TARGET_LENGTH = 300;
  // 日本語の単語モードで、画面の1行に並べる読みの文字数の目安
  const JA_LINE_LENGTH = 40;
  // ランキングに表示する件数
  const RANK_TOP = 30;
  // 選んだキー配列・モードを覚えておく localStorage のキー
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";
  const MODE_STORAGE = "typing-test.mode";
  const LANG_STORAGE = "typing-test.lang";
  // index.html で付けた ?v= をお題の読み込みにも付けて、キャッシュで古いお題が出ないようにする
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";

  const board = document.getElementById("board");
  const textEl = document.getElementById("text");
  const input = document.getElementById("input");
  const resultEl = document.getElementById("result");
  const rhythmEl = document.getElementById("rhythm");
  const rhythmAvgEl = document.getElementById("rhythm-avg");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const saveStatusEl = document.getElementById("save-status");

  const stat = {
    iki: document.getElementById("stat-iki"),
    wpm: document.getElementById("stat-wpm"),
    acc: document.getElementById("stat-acc"),
    time: document.getElementById("stat-time"),
    miss: document.getElementById("stat-miss")
  };
  const res = {
    wpm: document.getElementById("res-wpm"),
    acc: document.getElementById("res-acc"),
    time: document.getElementById("res-time"),
    miss: document.getElementById("res-miss"),
    iki: document.getElementById("res-iki"),
    uncorrected: document.getElementById("res-uncorrected"),
    rank: document.getElementById("res-rank"),
    rankLabel: document.getElementById("res-rank-label"),
    level: document.getElementById("res-level"),
    levelLabel: document.getElementById("res-level-label")
  };
  const levelStatusEl = document.getElementById("level-status");
  const rankingEl = document.getElementById("ranking");
  const rankingTitleEl = document.getElementById("ranking-title");
  const keyLayoutEl = document.getElementById("key-layout");
  const modeEl = document.getElementById("mode");
  const langEl = document.getElementById("lang");
  const guideEl = document.getElementById("guide");
  const GUIDE_EN = guideEl.textContent.trim();
  const GUIDE_JA = "読み（ひらがな）をローマ字で打ちます。IME はオフにしてください。計測は打ち始めた瞬間から始まります。Backspace で修正できます。";
  const GUIDE_KANA = "読み（ひらがな）を、選んだかな配列で打ちます。IME はオフにしてください。計測は打ち始めた瞬間から始まります。Backspace で修正できます。配列にないかなは、ミスとして飛ばします。";
  const romajiGuideEl = document.getElementById("romaji-guide");
  // 速さの単位（英語は WPM、日本語はかな/分）
  const speedUnitEls = Array.from(document.querySelectorAll(".speed-unit"));
  const rhythmWhatEl = document.getElementById("rhythm-what");
  const rhythmNoteEl = document.getElementById("rhythm-note");
  const paceEl = document.getElementById("pace");
  const paceTextEl = document.getElementById("pace-text");
  // インジケーターの帯のマス（Levels.PACE_STEPS 個）。左から順に、届いている段まで色を付ける
  const paceCells = [];
  for (let i = 0; i < Levels.PACE_STEPS; i++) {
    const cell = document.createElement("span");
    cell.className = "pace-cell";
    document.getElementById("pace-bar").appendChild(cell);
    paceCells.push(cell);
  }

  // 状態
  // 記録のモード（"normal" 文章 / "short" 短い文章 / "words" 単語 / "other" その他＝追加したお題で長さが文章・短い文章に当たらないもの）。ランキングはモードごとに分ける
  let mode = "normal";
  let sources = []; // 今のモードのお題の元。文章は { name, text }、単語は { name, words }
  let current = null; // 今のお題 { name, text }。やり直しでは同じものを使う
  let textIndex = -1;
  let textId = ""; // 今のお題の題材名・単語リスト名
  let target = "";
  let charEls = [];
  let prevValue = "";
  let startTime = 0;
  let endTime = 0;
  let keystrokes = 0; // 打った文字数（BSは含まない）
  let misses = 0;     // 打った時点で間違っていた文字数
  let lastKeyTime = 0; // 直前の打鍵（BS含む）の時刻
  let intervals = [];  // お題の位置ごとの打鍵間隔(ms)。間隔がない位置は null
  let missed = [];     // お題の位置ごとに、一度でもミスしたか
  let events = [];     // 全キー入力の記録（保存用。形式は docs/storage.md）
  let keyTime = 0;     // 直前に押したキーの時刻。そのキーで入った文字の時刻に使う
  let preKeys = [];    // 計測開始前に押したキー { code, number, time }。開始したら events に移す
  const heldShifts = new Set(); // 今押されている Shift キーの e.code
  let typer = null;    // 日本語のときの入力の状態（js/typer.js）。英語では null
  let showRomajiGuide = false; // ローマ字の手引きを出すか（日本語のローマ字入力のときだけ。かな配列では出さない）
  const kanaLayouts = {}; // 登録したかな配列（配列名 → KanaLayout.create の結果）
  let imeOn = false;   // IME がオンのまま打たれたか（日本語のとき、注意を出す）
  let timerId = 0;
  let finished = false;
  let lastActivity = 0; // 最後にキーを押した時刻（入力がないまま止めるのに使う。docs/measurement.md の「入力がないときの停止」）
  let allSessions = null; // 全記録の概要（インジケーターの目標を決めるのに使う）。読み込むまでは null
  let goal = null;        // このお題で目指すレベル（達成レベルの次。js/levels.js の TABLE の行）。出さないときは null
  // インジケーターの帯に出している段数と、次に今のペースと比べる時刻。
  // 1打ごとの揺れで帯がちらつかないよう、PACE_STEP_MS ごとに今のペースの段数と比べ、
  // 差の PACE_STEP_RATIO 倍（端数は切り捨て。少なくとも1段）だけ近づける
  const PACE_STEP_MS = 1500;
  const PACE_STEP_RATIO = 0.5;
  // 打ち始め直後はペースが跳ねるので、この文字数（日本語はかなの数）進むまではインジケーターを出さない
  const PACE_MIN_CHARS = 5;
  let paceShown = null; // 帯に出している段数（0〜Levels.PACE_STEPS）。出していないときは null
  let paceNextAt = 0;

  // 英語の1文字の正誤判定。日本語は js/romaji.js で、お題のかなに合う打ち方かを判定する
  function isCorrect(typed, expected) {
    return typed === expected;
  }

  function fetchText(path) {
    return fetch(path + "?v=" + ASSET_VERSION).then(function (r) {
      if (!r.ok) throw new Error(path + ": " + r.status);
      return r.text();
    });
  }

  // 今のモードのお題の元を読み込む。最初から入っているお題に、お題のページで追加したお題（docs/text-manager.md）を足す
  function loadSources() {
    const builtin = mode === "words" ? loadWordlists()
      : mode === "other" ? Promise.resolve([]) // 「その他」は追加したお題だけ
      : loadTexts(mode === "short" ? "_short.txt" : ".txt");
    return Promise.all([builtin, loadCustomTexts()]).then(function (v) {
      sources = v[0].concat(v[1]);
      if (sources.length === 0) {
        throw new Error(mode === "other" ? "NO_OTHER" : "no texts for mode " + mode + " in " + (mode === "words" ? wordlistDir() : textDir()));
      }
    });
  }

  // お題のページで追加したお題のうち、今の言語・モードのもの（文章は { name, text, lines }、単語は { name, words }）
  function loadCustomTexts() {
    return Store.getAllTexts()
      .catch(function (err) {
        console.warn(err); // 追加したお題が読めなくても、最初から入っているお題は使う
        return [];
      })
      .then(function (all) {
        return all
          .filter(function (x) { return x.lang === lang && x.mode === mode; })
          .map(function (x) {
            return x.kind === "words" ? { name: x.name, words: x.words } : { name: x.name, text: x.text, lines: x.lines };
          });
      });
  }

  // texts/index.json に書かれた題材のお題をすべて読み込む
  function loadTexts(suffix) {
    const dir = textDir();
    return fetchText("texts/index.json")
      .then(function (json) {
        const names = JSON.parse(json)[lang] || [];
        return Promise.all(names.map(function (name) {
          // 短縮版がない題材は飛ばす（失敗しても他の題材は使う）
          return fetchText(dir + name + suffix)
            .catch(function (err) {
              console.warn(err);
              return "";
            })
            .then(function (t) {
              return lang === "ja" ? parseJaText(name, t) : { name: name, text: t.replace(/\s+/g, " ").trim() };
            });
        }));
      })
      .then(function (loaded) {
        return loaded.filter(function (t) { return t.text.length > 0; });
      });
  }

  // 日本語のお題ファイルを読む。「表示する文」と「読み（ひらがな）」を1行ずつ交互に書く。
  // 空の行と # で始まる行は読み飛ばす。お題（打つ文字）は読みをスペースなしでつなげたもの
  function parseJaText(name, t) {
    const rows = t.split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s[0] !== "#"; });
    if (rows.length % 2 !== 0) console.warn(name + ": 表示する文と読みの行の数が合いません");
    const lines = [];
    for (let i = 0; i + 1 < rows.length; i += 2) lines.push({ display: rows[i], reading: rows[i + 1] });
    return {
      name: name,
      text: lines.map(function (l) { return l.reading; }).join(""),
      lines: lines
    };
  }

  // wordlists/index.json に書かれた単語リストをすべて読み込む
  function loadWordlists() {
    return fetchText("wordlists/index.json")
      .then(function (json) {
        const names = JSON.parse(json)[lang] || [];
        return Promise.all(names.map(function (name) {
          return fetchText(wordlistDir() + name + ".txt").then(function (t) {
            const words = t.split(/\r?\n/)
              .map(function (w) { return w.trim(); })
              .filter(function (w) { return w && w[0] !== "#"; })
              .map(function (w) {
                if (lang !== "ja") return w;
                // 日本語は「表示する語<タブ>読み」。かなだけの語は読みを省いてよい
                const cols = w.split("\t");
                return { display: cols[0].trim(), reading: (cols[1] || cols[0]).trim() };
              });
            return { name: name, words: words };
          });
        }));
      })
      .then(function (loaded) {
        return loaded.filter(function (l) { return l.words.length > 0; });
      });
  }

  // 単語リストから重ならないように単語を選んでランダムに並べ、約 WORDS_TARGET_LENGTH 文字のお題にする
  // 単語の間はスペース（日本語も打つ）。返り値 { text, lines }。日本語は lines（表示する語の行と読みの行）も作る
  function makeWordText(words) {
    const pool = words.slice();
    for (let i = pool.length - 1; i > 0; i--) { // シャッフル（Fisher-Yates）
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const reading = function (w) { return typeof w === "string" ? w : w.reading; };
    let picked = [];
    let length = 0; // 読みをスペースでつないだ長さ
    for (let i = 0; i < pool.length; i++) {
      const next = length ? length + 1 + reading(pool[i]).length : reading(pool[i]).length;
      if (next > WORDS_TARGET_LENGTH) {
        // 次の語を足すと超えるときは、足した方と足さない方のうち目安に近い方にする
        if (next - WORDS_TARGET_LENGTH < WORDS_TARGET_LENGTH - length) picked.push(pool[i]);
        break;
      }
      picked.push(pool[i]);
      length = next;
    }
    const text = picked.map(reading).join(" ");
    if (typeof picked[0] === "string") return { text: text };
    // 日本語：画面では JA_LINE_LENGTH 文字ほどで行を分け、表示する語と読みを1行ずつ並べる。
    // 行の終わりのスペースは読みの行に残す（行をつなぐとお題 text になる）
    const lines = [];
    let line = [];
    let lineLength = 0;
    picked.forEach(function (w, i) {
      if (line.length && lineLength + 1 + w.reading.length > JA_LINE_LENGTH) {
        lines.push(line);
        line = [];
        lineLength = 0;
      }
      lineLength += (line.length ? 1 : 0) + w.reading.length;
      line.push(w);
    });
    if (line.length) lines.push(line);
    return {
      text: text,
      lines: lines.map(function (ws, i) {
        return {
          display: ws.map(function (w) { return w.display; }).join("　"), // 画面では全角スペースで区切る
          reading: ws.map(function (w) { return w.reading; }).join(" ") + (i < lines.length - 1 ? " " : "")
        };
      })
    };
  }

  function showLoadError(err) {
    if (err && err.message === "NO_OTHER") {
      // 「その他」は追加したお題だけなので、まだなければ追加のしかたを案内する
      textEl.textContent = (lang === "ja" ? "日本語" : "英語") + "の「その他」のお題はまだありません。「設定」のページから開く「お題」のページで、文章（240〜360文字、70〜110文字のどちらにも入らない長さ）を追加すると、ここで打てます。";
      input.disabled = true;
      return;
    }
    console.error(err);
    textEl.textContent = location.protocol === "file:"
      ? "お題を読み込めませんでした。index.html を直接開くと読み込めないため、サーバー経由（例: http://localhost:8000）で開いてください。"
      : "お題を読み込めませんでした。ページを再読み込みしてください。";
    input.disabled = true;
  }

  // お題を決める。next なら新しいお題、そうでなければ今のお題（やり直し）
  function pickText(next) {
    if (current && !next) return current;
    if (mode === "words") {
      // 単語モードは毎回新しく作る
      const list = sources[Math.floor(Math.random() * sources.length)];
      const made = makeWordText(list.words);
      current = { name: list.name, text: made.text, lines: made.lines };
    } else {
      let i;
      do {
        i = Math.floor(Math.random() * sources.length);
      } while (sources.length > 1 && i === textIndex);
      textIndex = i;
      current = sources[i];
    }
    return current;
  }

  // モードを切り替えて、そのモードのお題を読み込み直す
  function setMode(newMode) {
    mode = newMode;
    modeEl.value = mode;
    sources = [];
    current = null;
    textIndex = -1;
    input.disabled = true;
    resultEl.hidden = true;
    textEl.textContent = "お題を読み込み中…";
    return loadSources()
      .then(function () { reset(true); })
      .catch(showLoadError);
  }

  function reset(next) {
    if (sources.length === 0) return; // 読み込み前・失敗時は何もしない
    const picked = pickText(next);
    textId = picked.name;
    target = picked.text;
    events = [];
    keyTime = 0;
    preKeys = [];
    saveStatusEl.textContent = "";
    prevValue = "";
    startTime = 0;
    endTime = 0;
    keystrokes = 0;
    misses = 0;
    lastKeyTime = 0;
    intervals = new Array(target.length).fill(null);
    missed = new Array(target.length).fill(false);
    rhythmEl.textContent = "";
    rankingEl.textContent = "";
    rankingTitleEl.textContent = "";
    finished = false;
    lastActivity = 0;
    guideEl.classList.remove("idle-stopped");
    clearInterval(timerId);
    setGoal();

    // 日本語：QWERTY ならローマ字、かな配列ならその割り当て表で判定する
    const kana = kanaLayouts[keyLayoutEl.value];
    typer = lang !== "ja" ? null : Typer.create(target, kana ? kana.options : Romaji.options);
    showRomajiGuide = lang === "ja" && !kana;
    imeOn = false;
    input.value = "";
    input.maxLength = target.length;
    input.disabled = false;
    guideEl.textContent = lang !== "ja" ? GUIDE_EN : showRomajiGuide ? GUIDE_JA : GUIDE_KANA;
    speedUnitEls.forEach(function (el) { el.textContent = lang === "ja" ? "かな/分" : "WPM"; });
    // 「キーごとの間隔」の説明。日本語は押したキーごとの間隔（かなは下の段に書く）
    rhythmWhatEl.textContent = lang === "ja" ? "最後に残ったかなを打った各キーの、直前のキーからの間隔（下の段はそのかな）" : "各文字の最後の打鍵の間隔";
    rhythmNoteEl.textContent = "修正の時間を含まないので、結果の平均 IKI より小さくなる";
    resultEl.hidden = true;
    board.classList.remove("finished");

    // お題を1文字ずつ span にする。日本語は、1行ごとに表示する文を上に、読みを下に並べる
    textEl.textContent = "";
    textEl.classList.toggle("ja", lang === "ja");
    const frag = document.createDocumentFragment();
    charEls = [];
    function addChars(parent, str, wide) {
      Array.from(str).forEach(function (ch) {
        const span = document.createElement("span");
        // 日本語の単語の間のスペースは、かなの幅に合わせて全角で見せる（打つのは半角スペース）
        span.textContent = wide && ch === " " ? "　" : ch;
        parent.appendChild(span);
        charEls.push(span);
      });
    }
    if (picked.lines) {
      picked.lines.forEach(function (l) {
        const display = document.createElement("div");
        display.className = "ja-display";
        display.textContent = l.display;
        const reading = document.createElement("div");
        reading.className = "ja-reading";
        addChars(reading, l.reading, true);
        frag.appendChild(display);
        frag.appendChild(reading);
      });
    } else {
      addChars(frag, target);
    }
    textEl.appendChild(frag);

    render();
    updateStats();
    input.focus();
  }

  // 打ち終えた位置ごとの正誤（true = お題と合っている）。長さは打ち終えた文字数
  function typedStates() {
    if (typer) {
      const states = [];
      typer.units.forEach(function (u) {
        for (let j = 0; j < u.len; j++) states.push(u.correct);
      });
      return states;
    }
    return Array.from(input.value, function (ch, i) { return isCorrect(ch, target[i]); });
  }

  function render() {
    const states = typedStates();
    for (let i = 0; i < charEls.length; i++) {
      let cls = "";
      if (i < states.length) {
        cls = states[i] ? "ok" : "ng";
      } else if (i === states.length) {
        cls = "current";
      }
      if (charEls[i].className !== cls) {
        charEls[i].className = cls;
      }
    }
    renderRomajiGuide();
  }

  // 日本語：次に打つローマ字の手引き。打ちかけ（灰色）・今のかなの残り（青）・その先（薄く）
  function renderRomajiGuide() {
    romajiGuideEl.hidden = !typer;
    if (!typer) return;
    romajiGuideEl.textContent = "";
    if (imeOn) {
      const warn = document.createElement("span");
      warn.className = "rg-warn";
      warn.textContent = "IME がオンになっています。オフにして（英字入力にして）から打ってください。";
      romajiGuideEl.appendChild(warn);
      return;
    }
    if (finished || !showRomajiGuide) return; // かな配列では手引きを出さない（IME の注意だけ）
    const g = typer.guide(24);
    [["rg-typed", g.typed], ["rg-rest", g.rest], ["rg-ahead", g.ahead]].forEach(function (p) {
      const span = document.createElement("span");
      span.className = p[0];
      span.textContent = p[1].replace(/ /g, "␣"); // 単語の間のスペースは見えるように␣で出す
      romajiGuideEl.appendChild(span);
    });
  }

  function correctCount() {
    return typedStates().filter(function (ok) { return ok; }).length;
  }

  // 日本語：最後に残った正しいかなを打ったキーの数（平均 IKI の分母に使う）
  function correctKeys() {
    return typer.units.reduce(function (n, u) { return u.correct ? n + u.keys.length : n; }, 0);
  }

  function elapsedSec() {
    if (!startTime) return 0;
    return ((endTime || performance.now()) - startTime) / 1000;
  }

  // 速さ（wpm）は、英語は WPM、日本語はかな/分（正しいかなの数 ÷ 分）
  function calc() {
    const sec = elapsedSec();
    const correct = correctCount();
    const wpm = sec <= 0 ? 0 : typer ? correct / (sec / 60) : (correct / 5) / (sec / 60);
    // 正確率：今の入力のうちお題と合っている文字の割合。直したミスは含めない（docs/measurement.md）
    const typed = typedStates().length;
    const acc = typed > 0 ? (correct / typed) * 100 : 100;
    return { sec: sec, wpm: wpm, acc: acc };
  }

  function updateStats() {
    // 打ち始めてから、設定の秒数のあいだキーを押さなかったら止める（記録しない）
    if (startTime && !finished && lastActivity && performance.now() - lastActivity >= Settings.get("idleStopSec") * 1000) {
      stopIdle();
      return;
    }
    const r = calc();
    // 打ち始め直後は値が極端に跳ねるので、2秒経つまで平均 IKI と WPM は出さない
    const show = finished || r.sec >= 2;
    // 途中の平均 IKI は、ここまでに進んだ文字数（日本語は正しく打ったキーの数）で割る（最後まで打つと結果の値と同じになる）
    const iki = Store.avgIki(r.sec, typer ? correctKeys() : input.value.length);
    stat.iki.textContent = show && iki !== null ? Math.round(iki) : "-";
    stat.wpm.textContent = show ? Math.round(r.wpm) : "-";
    stat.acc.textContent = Math.floor(r.acc);
    stat.time.textContent = r.sec.toFixed(1);
    stat.miss.textContent = misses;
    updatePace(r);
  }

  // ---- インジケーター（決まりは docs/levels.md の「打っている間のインジケーター」） ----

  // 目標：この言語・モードの達成レベルの次（短い文章・その他は文章の目標）。一番上を達成していれば null
  // 設定で消しているとき・記録をまだ読み込んでいないときも null（出さない）
  function setGoal() {
    goal = allSessions && Settings.get("indicator")
      ? Levels.next(Levels.achieved(allSessions, lang, Levels.targetMode(mode)))
      : null;
  }

  // 今のペース（ここまでに進んだ文字数で求めた文字/秒）を目標と比べて、帯の長さ・色と文字を変える
  // 目標のペースなら満タン（青）。遅れ1秒（基準の量を打つ秒数で）ごとに1段短くし、真ん中より長ければ黄、それ以下は赤
  // 5文字（日本語はかな）進むまでと、停止したときは空（灰色）。正確率がレベルの基準（95%）未満なら色を暗くする
  // 帯の段数は、PACE_STEP_MS（1.5秒）ごとに今のペースの段数と比べ、差の半分（切り捨て。差が1なら1段）だけ増やす・減らす。
  // 出し始め（5文字目）は今のペースの段数から始め、打ち終えたときは今のペースの段数にそろえる（結果のレベルと同じ判定）。
  // 文字の「今 ○ 文字/秒」「あと ○ 秒」は今のペースそのもの
  function updatePace(r) {
    paceEl.hidden = !goal;
    if (!goal) return;
    const chars = Levels.charsFor(lang);
    const progressed = typedStates().length;
    const rate = startTime && (progressed >= PACE_MIN_CHARS || finished) ? Levels.rateOf(progressed, r.sec) : null;
    const now = performance.now();
    if (rate === null) {
      paceShown = null;
    } else {
      const actual = Levels.paceSteps(rate, goal, chars);
      if (finished || paceShown === null) {
        paceShown = actual;
        paceNextAt = now + PACE_STEP_MS;
      } else if (now >= paceNextAt) {
        // 差が大きいほど大きく動かす：差の半分（端数は切り捨て。ただし差が1なら1段）
        const diff = actual - paceShown;
        paceShown += Math.sign(diff) * Math.max(1, Math.floor(Math.abs(diff) * PACE_STEP_RATIO));
        paceNextAt += PACE_STEP_MS;
      }
    }
    const steps = paceShown === null ? 0 : paceShown;
    const state = rate === null ? "idle" : Levels.paceState(steps);
    const dark = rate !== null && r.acc < Levels.MIN_ACCURACY;
    paceEl.className = "pace pace-" + state + (dark ? " pace-dark" : "");
    paceCells.forEach(function (cell, i) { cell.classList.toggle("on", i < steps); });
    // 遅れ：今のペースで基準の量を打つ秒数が、目標の秒数をどれだけ超えるか
    const late = rate === null ? 0 : chars / rate - goal.maxSec;
    paceTextEl.textContent = "目標 " + goal.name + "（" + Levels.minRate(goal, chars).toFixed(2) + " 文字/秒より速く）　今 " +
      (rate === null ? "-" : rate.toFixed(2)) + " 文字/秒" +
      (rate !== null && late >= 0 ? "（あと " + late.toFixed(1) + " 秒）" : "") +
      (dark ? "　正確率 " + Levels.MIN_ACCURACY + "% 未満" : "");
  }

  // 入力がないまま止める。続きからは打てない（もう一度か次のお題を選ぶ）。記録は保存しない
  function stopIdle() {
    finished = true;
    clearInterval(timerId);
    input.disabled = true;
    board.classList.add("finished");
    guideEl.classList.add("idle-stopped");
    guideEl.textContent = Settings.get("idleStopSec") + " 秒間入力がなかったので停止しました（記録はしません）。もう一度（Esc）か次のお題（Shift+Enter）を選んでください。";
    updatePace({ sec: 0, acc: 100 }); // インジケーターは灰色に戻す
  }

  function finish() {
    finished = true;
    endTime = performance.now();
    clearInterval(timerId);
    updateStats();
    input.disabled = true;
    board.classList.add("finished");

    const r = calc();
    r.uncorrected = target.length - correctCount(); // 直さずに残した間違いの数
    // 平均 IKI：英語は文字あたり、日本語はキーあたり（正しく打ったキーの数で割る）
    r.avgIki = Store.avgIki(Math.round(r.sec * 1000) / 1000, typer ? correctKeys() : target.length);
    res.iki.textContent = r.avgIki === null ? "-" : r.avgIki.toFixed(1);
    res.wpm.textContent = Math.round(r.wpm);
    res.acc.textContent = r.acc.toFixed(1);
    res.time.textContent = r.sec.toFixed(1);
    res.miss.textContent = misses;
    res.uncorrected.textContent = r.uncorrected;
    // グラフは位置ごとの最後の打鍵の間隔を使う。その平均を点線と色の基準にする
    const lastAvg = typer ? Rhythm.renderKeys(rhythmEl, keyColumns()) : Rhythm.render(rhythmEl, target, intervals, missed);
    rhythmAvgEl.textContent = lastAvg;
    resultEl.hidden = false;

    saveSession(r);
  }

  // 日本語の「キーごとの間隔」のグラフの元：最後に残ったかなごとに、そのかなを打ったキーと間隔
  // 間隔は、そのキーを押した時刻と直前のキー（Backspace を含む）の時刻の差。最初のキーは null
  function keyColumns() {
    return Rhythm.kanaColumns(typer.units, target, missed);
  }

  // ms を 0.1ms 単位に丸める（保存サイズを抑えるため）
  function round1(v) {
    return v === null ? null : Math.round(v * 10) / 10;
  }

  // ---- レベル（js/levels.js。決まりは docs/levels.md） ----

  const LANG_NAME = { en: "英語", ja: "日本語" };
  const MODE_NAME = { normal: "文章", short: "短い文章", words: "単語", other: "その他" };

  // 今回のレベルと文字/秒。正確率が基準未満なら「-」
  function renderLevel(session) {
    const level = Levels.ofSession(session);
    const rate = Levels.rateOfSession(session) || 0;
    res.level.textContent = level ? level.name : "-";
    res.levelLabel.textContent = "レベル（" + rate.toFixed(2) + " 文字/秒）" +
      (!level && session.result.accuracy < Levels.MIN_ACCURACY ? "・正確率 " + Levels.MIN_ACCURACY + "% 未満" : "");
  }

  // 達成レベル（この言語・モード）と、次の目標までの差。sessions は今回を含む全記録
  function renderLevelStatus(session, sessions) {
    const mode = Levels.targetMode(session.mode);
    const others = sessions.filter(function (s) { return s.id !== session.id; });
    const before = Levels.achieved(others, session.lang, mode);
    const now = Levels.achieved(sessions, session.lang, mode);
    const chars = Levels.charsFor(session.lang);
    const target = Levels.next(now);
    levelStatusEl.textContent = "";
    const add = function (text, className) {
      const span = document.createElement("span");
      if (className) span.className = className;
      span.textContent = text;
      levelStatusEl.appendChild(span);
    };
    const label = LANG_NAME[session.lang] + "・" + MODE_NAME[mode];
    if (now && (!before || now.index > before.index) && session.mode === mode) {
      // 今回で達成レベルが上がった：「日本語・文章レベル D を達成！」を目立たせる
      add(label + "レベル " + now.name + " を達成！", "level-up");
      res.level.classList.add("level-up"); // 結果のレベルの値も、達成した色にする
    } else {
      add(label + "の達成レベル：" + (now ? now.name : "なし"));
    }
    if (session.mode !== mode) add("（" + MODE_NAME[session.mode] + "は達成に数えません）");
    if (!target) {
      add(" ／ 一番上のレベルです");
      return;
    }
    // 次の目標までの差（あと何文字/秒 速くすればよいか）
    const need = Levels.minRate(target, chars);
    const gap = need - (Levels.rateOfSession(session) || 0);
    add(" ／ 次の目標 " + target.name + "（" + need.toFixed(2) + " 文字/秒より速く）" +
      (gap >= 0 ? "まで あと " + Math.max(gap, 0.01).toFixed(2) + " 文字/秒" : "：今回の速さは届いています" +
        (session.mode !== mode ? "（文章で打つと達成になります）" : "（正確率 " + Levels.MIN_ACCURACY + "% 以上で達成になります）")));
  }

  // この回を概要（sessions）と生データ（raws）の2つの記録にして保存し、順位を出す。形式は docs/storage.md
  function saveSession(r) {
    const id = crypto.randomUUID();
    const session = {
      schemaVersion: Store.SCHEMA_VERSION,
      id: id,
      finishedAt: new Date().toISOString(),
      appVersion: ASSET_VERSION,
      lang: lang,
      mode: mode,
      keyLayout: keyLayoutEl.value,
      textId: textId,
      textLength: target.length,
      result: {
        wpm: typer ? null : Math.round(r.wpm * 10) / 10,
        accuracy: Store.accuracy(target.length, r.uncorrected),
        timeSec: Math.round(r.sec * 1000) / 1000,
        keystrokes: keystrokes,
        misses: misses,
        uncorrected: r.uncorrected,
        avgIki: r.avgIki
      }
    };
    if (typer) {
      // 日本語：かな/分と、平均 IKI の分母（最後に残った正しいかなを打ったキーの数）
      session.result.kanaPerMin = Math.round(r.wpm * 10) / 10;
      session.result.correctKeys = correctKeys();
    }
    const raw = {
      id: id,
      keyLayout: session.keyLayout, // 文字から物理キーの位置を求めるのに使う（概要と同じ値）
      text: target,
      events: events,
      intervals: intervals.map(round1),
      missedPositions: missed.reduce(function (acc, m, i) { if (m) acc.push(i); return acc; }, [])
    };

    saveStatusEl.textContent = "記録を保存中…";
    res.rank.textContent = "-";
    res.rank.classList.remove("rank-1", "rank-2", "rank-3");
    res.level.classList.remove("level-up");
    res.rankLabel.textContent = "";
    renderLevel(session);
    levelStatusEl.textContent = "";
    Store.save(session, raw)
      .then(function () {
        Store.persist();
        PageFooter.refreshSize();
        return Promise.all([Store.rankOf(session), Store.top(session, RANK_TOP), Store.getAllSessions()]);
      })
      .then(function (v) {
        allSessions = v[2]; // 次のお題からは、今回を含めた達成レベルで目標を決める
        renderLevelStatus(session, v[2]);
        const info = v[0];
        if (info.eligible) {
          res.rank.textContent = info.rank;
          // 1〜3位は順位ごとの色で目立たせる（style.css の --rank-1〜3）
          if (info.rank <= 3) res.rank.classList.add("rank-" + info.rank);
          res.rankLabel.textContent = "位 / " + info.total + " 回";
        } else {
          res.rank.textContent = "-";
          res.rankLabel.textContent = "ランキング対象外（正確率 " + Store.RANK_MIN_ACCURACY + "% 未満）";
        }
        rankingTitleEl.textContent = Ranking.categoryLabel(session);
        document.getElementById("ranking-min").textContent = Store.RANK_MIN_ACCURACY;
        Ranking.render(rankingEl, v[1], id);
        saveStatusEl.textContent = "記録を保存しました。";
      })
      .catch(function (err) {
        console.error(err);
        saveStatusEl.textContent = "記録を保存できませんでした: " + err.message;
      });
  }

  // 押したキーを1行記録する。どの行も5要素にそろえる（docs/storage.md）
  //   [経過ms, "k", 物理キーの番号, 打っている位置, 正解なら1・ミスなら0（Shift・Backspace は null）]
  // 計測開始前のキーは preKeys にためておき、開始したときに startKeys で events に移す
  function logKey(e, now) {
    if (finished || input.disabled) return;
    const number = Keys.number(e.code);
    if (number === null) return; // Ctrl・矢印など、番号のないキーは記録しない
    const isBackspace = e.code === "Backspace";
    // Ctrl などと一緒に押したキーは文字を入力しないので記録しない（Ctrl + Backspace は削除するので記録する）
    if ((e.ctrlKey || e.altKey || e.metaKey) && !isBackspace) return;
    const pos = input.value.length;
    let judge = null;
    if (!Keys.isShift(e.code) && !isBackspace) judge = e.key === target[pos] ? 1 : 0;
    pushKey(e.code, number, now, pos, judge);
  }

  // "k" の行を足す。計測開始前は preKeys にためる
  function pushKey(code, number, now, pos, judge) {
    if (startTime) {
      events.push([round1(now - startTime), "k", number, pos, judge]);
      return;
    }
    // 開始前：前に押したキーのうち、押したままの Shift だけを残す（大文字で打ち始めるときの Shift）
    if (!Keys.isShift(code)) dropReleasedPreKeys();
    preKeys.push({ code: code, number: number, time: now, pos: pos, judge: judge });
  }

  function dropReleasedPreKeys() {
    preKeys = preKeys.filter(function (k) { return Keys.isShift(k.code) && heldShifts.has(k.code); });
  }

  // 計測開始の瞬間に、開始前のキーを events に移す（開始の打鍵が 0、その前の Shift は負の時刻になる）
  function startKeys() {
    preKeys.forEach(function (k) {
      events.push([round1(k.time - startTime), "k", k.number, k.pos, k.judge]);
    });
    preKeys = [];
  }

  // 日本語：キーを押したときの処理。入力欄は使わず、e.code から US キーボードの文字を求めてローマ字の判定にかける
  function handleJaKey(e, now) {
    if (finished) return;
    // IME がオンだと key が "Process" になる。かなに変換されてしまうので受け付けず、注意を出す
    if (e.key === "Process" || e.isComposing) {
      e.preventDefault();
      imeOn = true;
      renderRomajiGuide();
      return;
    }
    if ((e.ctrlKey || e.altKey || e.metaKey) && e.code !== "Backspace") return;
    const number = Keys.number(e.code);
    if (number === null) return;
    e.preventDefault();
    imeOn = false;

    if (Keys.isShift(e.code)) {
      pushKey(e.code, number, now, typer.pos, null);
      return;
    }

    if (e.code === "Backspace") {
      if (!startTime) return; // まだ何も打っていない
      const pos = typer.pos;
      const removed = typer.backspace(now);
      pushKey(e.code, number, now, pos, null);
      if (removed.length) {
        // 確定したかなを消したときだけ "-" の行を残す（打ちかけのキーを消したときは残さない）
        // 飛ばしたかなと一緒に消したときは、まとめて1行
        const from = removed[0].pos;
        events.push([round1(now - startTime), "-", target.slice(from, pos), from, null]);
        for (let i = from; i < pos; i++) intervals[i] = null;
      }
      lastKeyTime = now;
      render();
      updateStats();
      return;
    }

    if (!startTime) {
      startTime = now;
      dropReleasedPreKeys();
      startKeys();
      timerId = setInterval(updateStats, 100);
    }
    keystrokes++;
    // 文字のないキー（JIS の「ろ」など）は、どの打ち方にも合わない文字として渡す
    const r = typer.press(Keys.char(e.code, e.shiftKey) || "\u0000", now);
    pushKey(e.code, number, now, r.pos, r.judge);
    r.confirmed.forEach(function (u) {
      // "+" の時刻は、そのかなを生んだ最後のキーの時刻（次のキーで確定した「ん」も n の時刻）
      const t = round1(u.time - startTime);
      for (let j = 0; j < u.len; j++) {
        const i = u.pos + j;
        events.push([t, "+", target[i], i, u.correct ? 1 : 0]);
        // 間隔：そのかなの最初のキーの直前のキーから、最後のキーまで。2文字まとめて打ったときの2文字目は 0
        intervals[i] = j > 0 ? 0 : (u.prevTime === null ? null : u.time - u.prevTime);
      }
      if (u.skipped) {
        // 打ち方がないので飛ばしたかな：ミスに数えるのは、その位置で1回だけ（打ち直して何度通っても増やさない）
        if (!missed[u.pos]) misses++;
        missed[u.pos] = true;
      } else if (!u.correct) {
        misses++;
        missed[u.pos] = true;
      }
    });
    lastKeyTime = now;
    render();
    updateStats();
    if (typer.done()) finish();
  }

  // 入力欄の変化を記録する。時刻は、その文字を入力したキーを押した時刻
  //   [経過ms, "+", 入力した文字, 位置, 正解なら1・ミスなら0]
  //   [経過ms, "-", 消した文字, 位置, null]
  function logEvents(prev, value, now) {
    let p = 0;
    while (p < prev.length && p < value.length && prev[p] === value[p]) p++;
    const t = round1(now - startTime);
    if (p < prev.length) events.push([t, "-", prev.slice(p), p, null]);
    for (let i = p; i < value.length; i++) {
      events.push([t, "+", value[i], i, isCorrect(value[i], target[i]) ? 1 : 0]);
    }
  }

  input.addEventListener("input", function () {
    if (finished) return;
    if (typer) {
      // 日本語は入力欄を使わない（IME などで入ってしまった文字は捨てる）
      input.value = "";
      return;
    }
    const value = input.value;
    // 時刻は、この変化を起こしたキーを押した時刻（キーを押さずに変わったときは今の時刻）
    const now = keyTime || performance.now();
    keyTime = 0;

    // 末尾に追加された文字だけを打鍵として数える
    if (value.length > prevValue.length && value.startsWith(prevValue)) {
      if (!startTime) {
        startTime = now;
        startKeys();
        timerId = setInterval(updateStats, 100);
      }
      for (let i = prevValue.length; i < value.length; i++) {
        keystrokes++;
        if (!isCorrect(value[i], target[i])) {
          misses++;
          missed[i] = true;
        }
        // 打ち直した位置は最後の1打の間隔で上書き。1回で複数文字入った場合、2文字目以降は 0
        intervals[i] = !lastKeyTime ? null : (i === prevValue.length ? now - lastKeyTime : 0);
      }
    } else {
      // Backspace などで消えた位置の間隔は捨てる
      for (let i = value.length; i < prevValue.length; i++) intervals[i] = null;
    }
    if (value !== prevValue) {
      if (startTime) logEvents(prevValue, value, now);
      lastKeyTime = now;
    }
    prevValue = value;

    render();
    updateStats();
    if (value.length >= target.length) finish();
  });

  // キャレットは常に末尾。矢印キー等での移動とペーストを禁止
  const blockedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Enter", "Tab"];
  input.addEventListener("keydown", function (e) {
    lastActivity = performance.now(); // どのキーでも「入力あり」とみなす
    if (blockedKeys.indexOf(e.key) !== -1) {
      e.preventDefault();
      return;
    }
    const now = performance.now();
    if (Keys.isShift(e.code)) {
      // 押しっぱなしの Shift のキーリピートは記録しない（押した1回だけ残す）
      if (heldShifts.has(e.code)) return;
      heldShifts.add(e.code);
    }
    if (typer) {
      handleJaKey(e, now);
      return;
    }
    if (!Keys.isShift(e.code)) keyTime = now; // Shift だけでは入力欄は変わらない
    logKey(e, now);
  });
  // Shift を離したときは "u" の行を残す（どのキーを Shift と同時に押したか分かるように。n-gram で使う）
  //   [経過ms, "u", 物理キーの番号, 打っている位置, null]
  input.addEventListener("keyup", function (e) {
    if (!Keys.isShift(e.code)) return;
    heldShifts.delete(e.code);
    if (startTime && !finished) {
      events.push([round1(performance.now() - startTime), "u", Keys.number(e.code), typer ? typer.pos : input.value.length, null]);
    }
  });
  ["paste", "drop", "cut"].forEach(function (type) {
    input.addEventListener(type, function (e) { e.preventDefault(); });
  });
  input.addEventListener("select", function () {
    input.setSelectionRange(input.value.length, input.value.length);
  });

  input.addEventListener("focus", function () { board.classList.remove("blurred"); });
  input.addEventListener("blur", function () {
    board.classList.add("blurred");
    // 入力欄の外で Shift を離すと keyup が来ないので、ここで離したことにする
    heldShifts.forEach(function (code) {
      input.dispatchEvent(new KeyboardEvent("keyup", { code: code, key: "Shift" }));
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      reset(false);
    } else if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
      // Shift + Enter で次のお題（打っている途中でも。Enter だけでは何もしない）
      e.preventDefault();
      reset(true);
    }
  });
  // 結果のタブ切り替え。選んだタブはやり直しても維持する
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        const selected = t === tab;
        t.setAttribute("aria-selected", String(selected));
        document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
      });
    });
  });

  // キー配列の選択。選んだ配列はブラウザに覚えさせ、変えたらその回はやり直す
  // 選択肢は QWERTY と、キー配列のページで登録したかな配列（日本語のときだけ選べる）
  function addKanaLayouts(records) {
    records.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    records.forEach(function (r) {
      kanaLayouts[r.id] = KanaLayout.create(r.entries);
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.name;
      keyLayoutEl.appendChild(o);
    });
  }

  function restoreKeyLayout() {
    try {
      const saved = localStorage.getItem(KEY_LAYOUT_STORAGE);
      if (saved && keyLayoutEl.querySelector('option[value="' + saved + '"]')) keyLayoutEl.value = saved;
    } catch (e) { /* 保存できない環境では既定の配列を使う */ }
  }

  // 英語ではかな配列を選べないようにする。かな配列を選んでいたら QWERTY に戻す
  function updateKeyLayoutOptions() {
    Array.prototype.forEach.call(keyLayoutEl.options, function (o) {
      o.disabled = lang !== "ja" && o.value in kanaLayouts;
    });
    if (keyLayoutEl.selectedOptions[0] && keyLayoutEl.selectedOptions[0].disabled) {
      keyLayoutEl.value = "qwerty";
      try { localStorage.setItem(KEY_LAYOUT_STORAGE, "qwerty"); } catch (e) { /* 無視 */ }
    }
  }

  keyLayoutEl.addEventListener("change", function () {
    try { localStorage.setItem(KEY_LAYOUT_STORAGE, keyLayoutEl.value); } catch (e) { /* 無視 */ }
    reset(false);
  });

  document.getElementById("retry-btn").addEventListener("click", function () { reset(false); });
  document.getElementById("next-btn").addEventListener("click", function () { reset(true); });

  // バージョン表示と、記録の書き出し・読み込み（全ページ共通）
  PageFooter.init();

  // モードの選択。URL に ?short があれば短い文章、なければ前に選んだモード（初めては文章）で始める
  let initialMode = "normal";
  try {
    const saved = localStorage.getItem(MODE_STORAGE);
    if (saved && modeEl.querySelector('option[value="' + saved + '"]')) initialMode = saved;
  } catch (e) { /* 既定のモードを使う */ }
  if (new URLSearchParams(location.search).has("short")) initialMode = "short";
  modeEl.addEventListener("change", function () {
    try { localStorage.setItem(MODE_STORAGE, modeEl.value); } catch (e) { /* 無視 */ }
    // ?short は最初のモードを決めるだけなので、切り替えたら URL から外す
    if (location.search) history.replaceState(null, "", location.pathname);
    setMode(modeEl.value);
  });

  // 言語の選択。選んだ言語はブラウザに覚えさせ、変えたらその言語のお題を読み込み直す
  try {
    const saved = localStorage.getItem(LANG_STORAGE);
    if (saved && langEl.querySelector('option[value="' + saved + '"]')) lang = saved;
  } catch (e) { /* 既定の言語を使う */ }
  langEl.value = lang;
  langEl.addEventListener("change", function () {
    lang = langEl.value;
    try { localStorage.setItem(LANG_STORAGE, lang); } catch (e) { /* 無視 */ }
    // 英語に戻したときは、前に選んでいたモード（単語など）に戻す
    let m = modeEl.value;
    try { m = localStorage.getItem(MODE_STORAGE) || m; } catch (e) { /* 今のモードを使う */ }
    updateKeyLayoutOptions();
    setMode(m);
  });

  // 登録したかな配列を読み込んでから、前に選んだ配列に戻して始める（読み込めなくても QWERTY で始める）
  Store.getAllLayouts()
    .then(addKanaLayouts)
    .catch(function (err) { console.error(err); })
    .then(function () {
      restoreKeyLayout();
      updateKeyLayoutOptions();
      setMode(initialMode);
    });

  // インジケーターの目標を決めるため、全記録の概要を読んでおく（読めなければインジケーターを出さない）
  Store.getAllSessions()
    .then(function (all) {
      allSessions = all;
      setGoal();
      updateStats();
    })
    .catch(function (err) { console.warn(err); });
})();
