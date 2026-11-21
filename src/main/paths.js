'use strict';
const path = require('path');
const fs = require('fs');

/** Resolved data directories. Populated by init(). */
const P = {};
let ROOT = null;

/**
 * root: Electron userData (settings, accounts, caches, logs).
 * dataRoot: optional separate location for the big game data (versions, libraries, assets, instances, Java).
 */
function init(root, dataRoot) {
  ROOT = root;
  const data = dataRoot || root;
  const j = (...p) => path.join(root, ...p);
  const d = (...p) => path.join(data, ...p);
  Object.assign(P, {
    root,
    dataRoot: data,
    shared: d('shared'),
    versions: d('shared', 'versions'),
    libraries: d('shared', 'libraries'),
    assets: d('shared', 'assets'),
    instances: d('instances'),
    runtime: d('runtime'),
    cache: j('cache'),
    installers: j('cache', 'installers'),
    config: j('config'),
    skins: j('skins'),
    wallpapers: j('wallpapers'),
    profileIcons: j('profile-icons'),
    thumbs: j('cache', 'thumbs'),
    avatars: j('cache', 'avatars'),
    icons: j('cache', 'icons'),
    logs: j('logs'),
    tmp: j('tmp'),
  });
  for (const k of Object.keys(P)) if (k !== 'root' && k !== 'dataRoot') fs.mkdirSync(P[k], { recursive: true });
  return P;
}

/** Custom game-data folder chosen in setup, or null for the default. */
function readLocation(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, 'config', 'location.json'), 'utf8')).dataRoot;
    return v && path.isAbsolute(v) ? v : null;
  } catch { return null; }
}

/** Point the big game data at another folder. New downloads go there; existing files are not moved. */
function setDataRoot(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('Choose a full folder path.');
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'config', 'location.json'), JSON.stringify({ dataRoot: dir }));
  init(ROOT, dir);
  return dir;
}

/** Free bytes on the drive that holds `dir` (walks up to the nearest existing folder). */
async function freeSpace(dir) {
  let p = path.resolve(dir || P.dataRoot);
  while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
  try { const st = await fs.promises.statfs(p); return st.bavail * st.bsize; } catch { return null; }
}

module.exports = { P, init, readLocation, setDataRoot, freeSpace };
