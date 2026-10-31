'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
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
  p.memory = { mode: 'auto', max: 4096, min: 512, ...(p.memory || {}) };
  p.memory.max = Math.max(512, Math.round(+p.memory.max || 4096));
  p.memory.min = Math.max(0, Math.min(Math.round(+p.memory.min || 0), p.memory.max));
  p.jvmPreset = ['auto', 'default', 'balanced', 'zgc', 'lowmem'].includes(p.jvmPreset) ? p.jvmPreset : 'auto';
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
  if (deleteFiles && p.gameDir.startsWith(P.instances + path.sep)) await fsp.rm(p.gameDir, { recursive: true, force: true });
}

async function duplicate(id, withFiles) {
  const src = get(id);
  if (!src) throw new Error('Profile not found.');
  const copy = { ...src, id: undefined, name: `${src.name} copy`, gameDir: null, lastPlayed: null, playTime: 0, created: Date.now() };
  const p = save(copy);
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

module.exports = { init, list, get, save, touch, remove, duplicate, recordPlay, ensureDefault, normalize };
