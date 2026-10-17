(function () {
  "use strict";

  const LANG = "en";
  // URL に ?short が付いていたら短いお題を使う（試し打ち用）
  const SHORT = new URLSearchParams(location.search).has("short");
  // お題ファイルの置き場所。texts/<言語>/<題材名>.txt、短縮版は <題材名>_short.txt
  const TEXT_DIR = "texts/" + LANG + "/";
  const TEXT_SUFFIX = SHORT ? "_short.txt" : ".txt";
  // 記録のモード。ランキングはモードごとに分ける
  const MODE = SHORT ? "short" : "normal";
  // ランキングに表示する件数
  const RANK_TOP = 30;
  // 選んだキー配列を覚えておく localStorage のキー
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";
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
  const importFileEl = document.getElementById("import-file");

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

  // 状態
  let texts = []; // 読み込んだお題 { name: 題材名, text: 文 }
  let textIndex = -1;
  let textId = ""; // 今のお題の題材名（texts/index.json の名前）
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
  let timerId = 0;
  let finished = false;

  // 1文字の正誤判定。日本語対応時はここを言語ごとに差し替える
  function isCorrect(typed, expected) {
    return typed === expected;
  }

  function fetchText(path) {
    return fetch(path + "?v=" + ASSET_VERSION).then(function (r) {
      if (!r.ok) throw new Error(path + ": " + r.status);
      return r.text();
    });
  }

  // texts/index.json に書かれた題材のお題をすべて読み込む
  function loadTexts() {
    return fetchText("texts/index.json")
      .then(function (json) {
        const names = JSON.parse(json)[LANG] || [];
        return Promise.all(names.map(function (name) {
          // 短縮版がない題材は飛ばす（失敗しても他の題材は使う）
          return fetchText(TEXT_DIR + name + TEXT_SUFFIX)
            .catch(function (err) {
              console.warn(err);
              return "";
            })
            .then(function (t) {
              // 改行や連続した空白は1つのスペースにそろえる
              return { name: name, text: t.replace(/\s+/g, " ").trim() };
            });
        }));
      })
      .then(function (loaded) {
        texts = loaded.filter(function (t) { return t.text.length > 0; });
        if (texts.length === 0) throw new Error("no texts in " + TEXT_DIR + " (*" + TEXT_SUFFIX + ")");
      });
  }

  function showLoadError(err) {
    console.error(err);
    textEl.textContent = location.protocol === "file:"
      ? "お題を読み込めませんでした。index.html を直接開くと読み込めないため、サーバー経由（例: http://localhost:8000）で開いてください。"
      : "お題を読み込めませんでした。ページを再読み込みしてください。";
    input.disabled = true;
  }

  function pickText(next) {
    const list = texts;
    if (next || textIndex < 0) {
      let i;
      do {
        i = Math.floor(Math.random() * list.length);
      } while (list.length > 1 && i === textIndex);
      textIndex = i;
    }
    return list[textIndex];
  }

  function reset(next) {
    if (texts.length === 0) return; // 読み込み前・失敗時は何もしない
    const picked = pickText(next);
    textId = picked.name;
    target = picked.text;
    events = [];
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

    input.value = "";
    input.maxLength = target.length;
    input.disabled = false;
    resultEl.hidden = true;
    board.classList.remove("finished");

    // お題を1文字ずつ span にする
    textEl.textContent = "";
    const frag = document.createDocumentFragment();
    charEls = Array.from(target, function (ch) {
      const span = document.createElement("span");
      span.textContent = ch;
      frag.appendChild(span);
      return span;
    });
    textEl.appendChild(frag);

    render();
    updateStats();
    input.focus();
  }

  function render() {
    const value = input.value;
    for (let i = 0; i < charEls.length; i++) {
      let cls = "";
      if (i < value.length) {
        cls = isCorrect(value[i], target[i]) ? "ok" : "ng";
      } else if (i === value.length) {
        cls = "current";
      }
      if (charEls[i].className !== cls) {
        charEls[i].className = cls;
      }
    }
  }

  function correctCount() {
    const value = input.value;
    let n = 0;
    for (let i = 0; i < value.length; i++) {
      if (isCorrect(value[i], target[i])) n++;
    }
    return n;
  }

  function elapsedSec() {
    if (!startTime) return 0;
    return ((endTime || performance.now()) - startTime) / 1000;
  }

  function calc() {
    const sec = elapsedSec();
    const wpm = sec > 0 ? (correctCount() / 5) / (sec / 60) : 0;
    const acc = keystrokes > 0 ? ((keystrokes - misses) / keystrokes) * 100 : 100;
    return { sec: sec, wpm: wpm, acc: acc };
  }

  function updateStats() {
    const r = calc();
    // 打ち始め直後は値が極端に跳ねるので、2秒経つまで平均 IKI と WPM は出さない
    const show = finished || r.sec >= 2;
    // 途中の平均 IKI は、ここまでに進んだ文字数で割る（最後まで打つと結果の値と同じになる）
    const iki = Store.avgIki(r.sec, input.value.length);
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
    r.avgIki = Store.avgIki(Math.round(r.sec * 1000) / 1000, target.length);
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
      lang: LANG,
      mode: MODE,
      keyLayout: keyLayoutEl.value,
      textId: textId,
      textLength: target.length,
      result: {
        wpm: Math.round(r.wpm * 10) / 10,
        accuracy: Math.round(r.acc * 10) / 10,
        timeSec: Math.round(r.sec * 1000) / 1000,
        keystrokes: keystrokes,
        misses: misses,
        uncorrected: r.uncorrected,
        avgIki: r.avgIki
      }
    };
    const raw = {
      id: id,
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

  // 全キー入力を記録する。どの行も5要素にそろえる（docs/storage.md）
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
    const value = input.value;
    const now = performance.now();

    // 末尾に追加された文字だけを打鍵として数える
    if (value.length > prevValue.length && value.startsWith(prevValue)) {
      if (!startTime) {
        startTime = now;
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
    if (blockedKeys.indexOf(e.key) !== -1) e.preventDefault();
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

  // 記録の書き出し・読み込み
  document.getElementById("export-btn").addEventListener("click", function () {
    Store.exportFile()
      .then(function (n) { if (n === 0) alert("まだ記録がありません。"); })
      .catch(function (err) { alert("書き出せませんでした: " + err.message); });
  });
  document.getElementById("import-btn").addEventListener("click", function () {
    importFileEl.value = "";
    importFileEl.click();
  });
  importFileEl.addEventListener("change", function () {
    const file = importFileEl.files[0];
    if (!file) return;
    file.text()
      .then(Store.importFile)
      .then(function (r) {
        alert(r.added + " 件の記録を読み込みました。" + (r.skipped ? "（" + r.skipped + " 件はすでにあるため飛ばしました）" : ""));
      })
      .catch(function (err) { alert("読み込めませんでした: " + err.message); });
  });

  document.getElementById("retry-btn").addEventListener("click", function () { reset(false); });
  document.getElementById("next-btn").addEventListener("click", function () { reset(true); });

  // 右下隅にバージョン（index.html の ?v= の番号）を出す
  document.getElementById("version").textContent = ASSET_VERSION ? "v" + ASSET_VERSION : "";

  textEl.textContent = "お題を読み込み中…";
  loadTexts()
    .then(function () { reset(true); })
    .catch(showLoadError);
})();
