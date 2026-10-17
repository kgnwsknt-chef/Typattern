// タイピングの記録をブラウザの IndexedDB に保存する。形式は docs/storage.md を参照
const Store = (function () {
  "use strict";

  const DB_NAME = "typing-test";
  const DB_VERSION = 1;
  const STORE = "sessions";
  const EXPORT_APP = "typing-test";
  const SCHEMA = 1;

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
          reject(new Error("このブラウザでは IndexedDB が使えません"));
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const os = db.createObjectStore(STORE, { keyPath: "id" });
            os.createIndex("finishedAt", "finishedAt");
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  // fn(objectStore) の中で作ったリクエストの結果を、トランザクション完了後に返す
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        let result;
        const req = fn(t.objectStore(STORE));
        if (req) req.onsuccess = function () { result = req.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function save(record) {
    return tx("readwrite", function (os) { return os.add(record); });
  }

  function count() {
    return tx("readonly", function (os) { return os.count(); });
  }

  // 全記録を古い順に返す
  function getAll() {
    return tx("readonly", function (os) { return os.index("finishedAt").getAll(); });
  }

  // 書き出しファイルの記録を追加する。同じ id の記録は読み飛ばす
  function importRecords(records) {
    return tx("readonly", function (os) { return os.getAllKeys(); }).then(function (keys) {
      const have = new Set(keys);
      const fresh = records.filter(function (r) { return r && r.id && !have.has(r.id); });
      return tx("readwrite", function (os) {
        fresh.forEach(function (r) { os.add(r); });
      }).then(function () {
        return { added: fresh.length, skipped: records.length - fresh.length };
      });
    });
  }

  // 全記録を JSON ファイルとしてダウンロードさせる
  function exportFile() {
    return getAll().then(function (records) {
      const data = {
        app: EXPORT_APP,
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        sessions: records
      };
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
      return records.length;
    });
  }

  // 書き出しファイル（JSON 文字列）を読み込んで追加する
  function importFile(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return Promise.reject(new Error("JSON として読めませんでした"));
    }
    if (!data || data.app !== EXPORT_APP || !Array.isArray(data.sessions)) {
      return Promise.reject(new Error("このアプリの記録ファイルではありません"));
    }
    if (data.schema > SCHEMA) {
      return Promise.reject(new Error("新しい形式（schema " + data.schema + "）のため読み込めません"));
    }
    return importRecords(data.sessions);
  }

  // ブラウザに、容量が足りなくなっても記録を自動で消さないよう頼む
  function persist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persisted().then(function (already) {
      return already || navigator.storage.persist();
    });
  }

  return {
    SCHEMA: SCHEMA,
    save: save,
    count: count,
    getAll: getAll,
    exportFile: exportFile,
    importFile: importFile,
    persist: persist
  };
})();
