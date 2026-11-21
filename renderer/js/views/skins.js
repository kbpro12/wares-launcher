/* Skins and capes: live preview, account skin/cape, local library, lookup by username. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not a valid skin image.')); i.src = src; });

  /** Draw a front or back view of a 64x64 (or legacy 64x32) skin onto cv. One skin pixel = `s` canvas pixels. */
  function drawSkin(cv, img, variant, view, s) {
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const legacy = img.height <= 32;
    const slim = variant === 'slim' && !legacy;
    const aw = slim ? 3 : 4;
    const front = view === 'front';
    const face = front ? 'f' : 'b';

    const blit = (sx, sy, sw, sh, dx, dy, mirror) => {
      if (mirror) { ctx.save(); ctx.translate((dx + sw) * s, 0); ctx.scale(-1, 1); ctx.drawImage(img, sx, sy, sw, sh, 0, dy * s, sw * s, sh * s); ctx.restore(); }
      else ctx.drawImage(img, sx, sy, sw, sh, dx * s, dy * s, sw * s, sh * s);
    };

    const RA = { base: { f: 44, b: slim ? 51 : 52, y: 20 }, over: { f: 44, b: slim ? 51 : 52, y: 36 } };
    const LA = { base: { f: 36, b: slim ? 43 : 44, y: 52 }, over: { f: 52, b: slim ? 59 : 60, y: 52 } };
    const RL = { base: { f: 4, b: 12, y: 20 }, over: { f: 4, b: 12, y: 36 } };
    const LL = { base: { f: 20, b: 28, y: 52 }, over: { f: 4, b: 12, y: 52 } };

    const limb = (def, layer, w, dx, dy, mirror) => blit(def[layer][face], def[layer].y, w, 12, dx, dy, mirror);

    const leftArmX = front ? 12 : 4 - aw;
    const rightArmX = front ? 4 - aw : 12;
    const leftLegX = front ? 8 : 4;
    const rightLegX = front ? 4 : 8;

    for (const layer of ['base', 'over']) {
      if (layer === 'over' && legacy) break;
      limb(RL, layer, 4, rightLegX, 20);
      limb(legacy ? RL : LL, layer, 4, leftLegX, 20, legacy);
      limb(RA, layer, aw, rightArmX, 8);
      limb(legacy ? RA : LA, layer, aw, leftArmX, 8, legacy);
      blit(front ? 20 : 32, layer === 'base' ? 20 : 36, 8, 12, 4, 8);
      blit(front ? (layer === 'base' ? 8 : 40) : (layer === 'base' ? 24 : 56), 8, 8, 8, 4, 0);
    }
  }

  function capeThumb(src, scale = 5) {
    const c = h('canvas', { width: 10 * scale, height: 16 * scale, class: 'cape-cv' });
    loadImg(src).then((img) => {
      const k = img.width / 64;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, c.width, c.height);
    }).catch(() => {});
    return c;
  }

  function skinThumb(src, variant) {
    const c = h('canvas', { width: 48, height: 96, class: 'skin-thumb' });
    loadImg(src).then((img) => drawSkin(c, img, variant, 'front', 3)).catch(() => {});
    return c;
  }

  W.views.skins = {
    mount(page) {
      scope = W.bus.scope();
      const acc = W.activeAccount();
      const st = { cur: null, view: 'front', profile: null, capes: [], library: [], busy: false };
      const stage = h('canvas', { width: 192, height: 384, class: 'skin-stage', 'aria-label': 'Skin preview' });
      const caption = h('div', { class: 'skin-cap' });
      const actionsHost = h('div', { class: 'stack' });
      const capesHost = h('div', { class: 'capes' });
      const libHost = h('div', { class: 'skin-grid' });
      let img = null;

      const premium = !!acc && acc.type === 'microsoft';

      async function show(cur) {
        st.cur = cur;
        try { img = await loadImg(cur.image); } catch (e) { return W.err(e); }
        redraw();
        drawActions();
      }
      function redraw() {
        if (!img || !st.cur) { const ctx = stage.getContext('2d'); ctx.clearRect(0, 0, stage.width, stage.height); return; }
        drawSkin(stage, img, st.cur.variant, st.view, 12);
        caption.replaceChildren(h('b', null, st.cur.name), h('span', { class: 'dim' }, st.cur.variant === 'slim' ? 'Slim arms' : 'Classic arms'));
      }

      const viewSeg = W.seg([{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }], 'front', (v) => { st.view = v; redraw(); });
      const variantSeg = W.seg([{ value: 'classic', label: 'Classic' }, { value: 'slim', label: 'Slim' }], 'classic', (v) => { if (st.cur) { st.cur.variant = v; redraw(); } });

      async function ensureInLibrary(cur) {
        if (cur.libId && cur.libVariant === cur.variant) return cur.libId;
        const id = await W.api('skins:library-add', { name: cur.name, variant: cur.variant, dataUrl: cur.image });
        cur.libId = id;
        cur.libVariant = cur.variant;
        return id;
      }

      async function refreshLibrary() {
        st.library = await W.api('skins:library').catch(() => []);
        libHost.replaceChildren(...(st.library.length ? st.library.map((s) => h('div', { class: 'skin-card' },
          h('button', { class: 'skin-pick', type: 'button', title: 'Preview', onclick: () => show({ name: s.name, variant: s.variant, image: s.image, libId: s.id, libVariant: s.variant }) }, skinThumb(s.image, s.variant)),
          h('div', { class: 'ellipsis', style: { fontWeight: 600, fontSize: '13px' } }, s.name),
          h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Remove from library', onclick: async () => { await W.api('skins:library-remove', s.id); refreshLibrary(); } }, icon('trash-2', 14)))) : [h('p', { class: 'muted' }, 'Skins you save will appear here.')]));
      }

      function drawActions() {
        const cur = st.cur;
        actionsHost.replaceChildren(
          h('div', { class: 'row', style: { justifyContent: 'center' } }, viewSeg, variantSeg),
          cur && h('div', { class: 'row', style: { justifyContent: 'center' } },
            premium && h('button', { class: 'btn primary', type: 'button', disabled: st.busy, onclick: async (e) => {
              e.currentTarget.disabled = true; st.busy = true;
              try {
                const id = await ensureInLibrary(cur);
                await W.api('skins:upload-library', acc.id, id);
                await W.refreshAvatar(acc.id); W.toast('Skin applied. It can take a minute to show up in game.', { kind: 'ok' });
                await refreshLibrary(); loadAccount(false);
              } catch (err) { W.err(err); }
              st.busy = false; drawActions();
            } }, icon('check', 15), 'Apply to account'),
            acc && !premium && h('button', { class: 'btn primary', type: 'button', title: 'Shows this skin on the account head inside the launcher', onclick: async () => {
              try { const id = await ensureInLibrary(cur); await W.api('accounts:local-skin', acc.id, id); await refreshLibrary(); await W.refreshAvatar(acc.id); W.toast('Skin set as this account\'s head in the launcher.', { kind: 'ok' }); } catch (err) { W.err(err); }
            } }, icon('check', 15), 'Use as account head'),
            h('button', { class: 'btn', type: 'button', onclick: async () => { try { await ensureInLibrary(cur); await refreshLibrary(); W.toast('Saved to your library.', { kind: 'ok' }); } catch (err) { W.err(err); } } }, icon('star', 15), 'Save to library')));
      }

      async function loadAccount(select) {
        if (!premium) return;
        try {
          st.profile = await W.api('skins:profile', acc.id);
          if (st.profile.skin && st.profile.skin.image && select) await show({ name: `${st.profile.name} (current)`, variant: st.profile.skin.variant, image: st.profile.skin.image });
          capesHost.replaceChildren(
            h('button', { class: `cape-card${st.profile.capes.some((c) => c.active) ? '' : ' on'}`, type: 'button', onclick: async () => { await W.api('skins:cape', acc.id, null).catch(W.err); loadAccount(false); } }, h('div', { class: 'cape-none' }, icon('x', 18)), h('span', null, 'No cape')),
            ...st.profile.capes.map((c) => h('button', { class: `cape-card${c.active ? ' on' : ''}`, type: 'button', title: c.alias, onclick: async () => { await W.api('skins:cape', acc.id, c.id).catch(W.err); loadAccount(false); } }, c.image ? capeThumb(c.image) : h('div', { class: 'cape-none' }), h('span', null, c.alias))));
          if (!st.profile.capes.length) capesHost.append(h('p', { class: 'muted', style: { alignSelf: 'center' } }, 'This account owns no capes.'));
        } catch (e) { capesHost.replaceChildren(h('p', { class: 'muted' }, e.message)); }
      }

      const lookupInput = h('input', { class: 'input', placeholder: 'Minecraft username', maxlength: 16 });
      async function doLookup() {
        try {
          const r = await W.api('skins:lookup', lookupInput.value);
          if (!r.skin || !r.skin.image) return W.toast(`${r.name} uses a default skin.`, { kind: 'warn' });
          await show({ name: r.name, variant: r.skin.variant, image: r.skin.image });
        } catch (e) { W.err(e); }
      }
      lookupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });

      async function chooseFile(path) {
        try {
          const dataUrl = await W.api('skins:read-file', path);
          const i = await loadImg(dataUrl);
          if (i.width !== 64 || (i.height !== 64 && i.height !== 32)) throw new Error('A skin must be 64x64 (or legacy 64x32) pixels.');
          await show({ name: path.split(/[\\/]/).pop().replace(/\.png$/i, ''), variant: 'classic', image: dataUrl });
        } catch (e) { W.err(e); }
      }

      page.append(h('div', { class: 'skins' },
        h('section', { class: 'skin-left' },
          h('div', { class: 'stage-wrap' }, stage, h('div', { class: 'plinth' })),
          caption, actionsHost),
        h('section', { class: 'skin-right' },
          h('h1', { class: 'page-title' }, 'Skins & capes'),
          !premium && h('div', { class: 'notice slim' }, icon('info', 20), h('div', { class: 'grow' }, acc ? 'Offline accounts have no Mojang skin, so other players see the default skin. Pick a skin below and use it as this account\'s head inside the launcher.' : 'Add an account to apply skins. You can still preview skins without one.')),
          h('div', { class: 'block' }, h('h2', { class: 'h2' }, 'Add a skin'),
            h('div', { class: 'row wrap' },
              h('button', { class: 'btn', type: 'button', onclick: async () => { const [f] = await W.api('dialog:files', { title: 'Choose a skin PNG', filters: [{ name: 'PNG image', extensions: ['png'] }] }); if (f) chooseFile(f); } }, icon('upload', 15), 'Choose PNG file'),
              h('div', { class: 'row grow', style: { minWidth: '260px' } }, lookupInput, h('button', { class: 'btn', type: 'button', onclick: doLookup }, icon('search', 15), 'Find by name'))),
            h('p', { class: 'dim', style: { marginTop: '8px', fontSize: '12.5px' } }, 'Drop a skin PNG anywhere on this page to preview it.')),
          premium && h('div', { class: 'block' }, h('h2', { class: 'h2' }, 'Capes'), capesHost),
          h('div', { class: 'block' }, h('h2', { class: 'h2' }, 'Library'), libHost))));
      W.onFileDrop(page, /\.png$/i, ([f]) => chooseFile(f));
      show({ name: 'Starter skin', variant: 'classic', image: W.defaultSkinDataUrl() });
      refreshLibrary().then(() => loadAccount(true));
      const accId = acc && acc.id;
      scope.on('accounts', () => { const a = W.activeAccount(); if ((a && a.id) !== accId) W.go('skins'); });
    },
    unmount() { scope.dispose(); },
  };
})();
