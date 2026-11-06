/* Wares Launcher - animated backgrounds. One canvas, one rAF loop, capped FPS, paused when not visible. */
(function () {
  'use strict';
  const W = window.W;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /** Accent-derived palette. c(dh, ds, dl, a) returns an hsla() string. */
  function makePalette() {
    const p = { h: 215, s: 65, l: 62 };
    p.update = () => {
      const css = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6fa3e0';
      let r = 111, g = 163, b = 224;
      const m = /^#([0-9a-f]{6})$/i.exec(css);
      if (m) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      const d = mx - mn;
      let hh = 0; let s = 0;
      if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hh *= 60; if (hh < 0) hh += 360;
      }
      p.h = hh; p.s = s * 100; p.l = l * 100;
    };
    p.c = (dh = 0, ds = 0, dl = 0, a = 1) => `hsla(${(p.h + dh + 360) % 360},${clamp(p.s + ds, 0, 100)}%,${clamp(p.l + dl, 4, 96)}%,${a})`;
    p.update();
    return p;
  }

  const PRESETS = {
    aurora: {
      name: 'Aurora', scale: 0.22,
      make(w, h, p) {
        const bl = [0, 1, 2, 3].map((i) => ({ x: rnd(0, w), y: rnd(0, h), r: Math.max(w, h) * rnd(0.3, 0.46), vx: rnd(-7, 7), vy: rnd(-4, 4), dh: [0, -35, 40, -75][i], a: [0.5, 0.36, 0.32, 0.26][i] }));
        return {
          step(dt) { for (const b of bl) { b.x += b.vx * dt; b.y += b.vy * dt; if (b.x < -b.r * 0.3 || b.x > w + b.r * 0.3) b.vx *= -1; if (b.y < -b.r * 0.3 || b.y > h + b.r * 0.3) b.vy *= -1; } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'lighter';
            for (const b of bl) {
              const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
              g.addColorStop(0, p.c(b.dh, 0, -10, b.a));
              g.addColorStop(1, p.c(b.dh, 0, -10, 0));
              ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            }
            ctx.globalCompositeOperation = 'source-over';
          },
        };
      },
    },
    stars: {
      name: 'Starfield', scale: 1,
      make(w, h, p) {
        const n = clamp(Math.round((w * h) / 8000), 70, 240);
        const s = Array.from({ length: n }, () => ({ x: rnd(0, w), y: rnd(0, h), z: Math.random() ** 2, tw: rnd(0.6, 2.4), tint: Math.random() < 0.18 }));
        let t = 0;
        return {
          step(dt, tt) { t = tt; for (const o of s) { o.x -= (3 + o.z * 16) * dt; if (o.x < 0) { o.x = w; o.y = rnd(0, h); } } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            for (const o of s) {
              const a = (0.25 + 0.75 * o.z) * (0.7 + 0.3 * Math.sin(t * o.tw + o.x));
              ctx.fillStyle = o.tint ? p.c(0, 10, 18, a) : `rgba(225,232,245,${a})`;
              const sz = o.z > 0.75 ? 2 : 1;
              ctx.fillRect(Math.round(o.x), Math.round(o.y), sz, sz);
            }
          },
        };
      },
    },
    embers: {
      name: 'Embers', scale: 0.7,
      make(w, h, p) {
        const mk = (fresh) => ({ x: rnd(0, w), y: fresh ? h + rnd(0, 30) : rnd(0, h), v: rnd(12, 38), r: rnd(0.7, 2.1), ph: rnd(0, 6), sw: rnd(4, 14), a: rnd(0.35, 0.9) });
        const e = Array.from({ length: clamp(Math.round(w / 9), 36, 90) }, () => mk(false));
        return {
          step(dt, t) { for (const o of e) { o.y -= o.v * dt; o.x += Math.sin(t * 0.9 + o.ph) * o.sw * dt; if (o.y < -8) Object.assign(o, mk(true)); } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'lighter';
            for (const o of e) {
              const fade = clamp(o.y / (h * 0.9), 0, 1) * o.a;
              ctx.fillStyle = p.c(-8, 0, 6, fade * 0.16); ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 4.2, 0, 6.3); ctx.fill();
              ctx.fillStyle = p.c(-4, 0, 22, fade); ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.3); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
          },
        };
      },
    },
    rain: {
      name: 'Rain', scale: 0.6,
      make(w, h, p) {
        const d = Array.from({ length: clamp(Math.round(w / 5), 60, 190) }, () => ({ x: rnd(-20, w), y: rnd(0, h), l: rnd(7, 17), v: rnd(380, 720) }));
        return {
          step(dt) { for (const o of d) { o.y += o.v * dt; o.x -= o.v * dt * 0.16; if (o.y > h + 20) { o.y = -20; o.x = rnd(0, w + 30); } } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 1; ctx.strokeStyle = p.c(0, -25, 24, 0.3); ctx.beginPath();
            for (const o of d) { ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - o.l * 0.16, o.y - o.l); }
            ctx.stroke();
          },
        };
      },
    },
    snow: {
      name: 'Snowfall', scale: 0.75,
      make(w, h) {
        const f = Array.from({ length: clamp(Math.round(w / 8), 45, 120) }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(0.8, 2.6), v: rnd(10, 34), ph: rnd(0, 6), sw: rnd(4, 12) }));
        return {
          step(dt, t) { for (const o of f) { o.y += o.v * dt; o.x += Math.sin(t * 0.8 + o.ph) * o.sw * dt; if (o.y > h + 4) { o.y = -4; o.x = rnd(0, w); } } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            for (const o of f) { ctx.fillStyle = `rgba(236,242,250,${0.35 + o.r * 0.18})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.3); ctx.fill(); }
          },
        };
      },
    },
    grid: {
      name: 'Horizon grid', scale: 0.6,
      make(w, h, p) {
        let off = 0;
        return {
          step(dt) { off = (off + dt * 0.45) % 1; },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            const y0 = h * 0.5; const cx = w / 2;
            const g = ctx.createRadialGradient(cx, y0, 0, cx, y0, h * 0.5);
            g.addColorStop(0, p.c(0, 0, 0, 0.42)); g.addColorStop(1, p.c(0, 0, 0, 0));
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, y0 + 2);
            ctx.lineWidth = 1;
            for (let i = -18; i <= 18; i++) {
              ctx.strokeStyle = p.c(0, 0, 4, 0.28 - Math.abs(i) * 0.008);
              ctx.beginPath(); ctx.moveTo(cx + i * w * 0.02, y0); ctx.lineTo(cx + i * w * 0.17, h); ctx.stroke();
            }
            for (let k = 0; k < 14; k++) {
              const z = (k + off) / 14;
              const y = y0 + (h - y0) * z * z;
              ctx.strokeStyle = p.c(0, 0, 4, 0.1 + z * 0.3);
              ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
          },
        };
      },
    },
    fireflies: {
      name: 'Fireflies', scale: 0.75,
      make(w, h, p) {
        const f = Array.from({ length: clamp(Math.round(w / 18), 18, 46) }, () => ({ x: rnd(0, w), y: rnd(0, h), a: rnd(0, 6.3), v: rnd(5, 15), ph: rnd(0, 6), sp: rnd(0.5, 1.4) }));
        return {
          step(dt) { for (const o of f) { o.a += rnd(-1.4, 1.4) * dt; o.x += Math.cos(o.a) * o.v * dt; o.y += Math.sin(o.a) * o.v * dt; if (o.x < -10) o.x = w + 10; if (o.x > w + 10) o.x = -10; if (o.y < -10) o.y = h + 10; if (o.y > h + 10) o.y = -10; } },
          draw(ctx, t) {
            ctx.clearRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'lighter';
            for (const o of f) {
              const a = Math.max(0, Math.sin(t * o.sp + o.ph)) ** 2;
              if (a < 0.02) continue;
              const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 9);
              g.addColorStop(0, p.c(-6, 0, 24, a * 0.85)); g.addColorStop(1, p.c(-6, 0, 24, 0));
              ctx.fillStyle = g; ctx.fillRect(o.x - 9, o.y - 9, 18, 18);
            }
            ctx.globalCompositeOperation = 'source-over';
          },
        };
      },
    },
    waves: {
      name: 'Waves', scale: 0.35,
      make(w, h, p) {
        const L = [0, 1, 2, 3, 4].map((i) => ({ y: h * (0.5 + i * 0.1), amp: h * (0.035 + i * 0.012), f: rnd(0.012, 0.022) * (1 - i * 0.1), v: rnd(0.4, 0.9) * (i % 2 ? -1 : 1), ph: rnd(0, 6), dh: i * -14 }));
        let t = 0;
        return {
          step(dt, tt) { t = tt; },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            L.forEach((l, i) => {
              ctx.beginPath(); ctx.moveTo(0, h);
              for (let x = 0; x <= w; x += 3) ctx.lineTo(x, l.y + Math.sin(x * l.f * 6.28 + t * l.v + l.ph) * l.amp + Math.sin(x * l.f * 14 - t * l.v * 0.6) * l.amp * 0.35);
              ctx.lineTo(w, h); ctx.closePath();
              const g = ctx.createLinearGradient(0, l.y - l.amp, 0, h);
              g.addColorStop(0, p.c(l.dh, -6, -6, 0.16 + i * 0.03)); g.addColorStop(1, p.c(l.dh, -6, -20, 0.02));
              ctx.fillStyle = g; ctx.fill();
            });
          },
        };
      },
    },
    voxels: {
      name: 'Voxel drift', scale: 0.6,
      make(w, h, p) {
        const mk = (fresh) => ({ x: rnd(0, w), y: fresh ? h + 40 : rnd(0, h), s: rnd(10, 38), v: rnd(3, 11), z: rnd(0.3, 1) });
        const c = Array.from({ length: clamp(Math.round(w / 26), 10, 24) }, () => mk(false)).sort((a, b) => a.z - b.z);
        return {
          step(dt) { for (const o of c) { o.y -= o.v * o.z * dt; if (o.y < -60) Object.assign(o, mk(true)); } },
          draw(ctx) {
            ctx.clearRect(0, 0, w, h);
            for (const o of c) {
              const a = 0.1 + o.z * 0.3; const s = o.s * o.z; const ax = s * 0.866; const x = o.x; const y = o.y;
              const face = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); ctx.fill(); };
              face([x, y - s, x + ax, y - s / 2, x, y, x - ax, y - s / 2], p.c(0, -6, 12, a));
              face([x - ax, y - s / 2, x, y, x, y + s, x - ax, y + s / 2], p.c(0, -10, -4, a));
              face([x + ax, y - s / 2, x, y, x, y + s, x + ax, y + s / 2], p.c(0, -14, -14, a));
            }
          },
        };
      },
    },
  };

  class Engine {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.name = null; this.fps = 30;
      this.sim = null; this.raf = 0; this.last = 0; this.t = 0; this.cost = 0; this.slow = 0; this.reasons = new Set(); this.pal = makePalette();
      this.loop = this.loop.bind(this);
    }
    shouldRun() { return !!this.sim && !document.hidden && this.reasons.size === 0 && !W.state.lowResource && !reduced.matches; }
    kick() { if (!this.raf && this.shouldRun()) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
    loop(now) {
      this.raf = 0;
      if (!this.shouldRun()) return;
      if (now - this.last >= 1000 / this.fps - 2) {
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now; this.t += dt;
        const t0 = performance.now();
        this.sim.step(dt, this.t); this.sim.draw(this.ctx, this.t);
        // Adaptive quality: if drawing eats more than ~45% of the frame budget for a while, drop the frame rate.
        this.cost = this.cost * 0.92 + (performance.now() - t0) * 0.08;
        if (this.cost > 0.45 * (1000 / this.fps) && this.fps > 15 && ++this.slow > 90) {
          this.fps = this.fps > 30 ? 30 : this.fps > 24 ? 24 : 15; this.slow = 0; this.cost = 0;
        } else if (this.cost <= 0.45 * (1000 / this.fps)) this.slow = 0;
      }
      this.raf = requestAnimationFrame(this.loop);
    }
    clear() { this.sim = null; cancelAnimationFrame(this.raf); this.raf = 0; this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    setPreset(name) { this.name = name; this.rebuild(); }
    rebuild() {
      const def = PRESETS[this.name];
      if (!def) { this.clear(); return; }
      const r = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(8, Math.round(r.width * def.scale)); const h = Math.max(8, Math.round(r.height * def.scale));
      this.canvas.width = w; this.canvas.height = h;
      this.pal.update();
      this.sim = def.make(w, h, this.pal);
      for (let i = 0; i < 24; i++) { this.t += 0.1; this.sim.step(0.1, this.t); }
      this.sim.draw(this.ctx, this.t);
      this.kick();
    }
    pause(reason) { this.reasons.add(reason); }
    resume(reason) { this.reasons.delete(reason); this.kick(); }
  }

  let engine;
  let battery = null;
  let media = null;
  let mediaToken = 0;

  function clearMedia() { const m = document.getElementById('bg-media'); m.replaceChildren(); media = null; }

  async function applyMedia(b) {
    const token = ++mediaToken;
    clearMedia();
    let info = null;
    try { info = await W.api('bg:url', b.wallpaper); } catch { /* none */ }
    if (token !== mediaToken || !info) return;
    const holder = document.getElementById('bg-media');
    if (info.kind === 'video') {
      media = W.h('video', { src: info.url, muted: true, loop: true, autoplay: true, playsinline: true, preload: 'auto', disablePictureInPicture: true });
      media.muted = true;
    } else media = W.h('img', { src: info.url, alt: '' });
    holder.append(media);
    holder.style.filter = b.blur ? `blur(${b.blur}px)` : '';
    holder.style.transform = b.blur ? 'scale(1.06)' : '';
  }

  const bg = {
    PRESET_LIST: Object.entries(PRESETS).map(([id, d]) => ({ id, name: d.name })),
    init() {
      engine = new Engine(document.getElementById('bg-canvas'));
      const stage = document.getElementById('bg');
      let rt;
      new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => engine.name && engine.rebuild(), 220); }).observe(stage);
      document.addEventListener('visibilitychange', () => (document.hidden ? 0 : engine.kick()));
      window.addEventListener('blur', () => { if (W.state.settings.background.pauseUnfocused) { engine.pause('blur'); media && media.pause && media.pause(); } });
      window.addEventListener('focus', () => { engine.resume('blur'); media && media.play && media.play().catch(() => {}); });
      if (navigator.getBattery) navigator.getBattery().then((bat) => { battery = bat; bat.addEventListener('chargingchange', bg.syncPower); bg.syncPower(); }).catch(() => {});
    },
    apply() {
      const b = W.state.settings.background;
      document.documentElement.style.setProperty('--dim', String(b.dim / 100));
      engine.fps = b.fps;
      engine.slow = 0;
      engine.cost = 0;
      const holder = document.getElementById('bg-media');
      if (b.mode === 'wallpaper') { engine.clear(); applyMedia(b); }
      else {
        mediaToken++; clearMedia(); holder.style.filter = '';
        if (b.mode === 'preset') engine.setPreset(b.preset); else engine.clear();
      }
      bg.syncGame();
      bg.syncPower();
    },
    refreshPalette() { if (engine && engine.sim) { engine.pal.update(); engine.sim.draw(engine.ctx, engine.t); } },
    syncGame() {
      const b = W.state.settings.background;
      if (b.pauseInGame && W.state.gameRunning) { engine.pause('game'); media && media.pause && media.pause(); }
      else { engine.resume('game'); media && media.play && media.play().catch(() => {}); }
    },
    syncPower() {
      if (!engine || !battery) return;
      if (!battery.charging && W.state.settings.background.pauseOnBattery) { engine.pause('battery'); media && media.pause && media.pause(); }
      else { engine.resume('battery'); media && media.play && media.play().catch(() => {}); }
    },
    wake() { engine && engine.kick(); },
    /** Render a still frame of a preset into a small canvas (settings gallery). */
    thumb(name, w = 224, h = 126) {
      const def = PRESETS[name];
      const c = W.h('canvas', { width: Math.round(w * def.scale), height: Math.round(h * def.scale) });
      const ctx = c.getContext('2d');
      const sim = def.make(c.width, c.height, makePalette());
      for (let i = 0; i < 40; i++) sim.step(0.1, i * 0.1);
      sim.draw(ctx, 4);
      c.style.width = '100%'; c.style.height = '100%';
      return c;
    },
  };
  W.bg = bg;
})();
