(function () {
  "use strict";

  const LANG = "en";
  // URL に ?short が付いていたら短いお題を使う（試し打ち用）
  const SHORT = new URLSearchParams(location.search).has("short");
  // お題ファイルの置き場所。texts/<言語>/<題材名>.txt、短縮版は <題材名>_short.txt
  const TEXT_DIR = "texts/" + LANG + "/";
  const TEXT_SUFFIX = SHORT ? "_short.txt" : ".txt";
  // index.html で付けた ?v= をお題の読み込みにも付けて、キャッシュで古いお題が出ないようにする
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";

  const board = document.getElementById("board");
  const textEl = document.getElementById("text");
  const input = document.getElementById("input");
  const resultEl = document.getElementById("result");
  const rhythmEl = document.getElementById("rhythm");
  const rhythmAvgEl = document.getElementById("rhythm-avg");
  const bigramEl = document.getElementById("bigram");
  const trigramEl = document.getElementById("trigram");
  const bigramTable = NGram.create(2, "bigram");
  const trigramTable = NGram.create(3, "trigram");
  const tabs = Array.from(document.querySelectorAll(".tab"));

  const stat = {
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
    iki: document.getElementById("res-iki")
  };

  // 状態
  let texts = []; // 読み込んだお題の文
  let textIndex = -1;
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
          return fetchText(TEXT_DIR + name + TEXT_SUFFIX).catch(function (err) {
            console.warn(err);
            return "";
          });
        }));
      })
      .then(function (contents) {
        // 改行や連続した空白は1つのスペースにそろえる
        texts = contents
          .map(function (t) { return t.replace(/\s+/g, " ").trim(); })
          .filter(function (t) { return t.length > 0; });
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
    target = pickText(next);
    prevValue = "";
    startTime = 0;
    endTime = 0;
    keystrokes = 0;
    misses = 0;
    lastKeyTime = 0;
    intervals = new Array(target.length).fill(null);
    missed = new Array(target.length).fill(false);
    rhythmEl.textContent = "";
    bigramEl.textContent = "";
    trigramEl.textContent = "";
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
    // 打ち始め直後は値が極端に跳ねるので、2秒経つまで WPM は出さない
    stat.wpm.textContent = finished || r.sec >= 2 ? Math.round(r.wpm) : "-";
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
    res.wpm.textContent = Math.round(r.wpm);
    res.acc.textContent = r.acc.toFixed(1);
    res.time.textContent = r.sec.toFixed(1);
    res.miss.textContent = misses;
    const avg = Rhythm.render(rhythmEl, target, intervals, missed);
    rhythmAvgEl.textContent = avg;
    res.iki.textContent = avg;
    bigramTable.render(bigramEl, target, intervals, missed, avg);
    trigramTable.render(trigramEl, target, intervals, missed, avg);
    resultEl.hidden = false;
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
    if (value !== prevValue) lastKeyTime = now;
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

  document.getElementById("retry-btn").addEventListener("click", function () { reset(false); });
  document.getElementById("next-btn").addEventListener("click", function () { reset(true); });

  textEl.textContent = "お題を読み込み中…";
  loadTexts()
    .then(function () { reset(true); })
    .catch(showLoadError);
})();
