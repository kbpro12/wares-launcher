'use strict';
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { safeStorage } = require('electron');
const { P } = require('./paths');
const { Store } = require('./store');
const http = require('./http');

let store;
/** In-memory Minecraft sessions: accountId -> msmc Minecraft object. */
const sessions = new Map();

const AUTH_ERRORS = {
  'error.gui.closed': 'The sign-in window was closed before login finished.',
  'error.auth.xsts.userNotFound': 'This Microsoft account has no Xbox profile. Sign in at xbox.com once to create one, then try again.',
  'error.auth.xsts.bannedCountry': 'Xbox Live is not available in the country of this Microsoft account.',
  'error.auth.xsts.child': 'This is a child account. An adult must add it to a Microsoft family group first.',
  'error.auth.minecraft.profile': 'This Microsoft account does not own Minecraft: Java Edition, or no profile has been created yet.',
  'error.auth.minecraft.entitlements': 'Could not verify that this account owns Minecraft: Java Edition.',
  'error.auth.minecraft.login': 'Mojang rejected the login. Try again in a minute.',
  'error.auth.microsoft': 'Microsoft sign-in failed.',
  'error.gui.raw.noBrowser': 'No Chromium-based browser (Chrome, Edge, Brave) was found. Use the in-app window instead.',
};

function friendly(e) {
  const code = typeof e === 'string' ? e : (e && e.message) || '';
  const hit = Object.keys(AUTH_ERRORS).sort((a, b) => b.length - a.length).find((k) => code.startsWith(k));
  return new Error(hit ? AUTH_ERRORS[hit] : (code || 'Sign-in failed.'));
}

function init() {
  store = new Store(path.join(P.config, 'accounts.json'), { accounts: [], active: null });
}

/* ------------------------------------------------------- secret storage */

function seal(s) {
  if (!s) return null;
  if (safeStorage.isEncryptionAvailable()) return { enc: true, v: safeStorage.encryptString(s).toString('base64') };
  return { enc: false, v: Buffer.from(s).toString('base64') };
}
function unseal(o) {
  if (!o) return null;
  try {
    const buf = Buffer.from(o.v, 'base64');
    return o.enc ? safeStorage.decryptString(buf) : buf.toString();
  } catch { return null; }
}

/* ------------------------------------------------------------- accounts */

function publicView(a) {
  return { id: a.id, type: a.type, name: a.name, uuid: a.uuid, addedAt: a.addedAt, lastUsed: a.lastUsed || null, sessionOk: a.type === 'offline' ? true : !!a.token, localSkin: a.localSkin || null };
}

function list() {
  const d = store.get();
  return { accounts: d.accounts.map(publicView), active: d.active };
}

function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function addOffline(name) {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) throw new Error('Usernames use 3-16 letters, numbers or underscores.');
  const d = store.get();
  if (d.accounts.some((a) => a.type === 'offline' && a.name.toLowerCase() === n.toLowerCase())) throw new Error('That offline account already exists.');
  const acc = { id: crypto.randomUUID(), type: 'offline', name: n, uuid: offlineUuid(n), addedAt: Date.now() };
  store.patch({ accounts: [...d.accounts, acc], active: d.active || acc.id });
  return publicView(acc);
}

/** Sign in with Microsoft. method: 'window' (in-app popup) or 'browser' (system Chromium). */
async function addMicrosoft(method = 'window') {
  const { Auth } = require('msmc');
  const auth = new Auth('select_account');
  let xbox;
  try {
    xbox = method === 'browser'
      ? await auth.launch('raw', { width: 520, height: 720, suppress: true })
      : await auth.launch('electron', { width: 520, height: 720, resizable: false, title: 'Sign in to Microsoft', autoHideMenuBar: true, backgroundColor: '#25282c' });
    const mc = await xbox.getMinecraft();
    if (!mc.profile || mc.isDemo()) throw new Error('error.auth.minecraft.profile');
    const d = store.get();
    const existing = d.accounts.find((a) => a.type === 'microsoft' && a.uuid === mc.profile.id);
    const acc = existing || { id: crypto.randomUUID(), type: 'microsoft', addedAt: Date.now() };
    acc.name = mc.profile.name;
    acc.uuid = mc.profile.id;
    acc.token = seal(xbox.save());
    sessions.set(acc.id, mc);
    store.patch({ accounts: existing ? d.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...d.accounts, acc], active: acc.id });
    return publicView(acc);
  } catch (e) {
    throw friendly(e);
  }
}

function setActive(id) {
  if (!store.get().accounts.some((a) => a.id === id)) throw new Error('Account not found.');
  store.patch({ active: id });
}

function remove(id) {
  const d = store.get();
  const accounts = d.accounts.filter((a) => a.id !== id);
  sessions.delete(id);
  store.set({ accounts, active: d.active === id ? (accounts[0] && accounts[0].id) || null : d.active });
}

/** Valid Minecraft session for a Microsoft account, refreshing tokens when needed. */
async function session(id) {
  const d = store.get();
  const acc = d.accounts.find((a) => a.id === id);
  if (!acc || acc.type !== 'microsoft') throw new Error('Not a Microsoft account.');
  let mc = sessions.get(id);
  if (mc && mc.validate()) return mc;
  const { Auth } = require('msmc');
  const token = unseal(acc.token);
  if (!token) throw new Error('This account needs to sign in again.');
  try {
    const xbox = await new Auth('select_account').refresh(token);
    mc = await xbox.getMinecraft();
    acc.token = seal(xbox.save());
    acc.name = mc.profile.name;
    store.patch({ accounts: d.accounts.map((a) => (a.id === id ? acc : a)) });
    sessions.set(id, mc);
    return mc;
  } catch (e) {
    acc.token = null;
    store.patch({ accounts: d.accounts.map((a) => (a.id === id ? acc : a)) });
    throw new Error('Your Microsoft session expired. Sign in again from Accounts.');
  }
}

/** Auth block consumed by the launch engine. */
async function getAuth(id) {
  const acc = store.get().accounts.find((a) => a.id === id);
  if (!acc) throw new Error('No account selected. Add one in Accounts.');
  store.patch({ accounts: store.get().accounts.map((a) => (a.id === id ? { ...a, lastUsed: Date.now() } : a)) });
  if (acc.type === 'offline') return { type: 'offline', name: acc.name, uuid: acc.uuid.replace(/-/g, ''), accessToken: '0' };
  const mc = await session(id);
  const m = mc.mclc();
  return { type: 'microsoft', name: m.name, uuid: m.uuid, accessToken: m.access_token, xuid: m.meta && m.meta.xuid, clientId: m.client_token };
}

/* ------------------------------------------------- skins and capes API */

const MCS = 'https://api.minecraftservices.com/minecraft/profile';

async function mcFetch(id, url, init = {}) {
  const mc = await session(id);
  const res = await http.request(url, { ...init, headers: { Authorization: `Bearer ${mc.mcToken}`, ...(init.headers || {}) } });
  if (!res.ok) {
    let msg = `Request failed (HTTP ${res.status}).`;
    try { const j = await res.json(); msg = j.errorMessage || j.error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res;
}

async function textureDataUrl(url) {
  if (!url || !/^https?:\/\/textures\.minecraft\.net\//.test(url)) return null;
  const res = await http.request(url);
  if (!res.ok) return null;
  return 'data:image/png;base64,' + Buffer.from(await res.arrayBuffer()).toString('base64');
}

/** Current skin + owned capes of a Microsoft account. */
async function profileOf(id) {
  const res = await mcFetch(id, MCS);
  const p = await res.json();
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE') || null;
  const capes = [];
  for (const c of p.capes || []) capes.push({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE', image: await textureDataUrl(c.url) });
  return { name: p.name, uuid: p.id, skin: skin ? { variant: String(skin.variant || 'CLASSIC').toLowerCase(), image: await textureDataUrl(skin.url) } : null, capes };
}

async function uploadSkin(id, file, variant) {
  const buf = fs.readFileSync(file);
  if (buf.length > 24 * 1024) throw new Error('Skin files must be smaller than 24 KB.');
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  await mcFetch(id, MCS + '/skins', { method: 'POST', body: form });
  const acc = store.get().accounts.find((a) => a.id === id);
  if (acc) dropAvatarCache(acc.uuid);
}

async function setCape(id, capeId) {
  if (!capeId) await mcFetch(id, MCS + '/capes/active', { method: 'DELETE' });
  else await mcFetch(id, MCS + '/capes/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) });
}

/** Look up any Java player's public skin by name. */
async function lookup(name) {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) throw new Error('Enter a valid Minecraft username.');
  const a = await http.json(`https://api.mojang.com/users/profiles/minecraft/${n}`, { ttl: 30 * 60e3 }).catch(() => null);
  if (!a || !a.id) throw new Error(`No Java Edition player named ${n}.`);
  return textures(a.id, a.name);
}

async function textures(uuid, name) {
  const p = await http.json(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`, { ttl: 30 * 60e3 });
  const prop = (p.properties || []).find((x) => x.name === 'textures');
  const t = prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString()).textures || {} : {};
  return {
    name: name || p.name,
    uuid: p.id,
    skin: t.SKIN ? { variant: t.SKIN.metadata && t.SKIN.metadata.model === 'slim' ? 'slim' : 'classic', image: await textureDataUrl(t.SKIN.url) } : null,
    cape: t.CAPE ? await textureDataUrl(t.CAPE.url) : null,
  };
}

/* ----------------------------------------------------------- avatar cache */

const avatarFile = (uuid) => path.join(P.avatars, `${uuid.replace(/-/g, '')}.json`);
function readAvatarCache(uuid) { try { return JSON.parse(fs.readFileSync(avatarFile(uuid), 'utf8')); } catch { return null; } }
function writeAvatarCache(uuid, skin) {
  try { fs.mkdirSync(P.avatars, { recursive: true }); fs.writeFileSync(avatarFile(uuid), JSON.stringify({ ...skin, t: Date.now() })); } catch { /* optional */ }
}
function dropAvatarCache(uuid) { try { fs.rmSync(avatarFile(uuid), { force: true }); } catch { /* ignore */ } }

/**
 * Skin used to draw an account's head. Returns { variant, image } or null (the UI then shows the default Steve head).
 * Microsoft accounts: fresh from Mojang, cached on disk for offline starts.
 * Offline accounts: the local skin chosen in Skins & capes, if any.
 */
async function avatarTexture(id, fresh = false) {
  const acc = store.get().accounts.find((a) => a.id === id);
  if (!acc) return null;
  if (acc.type === 'offline') {
    if (!acc.localSkin) return null;
    try {
      const s = libraryPath(acc.localSkin);
      return { variant: s.variant, image: 'data:image/png;base64,' + fs.readFileSync(s.file).toString('base64') };
    } catch { return null; }
  }
  const cached = readAvatarCache(acc.uuid);
  if (cached && !fresh && Date.now() - cached.t < 6 * 3600e3) return { variant: cached.variant, image: cached.image };
  try {
    const p = await profileOf(id);
    if (p.skin && p.skin.image) { writeAvatarCache(acc.uuid, p.skin); return p.skin; }
    if (!p.skin) { dropAvatarCache(acc.uuid); return null; }
  } catch { /* fall through to public lookup */ }
  try {
    const t = await textures(acc.uuid, acc.name);
    if (t.skin && t.skin.image) { writeAvatarCache(acc.uuid, t.skin); return t.skin; }
  } catch { /* offline */ }
  return cached ? { variant: cached.variant, image: cached.image } : null;
}

/** Offline accounts: remember which library skin to show as the account's head in the launcher. */
function setLocalSkin(id, libId) {
  const d = store.get();
  const acc = d.accounts.find((a) => a.id === id);
  if (!acc || acc.type !== 'offline') throw new Error('Only offline accounts use a local skin.');
  if (libId) libraryPath(libId);
  store.patch({ accounts: d.accounts.map((a) => (a.id === id ? { ...a, localSkin: libId || null } : a)) });
}

/* --------------------------------------------------- local skin library */

function libraryFile() { return path.join(P.skins, 'library.json'); }
function readLibrary() { try { return JSON.parse(fs.readFileSync(libraryFile(), 'utf8')); } catch { return []; } }

function libraryList() {
  return readLibrary().map((s) => {
    let image = null;
    try { image = 'data:image/png;base64,' + fs.readFileSync(path.join(P.skins, s.file)).toString('base64'); } catch { /* missing file */ }
    return { ...s, image };
  });
}

function libraryAdd({ name, variant, dataUrl }) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Skins must be PNG images.');
  const id = crypto.randomUUID();
  const file = `${id}.png`;
  fs.writeFileSync(path.join(P.skins, file), Buffer.from(m[1], 'base64'));
  const lib = readLibrary();
  lib.push({ id, name: String(name || 'Skin').slice(0, 40), variant: variant === 'slim' ? 'slim' : 'classic', file, added: Date.now() });
  fs.writeFileSync(libraryFile(), JSON.stringify(lib));
  return id;
}

function libraryRemove(id) {
  const lib = readLibrary();
  const s = lib.find((x) => x.id === id);
  if (s) fs.rmSync(path.join(P.skins, s.file), { force: true });
  fs.writeFileSync(libraryFile(), JSON.stringify(lib.filter((x) => x.id !== id)));
}

function libraryPath(id) {
  const s = readLibrary().find((x) => x.id === id);
  if (!s) throw new Error('Skin not found.');
  return { file: path.join(P.skins, s.file), variant: s.variant };
}

module.exports = {
  init, list, addOffline, addMicrosoft, setActive, remove, getAuth, offlineUuid,
  profileOf, uploadSkin, setCape, lookup, avatarTexture, setLocalSkin,
  libraryList, libraryAdd, libraryRemove, libraryPath,
};
