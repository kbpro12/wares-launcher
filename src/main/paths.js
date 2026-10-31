'use strict';
const path = require('path');
const fs = require('fs');

/** Resolved data directories. Populated by init(). */
const P = {};

function init(root) {
  const j = (...p) => path.join(root, ...p);
  Object.assign(P, {
    root,
    shared: j('shared'),
    versions: j('shared', 'versions'),
    libraries: j('shared', 'libraries'),
    assets: j('shared', 'assets'),
    instances: j('instances'),
    runtime: j('runtime'),
    cache: j('cache'),
    installers: j('cache', 'installers'),
    config: j('config'),
    skins: j('skins'),
    wallpapers: j('wallpapers'),
    thumbs: j('cache', 'thumbs'),
    avatars: j('cache', 'avatars'),
    icons: j('cache', 'icons'),
    logs: j('logs'),
    tmp: j('tmp'),
  });
  for (const k of Object.keys(P)) if (k !== 'root') fs.mkdirSync(P[k], { recursive: true });
  return P;
}

module.exports = { P, init };
