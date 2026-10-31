/* Console: live game output per profile. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;
  const MAX_DOM = 1600;

  W.views.console = {
    mount(page, params = {}) {
      scope = W.bus.scope();
      let pid = params.profileId || [...S.running.keys()][0] || (W.activeProfile() || {}).id;
      let level = 'all';
      let query = '';
      let lines = [];
      let follow = true;

      const out = h('div', { class: 'console selectable', tabindex: 0, 'aria-live': 'off' });
      out.addEventListener('scroll', () => { follow = out.scrollTop + out.clientHeight >= out.scrollHeight - 30; });

      const match = (l) => (level === 'all' || (level === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === level)) && (!query || l.text.toLowerCase().includes(query));
      const row = (l) => h('div', { class: `ln ${l.level}` }, l.text);

      function redraw() {
        out.replaceChildren(...lines.filter(match).slice(-MAX_DOM).map(row));
        if (follow) out.scrollTop = out.scrollHeight;
      }

      async function load() {
        lines = pid ? await W.api('game:logs', pid).catch(() => []) : [];
        redraw();
        status.textContent = pid && S.running.has(pid) ? 'Game is running' : lines.length ? 'Game has exited' : 'No output yet. Launch a profile to see its log here.';
      }

      const status = h('span', { class: 'muted' });
      const sel = h('select', { class: 'select', 'aria-label': 'Profile', style: { maxWidth: '260px' }, onchange: (e) => { pid = e.target.value; load(); } },
        S.profiles.map((p) => h('option', { value: p.id }, p.name + (S.running.has(p.id) ? '  (running)' : ''))));
      if (pid) sel.value = pid;

      scope.on('log', (e) => {
        if (e.profileId !== pid) return;
        lines.push(...e.lines);
        if (lines.length > 4000) lines = lines.slice(-4000);
        const vis = e.lines.filter(match);
        for (const l of vis) out.append(row(l));
        while (out.childElementCount > MAX_DOM) out.firstChild.remove();
        if (follow) out.scrollTop = out.scrollHeight;
      });
      scope.on('running', (e) => { if (e && e.profileId === pid) { if (e.state === 'starting') { lines = []; redraw(); } load(); } });

      page.append(h('div', { class: 'cpage console-page' },
        h('div', { class: 'chead' }, h('h1', { class: 'page-title' }, 'Console'), h('div', { class: 'grow' }), status),
        h('div', { class: 'toolbar', style: { padding: '14px 28px 0' } }, sel,
          W.seg([{ value: 'all', label: 'All' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors' }], 'all', (v) => { level = v; redraw(); }),
          h('div', { class: 'search grow' }, icon('search', 16), h('input', { class: 'input', placeholder: 'Filter output', oninput: W.debounce((e) => { query = e.target.value.toLowerCase(); redraw(); }, 200) })),
          h('button', { class: 'btn', type: 'button', onclick: () => W.copy(lines.filter(match).map((l) => l.text).join('\n')) }, icon('copy', 15), 'Copy'),
          h('button', { class: 'btn', type: 'button', onclick: () => { lines = []; redraw(); } }, 'Clear'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => W.api('shell:open-data', 'logs') }, icon('folder-open', 15), 'Log files')),
        h('div', { class: 'console-wrap' }, out)));
      load();
    },
    unmount() { scope.dispose(); },
  };
})();
