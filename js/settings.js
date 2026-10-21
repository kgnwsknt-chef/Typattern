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
    indicator: { type: "boolean", def: true }                                   // タイピング中のインジケーター（目標のレベルとの差）を出すか
  };

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
    const n = Number(value);
    if (value === null || value === "" || !isFinite(n)) return item.def;
    const stepped = Math.round(n / item.step) * item.step;
    return Math.min(item.max, Math.max(item.min, stepped));
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

  return { ITEMS: ITEMS, get: get, set: set, reset: reset };
})();
