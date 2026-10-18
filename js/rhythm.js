// キーごとの打鍵間隔を棒グラフで表示する
const Rhythm = (function () {
  "use strict";

  const BAR_MAX = 72; // 棒の最大の高さ(px)。style.css の .rh-track の高さに合わせる
  const CAP_MS = 600; // 棒の高さの最大(ms)。これを超える間隔は頭打ちにする（どの回も同じ尺度で比べられるよう固定）

  // 英語：お題の文字ごとにグラフを描き、平均間隔(ms, 整数)を返す。間隔が1つもなければ "-"
  // 単語の途中で折り返さないよう、「単語＋後ろのスペース」をひとまとまり（rh-word）にする
  function render(container, target, intervals, missed) {
    const words = [];
    for (let i = 0; i < target.length; i++) {
      if (i === 0 || target[i - 1] === " ") words.push({ groups: [{ cols: [] }] });
      words[words.length - 1].groups[0].cols.push({ ch: target[i], v: intervals[i], missed: missed[i] });
    }
    return draw(container, words);
  }

  // 日本語：押したキーごとにグラフを描き、平均間隔(ms, 整数)を返す
  //   kana：かなのまとまり [{ caption: かな, keys: [{ ch: キーの文字, v: 直前のキーからの間隔 }], missed, breakBefore, join }]
  //   かなごとにキーの列をまとめ、下にかなを書く。どのかなの後でも折り返すが、join のもの（「、」など）は前のかなと離さない。
  //   breakBefore のもの（「。」の次）は改行してから描く
  function renderKeys(container, kana) {
    const words = [];
    kana.forEach(function (k) {
      if (!k.join || words.length === 0) words.push({ breakBefore: k.breakBefore, groups: [] });
      words[words.length - 1].groups.push({
        caption: k.caption,
        missed: k.missed,
        cols: k.keys.map(function (key) { return { ch: key.ch, v: key.v, missed: k.missed }; })
      });
    });
    return draw(container, words);
  }

  // 日本語の判定（js/typer.js）の確定したまとまり units から、renderKeys に渡すかなのまとまりを作る
  //   target：打ったお題（読み）、missed：位置ごとのミスの有無（true/false の配列）
  function kanaColumns(units, target, missed) {
    return units.map(function (u) {
      const caption = target.substr(u.pos, u.len);
      return {
        caption: caption === " " ? "_" : caption, // 単語の間のスペースは英語と同じく _ で出す
        // 飛ばしたかな（打ち方がない）はキーがないので、空の列を1つ置く
        keys: u.keyList.length === 0 ? [{ ch: "", v: null }] : u.keyList.map(function (k) {
          // 文字のないキー（JIS の「ろ」など）は ? で表す
          return { ch: k.ch === "\u0000" ? "?" : k.ch, v: k.prev === null ? null : k.time - k.prev };
        }),
        missed: missed.slice(u.pos, u.pos + u.len).some(function (m) { return m; }),
        breakBefore: u.pos > 0 && target[u.pos - 1] === "。",
        join: /^[、。ーぁぃぅぇぉゃゅょっゎ]/.test(caption)
      };
    });
  }

  // words：折り返しの単位 [{ breakBefore, groups: [{ caption, missed, cols: [{ ch, v, missed }] }] }]
  function draw(container, words) {
    container.textContent = "";

    const values = [];
    words.forEach(function (w) {
      w.groups.forEach(function (g) {
        g.cols.forEach(function (c) { if (c.v !== null) values.push(c.v); });
      });
    });
    if (values.length === 0) return "-";

    const avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    const cap = CAP_MS;
    const scaleMax = CAP_MS; // 棒の一番上 = CAP_MS
    const toPx = function (v) { return Math.round((Math.min(v, cap) / scaleMax) * BAR_MAX); };

    container.style.setProperty("--rh-avg", toPx(avg) + "px");

    const hue = readHue();
    const toColor = function (v) { return colorFor(v, avg, hue); };

    const frag = document.createDocumentFragment();
    words.forEach(function (w) {
      if (w.breakBefore) {
        const br = document.createElement("div");
        br.className = "rh-break"; // 文の終わりで改行する
        frag.appendChild(br);
      }
      const word = document.createElement("div");
      word.className = "rh-word";
      w.groups.forEach(function (g) {
        let parent = word;
        if (g.caption !== undefined) {
          // かなのまとまり：キーの列の下にかなを書く
          const group = document.createElement("div");
          group.className = "rh-group";
          parent = document.createElement("div");
          parent.className = "rh-cols";
          const kanaEl = document.createElement("div");
          kanaEl.className = "rh-kana" + (g.missed ? " missed" : "");
          kanaEl.textContent = g.caption;
          group.appendChild(parent);
          group.appendChild(kanaEl);
          word.appendChild(group);
        }
        g.cols.forEach(function (c) {
          parent.appendChild(column(c.ch, c.v, c.missed, cap, toPx, toColor));
        });
      });
      frag.appendChild(word);
    });
    container.appendChild(frag);

    return Math.round(avg);
  }

  // 色相は style.css の :root の変数から読む
  function readHue() {
    const css = getComputedStyle(document.documentElement);
    return {
      fast: parseFloat(css.getPropertyValue("--rh-hue-fast")),
      avg: parseFloat(css.getPropertyValue("--rh-hue-avg")),
      slow: parseFloat(css.getPropertyValue("--rh-hue-slow"))
    };
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

  // 他の表示（バイグラム一覧など）でも同じ配色を使うための関数
  function color(v, avg) {
    return colorFor(v, avg, readHue());
  }

  return { render: render, renderKeys: renderKeys, kanaColumns: kanaColumns, color: color };
})();
