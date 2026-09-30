/* =========================================================
   app.js — 界面与交互
   视图：时间线 / 相册 / 设置；二级页面：写日志 / 详情
   ========================================================= */
(function () {
  'use strict';

  var S = window.DiaryStore;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var TABS = ['timeline', 'album', 'settings'];

  /* 滚过这个距离后，当前页那一格 tab 变成「回到顶部」 */
  var TO_TOP_AT = 240;
  var toTopOn = false;

  /* 背景色备选：全部按「深色正文可读性」挑选并实测过对比度
     正文 ≥14.5:1、次要文字 ≥7.3:1、hint ≥4.7:1（均达 WCAG AA 以上） */
  var BG_COLORS = [
    { name: '暖沙',   hex: '#f5eee0' },
    { name: '雾蓝',   hex: '#e6eef8' },
    { name: '抹茶',   hex: '#e6f0e6' },
    { name: '藕粉',   hex: '#f9e9ef' },
    { name: '薰衣草', hex: '#eee9f9' },
    { name: '石墨',   hex: '#eaecf0' }
  ];

  var state = {
    settings: null,
    all: [],
    filter: 'all',
    keyword: '',
    tab: 'timeline',
    editing: null,        // { id | null, author, date, text, media: [] }
    editorUrls: new Map(),
    detail: null,         // { entry, urls: Map }
    lightbox: null        // { entry, mediaId }
  };

  var thumbUrls = new Map();

  /* ---------------- 小工具 ---------------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseDate(s) {
    var p = String(s || '').split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function formatDay(s) {
    var d = parseDate(s);
    if (isNaN(d.getTime())) return { title: s || '未标注日期', sub: '' };
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((today - that) / 86400000);
    var title;
    if (diff === 0) title = '今天';
    else if (diff === 1) title = '昨天';
    else if (diff === 2) title = '前天';
    else if (d.getFullYear() !== now.getFullYear()) title = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    else title = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return { title: title, sub: WEEK[d.getDay()] };
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatFullDate(s) {
    var d = parseDate(s);
    if (isNaN(d.getTime())) return s || '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK[d.getDay()];
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.hidden = true; }, 260);
    }, 1900);
  }

  function setBusy(on) { $('#loading').hidden = !on; }

  // 全屏庆祝（彩带 + 徽章）；万一 celebrate.js 没加载出来，退回普通 toast
  function celebrate(label) {
    if (window.Celebrate && window.Celebrate.burst) window.Celebrate.burst({ label: label });
    else toast(label);
  }

  var dialogResolve = null;
  function ask(opts) {
    opts = opts || {};
    $('#dialog-title').textContent = opts.title || '确认';
    $('#dialog-text').textContent = opts.text || '';
    var ok = $('#dialog-ok');
    ok.textContent = opts.okText || '确定';
    ok.className = 'solid-btn' + (opts.danger ? ' danger' : '');
    $('#dialog').hidden = false;
    return new Promise(function (resolve) { dialogResolve = resolve; });
  }
  function closeDialog(v) {
    $('#dialog').hidden = true;
    if (dialogResolve) { dialogResolve(v); dialogResolve = null; }
  }

  function thumbUrl(id, blob) {
    var u = thumbUrls.get(id);
    if (!u) { u = URL.createObjectURL(blob); thumbUrls.set(id, u); }
    return u;
  }
  function revokeThumb(id) {
    var u = thumbUrls.get(id);
    if (u) { URL.revokeObjectURL(u); thumbUrls.delete(id); }
  }

  function authorOf(entry) { return S.memberByKey(entry.author); }

  /* ---------------- 背景色 ---------------- */

  function bgEntry(hex) {
    var h = String(hex || '').toLowerCase();
    for (var i = 0; i < BG_COLORS.length; i++) {
      if (BG_COLORS[i].hex === h) return BG_COLORS[i];
    }
    return BG_COLORS[0];
  }

  function applyBgColor(hex) {
    var c = bgEntry(hex).hex;
    document.documentElement.style.setProperty('--bg-color', c);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c);
  }

  /* 首屏先按上次选的颜色上色，避免设置读出来之前闪一下默认色 */
  function cacheBgColor(hex) {
    try { localStorage.setItem('fd-bg-color', bgEntry(hex).hex); } catch (e) {}
  }
  function readCachedBgColor() {
    try { return localStorage.getItem('fd-bg-color'); } catch (e) { return null; }
  }

  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  var PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (!S.isSupported()) {
      $('#timeline').innerHTML = failPanel('😕', '当前环境无法保存数据',
        '浏览器禁用了本地存储（IndexedDB）。请换用 Chrome / Edge / Safari 打开，或通过 http://localhost 访问，而不是直接双击 HTML 文件。');
      $('.dock').hidden = true;
      return;
    }

    bindEvents();
    syncToTop(true);

    var cached = readCachedBgColor();
    if (cached) applyBgColor(cached);

    S.init()
      .then(function () { return refresh(); })
      .catch(function (err) {
        console.error(err);
        $('#timeline').innerHTML = failPanel('😕', '加载失败', escapeHtml(err && err.message));
      });
  }

  function failPanel(emoji, title, text) {
    return '<div class="empty"><span class="emoji">' + emoji + '</span><h2>' + title + '</h2><p>' + text + '</p></div>';
  }

  function refresh() {
    return S.getSettings().then(function (s) {
      state.settings = s;
      applyBgColor(s.bgColor);
      cacheBgColor(s.bgColor);
      return S.listEntries({});
    }).then(function (list) {
      state.all = list;
      renderSegmented();
      renderTimeline();
      if (state.tab === 'album') renderAlbum();
      if (state.tab === 'settings') renderSettings();
      // 内容变短时浏览器会把滚动位置夹回顶部，此时不一定触发 scroll 事件
      syncToTop(true);
    });
  }

  /* ---------------- 视图切换 ---------------- */

  function switchTab(name) {
    if (TABS.indexOf(name) < 0) return;
    var changed = (state.tab !== name);
    state.tab = name;

    TABS.forEach(function (t) {
      var v = $('#view-' + t);
      if (v) v.hidden = (t !== name);
    });

    $$('#tabbar .tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });

    $('#fab').hidden = (name === 'settings');

    window.scrollTo(0, 0);
    syncToTop(true);

    // 点的就是当前这一页：只当「回到顶部」用，不要再重渲染 ——
    // 相册/设置整块重建会让缩略图先清空再异步填回来，看起来就是闪一下。
    if (!changed) return;

    if (name === 'album') renderAlbum();
    if (name === 'settings') renderSettings();

    // 视图刚显示出来才量得到真实宽度（隐藏时 getBoundingClientRect 全是 0）
    requestAnimationFrame(positionThumb);
  }

  /* ---------------- 当前页 tab ⇄ 回到顶部 ---------------- */

  // 滚到下方时，把「当前页那一格」切成回到顶部；回到顶部区域后自动切回来。
  // 只动当前页那一格，其他 tab 保持原图标。
  function syncToTop(force) {
    var on = window.scrollY > TO_TOP_AT;
    if (!force && on === toTopOn) return;
    toTopOn = on;

    var tb = $('#tabbar');
    if (tb) tb.classList.toggle('to-top', on);

    // 两个文字层都留在 DOM 里（靠透明度和位移切换），
    // 所以要把非当前生效的那一层对读屏器隐藏，否则按钮名会读成「时间线回到顶部」
    $$('#tabbar .tab').forEach(function (b) {
      var live = on && b.classList.contains('active');
      var p = b.querySelector('.lb-page');
      var t = b.querySelector('.lb-top');
      if (p) p.setAttribute('aria-hidden', live ? 'true' : 'false');
      if (t) t.setAttribute('aria-hidden', live ? 'false' : 'true');
    });
  }

  function scrollToTop() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  }

  /* ---------------- 分段控件 ---------------- */

  function renderSegmented() {
    var members = state.settings.members;
    var counts = { all: state.all.length };
    members.forEach(function (m) {
      counts[m.key] = state.all.filter(function (e) { return e.author === m.key; }).length;
    });

    function btn(key, label, n) {
      return '<button class="seg-btn' + (state.filter === key ? ' active' : '') + '" type="button" ' +
        'role="tab" aria-selected="' + (state.filter === key) + '" data-filter="' + key + '">' +
        escapeHtml(label) + '<span class="n">' + n + '</span></button>';
    }

    var html = '<span class="seg-thumb" id="seg-thumb"></span>';
    html += btn('all', '全部', counts.all);
    members.forEach(function (m) { html += btn(m.key, m.name, counts[m.key] || 0); });

    $('#segmented').innerHTML = html;
    positionThumb(true);   // 刚重建，直接落位，别让它从 0 宽度长出来
  }

  // instant = true 时不做过渡，直接落位（刚重建出来的指示器要从正确位置直接出现，
  // 否则会看到它从 0 宽度「长」出来）
  function positionThumb(instant) {
    var seg = $('#segmented');
    if (!seg) return;
    var thumb = seg.querySelector('.seg-thumb');
    var btn = seg.querySelector('.seg-btn.active');
    if (!thumb || !btn) return;

    var segRect = seg.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();

    // 视图被 hidden 时 getBoundingClientRect 全是 0。此时若照样写进去，指示器会被压成
    // 0 宽；等切回时间线再补正，就会看到「先缩成一条线再弹开」的闪烁。所以直接不写。
    if (!segRect.width || !btnRect.width) return;

    var border = parseFloat(getComputedStyle(seg).borderLeftWidth) || 0;
    var w = btnRect.width + 'px';
    var x = 'translateX(' + (btnRect.left - segRect.left - border) + 'px)';

    if (instant) {
      thumb.style.transition = 'none';
      thumb.style.width = w;
      thumb.style.transform = x;
      void thumb.offsetWidth;      // 强制重排，把上面的值定为起点
      thumb.style.transition = '';
      return;
    }

    thumb.style.width = w;
    thumb.style.transform = x;
  }

  /* ---------------- 时间线 ---------------- */

  function currentList() {
    var list = state.all;
    if (state.filter !== 'all') {
      list = list.filter(function (e) { return e.author === state.filter; });
    }
    if (state.keyword) {
      var kw = state.keyword.toLowerCase();
      list = list.filter(function (e) {
        var name = S.memberByKey(e.author).name;
        return (e.text || '').toLowerCase().indexOf(kw) >= 0 || name.toLowerCase().indexOf(kw) >= 0;
      });
    }
    return list;
  }

  function renderTimeline() {
    var list = currentList();
    var root = $('#timeline');

    if (!list.length) {
      var isFiltering = state.filter !== 'all' || !!state.keyword;
      root.innerHTML = isFiltering
        ? failPanel('🔍', '没有找到相关的日志', '换个关键词，或看看其他成员的记录。')
        : failPanel('🏡', '还没有第一条记录', '今天发生了什么？<br>点右下角的 + 写下来吧。');
      syncToTop(true);
      return;
    }

    var ids = [];
    list.forEach(function (e) {
      (e.media || []).forEach(function (m) { ids.push(m.id); });
    });

    S.getThumbs(ids).then(function (thumbs) {
      var groups = [];
      var lastDate = null;
      list.forEach(function (e) {
        if (e.date !== lastDate) { groups.push({ date: e.date, items: [] }); lastDate = e.date; }
        groups[groups.length - 1].items.push(e);
      });

      root.innerHTML = groups.map(function (g) {
        var d = formatDay(g.date);
        return '<section class="day-group">' +
          '<div class="day-head"><span class="day-title">' + escapeHtml(d.title) + '</span>' +
          '<span class="day-sub">' + escapeHtml(d.sub) + ' · ' + g.items.length + ' 条</span></div>' +
          g.items.map(function (e) { return entryCardHtml(e, thumbs); }).join('') +
          '</section>';
      }).join('');
      // 列表高度变了，滚动位置可能被浏览器夹回顶部而不触发 scroll
      syncToTop(true);
    });
  }

  function entryCardHtml(entry, thumbs) {
    var a = authorOf(entry);
    var style = '--author-color:' + a.color + ';--author-soft:' + a.soft + ';';
    var media = entry.media || [];

    var html = '<article class="entry" data-id="' + entry.id + '" style="' + style + '">';
    html += '<div class="entry-head">' +
      '<span class="avatar">' + escapeHtml(a.name.slice(0, 1)) + '</span>' +
      '<div class="entry-who"><span class="entry-name">' + escapeHtml(a.name) + '</span>' +
      '<span class="entry-time">' + formatTime(entry.createdAt) + '</span></div></div>';

    if (entry.text) html += '<p class="entry-text clamp">' + escapeHtml(entry.text) + '</p>';
    if (media.length) html += mediaGridHtml(media, thumbs);
    html += '</article>';
    return html;
  }

  function mediaGridHtml(media, thumbs) {
    var n = media.length;
    var cls = n === 1 ? '1' : n === 2 ? '2' : n === 3 ? '3' : 'more';

    var cells = media.slice(0, 3).map(function (m, i) {
      var blob = thumbs.get(m.id);
      // 优先用已缓存的 URL，重渲染时直接出图，不闪
      var url = thumbUrls.get(m.id) || (blob ? thumbUrl(m.id, blob) : '');
      var inner = url
        ? '<img src="' + url + '" alt="" loading="lazy" />'
        : '<div class="no-thumb">' + (m.kind === 'video' ? '视频' : '图片') + '</div>';
      if (m.kind === 'video') inner += '<div class="play-badge"><span>' + PLAY_SVG + '</span></div>';
      if (i === 2 && n > 3) inner += '<div class="more-mask">+' + (n - 3) + '</div>';
      return '<div class="media-cell" data-media="' + m.id + '">' + inner + '</div>';
    }).join('');

    return '<div class="media-grid" data-n="' + cls + '">' + cells + '</div>';
  }

  /* ---------------- 相册 ---------------- */

  function renderAlbum() {
    // 按日志日期分组，和 iOS 相册一样一段一段排
    var groups = [];
    state.all.forEach(function (e) {
      var media = e.media || [];
      if (!media.length) return;
      var g = groups[groups.length - 1];
      if (!g || g.date !== e.date) { g = { date: e.date, items: [] }; groups.push(g); }
      media.forEach(function (m) { g.items.push({ m: m, e: e }); });
    });

    var head = $('#album-head');
    var box = $('#album');
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);

    if (!total) {
      head.textContent = '';
      box.innerHTML = failPanel('📷', '相册还是空的', '写日志时加上照片或视频，这里就会自动汇集起来。');
      return;
    }

    var videos = 0;
    groups.forEach(function (g) {
      g.items.forEach(function (i) { if (i.m.kind === 'video') videos++; });
    });
    head.textContent = '共 ' + total + ' 项 · 照片 ' + (total - videos) + ' · 视频 ' + videos;

    box.innerHTML = groups.map(function (g) {
      var d = formatDay(g.date);
      return '<section class="album-section">' +
        '<div class="album-day">' +
        '<span class="album-day-title">' + escapeHtml(d.title) + '</span>' +
        '<span class="album-day-sub">' + escapeHtml(d.sub) + ' · ' + g.items.length + ' 项</span>' +
        '</div>' +
        '<div class="album">' + g.items.map(function (i) {
          // 已经缓存过 URL 的直接出图，不走「先占位、异步再替换」那条路 ——
          // 否则每次重渲染都会先白一下再出图，看起来就是闪
          var url = thumbUrls.get(i.m.id);
          var badge = i.m.kind === 'video'
            ? '<div class="play-badge"><span>' + PLAY_SVG + '</span></div>' : '';
          return '<div class="album-cell" data-media="' + i.m.id + '">' +
            (url ? '<img src="' + url + '" alt="" loading="lazy" />' + badge
                 : '<div class="no-thumb">…</div>') +
            '</div>';
        }).join('') + '</div></section>';
    }).join('');

    var all = [];
    groups.forEach(function (g) { g.items.forEach(function (i) { all.push(i); }); });

    S.getThumbs(all.map(function (i) { return i.m.id; })).then(function (thumbs) {
      all.forEach(function (i) {
        var cell = box.querySelector('.album-cell[data-media="' + i.m.id + '"]');
        if (!cell) return;
        if (cell.querySelector('img')) return;   // 上面已经直接出图了，别覆盖一遍
        var blob = thumbs.get(i.m.id);
        if (!blob) return;
        var url = thumbUrl(i.m.id, blob);
        var badge = i.m.kind === 'video' ? '<div class="play-badge"><span>' + PLAY_SVG + '</span></div>' : '';
        cell.innerHTML = '<img src="' + url + '" alt="" loading="lazy" />' + badge;
      });
    });
  }

  /* ---------------- 设置 ---------------- */

  function renderSettings() {
    renderSwatches();

    var members = state.settings.members;
    $('#member-list').innerHTML = members.map(function (m) {
      return '<div class="row member-row">' +
        '<span class="avatar" style="--author-color:' + m.color + ';--author-soft:' + m.soft + '">' + escapeHtml(m.name.slice(0, 1)) + '</span>' +
        '<input class="row-input" type="text" maxlength="8" value="' + escapeHtml(m.name) + '" data-member="' + m.key + '" placeholder="称呼" />' +
        '</div>';
    }).join('');
    loadStats();
  }

  function renderSwatches() {
    var cur = bgEntry(state.settings.bgColor).hex;
    $('#swatches').innerHTML = BG_COLORS.map(function (c) {
      return '<button class="swatch' + (c.hex === cur ? ' active' : '') + '" type="button" ' +
        'data-bg="' + c.hex + '" style="--sw:' + c.hex + '" ' +
        'aria-label="' + escapeHtml(c.name) + '" aria-pressed="' + (c.hex === cur) + '" ' +
        'title="' + escapeHtml(c.name) + '">' +
        '<span class="swatch-check">' + CHECK_SVG + '</span></button>';
    }).join('');
    $('#bg-name').textContent = bgEntry(cur).name;
  }

  function pickBgColor(hex) {
    if (bgEntry(hex).hex === bgEntry(state.settings.bgColor).hex) return;
    state.settings.bgColor = hex;
    applyBgColor(hex);
    cacheBgColor(hex);
    renderSwatches();
    S.saveSettings({ bgColor: hex }).catch(function (err) {
      console.error(err);
      toast('背景色没能保存');
    });
  }

  function loadStats() {
    Promise.all([S.stats(), S.quota()]).then(function (r) {
      var st = r[0], q = r[1];
      var html = '<div class="stat-row">' +
        statCard(st.entries, '条日志') +
        statCard(st.media, '个媒体') +
        statCard(S.formatBytes(st.bytes), '占用空间') +
        '</div>';
      if (q && q.quota) {
        html += '<div class="row"><span class="row-label">浏览器可用空间</span>' +
          '<span class="row-static">' + S.formatBytes(q.usage || 0) + ' / ' + S.formatBytes(q.quota) + '</span></div>';
      }
      $('#stat-panel').innerHTML = html;
    });
  }

  function statCard(v, l) {
    return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(v)) + '</div>' +
      '<div class="stat-label">' + escapeHtml(l) + '</div></div>';
  }

  /* ---------------- 编辑 / 新建 ---------------- */

  function openEditor(entry) {
    clearEditorUrls();
    var members = state.settings.members;
    var draft;

    if (entry) {
      draft = { id: entry.id, author: entry.author, date: entry.date, text: entry.text || '', media: [] };
      $('#editor-title').textContent = '编辑日志';
    } else {
      draft = {
        id: null,
        author: state.settings.lastAuthor || members[0].key,
        date: S.todayStr(),
        text: '',
        media: []
      };
      $('#editor-title').textContent = '写日志';
    }

    state.editing = draft;
    $('#editor-text').value = draft.text;
    $('#editor-date').value = draft.date;
    renderAuthorPicker();

    if (entry && (entry.media || []).length) {
      setBusy(true);
      S.getThumbs(entry.media.map(function (m) { return m.id; })).then(function (thumbs) {
        draft.media = entry.media.map(function (m) {
          var blob = thumbs.get(m.id) || null;
          return {
            key: S.uid(), id: m.id, kind: m.kind, name: m.name, mime: m.mime,
            size: m.size, width: m.width, height: m.height,
            blob: null, thumb: blob, preview: blob
          };
        });
        renderEditorMedia();
        setBusy(false);
      }).catch(function () { setBusy(false); });
    } else {
      renderEditorMedia();
    }

    openSheet('#sheet-editor');
    // 不自动聚焦输入框：一进来就弹键盘会挡住内容，也可能只是来加张照片的。
    // 让用户自己决定要不要打字。
  }

  function renderAuthorPicker() {
    $('#author-picker').innerHTML = state.settings.members.map(function (m) {
      return '<button class="chip author-' + m.key + (state.editing.author === m.key ? ' active' : '') + '" ' +
        'data-author="' + m.key + '" type="button" style="--author-color:' + m.color + '">' +
        '<span class="dot" style="background:' + m.color + '"></span>' + escapeHtml(m.name) + '</button>';
    }).join('');
  }

  function renderEditorMedia() {
    var list = state.editing.media;
    $('#editor-media').innerHTML = list.map(function (m) {
      var url = '';
      if (m.preview) {
        url = state.editorUrls.get(m.key);
        if (!url) { url = URL.createObjectURL(m.preview); state.editorUrls.set(m.key, url); }
      }
      return '<div class="media-thumb" data-key="' + m.key + '">' +
        (url ? '<img src="' + url + '" alt="" />' : '') +
        (m.kind === 'video' ? '<span class="kind-tag">视频</span>' : '') +
        '<button class="rm" type="button" data-remove="' + m.key + '" aria-label="移除">✕</button>' +
        '</div>';
    }).join('');
  }

  function clearEditorUrls() {
    state.editorUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.editorUrls.clear();
  }

  function addFiles(files) {
    if (!files || !files.length) return;
    var arr = Array.prototype.slice.call(files);
    var pending = arr.length;
    setBusy(true);

    arr.forEach(function (file) {
      S.prepareFile(file).then(function (item) {
        state.editing.media.push(item);
        renderEditorMedia();
      }).catch(function (err) {
        if (err && err.message === 'VIDEO_TOO_LARGE') {
          toast('「' + file.name + '」超过 ' + S.formatBytes(S.MAX_VIDEO_BYTES) + '，换个短一点的吧');
        } else {
          toast('「' + file.name + '」处理失败');
          console.warn(err);
        }
      }).then(function () {
        pending--;
        if (pending <= 0) setBusy(false);
      });
    });
  }

  function saveEditor() {
    var d = state.editing;
    if (!d) return;
    var text = $('#editor-text').value.trim();
    var date = $('#editor-date').value || S.todayStr();

    if (!text && !d.media.length) { toast('写点什么，或加张照片吧'); return; }

    var keep = [], news = [], removeIds = [];
    d.media.forEach(function (m) {
      if (m.id) keep.push({
        id: m.id, kind: m.kind, name: m.name, mime: m.mime,
        size: m.size, width: m.width, height: m.height, hasThumb: !!m.thumb
      });
      else news.push(m);
    });

    if (d.id) {
      var entry = state.all.filter(function (e) { return e.id === d.id; })[0];
      if (entry) {
        var keepIds = {};
        keep.forEach(function (m) { keepIds[m.id] = 1; });
        (entry.media || []).forEach(function (m) { if (!keepIds[m.id]) removeIds.push(m.id); });
      }
    }

    setBusy(true);
    S.saveEntry({ id: d.id, author: d.author, date: date, text: text }, {
      keepMedia: keep, newMedia: news, removeMediaIds: removeIds
    }).then(function () {
      return S.saveSettings({ lastAuthor: d.author });
    }).then(function () {
      removeIds.forEach(revokeThumb);
      setBusy(false);
      closeSheet('#sheet-editor');
      // 新建才庆祝；改已有日志就安静地提示一下
      if (d.id) toast('已保存');
      else celebrate('已记下');
      return refresh();
    }).catch(function (err) {
      setBusy(false);
      console.error(err);
      toast('保存失败：' + (err && err.message ? err.message : '未知错误'));
    });
  }

  /* ---------------- 详情 ---------------- */

  function openDetail(id) {
    S.getEntry(id).then(function (entry) {
      if (!entry) { toast('这条日志已经不在了'); refresh(); return; }
      state.detail = { entry: entry, urls: new Map() };
      renderDetail(entry);
      openSheet('#sheet-detail');
    });
  }

  function renderDetail(entry) {
    var a = authorOf(entry);
    $('#detail-body').innerHTML =
      '<div class="detail-head">' +
      '<span class="avatar" style="--author-color:' + a.color + ';--author-soft:' + a.soft + '">' + escapeHtml(a.name.slice(0, 1)) + '</span>' +
      '<div class="entry-who"><span class="entry-name">' + escapeHtml(a.name) + '</span>' +
      '<span class="entry-time">' + formatFullDate(entry.date) + ' ' + formatTime(entry.createdAt) + '</span></div></div>' +
      (entry.text ? '<div class="detail-text">' + escapeHtml(entry.text) + '</div>' : '') +
      '<div class="detail-media" id="detail-media"></div>' +
      '<div class="detail-meta">' + (entry.updatedAt && entry.updatedAt !== entry.createdAt
        ? '最后修改：' + new Date(entry.updatedAt).toLocaleString('zh-CN') : '') + '</div>';

    var media = entry.media || [];
    if (!media.length) return;

    var urls = state.detail.urls;
    Promise.all(media.map(function (m) { return S.getMedia(m.id); })).then(function (records) {
      $('#detail-media').innerHTML = media.map(function (m, i) {
        var rec = records[i];
        if (!rec || !rec.blob) return '<div class="media-cell"><div class="no-thumb">文件丢失</div></div>';
        var url = URL.createObjectURL(rec.blob);
        urls.set(m.id, url);
        if (m.kind === 'video') {
          var poster = '';
          if (rec.thumb) {
            var purl = URL.createObjectURL(rec.thumb);
            urls.set('poster:' + m.id, purl);
            poster = ' poster="' + purl + '"';
          }
          return '<div class="media-cell"><video src="' + url + '" controls preload="metadata" playsinline' + poster + '></video></div>';
        }
        return '<div class="media-cell" data-media="' + m.id + '"><img src="' + url + '" alt="" /></div>';
      }).join('');
    });
  }

  function closeDetail() {
    if (state.detail) {
      state.detail.urls.forEach(function (u) { URL.revokeObjectURL(u); });
      state.detail.urls.clear();
      state.detail = null;
    }
  }

  /* ---------------- 大图 ---------------- */

  function openLightbox(mediaId) {
    var entry = state.detail ? state.detail.entry
      : state.all.filter(function (e) {
          return (e.media || []).some(function (m) { return m.id === mediaId; });
        })[0];
    if (!entry) return;
    var meta = (entry.media || []).filter(function (m) { return m.id === mediaId; })[0];

    S.getMedia(mediaId).then(function (rec) {
      if (!rec || !rec.blob) { toast('文件读不出来了'); return; }
      var url = URL.createObjectURL(rec.blob);
      $('#lightbox-stage').innerHTML = (meta && meta.kind === 'video')
        ? '<video src="' + url + '" controls autoplay playsinline></video>'
        : '<img src="' + url + '" alt="" />';

      state.lightbox = { entry: entry, mediaId: mediaId };
      renderLightboxCaption(entry, meta);

      $('#lightbox').hidden = false;
      $('#lightbox')._url = url;
    });
  }

  /** 大图下方的信息条：谁拍的、什么时候、跳去对应日志 */
  function renderLightboxCaption(entry, meta) {
    var a = authorOf(entry);
    var av = $('#lc-avatar');
    av.textContent = a.name.slice(0, 1);
    av.style.setProperty('--author-color', a.color);
    av.style.setProperty('--author-soft', a.soft);

    $('#lc-name').textContent = a.name + (meta && meta.kind === 'video' ? ' · 视频' : '');
    $('#lc-time').textContent = formatDay(entry.date).title + ' · ' + formatTime(entry.createdAt) +
      ' · ' + formatDay(entry.date).sub;
    $('#lightbox-caption').hidden = false;
  }

  function closeLightbox() {
    var lb = $('#lightbox');
    if (lb._url) { URL.revokeObjectURL(lb._url); lb._url = null; }
    $('#lightbox-stage').innerHTML = '';
    $('#lightbox-caption').hidden = true;
    state.lightbox = null;
    lb.hidden = true;
  }

  /* ---------------- 面板开关 ---------------- */

  var SHEETS = ['#sheet-editor', '#sheet-detail'];
  var CLOSE_FALLBACK_MS = 340;

  function isOpen(sel) {
    var el = $(sel);
    return !!el && !el.hidden && !el.classList.contains('closing');
  }

  /* 每个面板带一个「代号」_gen：关闭过程中若又被打开，代号变化，
     原定的收尾动作会自动作废，避免把刚打开的面板又藏起来。 */

  function forceHide(el) {
    el._gen = (el._gen || 0) + 1;
    if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
    el.classList.remove('closing');
    el.hidden = true;
  }

  function showSheetEl(el) {
    el._gen = (el._gen || 0) + 1;
    if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
    el.classList.remove('closing');
    el.hidden = false;
  }

  function hideSheetEl(el, onGone) {
    if (el.hidden) { if (onGone) onGone(); return; }

    var gen = el._gen = (el._gen || 0) + 1;
    if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
    el.classList.add('closing');

    var done = false;
    function finish() {
      if (done || el._gen !== gen) return;
      done = true;
      el.removeEventListener('animationend', onEnd);
      if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
      el.classList.remove('closing');
      el.hidden = true;
      if (onGone) onGone();
    }
    function onEnd(e) { if (e.target === el) finish(); }

    el.addEventListener('animationend', onEnd);
    el._closeTimer = setTimeout(finish, CLOSE_FALLBACK_MS);
  }

  var _overlayTimer = null;
  function showOverlay() {
    var ov = $('#overlay');
    if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
    ov.classList.remove('closing');
    ov.hidden = false;
  }
  function hideOverlay() {
    var ov = $('#overlay');
    if (ov.hidden) return;
    if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
    ov.classList.add('closing');
    _overlayTimer = setTimeout(function () {
      _overlayTimer = null;
      ov.classList.remove('closing');
      ov.hidden = true;
    }, 220);
  }

  /** 打开某个面板：其他面板立即隐藏，新面板从中心弹出 */
  function openSheet(sel) {
    if (sel !== '#sheet-detail') closeDetail();
    if (sel !== '#sheet-editor') { clearEditorUrls(); state.editing = null; }
    SHEETS.forEach(function (s) { forceHide($(s)); });
    showOverlay();
    showSheetEl($(sel));
  }

  function closeSheet(sel) {
    var el = $(sel);
    if (!el) return;
    hideSheetEl(el, function () {
      if (sel === '#sheet-detail') closeDetail();
      if (sel === '#sheet-editor') { clearEditorUrls(); state.editing = null; }
      if (!SHEETS.some(isOpen)) hideOverlay();
    });
  }

  /** 全部关闭（带退出动画），动画放完再清理状态 */
  function closeSheets() {
    var pending = 0;

    function finishClose() {
      if (SHEETS.some(isOpen)) return;
      hideOverlay();
      closeDetail();
      clearEditorUrls();
      state.editing = null;
    }

    SHEETS.forEach(function (s) {
      var el = $(s);
      if (el.hidden) return;
      pending++;
      hideSheetEl(el, function () {
        pending--;
        if (pending === 0) finishClose();
      });
    });

    if (pending === 0) finishClose();
  }

  /* ---------------- 备份 ---------------- */

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function doExport() {
    setBusy(true);
    S.exportAll()
      .then(function (payload) {
        download('印记备份-' + S.todayStr() + '.json', JSON.stringify(payload));
        setBusy(false);
        toast('备份已导出');
      })
      .catch(function (err) { setBusy(false); console.error(err); toast('导出失败'); });
  }

  function doImport(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try { payload = JSON.parse(reader.result); }
      catch (e) { toast('文件格式不对'); return; }

      ask({
        title: '导入备份',
        text: '导入会覆盖当前全部数据（' + state.all.length + ' 条日志）。确定继续吗？',
        okText: '覆盖导入',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        setBusy(true);
        S.importAll(payload)
          .then(function (n) {
            setBusy(false);
            toast('已导入 ' + n + ' 条日志');
            thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
            thumbUrls.clear();
            return refresh();
          })
          .catch(function (err) {
            setBusy(false);
            console.error(err);
            toast('导入失败：' + (err && err.message ? err.message : '未知错误'));
          });
      });
    };
    reader.readAsText(file);
  }

  function doClear() {
    ask({
      title: '清空全部数据',
      text: '将删除本机上的 ' + state.all.length + ' 条日志和所有照片、视频，无法恢复。建议先导出备份。',
      okText: '仍然清空',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      setBusy(true);
      S.clearAll().then(function () {
        thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
        thumbUrls.clear();
        return refresh();
      }).then(function () {
        setBusy(false);
        toast('已清空');
      }).catch(function (err) { setBusy(false); console.error(err); toast('清空失败'); });
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    window.addEventListener('resize', function () {
      positionThumb();
    });

    // 滚动：决定当前页那一格是不是「回到顶部」
    window.addEventListener('scroll', function () { syncToTop(); }, { passive: true });

    // 标签栏
    $('#tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      var name = b.getAttribute('data-tab');
      // 已经在这一页、又滚到了下方 —— 这一格此刻是「回到顶部」
      if (name === state.tab && toTopOn) { scrollToTop(); return; }
      switchTab(name);
    });

    // 搜索：常驻输入框，不再弹进弹出
    var searchInput = $('#search-input');
    var searchClear = $('#btn-search-clear');

    function syncSearchClear() { searchClear.hidden = !searchInput.value; }

    searchInput.addEventListener('input', function () {
      state.keyword = searchInput.value.trim();
      syncSearchClear();
      renderTimeline();
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') searchInput.blur();
    });

    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      state.keyword = '';
      syncSearchClear();
      renderTimeline();
      searchInput.focus();
    });

    // 分段控件
    $('#segmented').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b) return;
      var f = b.getAttribute('data-filter');
      if (f === state.filter) return;
      state.filter = f;
      $$('#segmented .seg-btn').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      positionThumb();
      renderTimeline();
    });

    // 时间线
    $('#timeline').addEventListener('click', function (e) {
      var cell = e.target.closest('.media-cell');
      if (cell) { e.stopPropagation(); openLightbox(cell.getAttribute('data-media')); return; }
      var card = e.target.closest('.entry');
      if (card) openDetail(card.getAttribute('data-id'));
    });

    // 相册
    $('#album').addEventListener('click', function (e) {
      var cell = e.target.closest('.album-cell');
      if (cell) openLightbox(cell.getAttribute('data-media'));
    });

    // FAB
    $('#fab').addEventListener('click', function () { openEditor(null); });

    // 关闭按钮 / 遮罩
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-close]');
      if (!close) return;
      var sheet = close.closest('.sheet');
      if (sheet) closeSheet('#' + sheet.id);
    });

    $('#overlay').addEventListener('click', function () { closeSheets(); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#lightbox').hidden) { closeLightbox(); return; }
      if (!$('#dialog').hidden) { closeDialog(false); return; }
      if (SHEETS.some(isOpen)) closeSheets();
    });

    // 编辑器
    $('#author-picker').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-author]');
      if (!chip || !state.editing) return;
      state.editing.author = chip.getAttribute('data-author');
      renderAuthorPicker();
    });

    $('#editor-text').addEventListener('input', function (e) {
      if (state.editing) state.editing.text = e.target.value;
    });

    $('#editor-date').addEventListener('change', function (e) {
      if (state.editing) state.editing.date = e.target.value || S.todayStr();
    });

    $('#btn-pick-photo').addEventListener('click', function () { $('#file-photo').click(); });
    $('#btn-pick-video').addEventListener('click', function () { $('#file-video').click(); });

    $('#file-photo').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    $('#file-video').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });

    $('#editor-media').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove]');
      if (!btn || !state.editing) return;
      var key = btn.getAttribute('data-remove');
      state.editing.media = state.editing.media.filter(function (m) { return m.key !== key; });
      var u = state.editorUrls.get(key);
      if (u) { URL.revokeObjectURL(u); state.editorUrls.delete(key); }
      renderEditorMedia();
    });

    $('#btn-save').addEventListener('click', saveEditor);

    // 详情
    $('#btn-edit').addEventListener('click', function () {
      if (!state.detail) return;
      var entry = state.detail.entry;
      closeSheets();
      openEditor(entry);
    });

    $('#btn-delete').addEventListener('click', function () {
      if (!state.detail) return;
      var entry = state.detail.entry;
      ask({
        title: '删除这条日志',
        text: '删除后无法恢复，其中的照片和视频也会一并删除。',
        okText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        setBusy(true);
        (entry.media || []).forEach(function (m) { revokeThumb(m.id); });
        S.deleteEntry(entry.id).then(function () {
          closeSheets();
          setBusy(false);
          toast('已删除');
          return refresh();
        }).catch(function (err) { setBusy(false); console.error(err); toast('删除失败'); });
      });
    });

    // 大图
    $('#lightbox-close').addEventListener('click', closeLightbox);
    $('#lightbox').addEventListener('click', function (e) {
      // 点画面以外的任何地方都关掉（图片/视频/信息条/关闭按钮除外），
      // 比只能点那一圈边距好按得多
      if (e.target.closest('img, video, .lightbox-caption, .lightbox-close')) return;
      closeLightbox();
    });
    $('#lightbox-goto').addEventListener('click', function () {
      var lb = state.lightbox;
      if (!lb) return;
      var id = lb.entry.id;
      closeLightbox();
      openDetail(id);
    });

    // 对话框
    $('#dialog-ok').addEventListener('click', function () { closeDialog(true); });
    $('#dialog-cancel').addEventListener('click', function () { closeDialog(false); });
    $('#dialog').addEventListener('click', function (e) {
      if (e.target === $('#dialog')) closeDialog(false);
    });

    // 设置：背景色
    $('#swatches').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bg]');
      if (b) pickBgColor(b.getAttribute('data-bg'));
    });

    // 设置：成员改名
    $('#member-list').addEventListener('change', function (e) {
      var input = e.target.closest('[data-member]');
      if (!input) return;
      var key = input.getAttribute('data-member');
      var name = input.value.trim() || '成员';
      var members = state.settings.members.map(function (m) {
        return m.key === key ? Object.assign({}, m, { name: name }) : m;
      });
      S.saveSettings({ members: members }).then(function () {
        state.settings.members = members;
        renderSegmented();
        renderTimeline();
        var av = $('#member-list .member-row .avatar');
        if (av) av.textContent = name.slice(0, 1);
        toast('称呼已更新');
      });
    });

    $('#btn-export').addEventListener('click', doExport);
    $('#btn-import').addEventListener('click', function () { $('#file-import').click(); });
    $('#file-import').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-clear').addEventListener('click', doClear);

    // 拖拽文件到编辑器
    ['dragover', 'drop'].forEach(function (t) {
      window.addEventListener(t, function (e) { e.preventDefault(); });
    });
    window.addEventListener('drop', function (e) {
      if (!$('#sheet-editor').hidden && e.dataTransfer && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });

    // 字体/尺寸变化后重新对齐分段指示器
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { positionThumb(); });
    }
    setTimeout(positionThumb, 400);
  }

  var booted = false;
  function bootOnce() { if (booted) return; booted = true; boot(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce);
  else bootOnce();
})();
