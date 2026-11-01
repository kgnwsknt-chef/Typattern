// キー配列習得のページ（layout-learning.html）。選んだ配列（QWERTY・かな配列・英語の配列）について、覚えた単位の数・達成項目・覚えたかなの図（かな配列だけ）・キー配列を出す
// 決まりは docs/layout-learning.md。求め方は js/layout-learning.js
(function () {
  "use strict";

  // タイピング画面で選んだキー配列（app.js と同じキー）。登録した配列なら、最初はそれを出す
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
  let lists = null; // 言語 → 単語リスト（日本語はかな配列、英語は英語の配列で使う）
  let sessions = [];

  function render() {
    const layout = layouts.filter(function (l) { return l.id === layoutEl.value; })[0];
    if (!layout) return;
    const en = layout.type === "eng";
    const p = en ? LayoutLearning.planEng(layout.entries) : LayoutLearning.plan(layout.entries);
    const mine = sessions.filter(function (s) { return s.mode === LayoutLearning.MODE && s.keyLayout === layout.id; });
    const s = LayoutLearning.state(p, lists[en ? "en" : "ja"], mine);
    const learned = s.learned;

    // 覚えた数と、今の段階・次に覚える単位
    const stage = s.stage === "1-1" ? "1-1. 頻出8字"
      : s.stage === "1-2" ? "1-2. 2つずつ足す（" + p.basicName + "）"
      : s.stage === "done" ? "習得完了"
      : s.areaIndex !== -1 ? "2. 学習区画「" + p.areas[s.areaIndex].name + "」" : "2. 配列ごとの学習区画";
    const got = p.units.filter(function (u) { return learned.has(u); }).length;
    summaryEl.textContent = "キー配列習得の回 " + mine.length + " 回 ／ 覚えた割り当て " + got + " / " + p.units.length +
      " ／ 今の段階：" + stage +
      (s.newUnits.length ? " ／ 次に覚える割り当て：" + s.newUnits.map(function (u) { return "「" + u + "」"; }).join("") + (s.stuck ? LayoutLearning.STUCK_NOTE : "") : "");

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

    // 覚えたかなの図（かな配列だけ。英語の配列は下のキー配列の図で見る）
    mandalaEl.closest("section").hidden = en;
    if (!en) KanaMandala.draw(mandalaEl, LayoutLearning.mandalaOpts(p, learned));

    // キー配列：シフトなしの面のかなのキーに、覚えたかどうかの色を付ける
    // キー配列：選んだ面（シフトなしの面・シフト面）で、各キーが出すかなを書き、覚えた単位のキーに色を付ける
    // 英語の配列は、そのキーを押したときの文字（シフトのキーはない）
    const base = en
      ? { get: KanaLayout.engMap(layout.entries).toChar, shifts: { prefix: [], postfix: [] } }
      : KeyMap.kanaOf(KanaLayout.create(layout.entries));
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
  Promise.all([Store.getAllLayouts(), Store.getAllSessions(), LayoutLearning.loadLists(fetchText, "ja"), LayoutLearning.loadLists(fetchText, "en")])
    .then(function (v) {
      // 最初に QWERTY（入れ替えのない英語の配列として扱う）、その後に登録した配列を名前の順に
      layouts = [{ id: "qwerty", name: "QWERTY", type: "eng", entries: [] }].concat(v[0].slice()
        .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }));
      sessions = v[1];
      lists = { ja: v[2], en: v[3] };
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
