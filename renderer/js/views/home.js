/* Home: current profile, recent play, Minecraft news. */
(function () {
  'use strict';
  const W = window.W;
  const { h, icon } = W;
  const S = W.state;
  let scope;
  let newsCache = null;

  function hero(p) {
    if (!p) {
      return h('section', { class: 'hero' }, W.empty('layers', 'No profiles yet', 'A profile is a Minecraft version with its own mods, packs and settings.',
        h('button', { class: 'btn primary', onclick: () => W.go('profiles', { create: true }) }, icon('plus', 16), 'Create a profile'),
        h('button', { class: 'btn', onclick: () => W.go('profiles', { presets: true }) }, icon('zap', 16), 'Start from a preset')));
    }
    const modsStat = h('dd', null, '-');
    W.api('content:list', p.id, 'mod').then((r) => { modsStat.textContent = r.items.filter((m) => m.enabled).length; }).catch(() => { modsStat.textContent = '0'; });
    const running = S.running.has(p.id);
    const loaderText = p.loader === 'vanilla' ? 'Vanilla' : `${W.loaderName(p.loader)}${p.loaderVersion ? ' ' + p.loaderVersion.replace(`${p.mcVersion}-`, '') : ''}`;
    return h('section', { class: 'hero' },
      h('div', { class: 'hero-head' },
        W.glyph(p, 'lg'),
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('h1', { class: 'hero-title ellipsis' }, p.name),
          h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } },
            h('span', { class: 'badge accent' }, loaderText), h('span', { class: 'badge' }, `Minecraft ${p.mcVersion}`),
            h('span', { class: 'badge' }, p.memory.mode === 'auto' ? 'Auto memory' : `${(p.memory.max / 1024).toFixed(p.memory.max % 1024 ? 1 : 0)} GB`),
            running && h('span', { class: 'badge ok' }, 'Running'))),
        h('div', { class: 'hero-actions' },
          h('button', { class: `btn ${running ? 'danger' : 'primary'} lg-btn`, type: 'button', onclick: () => (running ? W.api('game:stop', p.id) : W.play(p.id)) }, icon(running ? 'square' : 'play', 17), running ? 'Stop' : 'Play'))),
      h('div', { class: 'hero-foot' },
        h('dl', { class: 'stats' },
          h('div', null, h('dt', null, 'Last played'), h('dd', null, W.fmt.ago(p.lastPlayed))),
          h('div', null, h('dt', null, 'Time played'), h('dd', null, W.fmt.dur(p.playTime))),
          h('div', null, h('dt', null, 'Active mods'), modsStat)),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => W.go('profiles', { edit: p.id }) }, icon('pencil', 14), 'Edit'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => W.go('mods') }, icon('shapes', 14), 'Mods'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => W.api('shell:open-profile', p.id).catch(W.err) }, icon('folder-open', 14), 'Folder'))));
  }

  function recent() {
    const list = S.profiles.filter((p) => p.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    if (!list.length) return null;
    return h('section', { class: 'block' },
      h('h2', { class: 'h2' }, 'Recently played'),
      h('div', { class: 'list sheet panel' }, list.map((p) => h('div', { class: 'li' },
        W.glyph(p),
        h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `${W.profileLine(p)}  ${W.fmt.ago(p.lastPlayed)}`)),
        h('button', { class: 'btn sm', onclick: () => { W.selectProfile(p.id); W.play(p.id); }, disabled: S.running.has(p.id) }, icon('play', 14), 'Play')))));
  }

  function quick() {
    const tiles = [
      ['Browse mods', 'shapes', 'Find and install from Modrinth', () => W.go('mods')],
      ['Resource packs', 'image', 'Change how the game looks', () => W.go('resourcepacks')],
      ['Presets', 'zap', 'Tuned profiles in one click', () => W.go('profiles', { presets: true })],
      ['Skins & capes', 'paintbrush', 'Preview and apply skins', () => W.go('skins')],
    ];
    return h('section', { class: 'block' }, h('h2', { class: 'h2' }, 'Quick start'),
      h('div', { class: 'quick' }, tiles.map(([t, ic, d, fn]) => h('button', { class: 'qtile', type: 'button', onclick: fn }, h('span', { class: 'qicon' }, icon(ic, 20)), h('b', null, t), h('span', { class: 'muted' }, d)))));
  }

  function accountBanner() {
    if (W.activeAccount()) return null;
    return h('section', { class: 'notice' },
      icon('circle-user-round', 26),
      h('div', { class: 'grow' }, h('b', null, 'Add an account to play'), h('p', { class: 'muted' }, 'Sign in with Microsoft, or create an offline account for LAN and cracked servers.')),
      h('button', { class: 'btn primary', onclick: () => W.go('accounts') }, 'Add account'));
  }

  function newsItem(n, big) {
    const link = `https://minecraft.wiki/w/Java_Edition_${encodeURIComponent(n.version.replace(/ /g, '_'))}`;
    return h('a', { class: `news${big ? ' big' : ''}`, href: link, title: 'Open patch notes' },
      n.image ? h('img', { src: n.image, alt: '', loading: 'lazy' }) : h('div', { class: 'img-ph' }, icon('image', 24)),
      h('div', { class: 'news-t' }, h('b', null, n.title), h('span', { class: 'dim' }, `${n.type === 'snapshot' ? 'Snapshot' : 'Release'} ${n.version}`)),
      big && h('p', { class: 'muted clamp2', style: { fontSize: '12.5px' } }, n.summary));
  }

  async function loadNews(host) {
    try {
      newsCache = newsCache || await W.api('news:get');
      host.replaceChildren(...newsCache.slice(0, 7).map((n, i) => newsItem(n, i === 0)));
    } catch {
      host.replaceChildren(h('p', { class: 'muted' }, 'News is unavailable while offline.'));
    }
  }

  W.views.home = {
    mount(page) {
      scope = W.bus.scope();
      const main = h('div', { class: 'home-main' });
      const newsHost = h('div', { class: 'news-list' }, W.skeletons(3));
      const render = () => {
        const p = W.activeProfile();
        main.replaceChildren(...[accountBanner(), hero(p), recent(), quick()].filter(Boolean));
      };
      render();
      scope.on('profiles', render);
      scope.on('running', render);
      scope.on('accounts', render);
      page.append(h('div', { class: 'home' }, main,
        h('aside', { class: 'home-side' }, h('h2', { class: 'h2' }, 'Minecraft news'), newsHost)));
      loadNews(newsHost);
    },
    unmount() { scope.dispose(); },
  };
})();
