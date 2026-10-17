// タイピングの記録をブラウザの IndexedDB に保存する。形式は docs/storage.md を参照
//   sessions … 1回ごとの概要（結果の数値など）。ランキングや推移グラフに使う
//   raws     … 1回ごとの生データ（全キー入力・間隔など）。sessions と同じ id で結び付く
const Store = (function () {
  "use strict";

  // schema 1 の記録（旧データベース "typing-test"）は扱わない。旧データベースは消さずにそのまま残す
  const DB_NAME = "typing-records";
  const DB_VERSION = 2; // 入れ物（保存場所・索引）の構造の版
  const SCHEMA_VERSION = 2; // 記録1件の形式の版
  const EXPORT_APP = "typing-test";
  const RANK_INDEX = "rank"; // [lang, mode, keyLayout, result.avgIki]
  const RANK_MIN_ACCURACY = 95; // 正確率がこれ未満の記録はランキングに載せない（記録は残す）

  let dbPromise = null;

  // 平均 IKI(ms) = 経過時間 ÷ (お題の文字数 - 1)。修正にかかった時間も含む。定義は docs/scoring.md
  function avgIki(timeSec, textLength) {
    if (textLength < 2) return null;
    return Math.round((timeSec * 1000 / (textLength - 1)) * 10) / 10;
  }

  // 生データの全キー入力を再生して、直さずに残った間違いの数を数える
  function countUncorrected(raw) {
    let value = "";
    raw.events.forEach(function (e) {
      value = e[1] === "+" ? value.slice(0, e[3]) + e[2] : value.slice(0, e[3]);
    });
    let n = 0;
    for (let i = 0; i < raw.text.length; i++) if (value[i] !== raw.text[i]) n++;
    return n;
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
          const t = req.transaction;
          let sessions;
          if (e.oldVersion < 1) {
            sessions = db.createObjectStore("sessions", { keyPath: "id" });
            sessions.createIndex("finishedAt", "finishedAt");
            db.createObjectStore("raws", { keyPath: "id" });
          } else {
            sessions = t.objectStore("sessions");
          }
          if (e.oldVersion < 2) {
            // 版1 → 2：ランキングを WPM 順から平均 IKI 順に変え、平均 IKI の定義変更に合わせて計算し直す
            if (sessions.indexNames.contains(RANK_INDEX)) sessions.deleteIndex(RANK_INDEX);
            sessions.createIndex(RANK_INDEX, ["lang", "mode", "keyLayout", "result.avgIki"]);
            if (e.oldVersion >= 1) migrateTo2(t);
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

  // 既存の記録の平均 IKI を新しい定義で計算し直し、直さずに残した間違いの数を足す（生データは変えない）
  function migrateTo2(t) {
    const sessions = t.objectStore("sessions");
    const cur = t.objectStore("raws").openCursor();
    cur.onsuccess = function () {
      const c = cur.result;
      if (!c) return;
      const raw = c.value;
      const get = sessions.get(raw.id);
      get.onsuccess = function () {
        const s = get.result;
        if (s) {
          s.result.avgIki = avgIki(s.result.timeSec, s.textLength);
          s.result.uncorrected = countUncorrected(raw);
          sessions.put(s);
        }
      };
      c.continue();
    };
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

  function getAllRaws() {
    return tx("raws", "readonly", function (t) { return t.objectStore("raws").getAll(); });
  }

  // 全記録を JSON ファイルとしてダウンロードさせる。返り値は件数
  function exportFile() {
    return Promise.all([getAllSessions(), getAllRaws()]).then(function (all) {
      const data = {
        app: EXPORT_APP,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sessions: all[0],
        raws: all[1]
      };
      if (data.sessions.length === 0) return 0;
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a");
      const d = new Date();
      const pad = function (n) { return String(n).padStart(2, "0"); };
      a.href = URL.createObjectURL(blob);
      a.download = "typing-records-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return data.sessions.length;
    });
  }

  // 書き出しファイル（JSON 文字列）を読み込んで追加する。
  // 同じ id の記録と、概要・生データが揃っていない記録は飛ばす
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
    if (data.schemaVersion !== SCHEMA_VERSION) {
      return Promise.reject(new Error("対応していない形式です（schemaVersion " + (data.schemaVersion || data.schema) + "）"));
    }
    if (!Array.isArray(data.sessions) || !Array.isArray(data.raws)) {
      return Promise.reject(new Error("記録ファイルの中身が壊れています"));
    }
    const raws = new Map(data.raws.map(function (r) { return [r && r.id, r]; }));
    return tx("sessions", "readonly", function (t) { return t.objectStore("sessions").getAllKeys(); })
      .then(function (keys) {
        const have = new Set(keys);
        const fresh = data.sessions.filter(function (s) {
          return s && s.id && s.schemaVersion === SCHEMA_VERSION && !have.has(s.id) && raws.has(s.id);
        });
        return tx(["sessions", "raws"], "readwrite", function (t) {
          fresh.forEach(function (s) {
            t.objectStore("sessions").add(s);
            t.objectStore("raws").add(raws.get(s.id));
          });
        }).then(function () {
          return { added: fresh.length, skipped: data.sessions.length - fresh.length };
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
    save: save,
    count: count,
    top: top,
    rankOf: rankOf,
    getAllSessions: getAllSessions,
    getAllRaws: getAllRaws,
    exportFile: exportFile,
    importFile: importFile,
    persist: persist
  };
})();
