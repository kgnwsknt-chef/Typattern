// タイピングの記録をブラウザの IndexedDB に保存する。形式は docs/storage.md を参照
//   sessions … 1回ごとの概要（結果の数値など）。ランキングや推移グラフに使う
//   raws     … 1回ごとの生データ（全キー入力・間隔など）。sessions と同じ id で結び付く
const Store = (function () {
  "use strict";

  // schemaVersion 3 以前の記録（旧データベース "typing-records"・"typing-test"）は扱わない。旧データベースは消さずにそのまま残す
  const DB_NAME = "typattern-records";
  const DB_VERSION = 2; // 入れ物（保存場所・索引）の構造の版（2：キー配列の保存場所 layouts を追加）
  const SCHEMA_VERSION = 4; // 記録1件の形式の版（4：events にキーの行 "k" を足し、"+" の時刻を「その文字を生んだ最後のキーの時刻」にした）
  const EXPORT_APP = "typattern"; // 書き出しファイルの app 欄
  const RANK_INDEX = "rank"; // [lang, mode, keyLayout, result.avgIki]
  const RANK_MIN_ACCURACY = 95; // 正確率がこれ未満の記録はランキングに載せない（記録は残す）

  let dbPromise = null;

  // 平均 IKI(ms) = 経過時間 ÷ (お題の文字数 - 1)。修正にかかった時間も含む。定義は docs/measurement.md
  function avgIki(timeSec, textLength) {
    if (textLength < 2) return null;
    return Math.round((timeSec * 1000 / (textLength - 1)) * 10) / 10;
  }

  // 正確率(%) = 最後にお題と合っていた文字の割合。直したミスは含めない。定義は docs/measurement.md
  function accuracy(textLength, uncorrected) {
    if (textLength < 1) return 100;
    return Math.round(((textLength - uncorrected) / textLength) * 1000) / 10;
  }

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
          reject(new Error("このブラウザでは IndexedDB が使えません"));
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          const db = req.result;
          if (e.oldVersion < 1) {
            const sessions = db.createObjectStore("sessions", { keyPath: "id" });
            sessions.createIndex("finishedAt", "finishedAt");
            sessions.createIndex(RANK_INDEX, ["lang", "mode", "keyLayout", "result.avgIki"]);
            db.createObjectStore("raws", { keyPath: "id" });
          }
          if (e.oldVersion < 2) {
            // 版1 → 2：登録したキー配列の保存場所を足す（記録は変えない）
            db.createObjectStore("layouts", { keyPath: "id" });
          }
        };
        req.onsuccess = function () {
          const db = req.result;
          // 別のタブで新しい版が開かれたら接続を閉じて、版の更新を妨げない（次の操作で開き直す）
          db.onversionchange = function () {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () {
          console.warn("古い版のページが開いたままのため、記録の保存場所を更新できません。ほかのタブを閉じてください。");
        };
      });
    }
    return dbPromise;
  }

  // fn(t) の中でリクエストを作り、その結果をトランザクション完了後に返す
  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(stores, mode);
        let result;
        const req = fn(t);
        if (req) req.onsuccess = function () { result = req.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  // 概要と生データを1つのトランザクションで保存する（片方だけ残ることはない）
  function save(session, raw) {
    return tx(["sessions", "raws"], "readwrite", function (t) {
      t.objectStore("sessions").add(session);
      t.objectStore("raws").add(raw);
    });
  }

  function count() {
    return tx("sessions", "readonly", function (t) { return t.objectStore("sessions").count(); });
  }

  // ランキングの区分（言語・モード・配列）の範囲。upper を渡すと平均 IKI がそれ以下のものだけ
  function rankRange(cat, upper) {
    return IDBKeyRange.bound(
      [cat.lang, cat.mode, cat.keyLayout, -Infinity],
      [cat.lang, cat.mode, cat.keyLayout, upper === undefined ? Infinity : upper]
    );
  }

  // ランキングに載せる記録か（正確率 RANK_MIN_ACCURACY% 以上）
  function eligible(s) {
    return s.result.avgIki !== null && s.result.accuracy >= RANK_MIN_ACCURACY;
  }

  // a が b より上位か。平均 IKI の小さい順、同じなら正確率の高い順
  function compare(a, b) {
    return a.result.avgIki - b.result.avgIki || b.result.accuracy - a.result.accuracy;
  }

  // 区分の中の上位 n 件（平均 IKI の小さい順）。索引を小さい方から読み、対象外は飛ばす
  function top(cat, n) {
    const rows = [];
    return tx("sessions", "readonly", function (t) {
      const req = t.objectStore("sessions").index(RANK_INDEX).openCursor(rankRange(cat));
      req.onsuccess = function () {
        const cur = req.result;
        if (!cur) return;
        const s = cur.value;
        // n 件集めた後も、最後と同じ平均 IKI の記録は正確率で並べ替えるために読む
        if (rows.length >= n && s.result.avgIki > rows[rows.length - 1].result.avgIki) return;
        if (eligible(s)) rows.push(s);
        cur.continue();
      };
    }).then(function () { return rows.sort(compare).slice(0, n); });
  }

  // その記録の順位。同じ平均 IKI・正確率なら同順位。対象外なら eligible: false
  // total は区分の中でランキングに載る記録の数
  function rankOf(session) {
    let above = 0;
    let total = 0;
    return tx("sessions", "readonly", function (t) {
      const req = t.objectStore("sessions").index(RANK_INDEX).openCursor(rankRange(session));
      req.onsuccess = function () {
        const cur = req.result;
        if (!cur) return;
        const s = cur.value;
        if (eligible(s)) {
          total++;
          if (compare(s, session) < 0) above++;
        }
        cur.continue();
      };
    }).then(function () {
      return { eligible: eligible(session), rank: above + 1, total: total };
    });
  }

  // 全概要を古い順に返す
  function getAllSessions() {
    return tx("sessions", "readonly", function (t) {
      return t.objectStore("sessions").index("finishedAt").getAll();
    });
  }

  // 生データを1件ずつ fn(raw) に渡す（全件を一度にメモリに載せない）。ids を渡すとその id のものだけ
  function eachRaw(ids, fn) {
    return tx("raws", "readonly", function (t) {
      const req = t.objectStore("raws").openCursor();
      req.onsuccess = function () {
        const cur = req.result;
        if (!cur) return;
        if (!ids || ids.has(cur.value.id)) fn(cur.value);
        cur.continue();
      };
    });
  }

  function getAllRaws() {
    return tx("raws", "readonly", function (t) { return t.objectStore("raws").getAll(); });
  }

  // ---- 登録したキー配列（layouts） ----
  // 1件 { id: 配列名, name: 配列名, type: "kana", entries: [[キーの並び, かな], …], savedAt }。形式は docs/storage.md

  function getAllLayouts() {
    return tx("layouts", "readonly", function (t) { return t.objectStore("layouts").getAll(); });
  }

  // 同じ id があれば上書きする（上書きしてよいかは呼ぶ側で確かめる）
  function saveLayout(layout) {
    return tx("layouts", "readwrite", function (t) { t.objectStore("layouts").put(layout); });
  }

  function deleteLayout(id) {
    return tx("layouts", "readwrite", function (t) { t.objectStore("layouts").delete(id); });
  }

  // その配列で打った記録の数（記録に使われた配列は上書き・削除させない）
  function countSessionsWithLayout(id) {
    return getAllSessions().then(function (all) {
      return all.filter(function (s) { return s.keyLayout === id; }).length;
    });
  }

  // 保存している記録とキー配列の大きさ（バイト）。書き出すファイルの中身（JSON）と同じ形で数える
  // （navigator.storage.estimate は、github.io の同じ利用者の他のサイトの分も含むため使わない）
  function dataSize() {
    return Promise.all([getAllSessions(), getAllRaws(), getAllLayouts()]).then(function (all) {
      const data = { app: EXPORT_APP, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
        sessions: all[0], raws: all[1], layouts: all[2] };
      return new Blob([JSON.stringify(data)]).size;
    });
  }

  // 全記録と登録したキー配列を JSON ファイルとしてダウンロードさせる。返り値 { sessions, layouts }（件数）
  function exportFile() {
    return Promise.all([getAllSessions(), getAllRaws(), getAllLayouts()]).then(function (all) {
      const data = {
        app: EXPORT_APP,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sessions: all[0],
        raws: all[1],
        layouts: all[2]
      };
      const counts = { sessions: data.sessions.length, layouts: data.layouts.length };
      if (counts.sessions === 0 && counts.layouts === 0) return counts;
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a");
      const d = new Date();
      const pad = function (n) { return String(n).padStart(2, "0"); };
      a.href = URL.createObjectURL(blob);
      a.download = "typattern-records-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return counts;
    });
  }

  // 書き出しファイル（JSON 文字列）を読み込んで追加する。
  // 同じ id の記録と、概要・生データが揃っていない記録は飛ばす。
  // キー配列は、同じ名前のものがなければ足す。同じ名前で中身も同じなら飛ばし、中身が違えば今のものを残す（conflicts に数える）
  // 返り値 { added, skipped, layoutsAdded, layoutConflicts: [配列名, …] }
  function importFile(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return Promise.reject(new Error("JSON として読めませんでした"));
    }
    if (!data || data.app !== EXPORT_APP) {
      return Promise.reject(new Error("このアプリの記録ファイルではありません"));
    }
    // schemaVersion 3 以前のファイルは読み込まない
    if (data.schemaVersion !== SCHEMA_VERSION) {
      return Promise.reject(new Error("対応していない形式です（schemaVersion " + (data.schemaVersion || data.schema) + "）"));
    }
    if (!Array.isArray(data.sessions) || !Array.isArray(data.raws)) {
      return Promise.reject(new Error("記録ファイルの中身が壊れています"));
    }
    const raws = new Map(data.raws.map(function (r) { return [r && r.id, r]; }));
    // layouts がないファイル（キー配列を保存する前の書き出し）も読める
    const layouts = Array.isArray(data.layouts) ? data.layouts.filter(function (l) {
      return l && typeof l.id === "string" && Array.isArray(l.entries);
    }) : [];
    return Promise.all([
      tx("sessions", "readonly", function (t) { return t.objectStore("sessions").getAllKeys(); }),
      getAllLayouts()
    ]).then(function (have) {
      const haveIds = new Set(have[0]);
      const fresh = data.sessions.filter(function (s) {
        return s && s.id && s.schemaVersion === SCHEMA_VERSION && !haveIds.has(s.id) && raws.has(s.id);
      });
      const haveLayouts = new Map(have[1].map(function (l) { return [l.id, l]; }));
      const conflicts = [];
      const freshLayouts = layouts.filter(function (l) {
        const mine = haveLayouts.get(l.id);
        if (!mine) return true;
        if (JSON.stringify(mine.entries) !== JSON.stringify(l.entries)) conflicts.push(l.id);
        return false;
      });
      return tx(["sessions", "raws", "layouts"], "readwrite", function (t) {
        fresh.forEach(function (s) {
          t.objectStore("sessions").add(s);
          t.objectStore("raws").add(raws.get(s.id));
        });
        freshLayouts.forEach(function (l) { t.objectStore("layouts").add(l); });
      }).then(function () {
        return {
          added: fresh.length,
          skipped: data.sessions.length - fresh.length,
          layoutsAdded: freshLayouts.length,
          layoutConflicts: conflicts
        };
      });
    });
  }

  // ブラウザに、容量が足りなくなっても記録を自動で消さないよう頼む
  function persist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persisted().then(function (already) {
      return already || navigator.storage.persist();
    });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    RANK_MIN_ACCURACY: RANK_MIN_ACCURACY,
    avgIki: avgIki,
    accuracy: accuracy,
    eligible: eligible,
    compare: compare,
    save: save,
    count: count,
    top: top,
    rankOf: rankOf,
    getAllSessions: getAllSessions,
    getAllRaws: getAllRaws,
    eachRaw: eachRaw,
    getAllLayouts: getAllLayouts,
    saveLayout: saveLayout,
    deleteLayout: deleteLayout,
    countSessionsWithLayout: countSessionsWithLayout,
    exportFile: exportFile,
    dataSize: dataSize,
    importFile: importFile,
    persist: persist
  };
})();
