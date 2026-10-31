/* Profiles: list, editor, presets, modpack import. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;
  let mcPromise = null;

  W.getMc = () => (mcPromise = mcPromise || W.api('versions:minecraft').catch((e) => { mcPromise = null; throw e; }));

  const JVM_PRESETS = [
    { value: 'auto', label: 'Automatic (recommended)' },
    { value: 'default', label: 'Java defaults' },
    { value: 'balanced', label: 'Balanced (G1, tuned)' },
    { value: 'zgc', label: 'Low latency (ZGC, Java 15+)' },
    { value: 'lowmem', label: 'Low memory (Serial GC)' },
  ];

  const typeOf = (v) => (v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'legacy');
  const gb = (mb) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;

  function iconPicker(anchor, draft, onPick) {
    W.popover(anchor, (pop) => {
      pop.append(h('div', { class: 'head' }, 'Icon'));
      const grid = h('div', { class: 'glyph-grid' });
      const colors = h('div', { class: 'swatches' });
      const refresh = () => {
        grid.replaceChildren(...W.GLYPHS.map((g) => h('button', { class: `gbtn${draft.icon.glyph === g ? ' on' : ''}`, type: 'button', title: g, onclick: () => { draft.icon.glyph = g; onPick(); refresh(); } }, icon(g, 20))));
        colors.replaceChildren(...W.COLORS.map((c) => h('button', { class: `sw${draft.icon.color === c ? ' on' : ''}`, type: 'button', style: { background: c }, 'aria-label': c, onclick: () => { draft.icon.color = c; onPick(); refresh(); } })),
          h('input', { type: 'color', class: 'sw-input', value: /^#[0-9a-f]{6}$/i.test(draft.icon.color) ? draft.icon.color : '#8a95a3', title: 'Custom color', oninput: (e) => { draft.icon.color = e.target.value; onPick(); } }));
      };
      refresh();
      pop.append(h('div', { style: { padding: '12px' } }, grid, h('div', { style: { height: '10px' } }), colors));
    }, { width: 290 });
  }

  /* ---------------------------------------------------------- editor */
  function editor(host, source, isNew, api) {
    const draft = JSON.parse(JSON.stringify(source));
    let dirty = isNew;
    let token = 0;
    const markDirty = () => { dirty = true; saveBtn.disabled = false; };

    const tileHost = h('button', { class: 'tile-btn', type: 'button', title: 'Change icon', onclick: (e) => iconPicker(e.currentTarget, draft, () => { drawTile(); markDirty(); }) });
    const drawTile = () => tileHost.replaceChildren(W.glyph(draft, 'lg'), h('span', { class: 'tile-edit' }, icon('pencil', 12)));
    drawTile();

    const name = h('input', { class: 'input title-input', value: draft.name, maxlength: 48, placeholder: 'Profile name', oninput: (e) => { draft.name = e.target.value; markDirty(); } });

    /* version + loader */
    const verFilter = W.seg([{ value: 'release', label: 'Releases' }, { value: 'snapshot', label: 'Snapshots' }, { value: 'legacy', label: 'Beta & alpha' }], 'release', () => fillVersions());
    const verSel = h('select', { class: 'select', 'aria-label': 'Minecraft version', onchange: (e) => { draft.mcVersion = e.target.value; draft.loaderVersion = null; markDirty(); fillLoaderBuilds(); drawOptifine(); } });
    const verNote = h('div', { class: 'hint' });
    const loaderSeg = W.seg(W.LOADERS.map((l) => ({ value: l.id, label: l.name })), draft.loader, (v) => { draft.loader = v; draft.loaderVersion = null; markDirty(); fillVersions(); drawOptifine(); }, 'wrap');
    const buildSel = h('select', { class: 'select', 'aria-label': 'Loader build', onchange: (e) => { draft.loaderVersion = e.target.value || null; markDirty(); } });
    const buildNote = h('div', { class: 'hint' });
    const buildField = W.field('Loader build', buildSel, null);
    buildField.append(buildNote);
    const optifine = h('div', { class: 'panel pad', style: { display: 'none' } });

    let mc = null;
    let autoFilter = true;
    async function fillVersions() {
      const my = ++token;
      try {
        mc = mc || await W.getMc();
        const supported = draft.loader === 'vanilla' ? null : await W.api('versions:supported', draft.loader);
        if (my !== token) return;
        const cur = mc.versions.find((v) => v.id === draft.mcVersion);
        if (autoFilter && cur) verFilter.set(typeOf(cur));
        autoFilter = false;
        const set = supported ? new Set(supported) : null;
        let list = mc.versions.filter((v) => typeOf(v) === verFilter.value && (!set || set.has(v.id)));
        if (!list.length && set) list = mc.versions.filter((v) => set.has(v.id));
        const opts = list.map((v) => h('option', { value: v.id }, v.id + (v.id === mc.latest.release ? '  (latest release)' : v.id === mc.latest.snapshot ? '  (latest snapshot)' : '')));
        if (draft.mcVersion && !list.some((v) => v.id === draft.mcVersion)) {
          if (set && !set.has(draft.mcVersion)) draft.mcVersion = (list[0] || {}).id || draft.mcVersion;
          else opts.unshift(h('option', { value: draft.mcVersion }, draft.mcVersion));
        }
        verSel.replaceChildren(...opts);
        verSel.value = draft.mcVersion;
        verNote.textContent = set ? `${W.loaderName(draft.loader)} is available for ${list.length} Minecraft versions.` : 'Every Minecraft version from Alpha to the latest release.';
        fillLoaderBuilds();
      } catch (e) {
        verSel.replaceChildren(h('option', { value: draft.mcVersion }, draft.mcVersion));
        verSel.value = draft.mcVersion;
        verNote.textContent = 'Could not load the version list. Check your connection.';
        fillLoaderBuilds();
      }
    }

    async function fillLoaderBuilds() {
      const my = token;
      buildField.style.display = draft.loader === 'vanilla' ? 'none' : '';
      if (draft.loader === 'vanilla') return;
      buildSel.replaceChildren(h('option', { value: '' }, 'Loading...'));
      try {
        const list = await W.api('versions:loader', draft.loader, draft.mcVersion);
        if (my !== token) return;
        buildSel.replaceChildren(h('option', { value: '' }, 'Recommended (automatic)'),
          ...list.slice(0, 80).map((b) => h('option', { value: b.id }, `${b.label}${b.recommended ? '  (recommended)' : b.latest ? '  (latest)' : ''}${b.stable === false ? '  (beta)' : ''}`)));
        buildSel.value = draft.loaderVersion || '';
        buildNote.textContent = list.length ? '' : `${W.loaderName(draft.loader)} has no build for Minecraft ${draft.mcVersion}. Pick another version.`;
      } catch {
        buildSel.replaceChildren(h('option', { value: draft.loaderVersion || '' }, draft.loaderVersion || 'Recommended (automatic)'));
        buildNote.textContent = 'Could not load loader builds. The recommended build is chosen when you launch.';
      }
    }

    async function drawOptifine() {
      optifine.style.display = draft.loader === 'forge-optifine' ? '' : 'none';
      if (draft.loader !== 'forge-optifine') return;
      let has = false;
      if (!isNew) { try { has = (await W.api('content:list', draft.id, 'mod')).items.some((m) => /optifine/i.test(m.file)); } catch { /* none */ } }
      optifine.replaceChildren(
        h('div', { class: 'row' }, icon(has ? 'badge-check' : 'circle-alert', 20), h('div', { class: 'grow' },
          h('b', null, has ? 'OptiFine is installed' : 'OptiFine needs to be added'),
          h('p', { class: 'muted', style: { fontSize: '13px' } }, 'OptiFine is distributed from its own website and cannot be downloaded automatically. Download the jar that matches this Minecraft version, then add it here.'))),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => W.external('https://optifine.net/downloads') }, icon('external-link', 14), 'Get OptiFine'),
          h('button', { class: 'btn sm', type: 'button', disabled: isNew, title: isNew ? 'Save the profile first' : '', onclick: async () => {
            const [f] = await W.api('dialog:files', { title: 'Choose the OptiFine jar', filters: [{ name: 'OptiFine', extensions: ['jar'] }] });
            if (!f) return;
            try { await W.api('profiles:add-optifine', draft.id, f); W.toast('OptiFine added.', { kind: 'ok' }); drawOptifine(); } catch (e) { W.err(e); }
          } }, icon('upload', 14), 'Add OptiFine jar')));
    }

    /* files */
    const dirInput = h('input', { class: 'input', readOnly: true, value: draft.gameDir || '', placeholder: 'Created automatically in the Wares data folder' });
    const files = h('div', { class: 'row' }, dirInput,
      h('button', { class: 'btn', type: 'button', onclick: async () => { const d = await W.api('dialog:folder', 'Choose the game folder for this profile'); if (d) { draft.gameDir = d; dirInput.value = d; markDirty(); } } }, icon('folder-open', 16), 'Choose'),
      !isNew && h('button', { class: 'btn ghost', type: 'button', onclick: () => W.api('shell:open-profile', draft.id).catch(W.err) }, 'Open'));

    /* memory */
    const total = S.info.totalMem;
    const maxCap = Math.min(total, 32768);
    const memText = h('div', { class: 'hint' });
    const maxS = W.slider({ min: 1024, max: maxCap, step: 256, value: Math.min(draft.memory.max, maxCap), onInput: (v) => { draft.memory.max = v; if (draft.memory.min > v) { draft.memory.min = v; minS.value = v; minS.refill(); } memUpdate(); markDirty(); } });
    const minS = W.slider({ min: 0, max: maxCap, step: 256, value: Math.min(draft.memory.min, maxCap), onInput: (v) => { draft.memory.min = Math.min(v, draft.memory.max); memUpdate(); markDirty(); } });
    const memBox = h('div', { class: 'grid2' }, W.field('Maximum memory', maxS), W.field('Starting memory', minS));
    function memUpdate() {
      memText.textContent = draft.memory.mode === 'auto'
        ? `Wares picks a safe amount from your ${gb(total)} of RAM when the game starts.`
        : `Up to ${gb(draft.memory.max)}, starting at ${gb(draft.memory.min)}. ${draft.memory.max > total * 0.75 ? 'That leaves little for the system and may cause stutter.' : ''}`;
      memBox.style.display = draft.memory.mode === 'auto' ? 'none' : '';
    }
    const memSeg = W.seg([{ value: 'auto', label: 'Automatic' }, { value: 'custom', label: 'Custom' }], draft.memory.mode, (v) => { draft.memory.mode = v; memUpdate(); markDirty(); });
    memUpdate();

    /* java */
    const javaSel = h('select', { class: 'select', 'aria-label': 'Java runtime' });
    const javaPath = h('div', { class: 'row', style: { display: 'none' } },
      h('input', { class: 'input', value: draft.javaPath || '', placeholder: 'Path to java or javaw', oninput: (e) => { draft.javaPath = e.target.value || null; markDirty(); } }),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const [f] = await W.api('dialog:files', { title: 'Choose a Java executable' }); if (f) { draft.javaPath = f; javaPath.firstChild.value = f; markDirty(); } } }, 'Browse'));
    W.api('java:list').then((list) => {
      javaSel.replaceChildren(h('option', { value: '' }, 'Automatic (downloads the right Java)'),
        ...list.map((j) => h('option', { value: j.path }, `Java ${j.major}  ${j.managed ? 'managed by Wares' : j.vendor || j.version}`)),
        h('option', { value: '__custom' }, 'Custom path...'));
      const known = list.some((j) => j.path === draft.javaPath);
      javaSel.value = !draft.javaPath ? '' : known ? draft.javaPath : '__custom';
      javaPath.style.display = javaSel.value === '__custom' ? '' : 'none';
    }).catch(() => javaSel.replaceChildren(h('option', { value: '' }, 'Automatic')));
    javaSel.onchange = () => {
      javaPath.style.display = javaSel.value === '__custom' ? '' : 'none';
      if (javaSel.value !== '__custom') draft.javaPath = javaSel.value || null;
      markDirty();
    };

    /* window */
    const num = (k, ph) => h('input', { class: 'input', type: 'number', min: 0, max: 8000, placeholder: ph, value: draft.resolution[k] || '', oninput: (e) => { draft.resolution[k] = +e.target.value || 0; markDirty(); } });

    const section = (title, ...kids) => h('section', { class: 'esec' }, h('h3', { class: 'h3' }, title), ...kids);

    const saveBtn = h('button', { class: 'btn primary', type: 'button', disabled: !isNew, onclick: async () => {
      if (!draft.name.trim()) return W.toast('Give the profile a name.', { kind: 'warn' });
      saveBtn.disabled = true;
      try {
        const saved = await W.api('profiles:save', draft);
        S.profiles = await W.api('profiles:list');
        W.bus.emit('profiles');
        api.saved(saved.id);
        W.toast(isNew ? 'Profile created.' : 'Profile saved.', { kind: 'ok' });
      } catch (e) { W.err(e); saveBtn.disabled = false; }
    } }, icon('check', 16), isNew ? 'Create profile' : 'Save changes');

    host.replaceChildren(
      h('div', { class: 'ehead' }, tileHost, h('div', { class: 'grow' }, name, h('div', { class: 'hint', style: { marginTop: '6px' } }, isNew ? 'New profile' : `Created ${W.fmt.date(draft.created)}  Played ${W.fmt.dur(draft.playTime)}`))),
      section('Game', W.field('Minecraft version', h('div', { class: 'stack' }, verFilter, verSel), null), verNote,
        W.field('Mod loader', loaderSeg), buildField, optifine),
      section('Files', W.field('Game folder', files, 'Mods, resource packs, saves and settings for this profile live here. Changing it does not move existing files.'),
        !isNew && h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: async () => { await W.api('game:verify', draft.id).catch(W.err); W.toast('Game files will be checked and repaired on the next launch.', { kind: 'ok' }); } }, icon('shield', 14), 'Verify game files on next launch'))),
      section('Performance',
        W.field('Memory', memSeg), memBox, memText,
        h('div', { class: 'grid2' },
          W.field('JVM tuning', W.select(JVM_PRESETS, draft.jvmPreset, (v) => { draft.jvmPreset = v; markDirty(); })),
          W.field('Java runtime', javaSel)), javaPath,
        W.field('Extra JVM arguments', h('textarea', { class: 'textarea', rows: 2, placeholder: '-Dexample=value', oninput: (e) => { draft.jvmArgs = e.target.value; markDirty(); } }, draft.jvmArgs || ''))),
      section('Window and servers',
        h('div', { class: 'grid3' }, W.field('Width', num('width', 'Default')), W.field('Height', num('height', 'Default')),
          W.field('Fullscreen', h('div', { style: { paddingTop: '6px' } }, W.switchEl(draft.resolution.fullscreen, (v) => { draft.resolution.fullscreen = v; markDirty(); })))),
        W.field('Join a server on launch', h('input', { class: 'input', value: draft.serverJoin || '', placeholder: 'play.example.net:25565', oninput: (e) => { draft.serverJoin = e.target.value; markDirty(); } }))),
      section('Notes', h('textarea', { class: 'textarea', rows: 3, style: { fontFamily: 'var(--font-ui)', fontSize: '14px' }, placeholder: 'Anything worth remembering about this profile', oninput: (e) => { draft.notes = e.target.value; markDirty(); } }, draft.notes || '')),
      h('div', { class: 'efoot' }, saveBtn,
        !isNew && h('button', { class: 'btn', type: 'button', onclick: () => { W.selectProfile(draft.id); W.play(draft.id); } }, icon('play', 15), 'Play'),
        !isNew && h('button', { class: 'btn', type: 'button', onclick: async () => {
          const copy = await W.confirm('Copy the settings of this profile? Choose whether to include its files from the next screen.', { title: 'Duplicate profile', ok: 'Duplicate' });
          if (!copy) return;
          const withFiles = await W.confirm('Also copy mods, worlds and every other file? This can take a while for large profiles.', { title: 'Copy files too?', ok: 'Copy files' });
          try { const p = await W.api('profiles:duplicate', draft.id, withFiles); S.profiles = await W.api('profiles:list'); W.bus.emit('profiles'); api.saved(p.id); W.toast('Profile duplicated.', { kind: 'ok' }); } catch (e) { W.err(e); }
        } }, icon('copy', 15), 'Duplicate'),
        h('div', { class: 'grow' }),
        !isNew && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!await W.confirm(`Delete "${draft.name}"? Its folder stays on disk unless you choose to remove it next.`, { title: 'Delete profile', ok: 'Delete', danger: true })) return;
          const files = await W.confirm('Also delete the profile folder with its worlds, mods and settings? This cannot be undone.', { title: 'Delete files too?', ok: 'Delete files', danger: true });
          try { await W.api('profiles:delete', draft.id, files); S.profiles = await W.api('profiles:list'); W.bus.emit('profiles'); api.saved(null); } catch (e) { W.err(e); }
        } }, icon('trash-2', 15), 'Delete')));

    fillVersions();
    drawOptifine();
    return { isDirty: () => dirty };
  }

  /* ---------------------------------------------------------- presets */
  async function openPresets() {
    let presets;
    try { presets = await W.api('profiles:presets'); } catch (e) { return W.err(e); }
    let mc = null;
    try { mc = await W.getMc(); } catch { /* offline */ }
    let chosen = presets[0];
    const name = h('input', { class: 'input', placeholder: chosen.name });
    const verSel = h('select', { class: 'select' }, h('option', { value: '' }, 'Newest compatible release'),
      ...(mc ? mc.versions.filter((v) => v.type === 'release').slice(0, 60).map((v) => h('option', { value: v.id }, v.id)) : []));
    const grid = h('div', { class: 'preset-grid' });
    const draw = () => grid.replaceChildren(...presets.map((p) => h('button', { type: 'button', class: `preset${p === chosen ? ' on' : ''}`, onclick: () => { chosen = p; name.placeholder = p.name; draw(); verSel.disabled = !!p.mc; } },
      W.glyph({ icon: { glyph: p.glyph, color: p.color } }),
      h('div', { class: 'grow', style: { textAlign: 'left' } }, h('b', null, p.name), h('p', { class: 'muted' }, p.blurb),
        h('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, h('span', { class: 'badge accent' }, W.loaderName(p.loader)), p.modCount ? h('span', { class: 'badge' }, `${p.modCount} mods`) : null, p.mc ? h('span', { class: 'badge' }, p.mc) : null)))));
    draw();
    W.modal({
      title: 'Create from a preset', width: 760,
      body: h('div', null, h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'Presets create a tuned profile and install its mods from Modrinth. Mods without a build for the chosen version are skipped.'), grid,
        h('div', { class: 'grid2', style: { marginTop: '16px' } }, W.field('Profile name', name), W.field('Minecraft version', verSel))),
      actions: [{ label: 'Cancel' }, { label: 'Create profile', kind: 'primary', icon: 'zap', onClick: async () => {
        await W.api('profiles:from-preset', chosen.id, { name: name.value.trim() || undefined, mcVersion: verSel.value || undefined });
        W.toast('Creating profile. Progress is shown under Activity.', { kind: 'ok' });
      } }],
    });
  }

  /* ------------------------------------------------------------- view */
  W.views.profiles = {
    mount(page, params = {}) {
      scope = W.bus.scope();
      let selected = params.edit || (params.create ? 'new' : W.activeProfile() && W.activeProfile().id) || (S.profiles[0] && S.profiles[0].id) || 'new';
      const listHost = h('div', { class: 'plist' });
      const edHost = h('div', { class: 'peditor' });

      const drawList = () => {
        listHost.replaceChildren(...S.profiles.map((p) => h('button', { class: `li pl-item${selected === p.id ? ' sel' : ''}`, type: 'button', onclick: () => { selected = p.id; drawList(); drawEditor(); } },
          W.glyph(p), h('div', { class: 'grow', style: { textAlign: 'left', minWidth: 0 } }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, W.profileLine(p))),
          S.running.has(p.id) && h('span', { class: 'badge ok' }, 'Running'))));
        if (!S.profiles.length) listHost.append(h('p', { class: 'muted', style: { padding: '18px' } }, 'No profiles yet.'));
      };

      const api = { saved(id) { selected = id || (S.profiles[0] && S.profiles[0].id) || 'new'; drawList(); drawEditor(); } };

      async function drawEditor() {
        if (selected === 'new') {
          edHost.replaceChildren(h('div', { class: 'skeleton', style: { height: '200px' } }));
          let latest = '1.21.1';
          try { latest = (await W.getMc()).latest.release; } catch { /* offline */ }
          if (selected !== 'new') return;
          editor(edHost, { name: 'New profile', mcVersion: latest, loader: 'vanilla', icon: { glyph: 'box', color: W.COLORS[S.profiles.length % W.COLORS.length] }, memory: { mode: 'auto', max: 4096, min: 512 }, jvmPreset: 'auto', jvmArgs: '', javaPath: null, resolution: { width: 0, height: 0, fullscreen: false }, serverJoin: '', notes: '' }, true, api);
        } else {
          const p = W.getProfile(selected);
          if (!p) { edHost.replaceChildren(W.empty('layers', 'Select a profile')); return; }
          editor(edHost, p, false, api);
        }
      }

      scope.on('profiles', () => { if (selected !== 'new' && !W.getProfile(selected)) selected = S.profiles[0] ? S.profiles[0].id : 'new'; drawList(); });
      drawList();
      drawEditor();

      page.append(h('div', { class: 'split' },
        h('aside', { class: 'split-side' },
          h('div', { class: 'side-tools' },
            h('button', { class: 'btn primary wide', type: 'button', onclick: () => { selected = 'new'; drawList(); drawEditor(); } }, icon('plus', 16), 'New profile'),
            h('div', { class: 'row' },
              h('button', { class: 'btn grow', type: 'button', onclick: openPresets }, icon('zap', 15), 'Presets'),
              h('button', { class: 'btn grow', type: 'button', onclick: async () => {
                const [f] = await W.api('dialog:files', { title: 'Import a Modrinth modpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
                if (f) { await W.api('mr:install-pack', { file: f, name: undefined }).catch(W.err); W.toast('Importing modpack. Progress is shown under Activity.', { kind: 'ok' }); }
              } }, icon('package', 15), 'Import pack'))),
          listHost),
        edHost));
      W.onFileDrop(page, /\.mrpack$/i, async ([f]) => { await W.api('mr:install-pack', { file: f }).catch(W.err); W.toast('Importing modpack. Progress is shown under Activity.', { kind: 'ok' }); });
      if (params.presets) openPresets();
    },
    unmount() { scope.dispose(); },
  };
})();
