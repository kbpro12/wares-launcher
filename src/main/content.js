'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { P } = require('./paths');
const zip = require('./zip');
const http = require('./http');
const modrinth = require('./modrinth');

const FOLDERS = modrinth.FOLDERS;
const metaCache = new Map();
let diskLoaded = false;
let diskTimer = null;
const diskFile = () => path.join(P.cache, 'modmeta.json');

function loadDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(diskFile(), 'utf8')))) metaCache.set(k, v); } catch { /* cold cache */ }
}
function saveDisk() {
  clearTimeout(diskTimer);
  diskTimer = setTimeout(() => {
    try {
      const entries = [...metaCache.entries()].slice(-4000);
      fs.writeFileSync(diskFile(), JSON.stringify(Object.fromEntries(entries)));
    } catch { /* cache is optional */ }
  }, 4000);
}
async function iconDataUrl(file) {
  if (!file) return null;
  try { return 'data:image/png;base64,' + (await fsp.readFile(path.join(P.icons, file))).toString('base64'); } catch { return null; }
}
const MAX_ICON = 160 * 1024;

const png = (buf) => (buf && buf.length <= MAX_ICON ? 'data:image/png;base64,' + buf.toString('base64') : null);
const insideDir = (dir, file) => { const r = path.resolve(dir, file); return r.startsWith(path.resolve(dir) + path.sep) ? r : null; };

function fromFilename(name) {
  const m = /[-_+ ](v?\d[\w.+-]*?)(?:\.jar)?(?:\.disabled)?$/i.exec(name.replace(/\.(jar|zip)(\.disabled)?$/i, ''));
  return m ? m[1] : '';
}

function textOf(x) {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(textOf).join('');
  if (typeof x === 'object') return (x.text || '') + (x.extra ? textOf(x.extra) : '') + (x.translate && !x.text ? x.translate : '');
  return String(x);
}

/* ------------------------------------------------------------- mod meta */

function parseToml(t, file) {
  const name = /displayName\s*=\s*"([^"]*)"/.exec(t);
  const ver = /^\s*version\s*=\s*"([^"]*)"/m.exec(t);
  const logo = /logoFile\s*=\s*"([^"]*)"/.exec(t);
  const desc = /description\s*=\s*(?:'''([\s\S]*?)'''|"([^"]*)")/.exec(t);
  const authors = /authors\s*=\s*"([^"]*)"/.exec(t);
  let version = ver ? ver[1] : '';
  if (version.includes('${')) version = fromFilename(file);
  return { name: name && name[1], version, description: desc && (desc[1] || desc[2] || '').trim(), authors: authors ? [authors[1]] : [], logo: logo && logo[1] };
}

async function modMeta(full) {
  const st = await fsp.stat(full);
  loadDisk();
  const key = `${full}|${st.size}|${Math.round(st.mtimeMs)}`;
  if (metaCache.has(key)) return metaCache.get(key);
  const e = await zip.readEntries(full, ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'mcmod.info'], 1 << 20);
  let m = { name: null, version: '', description: '', authors: [], loader: null, logo: null };
  try {
    if (e['fabric.mod.json']) {
      const j = JSON.parse(e['fabric.mod.json'].toString('utf8'));
      const icon = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop();
      m = { name: j.name || j.id, version: j.version, description: j.description, authors: (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name)), loader: 'fabric', logo: icon };
    } else if (e['quilt.mod.json']) {
      const j = JSON.parse(e['quilt.mod.json'].toString('utf8'));
      const ql = j.quilt_loader || {};
      const md = ql.metadata || {};
      const icon = typeof md.icon === 'string' ? md.icon : md.icon && Object.values(md.icon).pop();
      m = { name: md.name || ql.id, version: ql.version, description: md.description, authors: Object.keys(md.contributors || {}), loader: 'quilt', logo: icon };
    } else if (e['META-INF/neoforge.mods.toml'] || e['META-INF/mods.toml']) {
      const isNeo = !!e['META-INF/neoforge.mods.toml'];
      const t = parseToml((e['META-INF/neoforge.mods.toml'] || e['META-INF/mods.toml']).toString('utf8'), path.basename(full));
      m = { ...t, loader: isNeo ? 'neoforge' : 'forge' };
    } else if (e['mcmod.info']) {
      let j = JSON.parse(e['mcmod.info'].toString('utf8'));
      j = Array.isArray(j) ? j[0] : (j.modList || [])[0];
      m = { name: j.name, version: j.version, description: j.description, authors: j.authorList || [], loader: 'forge', logo: j.logoFile };
    }
  } catch { /* unreadable metadata: fall back to filename */ }
  let iconFile = null;
  if (m.logo) {
    const buf = await zip.readEntry(full, String(m.logo).replace(/^\//, ''), MAX_ICON + 1);
    if (buf && buf.length <= MAX_ICON) {
      iconFile = crypto.createHash('sha1').update(key).digest('hex') + '.png';
      try { await fsp.mkdir(P.icons, { recursive: true }); await fsp.writeFile(path.join(P.icons, iconFile), buf); } catch { iconFile = null; }
    }
  }
  const out = { name: m.name || null, version: m.version || fromFilename(path.basename(full)), description: String(m.description || '').slice(0, 300), authors: (m.authors || []).slice(0, 4), loader: m.loader, iconFile };
  metaCache.set(key, out);
  saveDisk();
  return out;
}

/* --------------------------------------------------------- options.txt */

function optionsPath(profile) { return path.join(profile.gameDir, 'options.txt'); }

async function readOptions(profile) {
  try { return await fsp.readFile(optionsPath(profile), 'utf8'); } catch { return ''; }
}

function setOption(text, key, value) {
  const lines = text ? text.split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  const line = `${key}:${value}`;
  if (i >= 0) lines[i] = line; else lines.push(line);
  return lines.filter((l, idx) => l !== '' || idx < lines.length - 1).join('\n') + '\n';
}

async function writeOptions(profile, patch) {
  let t = await readOptions(profile);
  for (const [k, v] of Object.entries(patch)) t = setOption(t, k, v);
  await fsp.mkdir(profile.gameDir, { recursive: true });
  await fsp.writeFile(optionsPath(profile), t);
}

async function activePacks(profile) {
  const t = await readOptions(profile);
  const m = /^resourcePacks:(.*)$/m.exec(t);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

/* ----------------------------------------------------------------- list */

async function listMods(profile, manifest) {
  const dir = path.join(profile.gameDir, 'mods');
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  await http.pool(names.filter((n) => /\.jar(\.disabled)?$/i.test(n)), 8, async (n) => {
    const full = path.join(dir, n);
    const st = await fsp.stat(full);
    const meta = await modMeta(full);
    const enabled = !n.endsWith('.disabled');
    const rel = `mods/${enabled ? n : n.slice(0, -9)}`;
    const mr = manifest.files[rel] || null;
    out.push({
      file: n, enabled, size: st.size, mtime: st.mtimeMs,
      name: (mr && mr.title) || meta.name || n.replace(/\.jar(\.disabled)?$/i, ''),
      version: meta.version, description: meta.description, authors: meta.authors, loader: meta.loader,
      icon: await iconDataUrl(meta.iconFile), iconUrl: mr && mr.icon, modrinth: mr ? { projectId: mr.projectId, slug: mr.slug } : null,
    });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function packMeta(full, isDir) {
  let mcmeta = null;
  let icon = null;
  if (isDir) {
    try { mcmeta = await fsp.readFile(path.join(full, 'pack.mcmeta')); } catch { /* none */ }
    try { const b = await fsp.readFile(path.join(full, 'pack.png')); icon = png(b); } catch { /* none */ }
  } else {
    const e = await zip.readEntries(full, ['pack.mcmeta', 'pack.png'], MAX_ICON + 1);
    mcmeta = e['pack.mcmeta'];
    icon = png(e['pack.png']);
  }
  let description = '';
  let format = null;
  try {
    const j = JSON.parse(mcmeta.toString('utf8').replace(/^\uFEFF/, ''));
    description = textOf(j.pack && j.pack.description).replace(/§./g, '').slice(0, 240);
    format = j.pack && (j.pack.pack_format || j.pack.min_format);
  } catch { /* no metadata */ }
  return { description, format, icon };
}

async function listPacks(profile, type, manifest) {
  const folder = FOLDERS[type];
  const dir = path.join(profile.gameDir, folder);
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return { items: [], active: [] }; }
  const active = type === 'resourcepack' ? await activePacks(profile) : [];
  const activeFiles = active.filter((a) => a.startsWith('file/')).map((a) => a.slice(5));
  const out = [];
  await http.pool(ents.filter((e) => e.isDirectory() || /\.zip$/i.test(e.name)), 6, async (e) => {
    const full = path.join(dir, e.name);
    const st = await fsp.stat(full);
    const meta = await packMeta(full, e.isDirectory());
    const mr = manifest.files[`${folder}/${e.name}`] || null;
    out.push({
      file: e.name, isDir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs,
      name: (mr && mr.title) || e.name.replace(/\.zip$/i, ''), version: mr ? mr.versionNumber : '', description: meta.description,
      format: meta.format, icon: meta.icon, iconUrl: mr && mr.icon, modrinth: mr ? { projectId: mr.projectId, slug: mr.slug } : null,
    });
  });
  let activeShader = null;
  if (type === 'shader') activeShader = await readShaderPack(profile);
  for (const o of out) {
    if (type === 'resourcepack') o.activeIndex = activeFiles.indexOf(o.file);
    if (type === 'shader') o.active = activeShader === o.file;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  // Active resource packs: top of the list is highest priority (last in options.txt).
  const order = activeFiles.slice().reverse();
  return { items: out, active: order };
}

async function list(profile, type) {
  const manifest = await modrinth.readManifest(profile);
  if (type === 'mod') return { items: await listMods(profile, manifest), active: [] };
  return listPacks(profile, type, manifest);
}

/* --------------------------------------------------------------- actions */

async function toggleMod(profile, file, enable) {
  const dir = path.join(profile.gameDir, 'mods');
  const src = insideDir(dir, file);
  if (!src) throw new Error('Invalid file.');
  const isOff = file.endsWith('.disabled');
  if (enable === isOff) await fsp.rename(src, isOff ? src.slice(0, -9) : src + '.disabled');
}

async function remove(profile, type, file) {
  const dir = path.join(profile.gameDir, FOLDERS[type]);
  const target = insideDir(dir, file);
  if (!target) throw new Error('Invalid file.');
  await fsp.rm(target, { recursive: true, force: true });
  const m = await modrinth.readManifest(profile);
  const key = `${FOLDERS[type]}/${file.replace(/\.disabled$/, '')}`;
  if (m.files[key]) { delete m.files[key]; await modrinth.writeManifest(profile, m); }
  if (type === 'resourcepack') {
    const act = (await activePacks(profile)).filter((a) => a !== `file/${file}`);
    if (await readOptions(profile)) await writeOptions(profile, { resourcePacks: JSON.stringify(act) });
  }
}

async function addFiles(profile, type, files) {
  const dir = path.join(profile.gameDir, FOLDERS[type]);
  await fsp.mkdir(dir, { recursive: true });
  const ok = type === 'mod' ? /\.jar$/i : /\.zip$/i;
  const added = [];
  for (const f of files) {
    const name = path.basename(f);
    if (!ok.test(name)) continue;
    await fsp.copyFile(f, path.join(dir, name));
    added.push(name);
  }
  return added;
}

/** Set the active resource packs. `names` are pack files, highest priority first. */
async function setActivePacks(profile, names) {
  const current = await activePacks(profile);
  const builtin = current.filter((a) => !a.startsWith('file/'));
  const base = builtin.length ? builtin : ['vanilla'];
  const next = [...base, ...names.slice().reverse().map((n) => `file/${n}`)];
  await writeOptions(profile, { resourcePacks: JSON.stringify(next) });
}

/* ---------------------------------------------------------------- shaders */

function readProps(text) {
  const o = {};
  for (const l of (text || '').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return o;
}

async function readShaderPack(profile) {
  for (const f of [path.join(profile.gameDir, 'config', 'iris.properties'), path.join(profile.gameDir, 'optionsshaders.txt')]) {
    try {
      const v = readProps(await fsp.readFile(f, 'utf8')).shaderPack;
      if (v && v !== '(internal)' && v !== 'OFF') return v;
    } catch { /* try next */ }
  }
  return null;
}

async function setShaderPack(profile, name) {
  const writeProp = async (file, patch) => {
    let t = '';
    try { t = await fsp.readFile(file, 'utf8'); } catch { /* new file */ }
    const o = readProps(t);
    Object.assign(o, patch);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  };
  await writeProp(path.join(profile.gameDir, 'config', 'iris.properties'), { shaderPack: name || '', enableShaders: name ? 'true' : 'false' });
  await writeProp(path.join(profile.gameDir, 'optionsshaders.txt'), { shaderPack: name || 'OFF' });
}

module.exports = { list, toggleMod, remove, addFiles, setActivePacks, setShaderPack, writeOptions, readOptions };
