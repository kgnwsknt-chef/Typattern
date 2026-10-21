// 保存した1回分の記録から、結果画面と同じ「キーごとの間隔」のグラフを描く（記録のページのランキングで使う）
// 決まりは docs/records.md の「ランキング」
const SessionView = (function () {
  "use strict";

  // 日本語：記録したキー（events の "k" の行）を判定（js/typer.js）にもう一度通し、打ったときのまとまりを再現する
  //   optionsFn：打ち方の一覧（Romaji.options か、かな配列の KanaLayout.create(…).options）
  //   再現した "+" の行が記録と合わないとき（判定の決まりがその後に変わったときなど）は null
  //   observe(e, before, result, shiftOn)：渡すと、Shift 以外の "k" の行ごとに呼ぶ（ミスタイプのページで使う）。
  //     before は押す前の typer.expect()、result は typer.press の結果（Backspace のときはどちらも null）
  function replay(raw, optionsFn, observe) {
    const typer = Typer.create(raw.text, optionsFn);
    const shiftDown = new Set(); // 押されている Shift の番号（"u" の行で離す）
    // "u" の行（Shift を離した）を記録する前の記録では、Shift の次の1キーだけを Shift と同時に押したとみなす
    const hasUp = raw.events.some(function (e) { return e[1] === "u"; });
    const added = []; // 再現した "+" の行 [時刻, かな, 位置, 判定]
    raw.events.forEach(function (e) {
      if (e[1] === "u") {
        shiftDown.delete(e[2]);
        return;
      }
      if (e[1] !== "k") return;
      if (Keys.isShiftNumber(e[2])) {
        shiftDown.add(e[2]);
        return;
      }
      if (e[2] === Keys.BACKSPACE) {
        typer.backspace(e[0]);
        if (observe) observe(e, null, null, shiftDown.size > 0);
        return;
      }
      const before = observe ? typer.expect() : null;
      const shiftOn = shiftDown.size > 0;
      // 文字のないキー（JIS の「ろ」など）は、どの打ち方にも合わない文字として渡す（タイピング画面と同じ）
      const r = typer.press(Keys.charOf(e[2], shiftOn) || "\u0000", e[0]);
      if (observe) observe(e, before, r, shiftOn);
      r.confirmed.forEach(function (u) {
        for (let j = 0; j < u.len; j++) added.push([u.time, raw.text[u.pos + j], u.pos + j, u.correct ? 1 : 0]);
      });
      if (!hasUp) shiftDown.clear();
    });
    const recorded = raw.events.filter(function (e) { return e[1] === "+"; });
    const same = typer.done() && recorded.length === added.length && recorded.every(function (e, i) {
      const a = added[i];
      return Math.abs(e[0] - a[0]) < 0.05 && e[2] === a[1] && e[3] === a[2] && e[4] === a[3];
    });
    return same ? typer.units : null;
  }

  // container にグラフを描き、{ avg: 点線の平均(ms) か "-", note: グラフの説明 } を返す
  //   session：概要の記録、raw：その生データ、layouts：登録したかな配列（Store.getAllLayouts の結果）
  function render(container, session, raw, layouts) {
    const missed = new Array(raw.text.length).fill(false);
    raw.missedPositions.forEach(function (i) { missed[i] = true; });

    if (session.lang !== "ja") {
      return {
        avg: Rhythm.render(container, raw.text, raw.intervals, missed),
        what: "各文字の最後の打鍵の間隔",
        note: ""
      };
    }

    let optionsFn = null;
    if (raw.keyLayout === "qwerty") {
      optionsFn = Romaji.options;
    } else {
      const layout = layouts.find(function (l) { return l.id === raw.keyLayout; });
      if (layout) optionsFn = KanaLayout.create(layout.entries).options;
    }
    const units = optionsFn ? replay(raw, optionsFn) : null;
    if (units) {
      return {
        avg: Rhythm.renderKeys(container, Rhythm.kanaColumns(units, raw.text, missed)),
        what: "最後に残ったかなを打った各キーの、直前のキーからの間隔（下の段はそのかな）",
        note: ""
      };
    }
    // 再現できないときは、保存してあるかなごとの間隔で、かな1文字に棒1本を描く
    const text = raw.text.replace(/ /g, "_");
    return {
      avg: Rhythm.render(container, text, raw.intervals, missed),
      what: "かなごとの間隔（そのかなの最初のキーの直前のキーから、最後のキーまで。2文字まとめて打ったときの2文字目は 0）",
      note: optionsFn
        ? "記録したキーから打ったときの判定を再現できなかったため、かなごとに表示しています。"
        : "かな配列「" + raw.keyLayout + "」が削除されているため、かなごとに表示しています。"
    };
  }

  // その回の数値を1行にする（例「1位 ／ 2026/10/18 18:15 ／ tardigrade ／ 英語・文章・QWERTY ／ 平均 IKI 187.6 ms（64 WPM）／ …」）
  function summary(session, rank) {
    const r = session.result;
    const speed = session.lang === "ja" ? Math.round(r.kanaPerMin) + " かな/分" : Math.round(r.wpm) + " WPM";
    const level = Levels.ofSession(session);
    const rate = Levels.rateOfSession(session);
    const parts = [
      rank + " 位",
      formatDate(session.finishedAt),
      session.textId,
      Ranking.categoryLabel(session),
      "平均 IKI " + r.avgIki.toFixed(1) + " ms（" + speed + "）",
      "正確率 " + r.accuracy.toFixed(1) + "%",
      "ミス " + r.misses + "（未修正 " + r.uncorrected + "）",
      r.timeSec.toFixed(1) + " 秒"
    ];
    // 短い文章は達成レベルに数えないので、ランキングと同じくレベルを出さない
    if (Levels.COUNTED_MODES.indexOf(session.mode) !== -1) {
      parts.push("レベル " + (level ? level.name : "-") + (rate !== null ? "（" + rate.toFixed(2) + " 文字/秒）" : ""));
    }
    return parts.join(" ／ ");
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  return { render: render, summary: summary, replay: replay };
})();
