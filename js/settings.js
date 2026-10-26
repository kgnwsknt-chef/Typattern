// 設定（設定のページで変える値）の読み書き。全ページ共通。決まりは docs/settings.md
// ブラウザの localStorage に保存する（記録の書き出しには含めない）
const Settings = (function () {
  "use strict";

  const STORAGE_KEY = "typing-test.settings";

  // 項目ごとの初期値と範囲。数値は min〜max に直し、step の倍数に丸める
  const ITEMS = {
    ngramMaxMs: { type: "number", def: 2000, min: 100, max: 5000, step: 50, unit: "ms" },  // n-gram の分布の横軸の最大(ms)
    rhythmMaxMs: { type: "number", def: 600, min: 100, max: 5000, step: 50, unit: "ms" },  // キーごとの間隔の棒の最大(ms)
    rankMinAccuracy: { type: "number", def: 95, min: 50, max: 100, step: 1, unit: "%" },   // ランキングに載せる正確率の下限(%)
    idleStopSec: { type: "number", def: 60, min: 30, max: 600, step: 10, unit: "秒" },    // タイピング中、入力がないまま止めるまでの秒数
    weakRecentRuns: { type: "number", def: 30, min: 10, max: 200, step: 10, unit: "回" }, // 苦手な単語を数える、直近の単語モードの記録の回数
    indicator: { type: "boolean", def: true },                                  // タイピング中のインジケーター（目標のレベルとの差）を出すか
    showStats: { type: "boolean", def: true },                                  // タイピング中、数字の行（平均 IKI・正確率・秒・ミス）を出すか
    showGuide: { type: "boolean", def: true },                                  // 日本語のローマ字入力で、次に打つローマ字の手引きを出すか
    jaSecondLine: { type: "choice", def: "kana", choices: ["kana", "romaji"] }, // 日本語のお題の2行目：よみがな か ローマ字（ローマ字で打つときだけ）
    ikiMeasurementChars: { type: "keys", def: "qwertyuiopasdfghjklzxcvbnm;',./" },  // IKI 測定モードで語に使う文字（Shift なしで打てる QWERTY の文字）
    ikiMeasurementPick: { type: "choice", def: "least", choices: ["least", "random"] }, // IKI 測定モードの語の作り方：少ない bigram（B）か 文字列から（A）
    // 指の割り当て（IKI のページの「指と行(row)で分けた bigram・trigram」）。手（L・R）と指（1 人差し指〜4 小指）ごとに、打つキー（QWERTY の文字）
    fingerMap: { type: "fingers", def: { L4: "qaz", L3: "wsx", L2: "edc", L1: "rtfgvb", R1: "yuhjnm", R2: "ik,", R3: "ol.", R4: "p[]\\;'/" } }
  };
  const FINGER_KEYS = ["L4", "L3", "L2", "L1", "R1", "R2", "R3", "R4"];
  // "keys" の項目で使える文字（Shift なしで打てる QWERTY の文字。スペースは除く）
  const KEY_CHARS = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function normalize(name, value) {
    const item = ITEMS[name];
    if (item.type === "boolean") return typeof value === "boolean" ? value : item.def;
    if (item.type === "choice") return item.choices.indexOf(value) !== -1 ? value : item.def;
    if (item.type === "keys") {
      // 使えない文字を除き、重なった文字はまとめる（大文字は小文字にする）。2文字未満なら初期値
      if (typeof value !== "string") return item.def;
      const chars = [];
      Array.from(value.toLowerCase()).forEach(function (c) {
        if (KEY_CHARS.indexOf(c) !== -1 && chars.indexOf(c) === -1) chars.push(c);
      });
      return chars.length >= 2 ? chars.join("") : item.def;
    }
    if (item.type === "fingers") {
      // 使えない文字を除いて指ごとにそろえる。同じキーが2つの指にあれば、初期値にする（設定のページでは保存させない）
      const parsed = parseFingers(value);
      return parsed && fingerConflicts(parsed).length === 0 ? parsed : item.def;
    }
    const n = Number(value);
    if (value === null || value === "" || !isFinite(n)) return item.def;
    const stepped = Math.round(n / item.step) * item.step;
    return Math.min(item.max, Math.max(item.min, stepped));
  }

  // 指の割り当てを { L4: "qaz", … } にそろえる（使えない文字は除き、同じ指の中で重なった文字は1つに。大文字は小文字に）。形が違えば null
  function parseFingers(value) {
    if (!value || typeof value !== "object") return null;
    const out = {};
    FINGER_KEYS.forEach(function (f) {
      const chars = [];
      Array.from(String(value[f] || "").toLowerCase()).forEach(function (c) {
        if (KEY_CHARS.indexOf(c) !== -1 && chars.indexOf(c) === -1) chars.push(c);
      });
      out[f] = chars.join("");
    });
    return out;
  }

  // 2つ以上の指に書いたキー [{ key, fingers: ["L1", "L2"] }]
  function fingerConflicts(map) {
    const owners = {};
    FINGER_KEYS.forEach(function (f) {
      Array.from(map[f] || "").forEach(function (c) { (owners[c] = owners[c] || []).push(f); });
    });
    return Object.keys(owners).filter(function (c) { return owners[c].length > 1; })
      .map(function (c) { return { key: c, fingers: owners[c] }; });
  }

  // 保存した値（なければ初期値）
  function get(name) {
    return normalize(name, load()[name]);
  }

  // 範囲に直して保存し、保存した値を返す
  function set(name, value) {
    const all = load();
    all[name] = normalize(name, value);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) { /* 保存できなくても今の表示は続ける */ }
    return all[name];
  }

  // すべて初期値に戻す
  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 無視 */ }
  }

  return { ITEMS: ITEMS, FINGER_KEYS: FINGER_KEYS, get: get, set: set, reset: reset, parseFingers: parseFingers, fingerConflicts: fingerConflicts };
})();
