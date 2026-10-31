/* Settings: appearance, wallpapers, game defaults, performance, updates, Java, data, about. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;

  const THEMES = [
    { id: 'titanium', name: 'Titanium', accent: '#6fa3e0', base: '#2c3035' },
    { id: 'copper', name: 'Copper', accent: '#cf8b50', base: '#2c3035' },
    { id: 'verdigris', name: 'Verdigris', accent: '#47b49c', base: '#2c3035' },
    { id: 'amethyst', name: 'Amethyst', accent: '#9d88e8', base: '#2c3035' },
    { id: 'garnet', name: 'Garnet', accent: '#d65d74', base: '#2c3035' },
    { id: 'gilt', name: 'Gilt', accent: '#d6b24c', base: '#2c3035' },
    { id: 'obsidian', name: 'Obsidian', accent: '#4cc3d9', base: '#171a1d' },
    { id: 'aluminum', name: 'Aluminum', accent: '#2f6fd1', base: '#e6e8ec' },
  ];

  const section = (title, desc, ...kids) => h('section', { class: 'ssec' }, h('div', { class: 'ssec-head' }, h('h2', { class: 'h2' }, title), desc && h('p', { class: 'muted' }, desc)), h('div', { class: 'panel pad stack-lg' }, ...kids));
  const toggleRow = (label, hint, on, fn) => h('div', { class: 'row trow' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 500 } }, label), hint && h('div', { class: 'hint' }, hint)), W.switchEl(on, fn));

  /* Video frames are grabbed one at a time so a big folder never decodes several videos at once. */
  let frameChain = Promise.resolve();
  function videoFrame(url, canvas) {
    frameChain = frameChain.then(() => new Promise((res) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.src = url;
      let finished = false;
      const done = () => { if (finished) return; finished = true; v.removeAttribute('src'); v.load(); res(); };
      v.onloadedmetadata = () => { v.currentTime = Math.min(1.5, (v.duration || 2) / 4); };
      v.onseeked = () => {
        try { const k = 320 / v.videoWidth; canvas.width = 320; canvas.height = Math.round(v.videoHeight * k); canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height); } catch { /* leave blank */ }
        done();
      };
      v.onerror = done;
      setTimeout(done, 6000);
    }));
  }

  function wallpaperCard(w, current, onPick, onRemove) {
    const thumb = h('div', { class: 'bg-thumb' });
    if (w.kind === 'video') {
      const cv = h('canvas', { width: 320, height: 180 });
      thumb.append(cv, h('span', { class: 'play-badge' }, icon('play', 12)));
      videoFrame(w.url, cv);
    } else if (w.ext === 'png' || w.ext === 'jpg' || w.ext === 'jpeg') {
      const img = h('img', { alt: '', decoding: 'async' });
      thumb.append(img);
      W.api('bg:thumb', w.id).then((d) => { img.src = d || w.url; }).catch(() => { img.src = w.url; });
    } else thumb.append(h('img', { src: w.url, alt: '', loading: 'lazy', decoding: 'async' }));
    return h('div', { class: `bg-card${current === w.id ? ' on' : ''}` },
      h('button', { class: 'bg-pick', type: 'button', onclick: () => onPick(w) }, thumb,
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'ellipsis grow', style: { textAlign: 'left' } }, w.name),
          h('span', { class: 'badge' }, w.kind === 'video' ? 'Video' : w.ext === 'gif' ? 'GIF' : 'Image'))),
      w.source === 'user' && h('button', { class: 'bg-del btn icon sm', type: 'button', title: 'Remove from your wallpapers', onclick: () => onRemove(w) }, icon('x', 13)));
  }

  W.views.settings = {
    mount(page) {
      scope = W.bus.scope();
      const cfg = S.settings;
      const save = W.saveSettings;

      /* ---------------------------------------------------- appearance */
      const themeGrid = h('div', { class: 'theme-grid' });
      const accentInput = h('input', { type: 'color', class: 'sw-input lg', value: cfg.accent || '#6fa3e0', title: 'Custom accent colour', oninput: (e) => save({ accent: e.target.value }) });
      const drawThemes = () => {
        themeGrid.replaceChildren(...THEMES.map((t) => h('button', { class: `theme${S.settings.theme === t.id ? ' on' : ''}`, type: 'button', onclick: () => { save({ theme: t.id, accent: null }); drawThemes(); } },
          h('span', { class: 'theme-chip', style: { background: t.base } }, h('i', { style: { background: t.accent } }), h('i', { style: { background: `color-mix(in srgb, ${t.accent} 55%, ${t.base})` } })),
          h('span', null, t.name))));
      };
      drawThemes();

      /* ---------------------------------------------------- background */
      const bgBody = h('div', { class: 'stack-lg' });
      const wallHost = h('div', { class: 'bg-grid' });
      let wallpapers = null;

      async function loadWallpapers() {
        try { wallpapers = await W.api('bg:list'); } catch (e) { W.err(e); wallpapers = []; }
        drawWalls();
      }
      function drawWalls() {
        const b = S.settings.background;
        const addTile = h('button', { class: 'bg-card add', type: 'button', onclick: addFiles }, h('div', { class: 'bg-thumb add-thumb' }, icon('plus', 26)), h('span', null, 'Add files'));
        wallHost.replaceChildren(...(wallpapers || []).map((w) => wallpaperCard(w, b.wallpaper,
          (x) => { save({ background: { mode: 'wallpaper', wallpaper: x.id } }); drawWalls(); },
          async (x) => {
            if (!await W.confirm(`Remove ${x.name} from your wallpapers?`, { title: 'Remove wallpaper', ok: 'Remove', danger: true })) return;
            await W.api('bg:remove', x.id).catch(W.err);
            if (S.settings.background.wallpaper === x.id) { S.settings.background.wallpaper = null; S.settings.background.mode = 'preset'; W.bg.apply(); drawBg(); }
            loadWallpapers();
          })), addTile);
      }
      async function addFiles() {
        const files = await W.api('dialog:files', { title: 'Add wallpapers', multi: true, filters: [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'webm'] }] });
        if (!files.length) return;
        try { const ids = await W.api('bg:add', files); await loadWallpapers(); save({ background: { mode: 'wallpaper', wallpaper: ids[0] } }); drawWalls(); drawBg(); } catch (e) { W.err(e); }
      }
      W.onFileDrop(page, /\.(png|jpe?g|webp|gif|avif|mp4|webm)$/i, async (files) => {
        try { await W.api('bg:add', files); loadWallpapers(); W.toast('Wallpapers added.', { kind: 'ok' }); } catch (e) { W.err(e); }
      });

      const drawBg = () => {
        const b = S.settings.background;
        const modeSeg = W.seg([{ value: 'none', label: 'Brushed metal' }, { value: 'preset', label: 'Animated scenes' }, { value: 'wallpaper', label: 'Wallpapers' }], b.mode, (v) => { save({ background: { mode: v } }); drawBg(); });
        const parts = [modeSeg];
        if (b.mode === 'preset') {
          parts.push(h('div', { class: 'bg-grid' }, ...W.bg.PRESET_LIST.map((p) => h('div', { class: `bg-card${b.preset === p.id ? ' on' : ''}` },
            h('button', { class: 'bg-pick', type: 'button', onclick: () => { save({ background: { preset: p.id } }); drawBg(); } }, h('div', { class: 'bg-thumb' }, W.bg.thumb(p.id)), h('span', null, p.name))))));
        }
        if (b.mode === 'wallpaper') {
          if (wallpapers === null) loadWallpapers(); else drawWalls();
          parts.push(wallHost);
          parts.push(h('div', { class: 'row wrap' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => W.api('shell:open-data', 'wallpapers') }, icon('folder-open', 14), 'Open my wallpapers folder'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => W.api('shell:open-data', 'bundled') }, icon('folder-open', 14), 'Open built-in folder'),
            h('button', { class: 'btn sm ghost', type: 'button', onclick: loadWallpapers }, icon('refresh-cw', 14), 'Rescan')));
          parts.push(h('p', { class: 'hint' }, 'Drop PNG, JPG, WebP, GIF, AVIF, MP4 or WebM files into either folder, then press Rescan. Dropping files onto this page also adds them.'));
          const sel = (wallpapers || []).find((w) => w.id === b.wallpaper);
          if (sel && sel.kind === 'video') parts.push(h('div', { class: 'notice slim', style: { margin: 0 } }, icon('info', 18), h('div', { class: 'grow' }, 'Video wallpapers use more GPU and memory than images. They pause while a game runs, when the window is in the background and on battery.')));
        }
        if (b.mode !== 'none') {
          parts.push(h('div', { class: 'grid2' },
            W.field(`Darken  ${b.dim}%`, W.slider({ min: 0, max: 85, value: b.dim, onInput: W.debounce((v) => { S.settings.background.dim = v; document.documentElement.style.setProperty('--dim', String(v / 100)); save({ background: { dim: v } }); }, 60) })),
            b.mode === 'wallpaper' ? W.field(`Blur  ${b.blur}px`, W.slider({ min: 0, max: 24, value: b.blur, onInput: W.debounce((v) => save({ background: { blur: v } }), 120) }))
              : W.field('Frame rate', W.seg([{ value: 15, label: '15' }, { value: 24, label: '24' }, { value: 30, label: '30' }, { value: 60, label: '60' }], b.fps, (v) => save({ background: { fps: +v } })), 'Lower frame rates use less CPU and battery. Wares also lowers it by itself if drawing is slow.')));
          parts.push(toggleRow('Pause when the launcher is in the background', 'Stops animation while another window has focus.', b.pauseUnfocused, (v) => save({ background: { pauseUnfocused: v } })));
          parts.push(toggleRow('Pause while Minecraft is running', 'Frees CPU and GPU for the game.', b.pauseInGame, (v) => save({ background: { pauseInGame: v } })));
          parts.push(toggleRow('Pause on battery power', 'Keeps laptops cool and saves charge.', b.pauseOnBattery !== false, (v) => { save({ background: { pauseOnBattery: v } }); W.bg.syncPower(); }));
        }
        bgBody.replaceChildren(...parts);
      };
      drawBg();

      /* ------------------------------------------------------ java */
      const javaSel = h('select', { class: 'select' }, h('option', { value: '' }, 'Automatic (installs the right Java)'));
      const javaList = h('div', { class: 'list' });
      const loadJava = (force) => W.api('java:list', force).then((list) => {
        javaSel.replaceChildren(h('option', { value: '' }, 'Automatic (installs the right Java)'), ...list.map((j) => h('option', { value: j.path }, `Java ${j.major}  ${j.managed ? 'managed by Wares' : j.vendor || j.version}`)));
        javaSel.value = S.settings.game.javaPath || '';
        const have = new Set(list.map((j) => j.major));
        javaList.replaceChildren(...(list.length ? list.map((j) => h('div', { class: 'li' }, icon('coffee', 18), h('div', { class: 'grow' }, h('div', { class: 't' }, `Java ${j.major}  (${j.version})`), h('div', { class: 's mono' }, j.path)), h('span', { class: 'badge' }, j.managed ? 'Managed' : 'System'))) : [h('div', { class: 'li dim' }, 'No Java found yet. Wares installs the right one the first time a game needs it.')]),
          h('div', { class: 'li', style: { gap: '8px', flexWrap: 'wrap' } }, h('span', { class: 'muted', style: { marginRight: '6px' } }, 'Install now'),
            ...[8, 17, 21, 25].map((m) => h('button', { class: 'btn sm', type: 'button', disabled: have.has(m), onclick: async () => { try { await W.api('java:install', m); W.toast(`Installing Java ${m}. Progress is under Activity.`, { kind: 'ok' }); } catch (e) { W.err(e); } } }, have.has(m) ? `Java ${m} installed` : `Java ${m}`))));
      }).catch(() => {});
      javaSel.onchange = () => save({ game: { javaPath: javaSel.value || null } });
      loadJava(false);
      scope.on('jobs', (j) => { if (j && j.meta && j.meta.kind === 'java' && j.state === 'done') loadJava(true); });

      /* ----------------------------------------------------- updates */
      const updHost = h('div', { class: 'stack-lg' });
      const drawUpdates = () => {
        const u = S.update || { state: 'idle', current: S.info.version, repo: {} };
        const repo = u.repo || {};
        const line = {
          idle: 'Not checked yet.', checking: 'Checking GitHub...', none: 'You are on the latest version.', available: `Version ${u.version} is available.`,
          downloading: `Downloading version ${u.version}...`, ready: `Version ${u.version} is ready to install.`, error: u.error || 'Update check failed.',
          dev: 'You are running from source. Updates apply to installed builds.',
        }[u.state] || '';
        updHost.replaceChildren(
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600, fontSize: '15px' } }, `Version ${S.info.version}`), h('div', { class: u.state === 'error' ? 'hint err-text' : 'hint' }, line)),
            u.state === 'ready' ? h('button', { class: 'btn primary', type: 'button', onclick: () => W.api('update:install').catch(W.err) }, icon('rocket', 15), 'Restart and update')
              : u.state === 'available' ? h('button', { class: 'btn primary', type: 'button', onclick: () => W.api('update:download').catch(W.err) }, icon('download', 15), 'Download')
                : h('button', { class: 'btn', type: 'button', disabled: u.state === 'checking' || u.state === 'downloading', onclick: () => W.api('update:check').catch(W.err) }, icon('refresh-cw', 15), 'Check now')),
          u.state === 'downloading' && h('div', { class: 'bar' }, h('i', { style: { width: `${u.percent || 0}%` } })),
          u.notes && (u.state === 'available' || u.state === 'ready' || u.state === 'downloading') && h('pre', { class: 'plain selectable' }, u.notes),
          toggleRow('Check for updates automatically', 'Looks for new releases on GitHub at startup and every few hours.', S.settings.updates.auto !== false, (v) => save({ updates: { auto: v } })),
          W.field('Release channel', W.seg([{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta (pre-releases)' }], S.settings.updates.channel, (v) => save({ updates: { channel: v } }))),
          repo.url ? h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: () => W.external(repo.url) }, icon('external-link', 14), 'Open releases on GitHub'))
            : h('p', { class: 'hint' }, 'No GitHub repository is set for this build. Edit build.publish and repository in package.json, then follow docs/GITHUB-UPDATES.md.'));
      };
      W.api('update:status').then((u) => { S.update = u; drawUpdates(); }).catch(() => drawUpdates());
      scope.on('update', drawUpdates);

      /* ------------------------------------------------- performance */
      const metricsHost = h('div', { class: 'kv' });
      const loadMetrics = () => W.api('app:metrics').then((m) => {
        metricsHost.replaceChildren(h('dt', null, 'Launcher memory'), h('dd', null, `${m.totalMb} MB across ${m.processes.length} processes`),
          ...m.processes.flatMap((p) => [h('dt', null, p.type), h('dd', { class: 'mono' }, `${p.mb} MB`)]));
      }).catch(() => {});
      loadMetrics();
      const mtimer = setInterval(() => { if (document.body.contains(metricsHost)) loadMetrics(); else clearInterval(mtimer); }, 4000);

      const conns = h('span', { class: 'mono' }, String(cfg.network.connections));
      const saveConns = W.debounce((v) => save({ network: { connections: v } }), 300);
      const info = S.info;
      const restartNote = () => W.toast('Restart the launcher to apply this change.', { kind: 'warn' });

      page.append(h('div', { class: 'settings' },
        h('h1', { class: 'page-title', style: { marginBottom: '6px' } }, 'Settings'),

        section('Appearance', 'Every theme sits on the same machined-metal base. Pick a finish, then fine-tune the accent.',
          themeGrid,
          h('div', { class: 'row wrap' }, h('div', { style: { fontWeight: 500 } }, 'Custom accent'), accentInput,
            h('button', { class: 'btn sm', type: 'button', onclick: () => { save({ accent: null }); accentInput.value = '#6fa3e0'; } }, 'Reset to theme')),
          toggleRow('Compact sidebar', 'Show icons only.', !!cfg.compactRail, (v) => save({ compactRail: v }))),

        section('Background', 'Brushed metal, animated scenes drawn on a tiny canvas, or your own images and videos used as wallpaper presets.', bgBody),

        section('Updates', 'New versions come from this launcher\'s GitHub releases.', updHost),

        section('Game', 'Defaults for every profile. A profile can override each of these.',
          W.field('When the game starts', W.seg([{ value: 'minimize', label: 'Minimize launcher' }, { value: 'keep', label: 'Keep launcher open' }], cfg.game.onLaunch, (v) => save({ game: { onLaunch: v } }))),
          W.field('Default Java runtime', javaSel),
          toggleRow('Install Java automatically', 'When a game needs a Java version that is missing, Wares downloads it (Mojang\'s runtime first, Adoptium as backup).', cfg.game.autoInstallJava !== false, (v) => save({ game: { autoInstallJava: v } })),
          W.field('Extra JVM arguments for every profile', h('textarea', { class: 'textarea', rows: 2, placeholder: '-Dexample=value', value: cfg.game.jvmArgs || '', oninput: W.debounce((e) => save({ game: { jvmArgs: e.target.value } }), 400) }), null),
          h('div', null,
            h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 500 } }, 'Parallel downloads'), h('div', { class: 'hint' }, 'More connections finish faster on good networks, fewer is gentler on weak ones.')), conns),
            W.slider({ min: 2, max: 24, value: cfg.network.connections, onInput: (v) => { conns.textContent = v; saveConns(v); } }))),

        section('Performance', 'Wares keeps its own footprint small. These switches trade looks for lower resource use.',
          toggleRow('Verify game files on every launch', 'Off is much faster: files are checked once, then trusted. A quick crash re-checks them automatically.', !!cfg.perf.verifyFiles, (v) => save({ perf: { verifyFiles: v } })),
          toggleRow('Lower launcher priority while playing', 'Keeps the launcher\'s processes from competing with Minecraft for CPU.', cfg.perf.lowerPriorityInGame !== false, (v) => save({ perf: { lowerPriorityInGame: v } })),
          toggleRow('Free memory when minimized', 'Clears rebuildable caches when the window is minimized or a game starts.', cfg.perf.trimWhenMinimized !== false, (v) => save({ perf: { trimWhenMinimized: v } })),
          toggleRow('Low resource mode', 'Stops animated backgrounds completely and keeps a still frame. Restart to also shrink renderer memory.', !!cfg.perf.lowResource, (v) => { save({ perf: { lowResource: v } }); restartNote(); }),
          W.field('Low-end device mode', W.seg([{ value: 'auto', label: 'Automatic' }, { value: true, label: 'Always on' }, { value: false, label: 'Off' }], cfg.perf.lowEndMode, (v) => { save({ perf: { lowEndMode: v } }); restartNote(); }), 'Reduces Chromium\'s memory use. Automatic turns it on for computers with under 6 GB of RAM.'),
          toggleRow('Single graphics process', 'Runs the GPU work inside the main process. Saves roughly 50 MB. If the launcher crashes or shows a blank window after enabling it, turn it off again. Restart to apply.', !!cfg.perf.inProcessGpu, (v) => { save({ perf: { inProcessGpu: v } }); restartNote(); }),
          toggleRow('Hardware acceleration', 'Turn off if the launcher flickers or your GPU driver misbehaves. Takes effect after a restart.', cfg.perf.hardwareAcceleration !== false, (v) => { save({ perf: { hardwareAcceleration: v } }); restartNote(); }),
          h('div', { class: 'rule', style: { margin: '2px 0' } }),
          metricsHost,
          h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: async () => { await W.api('app:trim').catch(W.err); setTimeout(loadMetrics, 600); } }, icon('zap', 14), 'Free memory now'))),

        section('Java runtimes', 'Detected installs and the runtimes Wares manages for you.', javaList, h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: () => loadJava(true) }, icon('refresh-cw', 14), 'Scan again'))),

        section('Data', 'Everything Wares stores lives in one folder.',
          h('div', { class: 'kv' }, h('dt', null, 'Folder'), h('dd', { class: 'mono selectable' }, info.dataDir)),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', type: 'button', onclick: () => W.api('shell:open-data', 'root') }, icon('folder-open', 15), 'Open data folder'),
            h('button', { class: 'btn', type: 'button', onclick: () => W.api('shell:open-data', 'logs') }, icon('terminal', 15), 'Open logs'),
            h('button', { class: 'btn', type: 'button', onclick: async () => { if (await W.confirm('Clear cached version lists and downloaded installers? Game files, profiles and worlds are not touched.', { title: 'Clear cache', ok: 'Clear' })) { await W.api('data:clear-cache').catch(W.err); W.toast('Cache cleared.', { kind: 'ok' }); } } }, icon('trash-2', 15), 'Clear cache'))),

        section('About', null,
          h('div', { class: 'about' }, W.mark(46), h('div', null, h('div', { class: 'about-name' }, 'Wares Launcher'), h('div', { class: 'muted' }, `Version ${info.version}  by ${info.author}`))),
          h('div', { class: 'kv' }, h('dt', null, 'Runtime'), h('dd', null, `Electron ${info.electron} on ${info.platform} ${info.arch}`), h('dt', null, 'Memory'), h('dd', null, `${(info.totalMem / 1024).toFixed(1)} GB installed, ${info.cpus} threads`)),
          h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'Icons by Lucide. Type set in Barlow. Microsoft sign-in by msmc. Mods and packs from Modrinth. Wares Launcher is not affiliated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios.')),
      ));
    },
    unmount() { scope.dispose(); },
  };
})();
