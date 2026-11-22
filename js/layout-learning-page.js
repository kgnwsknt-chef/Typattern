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
  const carrySectionEl = document.getElementById("ll-carry"); // 覚えた割り当ての引き継ぎ
  const carryFromEl = document.getElementById("ll-carry-from");
  const carryBtn = document.getElementById("ll-carry-btn");
  const carryClearBtn = document.getElementById("ll-carry-clear");
  const carryMsgEl = document.getElementById("ll-carry-msg");
  const CARRY_LABEL = carryBtn.textContent;
  const CLEAR_LABEL = carryClearBtn.textContent;

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
    const p = planOf(layout);
    const mine = mineOf(layout);
    // 引き継いだ割り当ての数え分も合わせる（docs/layout-learning.md の「引き継ぎ」）
    const all = LayoutLearning.withCarry(p, mine, layout.carry);
    const s = LayoutLearning.state(p, lists[en ? "en" : "ja"], all);
    const learned = s.learned;

    // 覚えた数と、今の段階・次に覚える単位
    const stage = s.stage === "1-1" ? "1-1. 頻出8字"
      : s.stage === "1-2" ? "1-2. 3つずつ足す（" + p.basicName + "）"
      : s.stage === "done" ? "習得完了"
      : s.areaIndex !== -1 ? "2. 学習区画「" + p.areas[s.areaIndex].name + "」" : "2. 配列ごとの学習区画";
    const got = p.units.filter(function (u) { return learned.has(u); }).length;
    const carried = layout.carry ? LayoutLearning.carryRows(p, layout.carry) : [];
    summaryEl.textContent = "キー配列習得の回 " + mine.length + " 回" +
      (layout.carry ? "（「" + layout.carry.from + "」から " + carriedUnits(carried) + " 個の割り当てを引き継ぎ）" : "") + " ／ 覚えた割り当て " + got + " / " + p.units.length +
      " ／ 今の段階：" + stage +
      (s.newUnits.length ? " ／ 次に覚える割り当て：" + s.newUnits.map(function (u) { return "「" + u + "」"; }).join("") + (s.stuck ? LayoutLearning.STUCK_NOTE : "") : "");

    // 達成項目
    milestonesEl.textContent = "";
    // 達成項目は、範囲の単位を全部同時に覚えたときに達成（一度達成したら、忘れても消えない）
    // 1つずつ四角いタイルにして、3列に並べる（達成したものは色を付けて ✓、まだのものは今覚えている数）
    LayoutLearning.achieved(p, all).forEach(function (m) {
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

    renderCarry(layout);
  }

  // ---- 覚えた割り当ての引き継ぎ ----

  function planOf(layout) {
    return layout.type === "eng" ? LayoutLearning.planEng(layout.entries) : LayoutLearning.plan(layout.entries);
  }

  function mineOf(layout) {
    return sessions.filter(function (s) { return s.mode === LayoutLearning.MODE && s.keyLayout === layout.id; });
  }

  // 引き継いだ数え分に出てくる単位の数
  function carriedUnits(rows) {
    const set = new Set();
    rows.forEach(function (r) { Object.keys(r.learning.units).forEach(function (u) { set.add(u); }); });
    return set.size;
  }

  // 引き継ぐのも取り消すのも2回押しで確かめる（1回目で中身を見せる）。押していない方・配列を変えたときは元に戻す
  let armed = null;

  function disarm() {
    armed = null;
    carryBtn.textContent = CARRY_LABEL;
    carryClearBtn.textContent = CLEAR_LABEL;
    carryBtn.classList.remove("tm-danger");
    carryClearBtn.classList.remove("tm-danger");
  }

  function arm(btn, label) {
    disarm();
    armed = btn;
    btn.textContent = label;
    btn.classList.add("tm-danger");
  }

  function currentLayout() {
    return layouts.filter(function (l) { return l.id === layoutEl.value; })[0];
  }

  // 引き継ぐ元の配列の候補：同じ種類（かな配列どうし・英語の配列どうし。英語は QWERTY も）の、ほかの配列
  function renderCarry(layout) {
    disarm();
    carryMsgEl.textContent = "";
    // QWERTY は登録した配列ではない（登録データがない）ので、引き継ぎ先にしない
    carrySectionEl.hidden = layout.id === "qwerty";
    if (layout.id === "qwerty") return;
    const prev = carryFromEl.value;
    carryFromEl.textContent = "";
    layouts.forEach(function (l) {
      if (l.id === layout.id || (l.type === "eng") !== (layout.type === "eng")) return;
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      carryFromEl.appendChild(o);
    });
    if (prev && Array.prototype.some.call(carryFromEl.options, function (o) { return o.value === prev; })) carryFromEl.value = prev;
    carryBtn.disabled = !carryFromEl.options.length;
    if (!carryFromEl.options.length) carryMsgEl.textContent = "引き継ぐ元にできる、同じ種類の配列がありません。";
    carryClearBtn.hidden = !layout.carry;
    if (layout.carry) {
      const d = new Date(layout.carry.at);
      carryMsgEl.textContent = "今は「" + layout.carry.from + "」から引き継いでいます（" + d.toLocaleDateString("ja-JP") + "）。もう一度引き継ぐと、前の引き継ぎを置き換えます。";
    }
  }

  function saveCarry(layout, carry) {
    const rec = Object.assign({}, layout);
    if (carry) rec.carry = carry;
    else delete rec.carry;
    return Store.saveLayout(rec).then(function () {
      layouts[layouts.indexOf(layout)] = rec;
      PageFooter.refreshSize();
      render();
    });
  }

  carryFromEl.addEventListener("change", function () { disarm(); });

  carryBtn.addEventListener("click", function () {
    const layout = currentLayout();
    const from = layouts.filter(function (l) { return l.id === carryFromEl.value; })[0];
    if (!layout || !from) return;
    const made = LayoutLearning.makeCarry(planOf(layout), planOf(from), from.name, mineOf(from), from.carry);
    if (armed !== carryBtn) {
      arm(carryBtn, "引き継ぐ（確定）");
      carryMsgEl.textContent = "「" + from.name + "」の割り当てを引き継ぎます。割り当てが同じものは " + made.same.length + " 個で、そのうち「" + from.name + "」で打った記録があるもの " + made.counted.length + " 個（覚えているもの " + made.learned.length + " 個）の数え分を写します。" +
        (made.differ.length ? "割り当てが違うので引き継がないもの：" + made.differ.map(function (u) { return "「" + u + "」"; }).join("") + "。" : "") +
        (layout.carry ? "今の「" + layout.carry.from + "」からの引き継ぎは置き換えます。" : "") +
        "もう一度押すと引き継ぎます。";
      return;
    }
    disarm();
    saveCarry(layout, made.carry).then(function () {
      carryMsgEl.textContent = "「" + from.name + "」から " + made.counted.length + " 個の割り当ての数え分を引き継ぎました（覚えているもの " + made.learned.length + " 個）。";
    }).catch(function (err) {
      console.error(err);
      carryMsgEl.textContent = "引き継げませんでした: " + err.message;
    });
  });

  carryClearBtn.addEventListener("click", function () {
    const layout = currentLayout();
    if (!layout || !layout.carry) return;
    if (armed !== carryClearBtn) {
      arm(carryClearBtn, "取り消す（確定）");
      carryMsgEl.textContent = "「" + layout.carry.from + "」からの引き継ぎを取り消します。この配列で打った記録だけで数え直します。もう一度押すと取り消します。";
      return;
    }
    disarm();
    saveCarry(layout, null).then(function () {
      carryMsgEl.textContent = "引き継ぎを取り消しました。";
    }).catch(function (err) {
      console.error(err);
      carryMsgEl.textContent = "取り消せませんでした: " + err.message;
    });
  });

  PageFooter.init();
  Promise.all([Store.getAllLayouts(), Store.getAllSessions(), LayoutLearning.loadLists(fetchText, "ja"), LayoutLearning.loadLists(fetchText, "en")])
    .then(function (v) {
      // 最初に QWERTY（入れ替えのない英語の配列として扱う）、その後に登録した配列を名前の順に
      // 同時押しのあるかな配列は、まだキー配列習得に使えないので出さない（docs/layout-learning.md）
      layouts = [{ id: "qwerty", name: "QWERTY配列", type: "eng", entries: [] }].concat(v[0]
        .filter(function (l) { return l.type === "eng" || !KanaLayout.hasChord(l.entries); })
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
