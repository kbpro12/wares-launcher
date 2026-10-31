/* Mods, resource packs and shaders: local manager plus Modrinth browser. One factory, three views. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;

  const META = {
    mod: { title: 'Mods', noun: 'mod', icon: 'shapes', accept: /\.jar$/i, ext: ['jar'], folder: 'mods', empty: 'Install mods from Modrinth, or drop .jar files here.' },
    resourcepack: { title: 'Resource packs', noun: 'resource pack', icon: 'image', accept: /\.zip$/i, ext: ['zip'], folder: 'resourcepacks', empty: 'Install packs from Modrinth, or drop .zip files here.' },
    shader: { title: 'Shaders', noun: 'shader pack', icon: 'sparkles', accept: /\.zip$/i, ext: ['zip'], folder: 'shaderpacks', empty: 'Shader packs need Iris (Fabric/Quilt) or OptiFine. Install packs from Modrinth or drop .zip files here.' },
  };

  const CATEGORIES = {
    mod: ['optimization', 'adventure', 'technology', 'magic', 'library', 'utility', 'decoration', 'equipment', 'food', 'game-mechanics', 'management', 'mobs', 'storage', 'transportation', 'worldgen', 'social', 'cursed'],
    resourcepack: ['vanilla-like', 'realistic', 'simplistic', 'themed', 'cartoon', 'combat', 'decoration', 'tweaks', 'utility', 'modded', 'fantasy'],
    shader: ['semi-realistic', 'realistic', 'vanilla-like', 'cartoon', 'fantasy', 'potato', 'low', 'medium', 'high', 'colored-lighting'],
  };
  const SORTS = [{ value: 'relevance', label: 'Relevance' }, { value: 'downloads', label: 'Downloads' }, { value: 'follows', label: 'Follows' }, { value: 'newest', label: 'Newest' }, { value: 'updated', label: 'Recently updated' }];

  const pretty = (s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function thumb(src, fallback) {
    if (src) return h('img', { class: 'icon-img', src, alt: '', loading: 'lazy' });
    return h('div', { class: 'icon-img ph' }, icon(fallback, 22));
  }

  /** Plain-text preview of a Modrinth markdown body. */
  function plain(md) {
    return String(md || '')
      .replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/gm, '').replace(/[*_`>~]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1400);
  }

  function make(type) {
    const M = META[type];
    let scope;

    return {
      mount(page) {
        scope = W.bus.scope();
        const st = {
          profileId: (W.activeProfile() || {}).id || null, tab: 'installed', items: [], active: [], filter: '', updates: new Map(), loading: false,
          q: '', sort: 'relevance', category: '', compat: true, results: [], total: 0, offset: 0, busy: false, installedIds: new Set(),
        };
        const body = h('div', { class: 'cbody' });
        const profile = () => W.getProfile(st.profileId);

        const profSel = h('select', { class: 'select', 'aria-label': 'Profile', style: { maxWidth: '280px' }, onchange: (e) => { st.profileId = e.target.value; st.updates.clear(); load(); } });
        const fillProfiles = () => {
          profSel.replaceChildren(...S.profiles.map((p) => h('option', { value: p.id }, `${p.name} - ${W.profileLine(p)}`)));
          if (!W.getProfile(st.profileId)) st.profileId = (S.profiles[0] || {}).id || null;
          if (st.profileId) profSel.value = st.profileId;
        };
        fillProfiles();

        const tabs = h('div', { class: 'tabs' },
          h('button', { class: 'on', type: 'button', onclick: () => setTab('installed') }, 'Installed'),
          h('button', { type: 'button', onclick: () => setTab('browse') }, 'Browse Modrinth'));
        const setTab = (t) => {
          st.tab = t;
          [...tabs.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (t === 'installed')));
          draw();
        };

        /* ------------------------------------------------ installed */
        async function load() {
          if (!st.profileId) { draw(); return; }
          st.loading = true; draw();
          try {
            const r = await W.api('content:list', st.profileId, type);
            st.items = r.items; st.active = r.active || [];
            st.installedIds = new Set(r.items.filter((i) => i.modrinth).map((i) => i.modrinth.projectId));
          } catch (e) { W.err(e); st.items = []; }
          st.loading = false; draw();
        }

        const guardRunning = () => {
          if (type !== 'mod' && S.running.has(st.profileId)) { W.toast('Close the game first. Minecraft rewrites its settings when it exits.', { kind: 'warn' }); return true; }
          return false;
        };

        async function setPacks(order) {
          if (guardRunning()) return;
          try { await W.api('content:set-packs', st.profileId, order); st.active = order; draw(); } catch (e) { W.err(e); }
        }

        function installedRow(it) {
          const upd = st.updates.get(it.file);
          const actions = h('div', { class: 'row', style: { gap: '6px' } });
          if (upd) actions.append(h('button', { class: 'btn sm primary', type: 'button', title: `${upd.from} to ${upd.to}`, onclick: async () => { await W.api('content:update', st.profileId, type, upd).catch(W.err); st.updates.delete(it.file); draw(); } }, icon('circle-arrow-up', 14), 'Update'));
          if (type === 'resourcepack') {
            const idx = st.active.indexOf(it.file);
            if (idx < 0) actions.append(h('button', { class: 'btn sm', type: 'button', onclick: () => setPacks([it.file, ...st.active]) }, icon('plus', 14), 'Enable'));
            else {
              actions.append(
                h('button', { class: 'btn sm ghost icon', type: 'button', title: 'Higher priority', disabled: idx === 0, onclick: () => { const a = st.active.slice(); [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; setPacks(a); } }, icon('chevron-down', 15, 'flip')),
                h('button', { class: 'btn sm ghost icon', type: 'button', title: 'Lower priority', disabled: idx === st.active.length - 1, onclick: () => { const a = st.active.slice(); [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; setPacks(a); } }, icon('chevron-down', 15)),
                h('button', { class: 'btn sm', type: 'button', onclick: () => setPacks(st.active.filter((x) => x !== it.file)) }, 'Disable'));
            }
          }
          if (type === 'shader') {
            actions.append(it.active
              ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (guardRunning()) return; await W.api('content:set-shader', st.profileId, null).catch(W.err); load(); } }, 'Deactivate')
              : h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (guardRunning()) return; await W.api('content:set-shader', st.profileId, it.file).catch(W.err); load(); } }, 'Use'));
          }
          actions.append(h('button', { class: 'btn sm ghost icon', type: 'button', title: 'Delete', onclick: async () => {
            if (!await W.confirm(`Delete ${it.name} from this profile?`, { title: `Delete ${M.noun}`, ok: 'Delete', danger: true })) return;
            try { await W.api('content:remove', st.profileId, type, it.file); load(); } catch (e) { W.err(e); }
          } }, icon('trash-2', 15)));

          return h('div', { class: `li crow${it.enabled === false ? ' off' : ''}` },
            type === 'mod' && W.switchEl(it.enabled, async (v) => {
              try { await W.api('content:toggle', st.profileId, it.file, v); load(); } catch (e) { W.err(e); load(); }
            }),
            thumb(it.icon || it.iconUrl, M.icon),
            h('div', { class: 'grow' },
              h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 't ellipsis' }, it.name),
                it.version && h('span', { class: 'badge' }, it.version),
                it.loader && h('span', { class: 'badge accent' }, W.loaderName(it.loader)),
                it.modrinth && h('span', { class: 'badge', title: 'Matched on Modrinth' }, 'Modrinth'),
                type === 'shader' && it.active && h('span', { class: 'badge ok' }, 'Active'),
                type === 'resourcepack' && it.format && h('span', { class: 'badge' }, `Format ${it.format}`),
                upd && h('span', { class: 'badge warn' }, `Update ${upd.to}`)),
              it.description && h('div', { class: 's' }, it.description),
              h('div', { class: 's dim' }, `${it.file}${it.size ? '   ' + W.fmt.bytes(it.size) : ''}`)),
            actions);
        }

        function drawInstalled() {
          const p = profile();
          const f = st.filter.trim().toLowerCase();
          const items = st.items.filter((i) => !f || i.name.toLowerCase().includes(f) || i.file.toLowerCase().includes(f));
          const wrap = h('div', { class: 'cwrap' });

          const updateBtn = h('button', { class: 'btn', type: 'button', onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try {
              const r = await W.api('content:check-updates', st.profileId, type);
              st.updates = new Map(r.updates.map((u) => [u.file, u]));
              W.toast(r.updates.length ? `${r.updates.length} update(s) available.` : 'Everything is up to date.', { kind: r.updates.length ? 'warn' : 'ok' });
              draw();
            } catch (err) { W.err(err); b.disabled = false; }
          } }, icon('refresh-cw', 15), 'Check for updates');

          wrap.append(h('div', { class: 'toolbar' },
            h('div', { class: 'search grow' }, icon('search', 16), h('input', { class: 'input', placeholder: `Search installed ${M.title.toLowerCase()}`, value: st.filter, oninput: (e) => { st.filter = e.target.value; drawList(); } })),
            h('button', { class: 'btn', type: 'button', onclick: async () => {
              const files = await W.api('dialog:files', { title: `Add ${M.title.toLowerCase()}`, multi: true, filters: [{ name: M.title, extensions: M.ext }] });
              if (files.length) addFiles(files);
            } }, icon('upload', 15), 'Add files'),
            items.length || st.items.length ? updateBtn : null,
            h('button', { class: 'btn ghost', type: 'button', onclick: () => W.api('shell:open-profile', st.profileId, M.folder).catch(W.err) }, icon('folder-open', 15), 'Open folder')));

          if (st.updates.size) {
            wrap.append(h('div', { class: 'notice slim' }, icon('circle-arrow-up', 20), h('div', { class: 'grow' }, `${st.updates.size} update${st.updates.size > 1 ? 's' : ''} available`),
              h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { for (const u of [...st.updates.values()]) await W.api('content:update', st.profileId, type, u).catch(W.err); st.updates.clear(); draw(); } }, 'Update all')));
          }

          const listHost = h('div', { class: 'list sheet panel' });
          function drawList() {
            const ff = st.filter.trim().toLowerCase();
            const rows = st.items.filter((i) => !ff || i.name.toLowerCase().includes(ff) || i.file.toLowerCase().includes(ff));
            if (type === 'resourcepack') {
              const act = st.active.map((n) => rows.find((r) => r.file === n)).filter(Boolean);
              const rest = rows.filter((r) => !st.active.includes(r.file));
              listHost.replaceChildren(
                h('div', { class: 'group-head' }, `Active  (${act.length})`, h('span', { class: 'dim' }, 'Top entry has the highest priority')),
                ...(act.length ? act.map(installedRow) : [h('div', { class: 'li dim' }, 'No packs enabled. Minecraft uses its default textures.')]),
                h('div', { class: 'group-head' }, `Available  (${rest.length})`), ...rest.map(installedRow));
              return;
            }
            if (!rows.length) { listHost.replaceChildren(st.items.length ? h('div', { class: 'li dim' }, 'No matches.') : W.empty(M.icon, `No ${M.title.toLowerCase()} installed`, M.empty, h('button', { class: 'btn primary', type: 'button', onclick: () => setTab('browse') }, icon('search', 15), 'Browse Modrinth'))); return; }
            listHost.replaceChildren(...rows.map(installedRow));
          }
          drawList();
          wrap.append(listHost);
          if (p && p.loader === 'vanilla' && type === 'mod') wrap.prepend(h('div', { class: 'notice slim' }, icon('info', 20), h('div', { class: 'grow' }, 'This profile uses Vanilla Minecraft, which cannot load mods. Switch it to Fabric, Quilt, Forge or NeoForge.'), h('button', { class: 'btn sm', type: 'button', onclick: () => W.go('profiles', { edit: p.id }) }, 'Edit profile')));
          if (type === 'shader' && p && !['fabric', 'quilt', 'forge-optifine'].includes(p.loader)) wrap.prepend(h('div', { class: 'notice slim' }, icon('info', 20), h('div', { class: 'grow' }, 'Shader packs need Iris (Fabric or Quilt) or OptiFine. Use the Shaders preset to set this up.'), h('button', { class: 'btn sm', type: 'button', onclick: () => W.go('profiles', { presets: true }) }, 'Open presets')));
          return wrap;
        }

        async function addFiles(files) {
          try { const added = await W.api('content:add', st.profileId, type, files); W.toast(added.length ? `Added ${added.length} file(s).` : `No valid ${M.ext.join('/')} files were selected.`, { kind: added.length ? 'ok' : 'warn' }); load(); } catch (e) { W.err(e); }
        }

        /* --------------------------------------------------- browse */
        async function search(reset) {
          if (st.busy) return;
          const p = profile();
          if (!p) return;
          st.busy = true;
          if (reset) { st.offset = 0; st.results = []; }
          draw(true);
          try {
            const r = await W.api('mr:search', { query: st.q, type, mc: st.compat ? p.mcVersion : undefined, loader: p.loader, category: st.category || undefined, sort: st.sort, offset: st.offset, limit: 20 });
            st.results = st.results.concat(r.hits); st.total = r.total; st.offset = st.results.length;
          } catch (e) { W.err(e); }
          st.busy = false; draw(true);
        }

        function installNow(hit, versionId) {
          if (type === 'mod' && profile().loader === 'vanilla') { W.toast('Vanilla profiles cannot load mods. Change the loader first.', { kind: 'warn', action: { label: 'Edit profile', fn: () => W.go('profiles', { edit: st.profileId }) } }); return; }
          W.api('mr:install', st.profileId, { projectId: hit.id, type, title: hit.title, versionId, deps: true }).then(() => W.toast(`Installing ${hit.title}. Progress is shown under Activity.`)).catch(W.err);
        }

        async function openDetail(hit) {
          const p = profile();
          let versions = [];
          const bodyEl = h('div', null, W.skeletons(3));
          const sel = h('select', { class: 'select' });
          const ctx = W.modal({
            title: hit.title, width: 680, body: bodyEl,
            actions: [{ label: 'Open on Modrinth', icon: 'external-link', onClick: () => { W.external(`https://modrinth.com/${type === 'resourcepack' ? 'resourcepack' : type}/${hit.slug}`); return false; } }, { label: 'Close' },
              { label: 'Install', kind: 'primary', icon: 'download', onClick: () => { installNow(hit, sel.value || undefined); } }],
          });
          try {
            const [proj, vers] = await Promise.all([W.api('mr:project', hit.id), W.api('mr:versions', hit.id, { mc: p.mcVersion, loader: p.loader, type })]);
            versions = vers.length ? vers : await W.api('mr:versions', hit.id, { type });
            sel.replaceChildren(...versions.slice(0, 40).map((v) => h('option', { value: v.id }, `${v.number}   ${v.channel}   ${v.gameVersions.slice(-3).join(', ')}`)));
            if (!vers.length && versions.length) bodyEl.dataset.warn = '1';
            bodyEl.replaceChildren(
              h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } }, thumb(proj.icon, M.icon),
                h('div', { class: 'grow' }, h('p', null, proj.description),
                  h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '6px' } }, h('span', { class: 'badge' }, `${W.fmt.num(proj.downloads)} downloads`), h('span', { class: 'badge' }, `${W.fmt.num(proj.followers)} follows`), proj.license ? h('span', { class: 'badge' }, proj.license) : null, ...proj.categories.slice(0, 4).map((c) => h('span', { class: 'badge accent' }, pretty(c)))))),
              proj.gallery[0] && h('img', { class: 'gallery', src: proj.gallery[0].url, alt: '' }),
              h('pre', { class: 'plain selectable' }, plain(proj.body)),
              h('div', { class: 'rule' }),
              W.field('Version to install', sel, vers.length ? `Showing builds for Minecraft ${p.mcVersion}${type === 'mod' ? ' and ' + W.loaderName(p.loader) : ''}.` : 'No build matches this profile. Showing all versions; it may not work.'));
          } catch (e) { bodyEl.replaceChildren(h('p', { class: 'muted' }, `Could not load details: ${e.message}`)); }
          return ctx;
        }

        function hitRow(hit) {
          const done = st.installedIds.has(hit.id);
          return h('div', { class: 'li crow hit', onclick: (e) => { if (!e.target.closest('button')) openDetail(hit); } },
            thumb(hit.icon, M.icon),
            h('div', { class: 'grow' },
              h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 't ellipsis' }, hit.title), h('span', { class: 'dim', style: { fontSize: '12.5px' } }, `by ${hit.author}`)),
              h('div', { class: 's clamp2', style: { whiteSpace: 'normal' } }, hit.description),
              h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '5px' } },
                h('span', { class: 'meta' }, icon('download', 13), W.fmt.num(hit.downloads)), h('span', { class: 'meta' }, icon('clock', 13), W.fmt.ago(hit.updated)),
                ...hit.categories.slice(0, 3).map((c) => h('span', { class: 'badge' }, pretty(c))))),
            done ? h('span', { class: 'badge ok' }, 'Installed') : h('button', { class: 'btn primary sm', type: 'button', onclick: () => installNow(hit) }, icon('download', 14), 'Install'));
        }

        function drawBrowse(keepInput) {
          const listHost = h('div', { class: 'list sheet panel' });
          if (!st.results.length && st.busy) listHost.append(W.skeletons(6));
          else if (!st.results.length) listHost.append(W.empty('search', 'No results', st.compat ? 'Nothing matches this profile. Turn off the compatibility filter to search every version.' : 'Try a different search.'));
          else {
            listHost.append(...st.results.map(hitRow));
            if (st.results.length < st.total) listHost.append(h('div', { style: { padding: '14px', textAlign: 'center' } }, h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => search(false) }, st.busy ? 'Loading...' : `Load more  (${st.results.length} of ${W.fmt.num(st.total)})`)));
          }
          if (keepInput && body.querySelector('.browse-list')) { body.querySelector('.browse-list').replaceChildren(listHost); return null; }
          const catSel = W.select([{ value: '', label: 'All categories' }, ...CATEGORIES[type].map((c) => ({ value: c, label: pretty(c) }))], st.category, (v) => { st.category = v; search(true); });
          const wrap = h('div', { class: 'cwrap' },
            h('div', { class: 'toolbar' },
              h('div', { class: 'search grow' }, icon('search', 16), h('input', { class: 'input', placeholder: `Search ${M.title.toLowerCase()} on Modrinth`, value: st.q, oninput: W.debounce((e) => { st.q = e.target.value; search(true); }, 380) })),
              catSel, W.select(SORTS, st.sort, (v) => { st.sort = v; search(true); }, { style: 'max-width:170px' })),
            h('label', { class: 'row compat' }, W.switchEl(st.compat, (v) => { st.compat = v; search(true); }), h('span', { class: 'muted' }, `Only show ${M.title.toLowerCase()} for ${profile() ? W.profileLine(profile()) : 'this profile'}`)),
            h('div', { class: 'browse-list' }, listHost));
          return wrap;
        }

        /* ------------------------------------------------------ draw */
        function draw(keep) {
          if (!S.profiles.length) { body.replaceChildren(W.empty('layers', 'Create a profile first', `${M.title} are installed per profile.`, h('button', { class: 'btn primary', type: 'button', onclick: () => W.go('profiles', { create: true }) }, 'New profile'))); return; }
          if (st.tab === 'installed') {
            if (st.loading) { body.replaceChildren(W.skeletons(6)); return; }
            body.replaceChildren(drawInstalled());
          } else {
            const r = drawBrowse(keep);
            if (r) body.replaceChildren(r);
          }
        }

        scope.on('profiles', () => { fillProfiles(); if (!st.items.length && st.tab === 'installed') load(); });
        scope.on('content', (e) => { if (e.profileId === st.profileId && e.type === type) { load(); if (st.tab === 'browse') draw(true); } });
        scope.on('running', () => { if (type !== 'mod') { /* nothing: guarded on action */ } });

        page.append(h('div', { class: 'cpage' },
          h('div', { class: 'chead' }, h('h1', { class: 'page-title' }, M.title), h('div', { class: 'grow' }), h('span', { class: 'muted' }, 'Profile'), profSel),
          tabs, body));
        W.onFileDrop(page, M.accept, addFiles);
        tabs.addEventListener('click', () => { if (st.tab === 'browse' && !st.results.length && !st.busy) search(true); });
        load();
      },
      unmount() { scope.dispose(); },
    };
  }

  W.views.mods = make('mod');
  W.views.resourcepacks = make('resourcepack');
  W.views.shaders = make('shader');
})();
