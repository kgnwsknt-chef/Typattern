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
    rankLabel: document.getElementById("res-rank-label")
  };
  const rankingEl = document.getElementById("ranking");
  const rankingTitleEl = document.getElementById("ranking-title");
  const keyLayoutEl = document.getElementById("key-layout");
  const modeEl = document.getElementById("mode");
  const langEl = document.getElementById("lang");
  const guideEl = document.getElementById("guide");
  const GUIDE_EN = guideEl.textContent.trim();
  const GUIDE_JA = "読み（ひらがな）をローマ字で打ちます。IME はオフにしてください。計測は打ち始めた瞬間から始まります。Backspace で修正できます。";
  const romajiGuideEl = document.getElementById("romaji-guide");
  // 速さの単位（英語は WPM、日本語はかな/分）
  const speedUnitEls = Array.from(document.querySelectorAll(".speed-unit"));

  // 状態
  // 記録のモード（"normal" 文章 / "short" 短い文章 / "words" 単語）。ランキングはモードごとに分ける
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
  let typer = null;    // 日本語のときのローマ字の入力の状態（js/romaji.js）。英語では null
  let imeOn = false;   // IME がオンのまま打たれたか（日本語のとき、注意を出す）
  let timerId = 0;
  let finished = false;

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

  // 今のモードのお題の元を読み込む
  function loadSources() {
    return mode === "words" ? loadWordlists() : loadTexts(mode === "short" ? "_short.txt" : ".txt");
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
        sources = loaded.filter(function (t) { return t.text.length > 0; });
        if (sources.length === 0) throw new Error("no texts in " + dir + " (*" + suffix + ")");
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
              .filter(function (w) { return w && w[0] !== "#"; });
            return { name: name, words: words };
          });
        }));
      })
      .then(function (loaded) {
        sources = loaded.filter(function (l) { return l.words.length > 0; });
        if (sources.length === 0) throw new Error("no word lists in " + wordlistDir());
      });
  }

  // 単語リストから重ならないように単語を選んでランダムに並べ、約 WORDS_TARGET_LENGTH 文字のお題にする
  function makeWordText(words) {
    const pool = words.slice();
    for (let i = pool.length - 1; i > 0; i--) { // シャッフル（Fisher-Yates）
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    let text = "";
    for (let i = 0; i < pool.length; i++) {
      const next = text ? text + " " + pool[i] : pool[i];
      if (next.length > WORDS_TARGET_LENGTH) {
        // 次の語を足すと超えるときは、足した方と足さない方のうち目安に近い方にする
        if (next.length - WORDS_TARGET_LENGTH < WORDS_TARGET_LENGTH - text.length) text = next;
        break;
      }
      text = next;
    }
    return text;
  }

  function showLoadError(err) {
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
      current = { name: list.name, text: makeWordText(list.words) };
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
    // 日本語の単語リストはまだないので、日本語では単語モードを選べない
    const wordsOption = modeEl.querySelector('option[value="words"]');
    wordsOption.disabled = lang === "ja";
    if (lang === "ja" && newMode === "words") newMode = "normal";
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
    clearInterval(timerId);

    typer = lang === "ja" ? Romaji.create(target) : null;
    imeOn = false;
    input.value = "";
    input.maxLength = target.length;
    input.disabled = false;
    guideEl.textContent = lang === "ja" ? GUIDE_JA : GUIDE_EN;
    speedUnitEls.forEach(function (el) { el.textContent = lang === "ja" ? "かな/分" : "WPM"; });
    resultEl.hidden = true;
    board.classList.remove("finished");

    // お題を1文字ずつ span にする。日本語は、1行ごとに表示する文を上に、読みを下に並べる
    textEl.textContent = "";
    textEl.classList.toggle("ja", lang === "ja");
    const frag = document.createDocumentFragment();
    charEls = [];
    function addChars(parent, str) {
      Array.from(str).forEach(function (ch) {
        const span = document.createElement("span");
        span.textContent = ch;
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
        addChars(reading, l.reading);
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
    if (finished) return;
    const g = typer.guide(24);
    [["rg-typed", g.typed], ["rg-rest", g.rest], ["rg-ahead", g.ahead]].forEach(function (p) {
      const span = document.createElement("span");
      span.className = p[0];
      span.textContent = p[1];
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
    const lastAvg = Rhythm.render(rhythmEl, target, intervals, missed);
    rhythmAvgEl.textContent = lastAvg;
    resultEl.hidden = false;

    saveSession(r);
  }

  // ms を 0.1ms 単位に丸める（保存サイズを抑えるため）
  function round1(v) {
    return v === null ? null : Math.round(v * 10) / 10;
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
    res.rankLabel.textContent = "";
    Store.save(session, raw)
      .then(function () {
        Store.persist();
        return Promise.all([Store.rankOf(session), Store.top(session, RANK_TOP)]);
      })
      .then(function (v) {
        const info = v[0];
        if (info.eligible) {
          res.rank.textContent = info.rank;
          res.rankLabel.textContent = "位 / " + info.total + " 回";
        } else {
          res.rank.textContent = "-";
          res.rankLabel.textContent = "ランキング対象外（正確率 " + Store.RANK_MIN_ACCURACY + "% 未満）";
        }
        rankingTitleEl.textContent = Ranking.categoryLabel(session);
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
      const u = typer.backspace(now);
      pushKey(e.code, number, now, pos, null);
      if (u) {
        // 確定したかなを消したときだけ "-" の行を残す（打ちかけのキーを消したときは残さない）
        events.push([round1(now - startTime), "-", target.substr(u.pos, u.len), u.pos, null]);
        for (let i = u.pos; i < u.pos + u.len; i++) intervals[i] = null;
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
      if (!u.correct) {
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
    if (blockedKeys.indexOf(e.key) !== -1) {
      e.preventDefault();
      return;
    }
    const now = performance.now();
    if (Keys.isShift(e.code)) heldShifts.add(e.code);
    if (typer) {
      handleJaKey(e, now);
      return;
    }
    if (!Keys.isShift(e.code)) keyTime = now; // Shift だけでは入力欄は変わらない
    logKey(e, now);
  });
  input.addEventListener("keyup", function (e) {
    if (Keys.isShift(e.code)) heldShifts.delete(e.code);
  });
  ["paste", "drop", "cut"].forEach(function (type) {
    input.addEventListener(type, function (e) { e.preventDefault(); });
  });
  input.addEventListener("select", function () {
    input.setSelectionRange(input.value.length, input.value.length);
  });

  input.addEventListener("focus", function () { board.classList.remove("blurred"); });
  input.addEventListener("blur", function () { board.classList.add("blurred"); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      reset(false);
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
  try {
    const saved = localStorage.getItem(KEY_LAYOUT_STORAGE);
    if (saved && keyLayoutEl.querySelector('option[value="' + saved + '"]')) keyLayoutEl.value = saved;
  } catch (e) { /* 保存できない環境では既定の配列を使う */ }
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
    setMode(m);
  });

  setMode(initialMode);
})();
