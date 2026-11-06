/* First-run setup wizard: look, game data folder, preset profiles, account. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;

  const ACCENTS = [
    ['titanium', '#6fa3e0'], ['copper', '#cf8b50'], ['verdigris', '#47b49c'], ['amethyst', '#9d88e8'],
    ['garnet', '#d65d74'], ['gilt', '#d6b24c'], ['obsidian', '#4cc3d9'], ['aluminum', '#2f6fd1'],
  ];
  const STEPS = [
    { id: 'look', title: 'Make it yours', sub: 'Style and colour' },
    { id: 'storage', title: 'Game files', sub: 'Where data is stored' },
    { id: 'profiles', title: 'Preset profiles', sub: 'Optional' },
    { id: 'account', title: 'Account', sub: 'Sign in to play' },
    { id: 'done', title: 'All set', sub: 'Review and finish' },
  ];

  const gbText = (b) => (b == null ? 'unknown' : `${(b / 1024 ** 3).toFixed(b > 100 * 1024 ** 3 ? 0 : 1)} GB`);

  function stylePreview(kind) {
    const modern = kind === 'modern';
    return h('div', { class: `sp ${kind}` },
      h('div', { class: 'sp-rail' }, h('i'), h('i'), h('i')),
      h('div', { class: 'sp-main' }, h('div', { class: 'sp-hero' }), h('div', { class: 'sp-row' }, h('i'), h('i'), h('i'))),
      modern ? null : h('div', { class: 'sp-grain' }));
  }

  function open() {
    const layer = document.getElementById('layer-setup');
    const state = { step: 0, presets: new Set(['performance']), presetList: null, mc: '', mcList: [], dataDir: null, free: null, busy: false };
    const body = h('div', { class: 'setup-body' });
    const rail = h('div', { class: 'setup-rail' });
    const title = h('h2', { class: 'setup-title' });
    const sub = h('p', { class: 'muted' });
    const back = h('button', { class: 'btn', type: 'button', onclick: () => go(-1) }, 'Back');
    const next = h('button', { class: 'btn primary', type: 'button', onclick: () => (state.step === STEPS.length - 1 ? finish() : go(1)) });
    const skip = h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await W.saveSettings({ setup: { done: true } }); close(); } }, 'Skip setup');

    const card = h('div', { class: 'setup-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Wares Launcher' },
      rail, h('div', { class: 'setup-main' }, h('div', { class: 'setup-head' }, h('div', null, title, sub), skip), body, h('div', { class: 'setup-foot' }, back, h('div', { class: 'grow' }), next)));
    const scrim = h('div', { class: 'setup' }, card);
    layer.replaceChildren(scrim);

    function close() { scrim.classList.add('out'); setTimeout(() => layer.replaceChildren(), 220); }

    function drawRail() {
      rail.replaceChildren(
        h('div', { class: 'setup-brand' }, W.mark(34), h('div', null, h('b', null, 'Wares Launcher'), h('span', null, `Version ${S.info.version}`))),
        h('ol', { class: 'setup-steps' }, STEPS.map((s, i) => h('li', { class: i === state.step ? 'on' : i < state.step ? 'done' : '' },
          h('span', { class: 'dot' }, i < state.step ? icon('check', 13) : String(i + 1)), h('div', null, h('b', null, s.title), h('span', null, s.sub))))),
        h('div', { class: 'grow' }),
        h('p', { class: 'setup-note' }, 'You can change everything later in Settings.'));
    }

    function go(d) { state.step = Math.max(0, Math.min(STEPS.length - 1, state.step + d)); draw(); }

    /* -------------------------------------------------------- steps */
    function stepLook() {
      const ui = S.settings.ui;
      const styleCard = (kind, label, desc) => h('button', { class: `choice${(ui.style || 'modern') === kind ? ' on' : ''}`, type: 'button', onclick: () => { W.saveSettings({ ui: { style: kind } }); draw(); } },
        stylePreview(kind), h('b', null, label), h('span', { class: 'muted' }, desc));
      return h('div', { class: 'stack-lg' },
        h('div', { class: 'grid2' }, styleCard('modern', 'Modern', 'Soft rounded panels and a floating sidebar'), styleCard('metal', 'Brushed metal', 'The classic machined-steel look')),
        W.field('Colour', h('div', { class: 'accent-row' }, ACCENTS.map(([id, c]) => h('button', { class: `accent-dot${S.settings.theme === id && !S.settings.accent ? ' on' : ''}`, type: 'button', title: id, style: { background: c }, onclick: () => { W.saveSettings({ theme: id, accent: null }); draw(); } })))),
        h('div', { class: 'row trow' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, 'Translucent interface'), h('div', { class: 'hint' }, 'The sidebar and panels turn see-through so wallpapers show behind them.')),
          W.switchEl(!!ui.glass, (v) => W.saveSettings({ ui: { glass: v } }))));
    }

    function stepStorage() {
      const path = h('div', { class: 'mono path-box selectable' }, state.dataDir || '...');
      const freeEl = h('div', { class: 'hint' });
      const paint = () => { path.textContent = state.dataDir || '...'; freeEl.textContent = state.free != null ? `${gbText(state.free)} free on this drive. A typical setup needs 2 to 10 GB.` : ''; };
      W.api('setup:info').then((i) => { state.dataDir = i.dataDir; state.free = i.free; paint(); }).catch(() => {});
      paint();
      return h('div', { class: 'stack-lg' },
        h('p', null, 'Minecraft versions, libraries, Java runtimes and your profiles are stored in one place. Put them on a drive with plenty of room.'),
        W.field('Game data folder', h('div', { class: 'stack' }, path, freeEl)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            const d = await W.api('dialog:folder', 'Choose where Wares stores game files');
            if (!d) return;
            try { const r = await W.api('setup:set-data-dir', d); state.dataDir = r.dataDir; state.free = r.free; paint(); W.toast('Game data folder set.', { kind: 'ok' }); } catch (e) { W.err(e); }
          } }, icon('folder-open', 15), 'Choose another folder'),
          h('span', { class: 'hint' }, 'Settings and accounts always stay in your user profile.')));
    }

    function stepProfiles() {
      const host = h('div', { class: 'preset-grid' });
      const draw2 = () => {
        if (!state.presetList) { host.replaceChildren(W.skeletons(3)); return; }
        host.replaceChildren(...state.presetList.map((p) => h('button', { class: `preset${state.presets.has(p.id) ? ' on' : ''}`, type: 'button', onclick: () => { state.presets.has(p.id) ? state.presets.delete(p.id) : state.presets.add(p.id); draw2(); } },
          W.glyph({ icon: { glyph: p.glyph, color: p.color } }),
          h('div', { class: 'grow', style: { textAlign: 'left', minWidth: 0 } }, h('b', null, p.name), h('p', { class: 'muted' }, p.blurb),
            h('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, h('span', { class: 'badge accent' }, W.loaderName(p.loader)), p.modCount ? h('span', { class: 'badge' }, `${p.modCount} mods`) : null)),
          h('span', { class: 'check' }, state.presets.has(p.id) ? icon('check', 14) : null))));
      };
      if (!state.presetList) W.api('profiles:presets').then((l) => { state.presetList = l; draw2(); }).catch(() => { state.presetList = []; draw2(); });
      draw2();
      return h('div', { class: 'stack-lg' },
        h('p', null, 'Pick any profiles you want created for you. Each one is tuned for a purpose and its mods are installed from Modrinth. You can skip this and create profiles later.'),
        host,
        h('p', { class: 'hint' }, state.presets.size ? `${state.presets.size} selected. They are created when you finish, and progress shows under Activity.` : 'Nothing selected. A plain latest-release profile is created for you.'));
    }

    function stepAccount() {
      const list = h('div', { class: 'list sheet panel' });
      const paint = () => {
        const accs = S.accounts.accounts;
        list.replaceChildren(...(accs.length ? accs.map((a) => h('div', { class: 'li' }, W.avatar(a, 38), h('div', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, a.type === 'microsoft' ? 'Microsoft account' : 'Offline account')), h('span', { class: 'badge ok' }, 'Added'))) : [h('div', { class: 'li dim' }, 'No account yet. You can add one now or later from the Accounts page.')]));
      };
      paint();
      const off = W.bus.on('accounts', paint);
      state.cleanup = off;
      return h('div', { class: 'stack-lg' },
        h('p', null, 'Sign in with the Microsoft account that owns Minecraft, or add an offline account for LAN and cracked servers.'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => W.accountFlows.microsoft() }, icon('log-in', 15), 'Sign in with Microsoft'),
          h('button', { class: 'btn', type: 'button', onclick: () => W.accountFlows.offline() }, icon('user', 15), 'Add offline account')),
        list);
    }

    function stepDone() {
      const picked = state.presetList ? state.presetList.filter((p) => state.presets.has(p.id)).map((p) => p.name) : [];
      const row = (ic, label, value) => h('div', { class: 'li' }, h('span', { class: 'qicon', style: { margin: 0 } }, icon(ic, 18)), h('div', { class: 'grow' }, h('div', { class: 's' }, label), h('div', { class: 't' }, value)));
      return h('div', { class: 'stack-lg' },
        h('p', null, 'Everything is ready. Here is what will happen:'),
        h('div', { class: 'list sheet panel' },
          row('palette', 'Look', `${(S.settings.ui.style || 'modern') === 'modern' ? 'Modern' : 'Brushed metal'}, ${S.settings.theme}${S.settings.ui.glass ? ', translucent' : ''}`),
          row('hard-drive', 'Game data folder', state.dataDir || S.info.gameDataDir),
          row('layers', 'Profiles', picked.length ? picked.join(', ') : 'A latest-release profile'),
          row('circle-user-round', 'Account', S.accounts.accounts.length ? S.accounts.accounts.map((a) => a.name).join(', ') : 'None yet')));
    }

    /* ------------------------------------------------------- shell */
    function draw() {
      if (state.cleanup) { state.cleanup(); state.cleanup = null; }
      const s = STEPS[state.step];
      title.textContent = s.id === 'look' ? 'Welcome to Wares Launcher' : s.title;
      sub.textContent = { look: 'Let us set things up. First, how should it look?', storage: 'Choose where Wares keeps the big files.', profiles: 'Start with tuned profiles, or skip.', account: 'Add an account so you can play.', done: 'Review your choices.' }[s.id];
      body.replaceChildren({ look: stepLook, storage: stepStorage, profiles: stepProfiles, account: stepAccount, done: stepDone }[s.id]());
      back.style.visibility = state.step === 0 ? 'hidden' : '';
      next.replaceChildren(...(state.step === STEPS.length - 1 ? [icon('rocket', 16), 'Start playing'] : ['Continue', icon('chevron-right', 16)]));
      next.disabled = state.busy;
      drawRail();
    }

    async function finish() {
      state.busy = true; next.disabled = true;
      try {
        await W.saveSettings({ setup: { done: true } });
        for (const id of state.presets) await W.api('profiles:from-preset', id, {}).catch(W.err);
        if (state.presets.size) W.toast('Creating your profiles. Progress is shown under Activity.', { kind: 'ok' });
        close();
        W.go('home');
      } finally { state.busy = false; }
    }

    draw();
  }

  W.openSetup = open;
  W.maybeSetup = () => { if (!(S.settings.setup && S.settings.setup.done)) open(); };
})();
