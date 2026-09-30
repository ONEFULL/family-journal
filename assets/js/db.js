/* =========================================================
   db.js — IndexedDB 极简封装（Promise 化）
   三个对象仓库：
     entries : 日志（keyPath: id）
     media   : 媒体二进制（keyPath: id）
     meta    : 设置等键值（keyPath: key）
   ========================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'family-diary';
  var DB_VERSION = 1;

  var _dbPromise = null;

  function isSupported() {
    try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
    catch (e) { return false; }
  }

  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!isSupported()) {
        reject(new Error('NO_IDB'));
        return;
      }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          var es = db.createObjectStore('entries', { keyPath: 'id' });
          es.createIndex('date', 'date', { unique: false });
          es.createIndex('author', 'author', { unique: false });
          es.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('media')) {
          var ms = db.createObjectStore('media', { keyPath: 'id' });
          ms.createIndex('entryId', 'entryId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('OPEN_FAILED')); };
      req.onblocked = function () { reject(new Error('DB_BLOCKED')); };
    });
    return _dbPromise;
  }

  function req2p(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('TX_ABORTED')); };
    });
  }

  /* ---------- 通用读写 ---------- */

  function get(store, key) {
    return open().then(function (db) {
      var tx = db.transaction(store, 'readonly');
      return req2p(tx.objectStore(store).get(key));
    });
  }

  function getAll(store) {
    return open().then(function (db) {
      var tx = db.transaction(store, 'readonly');
      return req2p(tx.objectStore(store).getAll());
    });
  }

  function put(store, value) {
    return open().then(function (db) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      return txDone(tx).then(function () { return value; });
    });
  }

  function putMany(store, values) {
    if (!values || !values.length) return Promise.resolve();
    return open().then(function (db) {
      var tx = db.transaction(store, 'readwrite');
      var os = tx.objectStore(store);
      values.forEach(function (v) { os.put(v); });
      return txDone(tx);
    });
  }

  function del(store, key) {
    return open().then(function (db) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      return txDone(tx);
    });
  }

  function delMany(store, keys) {
    if (!keys || !keys.length) return Promise.resolve();
    return open().then(function (db) {
      var tx = db.transaction(store, 'readwrite');
      var os = tx.objectStore(store);
      keys.forEach(function (k) { os.delete(k); });
      return txDone(tx);
    });
  }

  function clearStores(stores) {
    return open().then(function (db) {
      var tx = db.transaction(stores, 'readwrite');
      stores.forEach(function (s) { tx.objectStore(s).clear(); });
      return txDone(tx);
    });
  }

  /* ---------- 多仓库事务（保存日志时用） ---------- */

  /**
   * 在一个事务里完成：写 entries + 写 media + 删 media
   */
  function commitEntry(entry, mediaToPut, mediaIdsToDelete) {
    return open().then(function (db) {
      var tx = db.transaction(['entries', 'media'], 'readwrite');
      tx.objectStore('entries').put(entry);
      var ms = tx.objectStore('media');
      (mediaToPut || []).forEach(function (m) { ms.put(m); });
      (mediaIdsToDelete || []).forEach(function (id) { ms.delete(id); });
      return txDone(tx).then(function () { return entry; });
    });
  }

  function deleteEntryCascade(entryId, mediaIds) {
    return open().then(function (db) {
      var tx = db.transaction(['entries', 'media'], 'readwrite');
      tx.objectStore('entries').delete(entryId);
      var ms = tx.objectStore('media');
      (mediaIds || []).forEach(function (id) { ms.delete(id); });
      return txDone(tx);
    });
  }

  global.DiaryDB = {
    isSupported: isSupported,
    open: open,
    get: get,
    getAll: getAll,
    put: put,
    putMany: putMany,
    del: del,
    delMany: delMany,
    clearStores: clearStores,
    commitEntry: commitEntry,
    deleteEntryCascade: deleteEntryCascade
  };
})(window);
