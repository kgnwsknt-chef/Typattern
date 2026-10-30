// キー配列習得のページ（layout-learning.html）。選んだかな配列について、覚えた単位の数・達成項目・覚えたかなの図・キー配列を出す
// 決まりは docs/layout-learning.md。求め方は js/layout-learning.js
(function () {
  "use strict";

  // タイピング画面で選んだキー配列（app.js と同じキー）。かな配列なら、最初はそれを出す
  const KEY_LAYOUT_STORAGE = "typing-test.keyLayout";
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "";
  const layoutEl = document.getElementById("ll-layout");
  const summaryEl = document.getElementById("ll-summary");
  const milestonesEl = document.getElementById("ll-milestones");
  const mandalaEl = document.getElementById("ll-mandala");
  const keymapEl = document.getElementById("ll-keymap");
  const faceEl = document.getElementById("ll-face"); // キー配列の面（シフトなし・シフト面）

  function fetchText(path) {
    return fetch(path + "?v=" + ASSET_VERSION).then(function (r) {
      if (!r.ok) throw new Error(path + ": " + r.status);
      return r.text();
    });
  }

  let layouts = [];
  let lists = null;
  let sessions = [];

  function render() {
    const layout = layouts.filter(function (l) { return l.id === layoutEl.value; })[0];
    if (!layout) return;
    const p = LayoutLearning.plan(layout.entries);
    const mine = sessions.filter(function (s) { return s.mode === LayoutLearning.MODE && s.keyLayout === layout.id; });
    const s = LayoutLearning.state(p, lists, mine);
    const learned = s.learned;

    // 覚えた数と、今の段階・次に覚える単位
    const stage = s.stage === "1-1" ? "1-1. 最初の8字"
      : s.stage === "1-2" ? "1-2. 2つずつ足す（基本30字）"
      : s.stage === "done" ? "習得完了"
      : s.areaIndex !== -1 ? "2. 学習区画「" + p.areas[s.areaIndex].name + "」" : "2. 配列ごとの学習区画";
    const got = p.units.filter(function (u) { return learned.has(u); }).length;
    summaryEl.textContent = "キー配列習得の回 " + mine.length + " 回 ／ 覚えた割り当て " + got + " / " + p.units.length +
      " ／ 今の段階：" + stage +
      (s.newUnits.length ? " ／ 次に覚える割り当て：" + s.newUnits.map(function (u) { return "「" + u + "」"; }).join("") : "");

    // 達成項目
    milestonesEl.textContent = "";
    // 達成項目は、範囲の単位を全部同時に覚えたときに達成（一度達成したら、忘れても消えない）
    // 1つずつ四角いタイルにして、3列に並べる（達成したものは色を付けて ✓、まだのものは今覚えている数）
    LayoutLearning.achieved(p, mine).forEach(function (m) {
      const tile = document.createElement("div");
      tile.className = "ll-tile " + (m.done ? "ll-done" : "ll-todo");
      const mark = document.createElement("div");
      mark.className = "ll-tile-mark";
      mark.textContent = m.done ? "✓" : "";
      const name = document.createElement("div");
      name.className = "ll-tile-name";
      name.textContent = m.name;
      const note = document.createElement("div");
      note.className = "ll-tile-note";
      note.textContent = m.done ? "達成" : m.got + " / " + m.total;
      tile.append(mark, name, note);
      milestonesEl.appendChild(tile);
    });

    // 覚えたかなの図
    KanaMandala.draw(mandalaEl, LayoutLearning.mandalaOpts(p, learned));

    // キー配列：シフトなしの面のかなのキーに、覚えたかどうかの色を付ける
    // キー配列：選んだ面（シフトなしの面・シフト面）で、各キーが出すかなを書き、覚えた単位のキーに色を付ける
    const base = KeyMap.kanaOf(KanaLayout.create(layout.entries));
    const faces = [""].concat(p.faces);
    const prevFace = faceEl.value;
    faceEl.textContent = "";
    faces.forEach(function (f, i) {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = !f ? "シフトなしの面" : (p.faces.length === 1 ? "シフト面" : "シフト面" + i) + "（" + (f === "Shift" ? "Shift" : f + " のキー") + "）";
      faceEl.appendChild(o);
    });
    faceEl.value = faces.indexOf(prevFace) !== -1 ? prevFace : "";
    const face = faceEl.value;
    // そのキーをその面で押したときのかな。前置シフトはシフトのキー → キー、後置シフトはキー → シフトのキーの順に押す
    const faceGet = function (ch) {
      if (!face) return base.get(ch);
      if (face === "Shift") { const k = Keys.ofChar(ch); return k ? base.get(Keys.charOf(k.number, true)) : null; }
      if (ch === face) return null;
      return base.shifts.prefix.indexOf(face) !== -1 ? base.get(face + ch) : base.get(ch + face);
    };
    const kana = { get: faceGet, shifts: base.shifts };
    const fill = getComputedStyle(document.documentElement).getPropertyValue("--ll-learned").trim();
    KeyMap.draw(keymapEl, function (number) {
      const ch = Keys.charOf(number, false);
      const u = ch === null ? null : kana.get(ch);
      if (!u || !p.unitSet.has(u)) return null;
      const st = s.status.get(u);
      const ok = learned.has(u);
      return {
        fill: ok ? fill : "",
        value: "",
        title: "「" + u + "」" + (ok ? "覚えた" : "まだ") + (st && st.acc !== null ? "（直近 " + st.count + " 回の正確率 " + st.acc.toFixed(1) + "%）" : st ? "（" + st.count + " 回）" : "")
      };
    }, kana);
  }

  PageFooter.init();
  Promise.all([Store.getAllLayouts(), Store.getAllSessions(), LayoutLearning.loadLists(fetchText)])
    .then(function (v) {
      layouts = v[0].filter(function (l) { return l.type !== "eng"; })
        .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      sessions = v[1];
      lists = v[2];
      if (!layouts.length) {
        summaryEl.textContent = "かな配列がまだ登録されていません。「設定」のページから開く「キー配列」のページで、かな配列を登録してください。";
        return;
      }
      layouts.forEach(function (l) {
        const o = document.createElement("option");
        o.value = l.id;
        o.textContent = l.name;
        layoutEl.appendChild(o);
      });
      try {
        const saved = localStorage.getItem(KEY_LAYOUT_STORAGE);
        if (saved && layouts.some(function (l) { return l.id === saved; })) layoutEl.value = saved;
      } catch (e) { /* 最初の配列を使う */ }
      layoutEl.addEventListener("change", render);
      faceEl.addEventListener("change", render);
      render();
    })
    .catch(function (err) {
      console.error(err);
      summaryEl.textContent = "記録を読み込めませんでした: " + err.message;
    });
})();
