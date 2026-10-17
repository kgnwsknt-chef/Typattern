(function () {
  "use strict";

  const LANG = "en";
  // URL に ?short が付いていたら短いお題を使う（試し打ち用）
  const SHORT = new URLSearchParams(location.search).has("short");

  const board = document.getElementById("board");
  const passageEl = document.getElementById("passage");
  const input = document.getElementById("input");
  const resultEl = document.getElementById("result");
  const rhythmEl = document.getElementById("rhythm");
  const rhythmAvgEl = document.getElementById("rhythm-avg");

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
    miss: document.getElementById("res-miss")
  };

  // 状態
  let passageIndex = -1;
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

  function pickPassage(next) {
    const list = SHORT ? PASSAGES_SHORT[LANG] : PASSAGES[LANG];
    if (next || passageIndex < 0) {
      let i;
      do {
        i = Math.floor(Math.random() * list.length);
      } while (list.length > 1 && i === passageIndex);
      passageIndex = i;
    }
    return list[passageIndex];
  }

  function reset(next) {
    target = pickPassage(next);
    prevValue = "";
    startTime = 0;
    endTime = 0;
    keystrokes = 0;
    misses = 0;
    lastKeyTime = 0;
    intervals = new Array(target.length).fill(null);
    missed = new Array(target.length).fill(false);
    rhythmEl.textContent = "";
    finished = false;
    clearInterval(timerId);

    input.value = "";
    input.maxLength = target.length;
    input.disabled = false;
    resultEl.hidden = true;
    board.classList.remove("finished");

    // お題を1文字ずつ span にする
    passageEl.textContent = "";
    const frag = document.createDocumentFragment();
    charEls = Array.from(target, function (ch) {
      const span = document.createElement("span");
      span.textContent = ch;
      frag.appendChild(span);
      return span;
    });
    passageEl.appendChild(frag);

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
    rhythmAvgEl.textContent = Rhythm.render(rhythmEl, target, intervals, missed);
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
  document.getElementById("retry-btn").addEventListener("click", function () { reset(false); });
  document.getElementById("next-btn").addEventListener("click", function () { reset(true); });

  reset(true);
})();
