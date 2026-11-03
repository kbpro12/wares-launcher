/* Modpacks: browse Modrinth modpacks and install them as profiles. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;

  const SORTS = [{ value: 'relevance', label: 'Relevance' }, { value: 'downloads', label: 'Downloads' }, { value: 'follows', label: 'Follows' }, { value: 'newest', label: 'Newest' }, { value: 'updated', label: 'Recently updated' }];
  const CATS = ['adventure', 'challenging', 'combat', 'kitchen-sink', 'lightweight', 'magic', 'multiplayer', 'optimization', 'quests', 'technology'];
  const pretty = (s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function importLocal() {
    return W.api('dialog:files', { title: 'Import a Modrinth modpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] })
      .then(async ([f]) => { if (f) { await W.api('mr:install-pack', { file: f }); W.toast('Importing modpack. Progress is shown under Activity.', { kind: 'ok' }); } })
      .catch(W.err);
  }

  async function openInstall(hit) {
    const name = h('input', { class: 'input', value: hit.title });
    const sel = h('select', { class: 'select' }, h('option', null, 'Loading versions...'));
    let versions = [];
    W.api('mr:versions', hit.id, { type: 'modpack' }).then((v) => {
      versions = v;
      sel.replaceChildren(...v.slice(0, 40).map((x) => h('option', { value: x.id }, `${x.number}   ${x.channel}   Minecraft ${x.gameVersions.slice(-1)[0] || '?'}   ${x.loaders.join(', ')}`)));
    }).catch((e) => { sel.replaceChildren(h('option', null, 'Could not load versions')); W.err(e); });
    W.modal({
      title: `Install ${hit.title}`, width: 540,
      body: h('div', { class: 'stack-lg' },
        h('p', { class: 'muted' }, 'A new profile is created with the exact Minecraft version, loader and files this pack needs. Large packs can take several minutes.'),
        W.field('Profile name', name), W.field('Pack version', sel)),
      actions: [{ label: 'Cancel' }, { label: 'Install pack', kind: 'primary', icon: 'download', onClick: async () => {
        if (!versions.length) { W.toast('Wait for the versions to load.', { kind: 'warn' }); return false; }
        await W.api('mr:install-pack', { projectId: hit.id, versionId: sel.value, name: name.value.trim() || hit.title });
        W.toast('Installing modpack. Progress is shown under Activity.', { kind: 'ok' });
      } }],
    });
  }

  W.views.modpacks = {
    mount(page) {
      scope = W.bus.scope();
      const st = { q: '', sort: 'downloads', category: '', results: [], total: 0, busy: false };
      const listHost = h('div', { class: 'list sheet panel' });

      async function search(reset) {
        if (st.busy) return;
        st.busy = true;
        if (reset) st.results = [];
        draw();
        try {
          const r = await W.api('mr:search', { query: st.q, type: 'modpack', category: st.category || undefined, sort: st.sort, offset: st.results.length, limit: 20 });
          st.results = st.results.concat(r.hits); st.total = r.total;
        } catch (e) { W.err(e); }
        st.busy = false; draw();
      }

      function draw() {
        if (!st.results.length) { listHost.replaceChildren(st.busy ? W.skeletons(6) : W.empty('package', 'No modpacks found', 'Try a different search.')); return; }
        listHost.replaceChildren(...st.results.map((hit) => h('div', { class: 'li crow hit', onclick: (e) => { if (!e.target.closest('button')) openInstall(hit); } },
          hit.icon ? h('img', { class: 'icon-img', src: hit.icon, alt: '', loading: 'lazy' }) : h('div', { class: 'icon-img ph' }, icon('package', 22)),
          h('div', { class: 'grow' },
            h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 't ellipsis' }, hit.title), h('span', { class: 'dim', style: { fontSize: '12.5px' } }, `by ${hit.author}`)),
            h('div', { class: 's clamp2', style: { whiteSpace: 'normal' } }, hit.description),
            h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '5px' } }, h('span', { class: 'meta' }, icon('download', 13), W.fmt.num(hit.downloads)), h('span', { class: 'meta' }, icon('clock', 13), W.fmt.ago(hit.updated)), ...hit.categories.slice(0, 4).map((c) => h('span', { class: 'badge' }, pretty(c))))),
          h('button', { class: 'btn primary sm', type: 'button', onclick: () => openInstall(hit) }, icon('download', 14), 'Install'))),
          st.results.length < st.total && h('div', { style: { padding: '14px', textAlign: 'center' } }, h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => search(false) }, `Load more  (${st.results.length} of ${W.fmt.num(st.total)})`)));
      }

      page.append(h('div', { class: 'cpage' },
        h('div', { class: 'chead' }, h('h1', { class: 'page-title' }, 'Modpacks'), h('div', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: importLocal }, icon('file-archive', 15), 'Import .mrpack')),
        h('div', { class: 'cwrap', style: { paddingTop: '16px' } },
          h('div', { class: 'toolbar' },
            h('div', { class: 'search grow' }, icon('search', 16), h('input', { class: 'input', placeholder: 'Search modpacks on Modrinth', oninput: W.debounce((e) => { st.q = e.target.value; search(true); }, 380) })),
            W.select([{ value: '', label: 'All categories' }, ...CATS.map((c) => ({ value: c, label: pretty(c) }))], '', (v) => { st.category = v; search(true); }),
            W.select(SORTS, st.sort, (v) => { st.sort = v; search(true); }, { style: 'max-width:170px' })),
          listHost, h('p', { class: 'dim', style: { marginTop: '12px', fontSize: '12.5px' } }, 'Modrinth modpacks (.mrpack) are supported. CurseForge packs are not. You can also drop a .mrpack file anywhere on the Profiles page.'))));
      W.onFileDrop(page, /\.mrpack$/i, async ([f]) => { await W.api('mr:install-pack', { file: f }).catch(W.err); W.toast('Importing modpack. Progress is shown under Activity.', { kind: 'ok' }); });
      search(true);
    },
    unmount() { scope.dispose(); },
  };
})();
