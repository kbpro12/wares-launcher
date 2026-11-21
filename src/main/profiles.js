'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { P } = require('./paths');
const { Store } = require('./store');
const versions = require('./versions');

let store;

function init() {
  store = new Store(path.join(P.config, 'profiles.json'), { profiles: [] });
}

const slug = (s) => String(s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'profile';

function normalize(input, prev = {}) {
  const id = prev.id || input.id || crypto.randomBytes(5).toString('hex');
  const p = { ...prev, ...input, id };
  p.name = String(p.name || 'New profile').trim().slice(0, 48) || 'New profile';
  if (!versions.LOADERS.includes(p.loader)) p.loader = 'vanilla';
  if (!p.mcVersion) throw new Error('Choose a Minecraft version.');
  p.loaderVersion = p.loaderVersion || null;
  p.icon = { glyph: 'box', color: '#8a95a3', ...(p.icon || {}) };
  delete p.icon.url;
  delete p.icon.imageData;
  p.memory = { mode: 'auto', max: 4096, min: 512, ...(p.memory || {}) };
  p.memory.max = Math.max(512, Math.round(+p.memory.max || 4096));
  p.memory.min = Math.max(0, Math.min(Math.round(+p.memory.min || 0), p.memory.max));
  p.jvmPreset = ['auto', 'default', 'fps', 'balanced', 'zgc', 'lowmem'].includes(p.jvmPreset) ? p.jvmPreset : 'auto';
  p.jvmArgs = String(p.jvmArgs || '').slice(0, 2000);
  p.javaPath = p.javaPath || null;
  p.resolution = { width: 0, height: 0, fullscreen: false, ...(p.resolution || {}) };
  p.serverJoin = String(p.serverJoin || '').trim();
  p.notes = String(p.notes || '').slice(0, 1000);
  p.created = p.created || Date.now();
  p.lastPlayed = p.lastPlayed || null;
  p.playTime = p.playTime || 0;
  if (!p.gameDir) p.gameDir = path.join(P.instances, `${slug(p.name)}-${id.slice(0, 4)}`);
  p.gameDir = path.resolve(p.gameDir);
  return p;
}

function list() { return store.get().profiles; }

const iconFile = (name) => path.join(P.profileIcons, name);

/** Copy of a profile that is safe to send to the UI: adds a file URL for a custom icon image. */
function decorate(p) {
  if (!p.icon || !p.icon.image) return p;
  let v = p.icon.v || 0;
  try { v = Math.round(fs.statSync(iconFile(p.icon.image)).mtimeMs); } catch { return { ...p, icon: { ...p.icon, image: null } }; }
  return { ...p, icon: { ...p.icon, url: pathToFileURL(iconFile(p.icon.image)).href + `?v=${v}` } };
}

/** Store a custom icon (a square PNG data URL prepared by the UI). */
function setIcon(id, dataUrl) {
  const p = get(id);
  if (!p) throw new Error('Profile not found.');
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Icons must be PNG images.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 900 * 1024) throw new Error('That icon is too large.');
  fs.mkdirSync(P.profileIcons, { recursive: true });
  const name = `${id}.png`;
  fs.writeFileSync(iconFile(name), buf);
  touch(id, { icon: { ...p.icon, image: name, v: Date.now() } });
  return decorate(get(id));
}

function clearIcon(id) {
  const p = get(id);
  if (!p) return null;
  if (p.icon && p.icon.image) fs.rmSync(iconFile(p.icon.image), { force: true });
  touch(id, { icon: { ...p.icon, image: null, v: 0 } });
  return decorate(get(id));
}
function get(id) { return list().find((p) => p.id === id) || null; }

function save(input) {
  const prev = input.id ? get(input.id) : null;
  const p = normalize(input, prev || {});
  fs.mkdirSync(p.gameDir, { recursive: true });
  for (const d of ['mods', 'resourcepacks', 'shaderpacks', 'saves']) fs.mkdirSync(path.join(p.gameDir, d), { recursive: true });
  // Changing version or loader invalidates the cached loader install.
  if (prev && (prev.mcVersion !== p.mcVersion || prev.loader !== p.loader || prev.loaderVersion !== p.loaderVersion)) {
    p.loaderInstalledId = null;
    p.loaderInstalledFor = null;
  }
  const all = list();
  store.patch({ profiles: prev ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p] });
  return p;
}

/** Update fields internally without validation churn (launcher bookkeeping). */
function touch(id, patch) {
  const p = get(id);
  if (!p) return;
  store.patch({ profiles: list().map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

async function remove(id, deleteFiles) {
  const p = get(id);
  if (!p) return;
  store.patch({ profiles: list().filter((x) => x.id !== id) });
  if (p.icon && p.icon.image) fs.rmSync(iconFile(p.icon.image), { force: true });
  if (deleteFiles && p.gameDir.startsWith(P.instances + path.sep)) await fsp.rm(p.gameDir, { recursive: true, force: true });
}

async function duplicate(id, withFiles) {
  const src = get(id);
  if (!src) throw new Error('Profile not found.');
  const copy = { ...src, id: undefined, name: `${src.name} copy`, gameDir: null, lastPlayed: null, playTime: 0, created: Date.now() };
  const p = save(copy);
  if (src.icon && src.icon.image) {
    try { fs.copyFileSync(iconFile(src.icon.image), iconFile(`${p.id}.png`)); touch(p.id, { icon: { ...p.icon, image: `${p.id}.png`, v: Date.now() } }); } catch { /* icon is optional */ }
  }
  if (withFiles) await fsp.cp(src.gameDir, p.gameDir, { recursive: true, force: false, errorOnExist: false });
  return p;
}

function recordPlay(id, seconds) {
  const p = get(id);
  if (p) touch(id, { lastPlayed: Date.now(), playTime: (p.playTime || 0) + Math.max(0, Math.round(seconds)) });
}

async function ensureDefault() {
  if (list().length) return;
  try {
    const m = await versions.minecraft();
    save({ name: 'Latest release', mcVersion: m.latest.release, loader: 'vanilla', icon: { glyph: 'box', color: '#6fa3e0' } });
  } catch { /* offline first run: user creates one later */ }
}

module.exports = { init, list, get, decorate, setIcon, clearIcon, save, touch, remove, duplicate, recordPlay, ensureDefault, normalize };
