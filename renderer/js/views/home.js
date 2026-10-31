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
    return h('section', { class: 'hero' },
      h('div', { class: 'hero-head' },
        W.glyph(p, 'lg'),
        h('div', { class: 'grow' },
          h('h1', { class: 'hero-title ellipsis' }, p.name),
          h('p', { class: 'muted' }, p.loader === 'vanilla' ? `Vanilla Minecraft ${p.mcVersion}` : `${W.loaderName(p.loader)}${p.loaderVersion ? ' ' + p.loaderVersion.replace(`${p.mcVersion}-`, '') : ''} on Minecraft ${p.mcVersion}`),
          h('div', { class: 'row', style: { marginTop: '14px' } },
            h('button', { class: 'btn', onclick: () => W.go('profiles', { edit: p.id }) }, icon('pencil', 15), 'Edit profile'),
            h('button', { class: 'btn', onclick: () => W.go('mods') }, icon('shapes', 15), 'Mods'),
            h('button', { class: 'btn ghost', onclick: () => W.api('shell:open-profile', p.id).catch(W.err) }, icon('folder-open', 15), 'Open folder')))),
      h('dl', { class: 'stats' },
        h('div', null, h('dt', null, 'Last played'), h('dd', null, W.fmt.ago(p.lastPlayed))),
        h('div', null, h('dt', null, 'Time played'), h('dd', null, W.fmt.dur(p.playTime))),
        h('div', null, h('dt', null, 'Active mods'), modsStat),
        h('div', null, h('dt', null, 'Memory'), h('dd', null, p.memory.mode === 'auto' ? 'Auto' : `${(p.memory.max / 1024).toFixed(p.memory.max % 1024 ? 1 : 0)} GB`))));
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
        main.replaceChildren(...[accountBanner(), hero(p), recent()].filter(Boolean));
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
