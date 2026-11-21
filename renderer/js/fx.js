/* Wares Launcher - runtime polish + self-tuning. Keeps the UI smooth on weak hardware. */
(function () {
  'use strict';
  const W = window.W;
  const root = document.documentElement;

  // 2. every image decodes off the main thread and loads lazily
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const imgs = n.tagName === 'IMG' ? [n] : n.querySelectorAll('img');
          for (const i of imgs) { if (!i.loading) i.loading = 'lazy'; i.decoding = 'async'; }
        }
      }
    }).observe(view, { childList: true, subtree: true });
  }

  // 3. pointer spotlight on cards (one rAF per move, no layout reads except the hovered card)
  let raf = 0; let pend = null;
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.qtile');
    if (!t) return;
    pend = { t, x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      const r = pend.t.getBoundingClientRect();
      pend.t.style.setProperty('--mx', `${pend.x - r.left}px`);
      pend.t.style.setProperty('--my', `${pend.y - r.top}px`);
    });
  }, { passive: true });

  // 4. frame-time guard: if the UI itself runs below ~35 fps, switch to lite visuals once and remember it
  function sample(ms) {
    return new Promise((resolve) => {
      let last = 0; let n = 0; let sum = 0;
      const end = performance.now() + ms;
      const f = (t) => {
        if (last) { const d = t - last; if (d < 250) { sum += d; n++; } }
        last = t;
        if (t < end && !document.hidden) requestAnimationFrame(f); else resolve(n > 20 ? sum / n : 0);
      };
      requestAnimationFrame(f);
    });
  }
  function lite() {
    if (root.classList.contains('lite')) return;
    root.classList.add('lite');
    W.state.lowResource = true;
    document.body.classList.add('low-res');
    W.bg && W.bg.wake();
    W.api('settings:set', { perf: { lowResource: true } }).catch(() => {});
    W.toast('Lite visuals enabled to keep the launcher smooth. Turn off in Settings > Low resource mode.', { ms: 7000 });
  }
  async function guard() {
    if (root.classList.contains('lite') || document.hidden || W.state.gameRunning || W.state.lowResource) return;
    const avg = await sample(2500);
    if (avg > 28) { const again = await sample(2000); if (again > 28) return lite(); }
    setTimeout(guard, 120000);
  }
  setTimeout(guard, 9000);
})();
