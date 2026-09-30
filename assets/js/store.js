/* =========================================================
   store.js — 数据访问层
   上层 app.js 只跟 DiaryStore 打交道。
   之后要换成云服务时，只要把这一层的实现替换掉，界面代码不用动。
   ========================================================= */
(function (global) {
  'use strict';

  var DB = global.DiaryDB;

  var MAX_IMAGE_SIDE = 2560;   // 原图压缩后的最长边
  var THUMB_SIDE = 560;        // 缩略图最长边
  var MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 单个视频上限 300MB

  var DEFAULT_SETTINGS = {
    key: 'settings',
    bgColor: '#f5eee0',
    members: [
      { key: 'me',       name: '我',   color: '#4a7ba7', soft: '#eaf1f8' },
      { key: 'wife',     name: '媳妇', color: '#c76a8e', soft: '#fbeef4' },
      { key: 'daughter', name: '女儿', color: '#cf9440', soft: '#fdf4e6' }
    ],
    lastAuthor: 'me'
  };

  /* ---------------- 工具 ---------------- */

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function todayStr(d) {
    var t = d ? new Date(d) : new Date();
    var m = String(t.getMonth() + 1).padStart(2, '0');
    var day = String(t.getDate()).padStart(2, '0');
    return t.getFullYear() + '-' + m + '-' + day;
  }

  function formatBytes(n) {
    if (!n || n < 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + units[i];
  }

  /* ---------------- 设置 ---------------- */

  var _settings = null;

  function getSettings() {
    if (_settings) return Promise.resolve(_settings);
    return DB.get('meta', 'settings').then(function (s) {
      if (!s) {
        _settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        return DB.put('meta', _settings).then(function () { return _settings; });
      }
      // 补齐新增字段
      _settings = Object.assign({}, DEFAULT_SETTINGS, s);
      return _settings;
    });
  }

  function saveSettings(patch) {
    return getSettings().then(function (s) {
      _settings = Object.assign({}, s, patch);
      return DB.put('meta', _settings).then(function () { return _settings; });
    });
  }

  function memberByKey(key) {
    var list = (_settings && _settings.members) || DEFAULT_SETTINGS.members;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return { key: key, name: key, color: '#8a837a', soft: '#f0eeea' };
  }

  /* ---------------- 图片 / 视频处理 ---------------- */

  function loadBitmap(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return loadImageEl(file); });
    }
    return loadImageEl(file);
  }

  function loadImageEl(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('IMG_DECODE_FAILED')); };
      img.src = url;
    });
  }

  function drawToBlob(src, w, h, quality) {
    return new Promise(function (resolve, reject) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w));
        canvas.height = Math.max(1, Math.round(h));
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        if (canvas.toBlob) {
          canvas.toBlob(function (b) {
            b ? resolve(b) : reject(new Error('TO_BLOB_FAILED'));
          }, 'image/jpeg', quality);
        } else {
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrlToBlob(dataUrl));
        }
      } catch (e) { reject(e); }
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [, 'application/octet-stream'])[1];
    var bin = atob(parts[1]);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function fitSize(w, h, max) {
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * s), h: Math.round(h * s) };
  }

  /**
   * 处理一张图片：压缩原图 + 生成缩略图
   * 失败时回退为「原文件直存」
   */
  function prepareImage(file) {
    return loadBitmap(file).then(function (src) {
      var iw = src.width || src.naturalWidth;
      var ih = src.height || src.naturalHeight;
      var full = fitSize(iw, ih, MAX_IMAGE_SIDE);
      var thumb = fitSize(iw, ih, THUMB_SIDE);

      return Promise.all([
        drawToBlob(src, full.w, full.h, 0.88),
        drawToBlob(src, thumb.w, thumb.h, 0.78).catch(function () { return null; })
      ]).then(function (r) {
        if (src.close) { try { src.close(); } catch (e) {} }
        return {
          blob: r[0],
          thumb: r[1],
          mime: 'image/jpeg',
          width: full.w,
          height: full.h
        };
      });
    }).catch(function () {
      // 例如 HEIC 等浏览器解不了的格式：原样保存
      return { blob: file, thumb: null, mime: file.type || 'application/octet-stream', width: 0, height: 0 };
    });
  }

  /** 从已有图片 blob 重新生成缩略图（导入备份时用） */
  function makeImageThumb(blob) {
    if (!blob || (blob.type || '').indexOf('image/') !== 0) return Promise.resolve(null);
    return loadBitmap(blob).then(function (src) {
      var iw = src.width || src.naturalWidth;
      var ih = src.height || src.naturalHeight;
      var t = fitSize(iw, ih, THUMB_SIDE);
      return drawToBlob(src, t.w, t.h, 0.78).then(function (b) {
        if (src.close) { try { src.close(); } catch (e) {} }
        return b;
      });
    }).catch(function () { return null; });
  }

  /** 截取视频第 1 秒左右的画面作为封面 */
  function captureVideoFrame(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var settled = false;
      var timer = null;

      function finish(blob) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try { URL.revokeObjectURL(url); } catch (e) {}
        try { video.removeAttribute('src'); video.load(); } catch (e) {}
        resolve(blob || null);
      }

      timer = setTimeout(function () { finish(null); }, 9000);

      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      video.onloadedmetadata = function () {
        var t = 1;
        if (isFinite(video.duration) && video.duration > 0) {
          t = Math.min(1, video.duration * 0.1);
        }
        try { video.currentTime = t; } catch (e) { finish(null); }
      };

      video.onseeked = function () {
        try {
          var vw = video.videoWidth || 640;
          var vh = video.videoHeight || 360;
          var s = fitSize(vw, vh, 720);
          drawToBlob(video, s.w, s.h, 0.75).then(finish, function () { finish(null); });
        } catch (e) { finish(null); }
      };

      video.onerror = function () { finish(null); };
      video.src = url;
    });
  }

  function prepareVideo(file) {
    return captureVideoFrame(file).then(function (thumb) {
      return {
        blob: file,
        thumb: thumb,
        mime: file.type || 'video/mp4',
        width: 0,
        height: 0
      };
    });
  }

  /** 统一入口：把 File 变成可入库的媒体对象（未落库，仅内存） */
  function prepareFile(file) {
    var kind = (file.type || '').indexOf('video/') === 0 ? 'video'
             : (file.type || '').indexOf('image/') === 0 ? 'image'
             : (file.name && /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name)) ? 'video'
             : (file.name && /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name)) ? 'image'
             : 'other';

    if (kind === 'video' && file.size > MAX_VIDEO_BYTES) {
      return Promise.reject(new Error('VIDEO_TOO_LARGE'));
    }

    var task = kind === 'image' ? prepareImage(file)
             : kind === 'video' ? prepareVideo(file)
             : Promise.resolve({ blob: file, thumb: null, mime: file.type || '', width: 0, height: 0 });

    return task.then(function (r) {
      return {
        key: uid(),
        id: null,
        kind: kind,
        name: file.name || (kind + '-' + Date.now()),
        mime: r.mime,
        size: r.blob.size,
        width: r.width,
        height: r.height,
        blob: r.blob,
        thumb: r.thumb,
        preview: r.thumb || r.blob
      };
    });
  }

  /* ---------------- 日志读写 ---------------- */

  /**
   * 列表查询
   * @param {{author?:string, keyword?:string}} opts
   */
  function listEntries(opts) {
    opts = opts || {};
    return DB.getAll('entries').then(function (all) {
      var list = all || [];

      if (opts.author && opts.author !== 'all') {
        list = list.filter(function (e) { return e.author === opts.author; });
      }
      if (opts.keyword) {
        var kw = String(opts.keyword).trim().toLowerCase();
        if (kw) {
          list = list.filter(function (e) {
            var name = memberByKey(e.author).name;
            return (e.text || '').toLowerCase().indexOf(kw) >= 0 ||
                   name.toLowerCase().indexOf(kw) >= 0;
          });
        }
      }

      list.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
      });
      return list;
    });
  }

  function getEntry(id) { return DB.get('entries', id); }

  /**
   * 保存日志
   * @param {{id?, author, date, text}} data
   * @param {{keepMedia?:Array, newMedia?:Array, removeMediaIds?:Array}} mediaPlan
   */
  function saveEntry(data, mediaPlan) {
    mediaPlan = mediaPlan || {};
    var now = new Date().toISOString();
    var isNew = !data.id;
    var id = data.id || uid();

    return getEntry(id).then(function (existing) {
      var keep = mediaPlan.keepMedia || [];
      var news = mediaPlan.newMedia || [];

      var mediaMeta = keep.map(function (m) { return m; });
      var mediaRecords = [];

      news.forEach(function (item) {
        var mid = item.id || uid();
        mediaMeta.push({
          id: mid,
          kind: item.kind,
          name: item.name,
          mime: item.mime,
          size: item.size,
          width: item.width || 0,
          height: item.height || 0,
          hasThumb: !!item.thumb,
          createdAt: now
        });
        mediaRecords.push({ id: mid, entryId: id, blob: item.blob, thumb: item.thumb || null });
      });

      var entry = {
        id: id,
        author: data.author,
        date: data.date,
        text: data.text || '',
        media: mediaMeta,
        createdAt: (existing && existing.createdAt) || now,
        updatedAt: now
      };

      return DB.commitEntry(entry, mediaRecords, mediaPlan.removeMediaIds || [])
        .then(function () { return entry; });
    });
  }

  function deleteEntry(id) {
    return getEntry(id).then(function (e) {
      var ids = (e && e.media ? e.media.map(function (m) { return m.id; }) : []);
      return DB.deleteEntryCascade(id, ids);
    });
  }

  /* ---------------- 媒体读取 ---------------- */

  function getMedia(id) { return DB.get('media', id); }

  /** 批量取缩略图，返回 Map<mediaId, Blob> */
  function getThumbs(ids) {
    var map = new Map();
    if (!ids || !ids.length) return Promise.resolve(map);
    var uniq = Array.from(new Set(ids));
    return Promise.all(uniq.map(function (id) {
      return DB.get('media', id).then(function (m) {
        if (m && m.thumb) map.set(id, m.thumb);
        else if (m && m.blob) map.set(id, m.blob);
      }).catch(function () {});
    })).then(function () { return map; });
  }

  /* ---------------- 统计 / 备份 ---------------- */

  function stats() {
    return Promise.all([DB.getAll('entries'), DB.getAll('media')]).then(function (r) {
      var entries = r[0] || [];
      var media = r[1] || [];
      var bytes = 0;
      media.forEach(function (m) {
        if (m.blob) bytes += m.blob.size || 0;
        if (m.thumb) bytes += m.thumb.size || 0;
      });
      return {
        entries: entries.length,
        media: media.length,
        photos: media.filter(function (m) { return (m.blob && (m.blob.type || '').indexOf('image/') === 0); }).length,
        videos: media.filter(function (m) { return (m.blob && (m.blob.type || '').indexOf('video/') === 0); }).length,
        bytes: bytes
      };
    });
  }

  function quota() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().catch(function () { return null; });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function exportAll(onProgress) {
    return Promise.all([getSettings(), DB.getAll('entries'), DB.getAll('media')])
      .then(function (r) {
        var settings = r[0], entries = r[1] || [], media = r[2] || [];
        var out = [];
        var i = 0;

        function step() {
          if (i >= media.length) return Promise.resolve();
          var m = media[i++];
          if (onProgress) onProgress(i, media.length);
          if (!m.blob) return step();
          return blobToDataUrl(m.blob).then(function (data) {
            out.push({ id: m.id, mime: m.blob.type || 'application/octet-stream', data: data });
            return step();
          });
        }

        return step().then(function () {
          return {
            app: 'family-diary',
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: { members: settings.members, bgColor: settings.bgColor },
            entries: entries,
            media: out
          };
        });
      });
  }

  /**
   * 导入备份（整体替换）
   */
  function importAll(payload, onProgress) {
    if (!payload || payload.app !== 'family-diary' || !Array.isArray(payload.entries)) {
      return Promise.reject(new Error('BAD_FILE'));
    }

    return DB.clearStores(['entries', 'media']).then(function () {
      var mediaList = payload.media || [];
      var i = 0;

      function step() {
        if (i >= mediaList.length) return Promise.resolve([]);
        var m = mediaList[i++];
        if (onProgress) onProgress(i, mediaList.length);
        var blob = dataUrlToBlob(m.data);
        var thumbP = (blob.type || '').indexOf('image/') === 0
          ? makeImageThumb(blob)
          : Promise.resolve(null);
        return thumbP.then(function (thumb) {
          return { id: m.id, entryId: '', blob: blob, thumb: thumb };
        }).then(function (rec) {
          return step().then(function (rest) { return [rec].concat(rest); });
        });
      }

      return step().then(function (records) {
        // 回填 entryId，并修正 hasThumb
        var byId = {};
        records.forEach(function (r) { byId[r.id] = r; });

        var entries = payload.entries.map(function (e) {
          var media = (e.media || []).map(function (m) {
            var rec = byId[m.id];
            if (rec) rec.entryId = e.id;
            return Object.assign({}, m, { hasThumb: !!(rec && rec.thumb) });
          });
          return Object.assign({}, e, { media: media });
        });

        return DB.putMany('media', records)
          .then(function () { return DB.putMany('entries', entries); })
          .then(function () {
            if (!payload.settings) return;
            var patch = {};
            if (payload.settings.members) patch.members = payload.settings.members;
            if (payload.settings.bgColor) patch.bgColor = payload.settings.bgColor;
            if (Object.keys(patch).length) return saveSettings(patch);
          })
          .then(function () { return entries.length; });
      });
    });
  }

  function clearAll() {
    _settings = null;
    return DB.clearStores(['entries', 'media', 'meta']);
  }

  /* ---------------- 导出接口 ---------------- */

  global.DiaryStore = {
    uid: uid,
    todayStr: todayStr,
    formatBytes: formatBytes,
    init: getSettings,
    getSettings: getSettings,
    saveSettings: saveSettings,
    memberByKey: memberByKey,
    listEntries: listEntries,
    getEntry: getEntry,
    saveEntry: saveEntry,
    deleteEntry: deleteEntry,
    getMedia: getMedia,
    getThumbs: getThumbs,
    prepareFile: prepareFile,
    prepareImage: prepareImage,
    prepareVideo: prepareVideo,
    stats: stats,
    quota: quota,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll,
    isSupported: DB.isSupported,
    MAX_VIDEO_BYTES: MAX_VIDEO_BYTES
  };
})(window);
