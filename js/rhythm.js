// キーごとの打鍵間隔を棒グラフで表示する
const Rhythm = (function () {
  "use strict";

  const BAR_MAX = 72; // 棒の最大の高さ(px)。style.css の .rh-track の高さに合わせる
  const CAP_RATIO = 3; // 平均のこの倍を超える間隔は頭打ちにする

  // container にグラフを描き、平均間隔(ms, 整数)を返す。間隔が1つもなければ "-"
  function render(container, target, intervals, missed) {
    container.textContent = "";

    const values = intervals.filter(function (v) { return v !== null; });
    if (values.length === 0) return "-";

    const avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    const cap = avg * CAP_RATIO;
    const scaleMax = Math.max(1, Math.min(Math.max.apply(null, values), cap));
    const toPx = function (v) { return Math.round((Math.min(v, cap) / scaleMax) * BAR_MAX); };

    container.style.setProperty("--rh-avg", toPx(avg) + "px");

    // 色相は style.css の変数から読む
    const css = getComputedStyle(container);
    const hue = {
      fast: parseFloat(css.getPropertyValue("--rh-hue-fast")),
      avg: parseFloat(css.getPropertyValue("--rh-hue-avg")),
      slow: parseFloat(css.getPropertyValue("--rh-hue-slow"))
    };
    const toColor = function (v) { return colorFor(v, avg, hue); };

    // 単語の途中で折り返さないよう、「単語＋後ろのスペース」をひとまとまりにする
    const frag = document.createDocumentFragment();
    let word = null;
    for (let i = 0; i < target.length; i++) {
      if (!word || target[i - 1] === " ") {
        word = document.createElement("div");
        word.className = "rh-word";
        frag.appendChild(word);
      }
      word.appendChild(column(target[i], intervals[i], missed[i], cap, toPx, toColor));
    }
    container.appendChild(frag);

    return Math.round(avg);
  }

  // 間隔 → 棒の色。0 で青、平均で緑、平均の2倍以上で赤。その間は色相をなめらかに変える
  function colorFor(v, avg, hue) {
    const r = Math.min(v / avg, 2);
    const h = r <= 1
      ? hue.fast + (hue.avg - hue.fast) * r
      : hue.avg + (hue.slow - hue.avg) * (r - 1);
    return "hsl(" + Math.round(h) + ", 70%, 42%)";
  }

  // 1文字分の列（数値・棒・文字）
  function column(ch, v, isMissed, cap, toPx, toColor) {
    const col = document.createElement("div");
    col.className = "rh-col";

    const track = document.createElement("div");
    track.className = "rh-track";

    if (v !== null) {
      const px = toPx(v);
      const bar = document.createElement("div");
      bar.className = "rh-bar" + (v > cap ? " clipped" : "");
      bar.style.height = px + "px";
      bar.style.background = toColor(v);
      track.appendChild(bar);

      const val = document.createElement("span");
      val.className = "rh-val";
      val.textContent = Math.round(v);
      val.style.bottom = px + 2 + "px";
      track.appendChild(val);
    }

    const label = document.createElement("div");
    label.className = "rh-char" + (ch === " " ? " space" : "") + (isMissed ? " missed" : "");
    label.textContent = ch === " " ? "_" : ch;

    col.appendChild(track);
    col.appendChild(label);
    return col;
  }

  return { render: render };
})();
