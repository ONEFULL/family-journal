/* 印记 · celebrate.js
   记下一笔后的全屏庆祝：从屏幕中心炸开的彩带 + 中央「已记下」徽章。
   零依赖、无第三方库；动画跑完自动销毁 canvas 与 rAF，不留常驻循环。 */
(function () {
  'use strict';

  // 配色沿用应用主色系（暖橙 + 三位成员色 + 一点白）
  var COLORS = ['#e8613c', '#f0935a', '#f5c26b', '#c76a8e', '#e39cc0',
                '#4a7ba7', '#8fc0e0', '#6a9a70', '#b8d8a0', '#7a6ab0', '#ffffff'];

  var TAU = Math.PI * 2;
  var TOTAL_MS = 2700;      // 整场动画时长（到点无条件清理）
  var WAVE2_AT = 160;       // 第二波：炸开后的余势
  var WAVE3_AT = 400;       // 第三波：慢速飘落，负责「落下来」的收尾

  var canvas = null, ctx = null, vp = { w: 0, h: 0 };
  var parts = [], rings = [];
  var raf = 0, last = 0, token = 0;
  var badgeIn = 0, badgeOut = 0, endTimer = 0, wave2 = 0, wave3 = 0;

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------------- 画布 ---------------- */

  function fit() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);   // 限制 2x，避免大屏 3x 白烧性能
    vp.w = window.innerWidth;
    vp.h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(vp.w * dpr));
    canvas.height = Math.max(1, Math.round(vp.h * dpr));
    canvas.style.width = vp.w + 'px';
    canvas.style.height = vp.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    fit();
    window.addEventListener('resize', fit);
  }

  function teardown() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    clearTimeout(wave2); clearTimeout(wave3); clearTimeout(endTimer);
    parts.length = 0;
    rings.length = 0;
    if (canvas) {
      window.removeEventListener('resize', fit);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null; ctx = null;
    }
  }

  /* ---------------- 粒子 ---------------- */

  function spawn(n, opt) {
    // 屏幕越大飞得越远，保证「炸满全屏」
    var s = Math.min(Math.max(Math.max(vp.w, vp.h) / 820, 0.85), 1.6);
    var size = Math.min(Math.max(s, 0.8), 1.35);
    var cx = vp.w / 2, cy = vp.h / 2;

    for (var i = 0; i < n; i++) {
      var ang = opt.angle + (Math.random() - 0.5) * opt.spread;
      var sp = (opt.vmin + Math.random() * (opt.vmax - opt.vmin)) * s;
      parts.push({
        x: cx + (Math.random() - 0.5) * 18,
        y: cy + (Math.random() - 0.5) * 18,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + opt.lift,
        w: (4 + Math.random() * 9) * size,
        h: (2.4 + Math.random() * 4.6) * size,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.36,
        seed: Math.random() * TAU,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.2,
        drag: opt.drag,
        grav: opt.grav,
        life: 0,
        ttl: Math.round(opt.ttl * (0.75 + Math.random() * 0.45))
      });
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);

    // 归一化到「60fps 的帧」为单位，120Hz 屏上速度才不会翻倍
    var dt = Math.min((now - last) / 16.6667, 2.5);
    if (!(dt > 0)) dt = 1;
    last = now;

    ctx.clearRect(0, 0, vp.w, vp.h);

    // 中心光晕：给「爆炸」一个瞬间的亮度
    for (var r = rings.length - 1; r >= 0; r--) {
      var g = rings[r];
      g.life += dt;
      var kr = g.life / g.ttl;
      if (kr >= 1) { rings.splice(r, 1); continue; }
      var rad = Math.max(g.max * (1 - Math.pow(1 - kr, 2.4)), 1);
      var ga = (1 - kr) * 0.6;
      var rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rad);
      rg.addColorStop(0, 'rgba(255, 246, 236, ' + ga + ')');
      rg.addColorStop(0.55, 'rgba(255, 188, 138, ' + ga * 0.45 + ')');
      rg.addColorStop(1, 'rgba(255, 188, 138, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.fill();
    }

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life += dt;
      if (p.life > p.ttl) continue;

      var d = Math.pow(p.drag, dt);
      p.vx *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;

      var k = p.life / p.ttl;
      var alpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath(); ctx.arc(0, 0, p.h * 0.5, 0, TAU); ctx.fill();
      } else {
        // 纵向缩放模拟纸片翻面，彩带才有立体感（缩到 0 就是「侧着」那一瞬）
        ctx.scale(1, Math.cos(p.life * 0.16 + p.seed));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  }

  /* ---------------- 中央徽章 ---------------- */

  function showBadge(label, myToken) {
    var el = document.getElementById('fx-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fx-badge';
      el.className = 'fx-badge';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML =
        '<span class="fx-badge-ic">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M5 12.8l4.4 4.4L19 6.6"/>' +
          '</svg>' +
        '</span>' +
        '<span class="fx-badge-text"></span>';
      document.body.appendChild(el);
    }
    el.querySelector('.fx-badge-text').textContent = label;

    // 重放：先让元素可见且不带动画类，强制一次重排，再挂上动画类
    el.hidden = false;
    el.classList.remove('show', 'out');
    void el.offsetWidth;
    el.classList.add('show');

    clearTimeout(badgeIn); clearTimeout(badgeOut);
    badgeIn = setTimeout(function () {
      if (myToken !== token) return;
      el.classList.add('out');
      badgeOut = setTimeout(function () {
        if (myToken !== token) return;
        el.hidden = true;
        el.classList.remove('show', 'out');
      }, 490);
    }, 1650);
  }

  /* ---------------- 对外接口 ---------------- */

  function burst(opts) {
    opts = opts || {};
    var myToken = ++token;
    var delay = opts.delay == null ? 170 : opts.delay;

    showBadge(opts.label || '已记下', myToken);

    if (reduceMotion()) return;   // 尊重系统设置：只留徽章，不炸彩带

    setTimeout(function () {
      if (myToken !== token) return;

      ensureCanvas();
      parts.length = 0;
      rings.length = 0;

      rings.push({ x: vp.w / 2, y: vp.h / 2, max: Math.max(vp.w, vp.h) * 0.52, life: 0, ttl: 22 });

      // 第一波：初速快、阻力大 —— 瞬间炸到屏幕边缘，然后迅速减速
      spawn(150, { angle: 0, spread: TAU, vmin: 11, vmax: 30, lift: -1.6,
                   drag: 0.962, grav: 0.34, ttl: 100 });

      last = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);

      // 第二波：中速，补足中景的密度
      wave2 = setTimeout(function () {
        if (myToken !== token || !ctx) return;
        spawn(105, { angle: 0, spread: TAU, vmin: 8, vmax: 22, lift: -0.8,
                     drag: 0.968, grav: 0.4, ttl: 112 });
      }, WAVE2_AT);

      // 第三波：慢速小片，负责落下来的收尾，让画面不至于「唰一下空掉」
      wave3 = setTimeout(function () {
        if (myToken !== token || !ctx) return;
        spawn(70, { angle: 0, spread: TAU, vmin: 3.5, vmax: 11, lift: -0.2,
                    drag: 0.978, grav: 0.46, ttl: 124 });
      }, WAVE3_AT);

      endTimer = setTimeout(function () {
        if (myToken !== token) return;
        teardown();
      }, TOTAL_MS);
    }, delay);
  }

  window.Celebrate = { burst: burst };
})();
