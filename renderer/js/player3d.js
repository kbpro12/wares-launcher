/* Wares Launcher - animated player.
   Rendered by native/render (Rust, compiled to WebAssembly): a software rasteriser with a z-buffer, so there is no sorting
   flicker. One persistent canvas is reused across Home re-renders, the loop only runs while the canvas is on screen,
   and it backs off to a lower resolution / frame rate when frames take too long. */
(function () {
  'use strict';
  const W = window.W;
  const { h } = W;
  const root = document.documentElement;
  const DANCES = ['disco', 'pump', 'sway', 'spin'];
  const ID = { idle: 0, disco: 1, pump: 2, sway: 3, spin: 4, walk: 5 };
  const CW = 300; const CH = 360; // aspect 5:6, matches the CSS box

  const P = {
    canvas: null, ctx: null, img: null, w: 0, h: 0, q: 1.5, ex: null, readyP: null, failed: false,
    skinKey: null, mode: 'random', cur: 'disco', danceAt: 0, temp: null, walking: false,
    mx: null, my: null, lx: 0, ly: 0, rect: null, rectAt: 0, raf: 0, last: 0, t0: performance.now(),
    cost: 0, costN: 0, fpsMode: 'auto', slow: false,
  };

  function engine() {
    if (P.readyP) return P.readyP;
    P.readyP = (async () => {
      const b64 = window.WARES_RENDER_WASM;
      if (!b64) throw new Error('renderer missing');
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bin, {});
      P.ex = instance.exports;
      return P.ex;
    })().catch((e) => { P.failed = true; console.warn('Rust renderer unavailable:', e.message); });
    return P.readyP;
  }

  function ensureCanvas() {
    if (P.canvas) return P.canvas;
    const c = document.createElement('canvas');
    c.className = 'pl-canvas';
    c.setAttribute('aria-hidden', 'true');
    c.addEventListener('click', () => {
      if (P.mode === 'idle' || P.walking) P.temp = { id: 1, until: performance.now() + 1800 }; // wave a little
      else nextDance();
      kick();
    });
    P.canvas = c; P.ctx = c.getContext('2d', { alpha: true });
    new ResizeObserver(() => { P.w = 0; kick(); }).observe(c);
    return c;
  }

  function nextDance() { P.cur = DANCES[(DANCES.indexOf(P.cur) + 1) % DANCES.length]; P.danceAt = performance.now(); }

  /** Pixel size of the backing store: CSS size x devicePixelRatio x quality, kept inside the renderer's buffers. */
  function fit() {
    const r = P.canvas.getBoundingClientRect();
    if (!r.width) return false;
    let k = (window.devicePixelRatio || 1) * P.q;
    k = Math.min(k, 800 / r.width, 960 / r.height);
    const w = Math.max(64, Math.round(r.width * k)); const hh = Math.max(64, Math.round(r.height * k));
    if (w === P.w && hh === P.h) return true;
    if (!P.ex.set_size(w, hh)) return false;
    P.w = w; P.h = hh;
    P.canvas.width = w; P.canvas.height = hh;
    P.img = new ImageData(new Uint8ClampedArray(P.ex.memory.buffer, P.ex.fb_ptr(), w * hh * 4), w, hh); // a view: no copy
    return true;
  }

  const staticMode = () => root.classList.contains('calm') || root.classList.contains('lite') || (W.state && W.state.settings && W.state.settings.ui && W.state.settings.ui.anim === 'calm');

  function draw(now) {
    const t0 = performance.now();
    if (!fit()) return;
    if (!P.rect || now - P.rectAt > 400) { P.rect = P.canvas.getBoundingClientRect(); P.rectAt = now; }
    const still = staticMode();
    // look at the cursor, eased
    const hasPtr = P.mx !== null; // until the first mouse move the player simply faces front
    const nx = hasPtr ? Math.max(-1, Math.min(1, (P.mx - (P.rect.left + P.rect.width / 2)) / (window.innerWidth * 0.45))) : 0;
    const ny = hasPtr ? Math.max(-1, Math.min(1, (P.my - (P.rect.top + P.rect.height * 0.25)) / (window.innerHeight * 0.45))) : 0;
    P.lx += (nx - P.lx) * 0.12; P.ly += (ny - P.ly) * 0.12;
    if (P.mode === 'random' && !P.walking && now - P.danceAt > 9000) nextDance();
    let id;
    if (still) id = 0;
    else if (P.walking) id = ID.walk;
    else if (P.temp && now < P.temp.until) id = P.temp.id;
    else id = P.mode === 'idle' ? 0 : ID[P.cur];
    P.ex.frame(still ? 0 : (now - P.t0) / 1000, id, still ? 0 : P.lx, still ? 0 : P.ly, 0);
    P.ctx.putImageData(P.img, 0, 0);
    // adapt: if drawing keeps costing more than ~9 ms, lower the resolution, then the frame rate
    P.cost += performance.now() - t0; P.costN++;
    if (P.costN >= 40) {
      const avg = P.cost / P.costN; P.cost = 0; P.costN = 0;
      if (avg > 9) { if (P.q > 1) { P.q = Math.max(1, P.q - 0.25); P.w = 0; } else P.slow = true; }
    }
  }

  function tick(now) {
    P.raf = 0;
    if (!P.canvas || !P.canvas.isConnected || document.hidden || document.body.classList.contains('blurred')) return; // resumed by kick()
    const fps = P.fpsMode === '30' || P.slow ? 30 : 60;
    if (now - P.last >= 1000 / fps - 2) { P.last = now; draw(now); }
    if (!staticMode()) P.raf = requestAnimationFrame(tick); else draw(now); // static: one frame is enough
  }

  function kick() { if (!P.raf && P.ex) P.raf = requestAnimationFrame(tick); }

  window.addEventListener('pointermove', (e) => { P.mx = e.clientX; P.my = e.clientY; }, { passive: true });
  window.addEventListener('focus', () => { document.body.classList.remove('blurred'); kick(); });
  window.addEventListener('blur', () => document.body.classList.add('blurred'));
  document.addEventListener('visibilitychange', kick);

  /** Draw the skin to a 64x64 canvas (upgrading old 64x32 skins) and hand it to the renderer. */
  function loadSkin(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        const legacy = img.height < 64;
        if (legacy) { // mirror the right arm and leg onto the left ones
          for (const [sx, sy, dx, dy] of [[40, 16, 32, 48], [0, 16, 16, 48]]) {
            x.save(); x.translate(dx + 16, dy); x.scale(-1, 1); x.drawImage(c, sx, sy, 16, 16, 0, 0, 16, 16); x.restore();
          }
        }
        const slim = !legacy && x.getImageData(47, 24, 1, 1).data[3] === 0;
        new Uint8Array(P.ex.memory.buffer, P.ex.skin_ptr(), 64 * 64 * 4).set(x.getImageData(0, 0, 64, 64).data);
        P.ex.set_skin(slim ? 1 : 0);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function setSkin(acc) {
    await engine(); if (P.failed) return;
    let src = null; let key = 'steve';
    if (acc) {
      try { const s = await W.api('accounts:avatar', acc.id); if (s && s.image) { src = s.image; key = `${acc.id}:${s.image.length}`; } } catch { /* offline: keep what we have */ }
    }
    if (!src) { if (P.skinKey) return; src = W.defaultSkinDataUrl(); }
    if (key === P.skinKey) return;
    if (await loadSkin(src)) { P.skinKey = key; kick(); }
  }

  /** The stage: floor pad (opts.pad = the Play button) and the player canvas. opts.dance: random|disco|pump|sway|spin|idle */
  W.player3d = function player3d(acc, opts = {}) {
    const canvas = ensureCanvas();
    P.mode = DANCES.includes(opts.dance) || opts.dance === 'idle' ? opts.dance : 'random';
    P.fpsMode = String(opts.fps || 'auto');
    if (P.mode !== 'random' && P.mode !== 'idle') P.cur = P.mode;
    else if (!DANCES.includes(P.cur)) P.cur = 'disco';
    const stage = h('div', { class: 'hero-stage' },
      opts.pad ? h('div', { class: 'anchor padwrap' }, opts.pad) : null,
      h('div', { class: 'anchor scene' }, canvas));
    const o = {
      setWalking: (on) => { P.walking = !!on; kick(); },
    };
    stage.player = o;
    engine().then(() => { if (!P.failed) { setSkin(acc); kick(); } else canvas.remove(); });
    return stage;
  };
  W.player3d.stop = () => { if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; } };
})();
