/* Accounts: Microsoft (premium) and offline accounts. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;

  async function refresh() {
    S.accounts = await W.api('accounts:list');
    S.settings.activeAccount = S.accounts.active;
    W.bus.emit('accounts');
  }

  function addMicrosoft() {
    let method = 'browser';
    const hint = h('p', { class: 'muted' });
    const seg = W.seg([{ value: 'browser', label: 'My default browser' }, { value: 'window', label: 'Inside Wares' }], method, (v) => { method = v; setHint(); });
    const setHint = () => { hint.textContent = method === 'browser'
      ? 'Opens Microsoft sign-in in the browser you already use, so your saved Microsoft accounts and password manager are available. Pick your account there.'
      : 'Opens a Microsoft sign-in window on top of the launcher. Use this if your browser cannot reach localhost.'; };
    setHint();
    let waiting = false;
    const ctx = W.modal({
      title: 'Add a Microsoft account', width: 520,
      onClose: () => { if (waiting) W.api('accounts:cancel-login').catch(() => {}); },
      body: h('div', { class: 'stack-lg' }, h('p', null, 'Use the Microsoft account that owns Minecraft: Java Edition. Wares keeps only a refresh token, encrypted with your operating system. Your password is never seen or stored.'), seg, hint),
      actions: [{ label: 'Cancel' }, { label: 'Continue', kind: 'primary', icon: 'log-in', onClick: async (c) => {
        waiting = true;
        c.setActions([{ label: 'Cancel sign-in', onClick: () => { W.api('accounts:cancel-login').catch(() => {}); } }]);
        c.body.replaceChildren(h('div', { class: 'empty', style: { padding: '26px 10px' } }, h('div', { class: 'bar ind', style: { width: '220px' } }, h('i')), h('b', null, method === 'browser' ? 'Finish in your browser' : 'Finish signing in'),
          h('p', null, method === 'browser' ? 'A new tab opened in your default browser. Choose your Microsoft account there, then come back. This window closes by itself.' : 'Complete the sign-in in the window that just opened.'),
          method === 'browser' ? h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'Nothing opened? Allow pop-ups for the launcher, or cancel and choose "Inside Wares".') : null));
        try {
          const a = await W.api('accounts:add-microsoft', method);
          waiting = false;
          await refresh();
          W.toast(`Signed in as ${a.name}.`, { kind: 'ok' });
        } catch (e) { waiting = false; if (!/cancel/i.test(e.message)) W.err(e); }
        return true;
      } }],
    });
    return ctx;
  }

  function addOffline() {
    const input = h('input', { class: 'input', placeholder: 'Steve', maxlength: 16, autocomplete: 'off' });
    const note = h('div', { class: 'hint' }, '3 to 16 letters, numbers or underscores.');
    const go = async (ctx) => {
      try { await W.api('accounts:add-offline', input.value.trim()); await refresh(); W.toast('Offline account added.', { kind: 'ok' }); ctx.close(); } catch (e) { note.textContent = e.message; note.style.color = 'var(--err)'; return false; }
    };
    const ctx = W.modal({
      title: 'Add an offline account', width: 460,
      body: h('div', { class: 'stack-lg' }, h('p', { class: 'muted' }, 'Offline accounts work in singleplayer, on LAN and on servers that allow non-premium players. They cannot use Mojang skins.'), W.field('Username', input, null), note),
      actions: [{ label: 'Cancel' }, { label: 'Add account', kind: 'primary', onClick: () => go(ctx).then(() => false) }],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(ctx); });
  }

  W.views.accounts = {
    mount(page) {
      scope = W.bus.scope();
      const listHost = h('div', { class: 'list sheet panel' });
      const draw = () => {
        const { accounts, active } = S.accounts;
        if (!accounts.length) { listHost.replaceChildren(W.empty('circle-user-round', 'No accounts yet', 'Add a Microsoft account to play online, or an offline account for LAN and cracked servers.')); return; }
        listHost.replaceChildren(...accounts.map((a) => h('div', { class: `li arow${a.id === active ? ' sel' : ''}` },
          W.avatar(a, 52),
          h('div', { class: 'grow' },
            h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 't', style: { fontSize: '16px' } }, a.name),
              h('span', { class: `badge ${a.type === 'microsoft' ? 'accent' : ''}` }, a.type === 'microsoft' ? 'Microsoft' : 'Offline'),
              a.id === active && h('span', { class: 'badge ok' }, 'In use'),
              !a.sessionOk && h('span', { class: 'badge warn' }, 'Sign in again')),
            h('div', { class: 's mono selectable' }, a.uuid),
            h('div', { class: 's dim' }, `Added ${W.fmt.date(a.addedAt)}${a.lastUsed ? '   Last used ' + W.fmt.ago(a.lastUsed) : ''}`)),
          a.id !== active && h('button', { class: 'btn sm', type: 'button', onclick: async () => { await W.api('accounts:select', a.id).catch(W.err); refresh(); } }, 'Use'),
          a.type === 'microsoft' && !a.sessionOk && h('button', { class: 'btn sm primary', type: 'button', onclick: addMicrosoft }, 'Sign in'),
          h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Copy UUID', onclick: () => W.copy(a.uuid) }, icon('copy', 15)),
          h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Remove account', onclick: async () => {
            if (!await W.confirm(`Remove ${a.name} from Wares? ${a.type === 'microsoft' ? 'You can sign in again at any time.' : 'Worlds are not deleted.'}`, { title: 'Remove account', ok: 'Remove', danger: true })) return;
            await W.api('accounts:remove', a.id).catch(W.err); W.forgetSkin(a.id); refresh();
          } }, icon('trash-2', 15)))));
      };
      draw();
      scope.on('accounts', draw);
      page.append(h('div', { class: 'cpage' },
        h('div', { class: 'chead' }, h('h1', { class: 'page-title' }, 'Accounts'), h('div', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: addOffline }, icon('user', 15), 'Add offline account'),
          h('button', { class: 'btn primary', type: 'button', onclick: addMicrosoft }, icon('log-in', 15), 'Add Microsoft account')),
        h('div', { class: 'cwrap', style: { paddingTop: '16px' } }, listHost,
          h('p', { class: 'dim', style: { marginTop: '14px', fontSize: '12.5px', maxWidth: '640px' } }, 'Wares is an independent launcher and is not affiliated with Mojang or Microsoft. Buy Minecraft to play on official servers.'))));
    },
    unmount() { scope.dispose(); },
  };
})();
