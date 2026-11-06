/* Wares Launcher - application shell, router and launch bar. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;

  const NAV = [
    { id: 'home', label: 'Home', icon: 'house' },
    { id: 'profiles', label: 'Profiles', icon: 'layers' },
    'sep',
    { id: 'mods', label: 'Mods', icon: 'shapes' },
    { id: 'resourcepacks', label: 'Resource packs', icon: 'image' },
    { id: 'shaders', label: 'Shaders', icon: 'sparkles' },
    { id: 'modpacks', label: 'Modpacks', icon: 'package' },
    'sep',
    { id: 'skins', label: 'Skins & capes', icon: 'paintbrush' },
    { id: 'accounts', label: 'Accounts', icon: 'circle-user-round' },
    'grow',
    { id: 'console', label: 'Console', icon: 'terminal' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  /* --------------------------------------------------------- settings */
  function merge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return out;
  }

  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.58 ? '#0c1118' : '#ffffff';
  }

  function applyAppearance() {
    const s = S.settings;
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    if (s.accent && /^#[0-9a-f]{6}$/i.test(s.accent)) {
      root.style.setProperty('--accent', s.accent);
      root.style.setProperty('--accent-ink', inkFor(s.accent));
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-ink');
    }
    document.body.classList.toggle('rail-compact', !!s.compactRail);
    const ui = s.ui || {};
    root.dataset.style = ui.style === 'metal' ? 'metal' : 'modern';
    const glass = !!ui.glass;
    document.body.classList.toggle('glass', glass);
    document.body.classList.toggle('no-blur', glass && ui.glassBlur === 0);
    document.body.classList.toggle('low-res', !!s.perf.lowResource);
    const chrome = glass ? Math.max(30, Math.min(100, ui.glassAlpha)) : 100;
    root.style.setProperty('--chrome-a', `${chrome}%`);
    root.style.setProperty('--panel-a', glass ? `${Math.min(100, chrome + 14)}%` : '90%');
    root.style.setProperty('--glass-blur-on', `${ui.glassBlur == null ? 14 : ui.glassBlur}px`);
    S.lowResource = !!s.perf.lowResource;
    W.bg.refreshPalette();
  }

  /** Persist a settings patch. Appearance and background are applied immediately. */
  W.saveSettings = async function saveSettings(patch) {
    S.settings = merge(S.settings, patch);
    applyAppearance();
    if (patch.background) W.bg.apply();
    if (patch.perf) W.bg.wake();
    try { await W.api('settings:set', patch); } catch (e) { W.err(e); }
    W.bus.emit('settings');
  };

  /* -------------------------------------------------------- title bar */
  function buildTitlebar() {
    const tb = document.getElementById('titlebar');
    const activity = h('button', { class: 'tb-btn nd', title: 'Downloads and tasks', 'aria-label': 'Activity', onclick: (e) => openActivity(e.currentTarget) }, icon('download', 17));
    const max = h('button', { class: 'tb-btn nd', title: 'Maximize', 'aria-label': 'Maximize', onclick: () => W.api('win:maximize') }, icon('square', 14));
    const upd = h('button', { class: 'update-pill nd', type: 'button', style: { display: 'none' }, onclick: () => {
      if (S.update && S.update.state === 'ready') promptRestart(S.update); else if (S.update && S.update.state === 'available') { S.manualCheck = true; promptUpdate(S.update); S.manualCheck = false; } else W.go('settings');
    } });
    W.bus.on('update', () => {
      const u = S.update || {};
      upd.style.display = ['available', 'downloading', 'ready'].includes(u.state) ? '' : 'none';
      upd.replaceChildren(icon(u.state === 'ready' ? 'rocket' : 'circle-arrow-up', 14), u.state === 'ready' ? `Restart to update to ${u.version}` : u.state === 'downloading' ? `Updating ${u.percent || 0}%` : `Update ${u.version}`);
      upd.classList.toggle('ready', u.state === 'ready');
    });
    tb.append(
      h('div', { class: 'brand' }, W.mark(22), h('b', null, 'Wares Launcher')),
      h('div', { class: 'spacer' }),
      upd,
      activity,
      h('button', { class: 'tb-btn nd', title: 'Minimize', 'aria-label': 'Minimize', onclick: () => W.api('win:minimize') }, icon('minus', 16)),
      max,
      h('button', { class: 'tb-btn nd close', title: 'Close', 'aria-label': 'Close', onclick: () => W.api('win:close') }, icon('x', 17)));
    tb.addEventListener('dblclick', (e) => { if (e.target === tb || e.target.classList.contains('spacer')) W.api('win:maximize'); });
    W.on('win:maximized', (m) => { max.replaceChildren(icon(m ? 'copy' : 'square', 14)); max.title = m ? 'Restore' : 'Maximize'; });
    W.bus.on('jobs', () => {
      const n = [...S.jobs.values()].filter((j) => j.state === 'running' && j.meta.kind !== 'launch').length;
      let c = activity.querySelector('.count');
      if (n && !c) { c = h('span', { class: 'count' }); activity.append(c); }
      if (c) { if (n) c.textContent = n; else c.remove(); }
    });
  }

  function openActivity(anchor) {
    W.popover(anchor, (pop) => {
      const render = () => {
        pop.replaceChildren(h('div', { class: 'head' }, 'Activity'));
        const jobs = [...S.jobs.values()].reverse();
        if (!jobs.length) pop.append(h('div', { class: 'empty', style: { padding: '28px 16px' } }, icon('cloud-download', 30), h('p', null, 'Nothing is downloading.')));
        for (const j of jobs) {
          const pct = j.total ? Math.min(100, (j.current / j.total) * 100) : 0;
          pop.append(h('div', { class: 'li', style: { cursor: 'default', alignItems: 'stretch', flexDirection: 'column', gap: '6px' } },
            h('div', { class: 'row' },
              h('div', { class: 'grow' }, h('div', { class: 't' }, j.title), h('div', { class: 's' }, j.state === 'running' ? [j.stage, j.text].filter(Boolean).join(': ') : j.text || j.state)),
              j.state === 'running' && h('button', { class: 'btn ghost icon sm', title: 'Cancel', onclick: () => W.api('jobs:cancel', j.id) }, icon('x', 15)),
              j.state === 'done' && h('span', { class: 'badge ok' }, 'Done'),
              j.state === 'error' && h('span', { class: 'badge err' }, 'Failed'),
              j.state === 'cancelled' && h('span', { class: 'badge' }, 'Cancelled')),
            j.state === 'running' && h('div', { class: `bar${j.indeterminate ? ' ind' : ''}` }, h('i', { style: { width: `${pct}%` } }))));
        }
      };
      render();
      const off = W.bus.on('jobs', () => (pop.isConnected ? render() : off()));
    }, { align: 'end', width: 360 });
  }

  /* ------------------------------------------------------------- rail */
  const railButtons = {};
  function buildRail() {
    const rail = document.getElementById('rail');
    for (const n of NAV) {
      if (n === 'sep') rail.append(h('div', { class: 'rail-sep' }));
      else if (n === 'grow') rail.append(h('div', { class: 'rail-grow' }));
      else {
        const b = h('button', { class: 'rail-item', title: n.label, onclick: () => W.go(n.id) }, icon(n.icon, 19), h('span', null, n.label));
        railButtons[n.id] = b;
        rail.append(b);
      }
    }
    const toggle = h('button', { title: 'Collapse sidebar', 'aria-label': 'Collapse sidebar', onclick: () => W.saveSettings({ compactRail: !S.settings.compactRail }) }, icon('sliders-horizontal', 15));
    rail.append(h('div', { class: 'rail-foot' }, h('button', { class: 'ver', title: 'Check for updates', onclick: () => W.checkUpdates() }, icon('refresh-cw', 13), h('span', null, `v${S.info.version}`)), toggle));
  }

  /* ----------------------------------------------------------- router */
  let current = null;
  W.go = function go(route, params = {}) {
    if (!W.views[route]) return;
    if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    W.closePopover();
    S.route = route;
    const view = document.getElementById('view');
    const page = h('div', { class: 'page', dataset: { route } });
    view.replaceChildren(page);
    current = W.views[route];
    for (const [id, b] of Object.entries(railButtons)) { b.classList.toggle('active', id === route); b.setAttribute('aria-current', id === route ? 'page' : 'false'); }
    try { current.mount(page, params); } catch (e) { console.error(e); page.append(W.empty('circle-alert', 'This page failed to load', e.message)); }
    view.scrollTop = 0;
  };

  /* -------------------------------------------------------- launch bar */
  const lb = {};
  function buildLaunchBar() {
    const bar = document.getElementById('launchbar');
    lb.progress = h('div', { id: 'launch-progress' }, h('i'));
    lb.acc = h('button', { class: 'btn ghost', style: { height: '54px', padding: '0 10px 0 6px', justifyContent: 'flex-start', gap: '11px', minWidth: 0, maxWidth: '100%' }, onclick: (e) => openAccountPopover(e.currentTarget) });
    lb.prof = h('button', { class: 'btn ghost', style: { height: '54px', padding: '0 12px 0 8px', justifyContent: 'flex-start', gap: '12px', minWidth: 0, width: '100%' }, onclick: (e) => openProfilePopover(e.currentTarget) });
    lb.status = h('div', { class: 's dim ellipsis', style: { fontSize: '12px', minHeight: '17px', marginTop: '-2px' } });
    lb.play = h('button', { class: 'btn primary', style: { height: '52px', minWidth: '190px', fontSize: '17px', fontFamily: 'var(--font-display)', letterSpacing: '.03em', gap: '10px' }, onclick: onPlay });
    bar.append(lb.progress, h('div', { style: { minWidth: 0 } }, lb.acc),
      h('div', { style: { minWidth: 0 } }, lb.prof, lb.status),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, lb.play));
    W.bus.on('jobs', refreshLaunchBar);
    W.bus.on('running', refreshLaunchBar);
    W.bus.on('profiles', refreshLaunchBar);
    W.bus.on('accounts', refreshLaunchBar);
    setInterval(() => { if (S.running.size) refreshLaunchBar(); }, 30000);
  }

  function launchJobFor(profileId) {
    return [...S.jobs.values()].reverse().find((j) => j.meta.kind === 'launch' && j.meta.profileId === profileId && j.state === 'running');
  }

  function refreshLaunchBar() {
    const p = W.activeProfile();
    const acc = W.activeAccount();
    lb.acc.replaceChildren(
      acc ? W.avatar(acc, 42) : h('div', { class: 'avatar', style: { display: 'grid', placeItems: 'center', width: '42px', height: '42px', color: 'var(--text-3)' } }, icon('plus', 18)),
      h('div', { style: { minWidth: 0, textAlign: 'left' } },
        h('div', { class: 'ellipsis', style: { fontWeight: 600, lineHeight: 1.2 } }, acc ? acc.name : 'Add an account'),
        h('div', { class: 'dim', style: { fontSize: '12px' } }, acc ? (acc.type === 'microsoft' ? 'Microsoft account' : 'Offline account') : 'Required to play')),
      icon('chevron-down', 14));
    lb.prof.replaceChildren(
      p ? W.glyph(p) : h('div', { class: 'tile', style: { '--tile': '#555' } }, icon('layers', 20)),
      h('div', { style: { minWidth: 0, textAlign: 'left', flex: 1 } },
        h('div', { class: 'ellipsis', style: { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '20px', lineHeight: 1.1 } }, p ? p.name : 'No profile'),
        h('div', { class: 'muted ellipsis', style: { fontSize: '12.5px' } }, p ? W.profileLine(p) : 'Create a profile to start')),
      icon('chevron-down', 14));

    const running = p && S.running.get(p.id);
    const job = p && launchJobFor(p.id);
    lb.play.className = 'btn primary';
    lb.play.disabled = !p;
    if (job) {
      lb.play.className = 'btn';
      lb.play.replaceChildren(icon('x', 18), 'Cancel');
      lb.play.dataset.mode = 'cancel';
      lb.play.dataset.job = job.id;
      const pct = job.total ? Math.min(100, Math.round((job.current / job.total) * 100)) : null;
      lb.status.textContent = [job.stage, job.text, pct != null ? `${pct}%` : ''].filter(Boolean).join('  ');
      lb.progress.classList.add('on');
      lb.progress.classList.toggle('ind', !job.total);
      lb.progress.firstChild.style.width = `${pct || 0}%`;
    } else if (running) {
      lb.play.className = 'btn danger';
      lb.play.replaceChildren(icon('square', 16), 'Stop');
      lb.play.dataset.mode = 'stop';
      lb.status.textContent = `Playing for ${W.fmt.dur((Date.now() - running.startedAt) / 1000)}`;
      lb.progress.classList.remove('on', 'ind');
    } else {
      lb.play.replaceChildren(icon('play', 18), 'Play');
      lb.play.dataset.mode = 'play';
      lb.status.textContent = p && p.lastPlayed ? `Last played ${W.fmt.ago(p.lastPlayed)}` : '';
      lb.progress.classList.remove('on', 'ind');
    }
  }

  W.play = async function play(profileId) {
    if (!W.activeAccount()) { W.toast('Add an account before playing.', { kind: 'warn', action: { label: 'Open accounts', fn: () => W.go('accounts') } }); return; }
    try { await W.api('game:launch', profileId); } catch (e) { W.err(e); }
  };

  function onPlay() {
    const p = W.activeProfile();
    if (!p) return W.go('profiles', { create: true });
    const mode = lb.play.dataset.mode;
    if (mode === 'cancel') return W.api('jobs:cancel', lb.play.dataset.job);
    if (mode === 'stop') return W.api('game:stop', p.id);
    return W.play(p.id);
  }

  function openAccountPopover(anchor) {
    W.popover(anchor, (pop, close) => {
      pop.append(h('div', { class: 'head' }, 'Accounts'));
      for (const a of S.accounts.accounts) {
        pop.append(h('div', { class: `li${a.id === S.accounts.active ? ' sel' : ''}`, onclick: async () => { close(); await W.api('accounts:select', a.id); S.accounts.active = a.id; S.settings.activeAccount = a.id; W.bus.emit('accounts'); } },
          W.avatar(a, 34), h('div', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, a.type === 'microsoft' ? 'Microsoft' : 'Offline'))));
      }
      pop.append(h('div', { class: 'li', onclick: () => { close(); W.go('accounts'); } }, icon('circle-user-round', 18), h('div', { class: 'grow' }, 'Manage accounts')));
    }, { width: 300 });
  }

  function openProfilePopover(anchor) {
    W.popover(anchor, (pop, close) => {
      pop.append(h('div', { class: 'head' }, 'Profiles'));
      const cur = W.activeProfile();
      for (const p of S.profiles) {
        pop.append(h('div', { class: `li${cur && p.id === cur.id ? ' sel' : ''}`, onclick: () => { close(); W.selectProfile(p.id); } },
          W.glyph(p, 'sm'), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, W.profileLine(p))),
          S.running.has(p.id) && h('span', { class: 'badge ok' }, 'Running')));
      }
      pop.append(h('div', { class: 'li', onclick: () => { close(); W.go('profiles', { create: true }); } }, icon('plus', 18), h('div', { class: 'grow' }, 'New profile')));
    }, { width: 340 });
  }

  W.selectProfile = function selectProfile(id) {
    S.settings.lastProfile = id;
    W.api('settings:set', { lastProfile: id }).catch(() => {});
    W.bus.emit('profiles');
  };

  /* ---------------------------------------------------------- updates */
  const prompted = new Set();
  function promptUpdate(u) {
    const manual = S.manualCheck;
    if (!manual && (S.settings.updates.skipped === u.version || prompted.has(u.version))) return;
    prompted.add(u.version);
    W.modal({
      title: 'Update available', width: 520,
      body: h('div', { class: 'stack-lg' },
        h('div', { class: 'row', style: { gap: '14px' } }, W.mark(40), h('div', null, h('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '24px', lineHeight: 1.1 } }, `Wares Launcher ${u.version}`), h('div', { class: 'muted' }, `You are on ${u.current}`))),
        u.notes ? h('pre', { class: 'plain selectable', style: { marginTop: 0 } }, u.notes) : h('p', { class: 'muted' }, 'A new version is ready to download from GitHub.')),
      actions: [
        { label: 'Skip this version', onClick: () => { W.saveSettings({ updates: { skipped: u.version } }); } },
        { label: 'Later' },
        { label: 'Update now', kind: 'primary', icon: 'download', onClick: () => { W.api('update:download').catch(W.err); W.toast('Downloading the update. You can keep using the launcher.', { kind: 'ok' }); } },
      ],
    });
  }
  function promptRestart(u) {
    W.modal({
      title: 'Ready to update', width: 460,
      body: h('div', { class: 'stack-lg' }, h('p', null, `Version ${u.version} has been downloaded. Restart Wares Launcher to finish the update. It takes a few seconds and your profiles are untouched.`)),
      actions: [{ label: 'Later' }, { label: 'Restart and update', kind: 'primary', icon: 'rocket', onClick: () => { W.api('update:install').catch(W.err); } }],
    });
  }
  W.checkUpdates = async function checkUpdates() {
    S.manualCheck = true;
    W.toast('Checking for updates...', { ms: 1800 });
    try { const u = await W.api('update:check'); if (u && u.state === 'dev') { S.manualCheck = false; W.toast('Updates work in the installed app, not when running from source.', { kind: 'warn' }); } } catch (e) { S.manualCheck = false; W.err(e); }
  };

  /* ----------------------------------------------------------- events */
  function wireEvents() {
    W.on('job:update', (j) => {
      S.jobs.set(j.id, j);
      if (j.state !== 'running') setTimeout(() => { const cur = S.jobs.get(j.id); if (cur && cur.state !== 'running') { S.jobs.delete(j.id); W.bus.emit('jobs'); } }, 20000);
      W.bus.emit('jobs', j);
    });

    W.on('game:state', (e) => {
      if (e.state === 'running') S.running.set(e.profileId, { startedAt: e.startedAt, pid: e.pid });
      if (e.state === 'closed') {
        S.running.delete(e.profileId);
        const p = W.getProfile(e.profileId);
        if (e.crashed) W.toast(`${p ? p.name : 'Minecraft'} closed unexpectedly (exit code ${e.code}).`, { kind: 'err', ms: 12000, action: { label: 'View log', fn: () => W.go('console', { profileId: e.profileId }) } });
        W.api('profiles:list').then((l) => { S.profiles = l; W.bus.emit('profiles'); });
      }
      S.gameRunning = S.running.size > 0;
      W.bg.syncGame();
      W.bus.emit('running', e);
    });

    W.on('game:error', (e) => {
      const act = e.code === 'NEEDS_OPTIFINE' ? { label: 'Add OptiFine', fn: () => W.go('profiles', { edit: e.profileId }) } : null;
      W.toast(e.message, { kind: 'err', ms: 12000, action: act });
    });
    W.on('game:log', (e) => W.bus.emit('log', e));

    W.on('update:status', (u) => {
      const prev = S.update && S.update.state;
      S.update = { ...(S.update || {}), ...u };
      W.bus.emit('update', S.update);
      if (u.state === 'available' && prev !== 'available') promptUpdate(S.update);
      if (u.state === 'ready' && prev !== 'ready') promptRestart(S.update);
      if (S.manualCheck) {
        if (u.state === 'none') { S.manualCheck = false; W.toast('You are on the latest version.', { kind: 'ok' }); }
        else if (u.state === 'error') { S.manualCheck = false; W.toast(u.error || 'Update check failed.', { kind: 'err' }); }
        else if (u.state === 'available' || u.state === 'dev') S.manualCheck = false;
      }
    });

    W.on('app:trim', () => { W.dropSkinCache(); if (W.clearCaches) W.clearCaches(); });

    W.on('profiles:changed', async (e) => {
      S.profiles = await W.api('profiles:list');
      if (e && e.id && !S.profiles.some((p) => p.id === S.settings.lastProfile)) W.selectProfile(e.id);
      if (e && e.warnings && e.warnings.length) W.toast(`${e.warnings.length} item(s) could not be installed for this version.`, { kind: 'warn' });
      W.bus.emit('profiles', e);
    });

    W.on('content:changed', (e) => {
      if (e.installed && e.installed.length) W.toast(`Installed ${e.installed.map((x) => x.title).slice(0, 3).join(', ')}${e.installed.length > 3 ? ` and ${e.installed.length - 3} more` : ''}.`, { kind: 'ok' });
      if (e.warnings && e.warnings.length) W.toast(e.warnings[0], { kind: 'warn', ms: 8000 });
      W.bus.emit('content', e);
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="https://"]');
      if (a) { e.preventDefault(); W.external(a.href); }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  /* ------------------------------------------------------------- boot */
  async function boot() {
    try {
      S.info = await W.api('app:info');
      S.settings = await W.api('settings:get');
      applyAppearance();
      buildTitlebar();
      buildRail();
      buildLaunchBar();
      W.bg.init();
      W.bg.apply();
      wireEvents();
      [S.profiles, S.accounts] = await Promise.all([W.api('profiles:list'), W.api('accounts:list')]);
      for (const r of await W.api('game:status')) S.running.set(r.profileId, r);
      S.gameRunning = S.running.size > 0;
      for (const j of await W.api('jobs:list')) S.jobs.set(j.id, j);
      W.api('update:status').then((u) => { S.update = u; W.bus.emit('update', u); }).catch(() => {});
      refreshLaunchBar();
      W.go('home');
      await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());
      requestAnimationFrame(() => requestAnimationFrame(() => { document.body.classList.add('ready'); W.api('app:ready').catch(() => {}); setTimeout(() => W.maybeSetup && W.maybeSetup(), 350); }));
    } catch (e) {
      document.body.classList.add('ready');
      W.api('app:ready').catch(() => {});
      document.getElementById('view').replaceChildren(W.empty('circle-alert', 'Wares Launcher could not start', e.message));
    }
  }

  W.bus.on('profiles', async () => {
    if (!S.profiles.length) S.profiles = await W.api('profiles:list');
  });
  window.addEventListener('DOMContentLoaded', boot);
})();
