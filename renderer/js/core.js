/* Wares Launcher - renderer core. Classic script, exposes window.W. */
(function () {
  'use strict';
  const W = (window.W = {});
  const NS = 'http://www.w3.org/2000/svg';

  /* Safety net: DOM insertion helpers ignore null, undefined and false instead of printing them. */
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const native = Element.prototype[m];
    Element.prototype[m] = function patched(...kids) { return native.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
  }

  W.api = (ch, ...a) => window.wares.invoke(ch, ...a);
  W.on = (ch, cb) => window.wares.on(ch, cb);
  W.platform = window.wares.platform;

  /* ------------------------------------------------------------ DOM */
  const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate', 'readOnly', 'textContent', 'scrollTop']);

  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }

  W.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    append(el, kids);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else for (const [sk, sv] of Object.entries(v)) (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv));
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROPS.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    return el;
  };
  const h = W.h;

  W.icon = function icon(name, size = 18, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = window.ICONS[name] || '';
    return s;
  };

  /** Brand mark: machined plate with a stamped W. */
  W.mark = function mark(size = 24) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.innerHTML =
      '<defs><linearGradient id="mk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent-hi)"/><stop offset=".55" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-lo)"/></linearGradient></defs>' +
      '<rect x="1.5" y="1.5" width="29" height="29" rx="5" fill="url(#mk)" stroke="rgba(0,0,0,.55)"/>' +
      '<rect x="2.5" y="2.5" width="27" height="13" rx="4" fill="rgba(255,255,255,.14)"/>' +
      '<path d="M7 10.5 11.6 22.5 16 13.8 20.4 22.5 25 10.5" fill="none" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"/>';
    return s;
  };

  /* ---------------------------------------------------------- state */
  W.state = {
    settings: null, profiles: [], accounts: { accounts: [], active: null }, jobs: new Map(), running: new Map(),
    info: null, route: 'home', lowResource: false, gameRunning: false,
  };
  const listeners = {};
  W.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || new Set()).add(fn); return () => listeners[ev].delete(fn); },
    emit(ev, p) { (listeners[ev] || []).forEach((f) => { try { f(p); } catch (e) { console.error(e); } }); },
  };

  W.bus.scope = () => {
    const offs = [];
    return { on(ev, fn) { offs.push(W.bus.on(ev, fn)); }, dispose() { offs.splice(0).forEach((f) => f()); } };
  };

  W.LOADERS = [
    { id: 'vanilla', name: 'Vanilla' }, { id: 'fabric', name: 'Fabric' }, { id: 'quilt', name: 'Quilt' },
    { id: 'forge', name: 'Forge' }, { id: 'forge-optifine', name: 'Forge + OptiFine' }, { id: 'neoforge', name: 'NeoForge' },
  ];
  W.loaderName = (id) => (W.LOADERS.find((l) => l.id === id) || { name: id }).name;
  W.GLYPHS = ['box', 'package', 'zap', 'gauge', 'sparkles', 'wrench', 'hard-drive', 'flame', 'rocket', 'swords', 'map', 'star', 'shield', 'globe', 'cpu', 'coffee', 'shapes', 'palette', 'layers', 'scissors'];
  W.COLORS = ['#6fa3e0', '#47b49c', '#9d88e8', '#d65d74', '#cf8b50', '#d6b24c', '#8a95a3', '#c79a5b'];

  W.profileLine = (p) => `${p.loader === 'vanilla' ? 'Vanilla' : W.loaderName(p.loader)} ${p.mcVersion}`;
  W.getProfile = (id) => W.state.profiles.find((p) => p.id === id) || null;
  W.activeProfile = () => W.getProfile(W.state.settings.lastProfile) || W.state.profiles[0] || null;
  W.activeAccount = () => W.state.accounts.accounts.find((a) => a.id === W.state.accounts.active) || null;

  W.glyph = function glyph(profile, cls = '') {
    const ic = profile.icon || {};
    return h('div', { class: `tile ${cls}`, style: { '--tile': ic.color || '#8a95a3' } }, W.icon(ic.glyph || 'box', cls.includes('lg') ? 38 : cls.includes('sm') ? 16 : 20));
  };

  /* ------------------------------------------------------- formatters */
  W.fmt = {
    bytes(n) {
      if (!n) return '0 B';
      const u = ['B', 'KB', 'MB', 'GB'];
      const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
      return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
    },
    num(n) { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0); },
    ago(ts) {
      if (!ts) return 'Never';
      const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
      if (s < 60) return 'Just now';
      if (s < 3600) return `${Math.floor(s / 60)} min ago`;
      if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
      if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
      return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },
    dur(sec) {
      sec = Math.round(sec || 0);
      if (sec < 60) return sec ? `${sec}s` : '0m';
      const m = Math.floor(sec / 60);
      if (m < 60) return `${m}m`;
      const hr = Math.floor(m / 60);
      return hr < 100 ? `${hr}h ${m % 60}m` : `${hr}h`;
    },
    date(ts) { return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); },
  };

  W.debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------------------------------------------------------- toasts */
  W.toast = function toast(msg, opts = {}) {
    const layer = document.getElementById('layer-toast');
    const kind = opts.kind || 'info';
    const el = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' },
      h('div', { class: 'm' }, msg),
      opts.action && h('button', { class: 'a', onclick: () => { opts.action.fn(); el.remove(); } }, opts.action.label));
    layer.append(el);
    while (layer.children.length > 4) layer.firstChild.remove();
    setTimeout(() => el.remove(), opts.ms || (kind === 'err' ? 8000 : 4200));
  };
  W.err = (e, action) => W.toast((e && e.message) || String(e), { kind: 'err', action });

  /* ----------------------------------------------------------- modal */
  W.modal = function modal({ title, body, actions = [], width = 560, dismissable = true, onClose }) {
    const layer = document.getElementById('layer-modal');
    let closed = false;
    const ctx = {};
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      onClose && onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
    const mbody = h('div', { class: 'mbody' });
    const footer = h('footer');
    const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { '--w': `${width}px` } },
      h('header', null, h('h3', null, title), dismissable && h('button', { class: 'btn ghost icon sm', 'aria-label': 'Close', onclick: close }, W.icon('x', 16))),
      mbody, footer);
    const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim && dismissable) close(); } }, m);
    Object.assign(ctx, { close, el: m, body: mbody });
    ctx.setActions = (list) => {
      footer.replaceChildren();
      footer.style.display = list.length ? '' : 'none';
      for (const a of list) {
        const b = h('button', { class: `btn ${a.kind || ''}`, type: 'button', disabled: !!a.disabled }, a.icon && W.icon(a.icon, 16), a.label);
        b.onclick = async () => {
          if (!a.onClick) return close();
          b.disabled = true;
          try { const r = await a.onClick(ctx); if (r !== false) close(); } catch (e) { W.err(e); } finally { b.disabled = false; }
        };
        footer.append(b);
        a.el = b;
      }
    };
    const content = typeof body === 'function' ? body(ctx) : body;
    if (content) mbody.append(content);
    ctx.setActions(actions);
    document.addEventListener('keydown', onKey, true);
    layer.append(scrim);
    const first = m.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return ctx;
  };

  W.confirm = (message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) => new Promise((res) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; res(v); } };
    W.modal({
      title, width: 440, body: h('p', { class: 'muted' }, message), onClose: () => done(false),
      actions: [{ label: 'Cancel' }, { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done(true); } }],
    });
  });

  /* --------------------------------------------------------- popover */
  let activePop = null;
  W.closePopover = () => { if (activePop) { activePop.cleanup(); activePop = null; } };
  W.popover = function popover(anchor, build, { align = 'start', width } = {}) {
    W.closePopover();
    const layer = document.getElementById('layer-popover');
    const pop = h('div', { class: 'popover', style: width ? { width: `${width}px` } : null });
    const close = () => W.closePopover();
    build(pop, close);
    layer.append(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    let left = align === 'end' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, innerWidth - pw - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', key, true); }, 0);
    activePop = { cleanup() { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', key, true); pop.remove(); } };
    return pop;
  };

  /* -------------------------------------------------------- controls */
  W.switchEl = function switchEl(on, onChange) {
    const el = h('button', { class: `switch${on ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(!!on) });
    el.addEventListener('click', () => {
      const v = !el.classList.contains('on');
      el.classList.toggle('on', v);
      el.setAttribute('aria-checked', String(v));
      onChange && onChange(v);
    });
    return el;
  };

  W.seg = function seg(options, value, onChange, cls = '') {
    const el = h('div', { class: `seg ${cls}`, role: 'group' });
    const set = (v, silent) => {
      el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
      el.value = v;
      if (!silent) onChange && onChange(v);
    };
    for (const o of options) el.append(h('button', { type: 'button', dataset: { v: o.value }, onclick: () => set(o.value) }, o.icon && W.icon(o.icon, 14), o.label));
    set(value, true);
    el.set = (v) => set(v, true);
    return el;
  };

  W.select = function select(options, value, onChange, props = {}) {
    const el = h('select', { ...props, class: `select ${props.class || ''}` },
      options.map((o) => h('option', { value: o.value }, o.label)));
    el.value = value == null ? '' : String(value);
    el.addEventListener('change', () => onChange && onChange(el.value));
    return el;
  };

  W.slider = function slider({ min, max, step = 1, value, onInput }) {
    const el = h('input', { type: 'range', class: 'slider', min, max, step });
    el.value = value;
    const fill = () => el.style.setProperty('--fill', `${((el.value - min) / (max - min)) * 100}%`);
    fill();
    el.addEventListener('input', () => { fill(); onInput && onInput(+el.value); });
    el.refill = fill;
    return el;
  };

  W.field = (label, control, hint) => h('div', { class: 'field' }, label && h('label', null, label), control, hint && h('div', { class: 'hint' }, hint));

  W.empty = (icon, title, text, ...actions) => h('div', { class: 'empty' }, W.icon(icon, 44), h('b', null, title), text && h('p', null, text), actions.length ? h('div', { class: 'row', style: { marginTop: '6px' } }, actions) : null);

  W.skeletons = (n = 6, height = 64) => h('div', { class: 'list' }, Array.from({ length: n }, () => h('div', { class: 'li' }, h('div', { class: 'skeleton', style: { width: '48px', height: '48px' } }), h('div', { class: 'grow' }, h('div', { class: 'skeleton', style: { width: '40%', height: '14px', marginBottom: '8px' } }), h('div', { class: 'skeleton', style: { width: '70%', height: '12px' } })))));

  W.external = (url) => W.api('shell:external', url).catch(W.err);

  /** Accept dropped files on an element. Calls cb(paths) with those matching `re`. */
  W.onFileDrop = function onFileDrop(el, re, cb) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dropping'); });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dropping');
      const paths = [...e.dataTransfer.files].map((f) => window.wares.pathForFile(f)).filter((p) => p && re.test(p));
      if (paths.length) cb(paths);
    });
  };

  /* ---------------------------------------------------------- avatars */
  /** Neutral starter skin (drawn in code). Its head is the Steve-style placeholder avatar. */
  let steveCanvas = null;
  W.defaultSkinCanvas = function defaultSkinCanvas() {
    if (steveCanvas) return steveCanvas;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    const fill = (col, a, b, w, hh) => { x.fillStyle = col; x.fillRect(a, b, w, hh); };
    const skin = '#c58c69'; const hair = '#4a3322'; const shirt = '#2b9aa3'; const pants = '#3b4aa0'; const shoe = '#555b63';
    fill(skin, 0, 0, 32, 16); fill(hair, 8, 0, 16, 8); fill(hair, 0, 8, 32, 3); fill(hair, 24, 8, 8, 8);
    fill('#ffffff', 9, 12, 2, 1); fill('#ffffff', 13, 12, 2, 1); fill('#3a2b7a', 10, 12, 1, 1); fill('#3a2b7a', 14, 12, 1, 1); fill('#a8694f', 10, 14, 4, 1);
    fill(shirt, 16, 16, 24, 16); fill(shirt, 40, 16, 16, 16); fill(skin, 44, 28, 8, 4);
    fill(pants, 0, 16, 16, 16); fill(shoe, 0, 28, 16, 4);
    fill(shirt, 32, 48, 16, 16); fill(skin, 36, 60, 8, 4); fill(pants, 16, 48, 16, 16); fill(shoe, 16, 60, 16, 4);
    steveCanvas = c;
    return c;
  };
  W.defaultSkinDataUrl = () => W.defaultSkinCanvas().toDataURL('image/png');

  const skinCache = new Map();
  function skinFor(acc) {
    if (!skinCache.has(acc.id)) skinCache.set(acc.id, W.api('accounts:avatar', acc.id).catch(() => null));
    return skinCache.get(acc.id);
  }
  W.forgetSkin = (id) => skinCache.delete(id);
  W.dropSkinCache = () => skinCache.clear();

  /** Account head. Starts as the Steve head and swaps to the real skin head once it is known. */
  W.avatar = function avatar(acc, size = 40) {
    const c = h('canvas', { class: 'avatar', width: 8, height: 8, style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const head = (src) => { ctx.clearRect(0, 0, 8, 8); ctx.drawImage(src, 8, 8, 8, 8, 0, 0, 8, 8); ctx.drawImage(src, 40, 8, 8, 8, 0, 0, 8, 8); };
    head(W.defaultSkinCanvas());
    if (acc) {
      skinFor(acc).then((skin) => {
        if (!skin || !skin.image) return;
        const img = new Image();
        img.onload = () => head(img);
        img.src = skin.image;
      });
    }
    return c;
  };

  /** Re-read an account's skin (after applying one) and redraw every avatar. */
  W.refreshAvatar = async function refreshAvatar(id) {
    W.forgetSkin(id);
    try { skinCache.set(id, W.api('accounts:avatar', id, true)); await skinCache.get(id); } catch { /* keep old */ }
    W.bus.emit('accounts');
  };

  /** Copy text via a temporary field (works without clipboard permission). */
  W.copy = (text) => {
    const t = h('textarea', { style: 'position:fixed;opacity:0' });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
    W.toast('Copied to clipboard', { kind: 'ok', ms: 1800 });
  };

  W.views = {};
})();
