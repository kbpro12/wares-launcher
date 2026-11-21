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
    let waiting = false;
    let offCode = null;
    const ctx = W.modal({
      title: 'Add a Microsoft account', width: 540, body: h('div'), actions: [],
      onClose: () => { if (offCode) offCode(); if (waiting) W.api('accounts:cancel-login').catch(() => {}); },
    });
    const show = (el, actions) => { ctx.body.replaceChildren(el); ctx.setActions(actions); };

    function intro() {
      show(h('div', { class: 'stack-lg' },
        h('p', null, 'Use the Microsoft account that owns Minecraft: Java Edition. Wares keeps only a refresh token, encrypted with your operating system. Your password is never seen or stored.'),
        h('div', { class: 'panel pad stack' }, h('b', null, 'In your own browser'), h('p', { class: 'muted' }, 'Wares gives you a short code and opens Microsoft in your default browser. Pick any account you are already signed in to, enter the code, and you are done.'))),
      [{ label: 'Cancel' }, { label: 'Sign in inside Wares', onClick: () => { run('window'); return false; } }, { label: 'Sign in with my browser', kind: 'primary', icon: 'log-in', onClick: () => { run('device'); return false; } }]);
    }

    function showWaiting(title, text, extra) {
      show(h('div', { class: 'empty', style: { padding: '24px 10px' } }, h('div', { class: 'bar ind', style: { width: '220px' } }, h('i')), h('b', null, title), h('p', null, text), extra || null), [{ label: 'Cancel' }]);
    }

    function showCode(c) {
      show(h('div', { class: 'stack-lg', style: { textAlign: 'center' } },
        h('p', null, 'A page opened in your browser. If it asks for a code, enter this one:'),
        h('div', { class: 'code-box selectable' }, c.code),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn', type: 'button', onclick: () => W.copy(c.code) }, icon('copy', 15), 'Copy code'),
          h('button', { class: 'btn', type: 'button', onclick: () => W.external(c.openUri) }, icon('external-link', 15), 'Open browser again')),
        h('div', { class: 'bar ind', style: { width: '200px', margin: '0 auto' } }, h('i')),
        h('p', { class: 'dim', style: { fontSize: '12.5px' } }, 'Waiting for you to approve in the browser. This window closes by itself.')),
      [{ label: 'Cancel' }, { label: 'Use the copy-address method', onClick: () => { W.api('accounts:cancel-login').catch(() => {}); setTimeout(() => run('paste'), 150); return false; } }]);
    }

    function showPaste() {
      const input = h('input', { class: 'input', placeholder: 'https://login.live.com/oauth20_desktop.srf?code=...', autocomplete: 'off' });
      const send = async () => { const ok = await W.api('accounts:login-submit', input.value).catch(() => false); if (!ok) W.toast('That is not the address from the end of the sign-in. It should contain "code=".', { kind: 'warn' }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      show(h('div', { class: 'stack-lg' },
        h('ol', { class: 'steps' },
          h('li', null, 'Your browser opened Microsoft. Pick your account and sign in.'),
          h('li', null, 'You end on a blank white page. Click the address bar and copy it (Ctrl+L, then Ctrl+C).'),
          h('li', null, 'Wares notices the copy by itself. If nothing happens, paste it below.')),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: send }, 'Continue')),
        h('div', { class: 'bar ind', style: { width: '200px' } }, h('i'))),
      [{ label: 'Cancel' }]);
      setTimeout(() => input.focus(), 50);
    }

    async function run(method) {
      waiting = true;
      if (method === 'device') { showWaiting('Contacting Microsoft', 'Getting a sign-in code...'); offCode = W.on('login:code', showCode); }
      else if (method === 'paste') showPaste();
      else showWaiting('Finish signing in', 'Complete the sign-in in the window that just opened.');
      try {
        const a = await W.api('accounts:add-microsoft', method);
        waiting = false;
        await refresh();
        W.toast(`Signed in as ${a.name}.`, { kind: 'ok' });
        ctx.close();
      } catch (e) {
        waiting = false;
        if (offCode) { offCode(); offCode = null; }
        if (e.code === 'DEVICE_UNSUPPORTED' && method === 'device') return run('paste');
        if (/cancel/i.test(e.message)) return undefined;
        W.err(e);
        intro();
      }
      return undefined;
    }

    intro();
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

  W.accountFlows = { microsoft: () => addMicrosoft(), offline: () => addOffline() };

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
