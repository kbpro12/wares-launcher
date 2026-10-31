'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');
const { P } = require('./paths');
const http = require('./http');
const settings = require('./settings');
const profiles = require('./profiles');
const accounts = require('./accounts');
const versions = require('./versions');
const javaMod = require('./java');
const launcher = require('./launcher');
const modrinth = require('./modrinth');
const content = require('./content');
const modpacks = require('./modpacks');
const presets = require('./presets');
const jobs = require('./jobs');
const perf = require('./perf');
const updater = require('./updater');
const wallpapers = require('./wallpapers');
const game = require('./game');

let win = null;
const setWindow = (w) => { win = w; };
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

/** Register an invokable channel. Errors are returned, never thrown across IPC. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) {
      if (!e || !e.message || !/cancel/i.test(e.message)) console.error(`[ipc] ${channel}:`, e && e.message);
      let msg = (e && e.message) || String(e);
      if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) msg = 'Could not reach the server. Check your internet connection and try again.';
      return { ok: false, error: msg, code: e && e.code };
    }
  });
}

function profileOrThrow(id) {
  const p = profiles.get(id);
  if (!p) throw new Error('Profile not found.');
  return p;
}

function register() {
  jobs.setSender(send);
  perf.setSender(send);
  updater.setSender(send);
  launcher.setNotifier((ch, payload) => {
    send(ch, payload);
    if (ch !== 'game:state' || !win || win.isDestroyed()) return;
    if (payload.state === 'running' && settings.get().game.onLaunch === 'minimize') win.minimize();
    if (payload.state === 'closed' && win.isMinimized()) win.restore();
  });

  /* ---- app / window */
  handle('app:info', () => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron,
    totalMem: Math.floor(os.totalmem() / 1048576), cpus: os.cpus().length, dataDir: P.root, author: 'VisdomXD',
  }));
  handle('win:minimize', () => win && win.minimize());
  handle('win:maximize', () => { if (!win) return false; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
  handle('win:close', () => win && win.close());
  handle('win:is-maximized', () => !!(win && win.isMaximized()));

  handle('shell:external', (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.');
    return shell.openExternal(url);
  });
  handle('shell:open-data', (which) => {
    fs.mkdirSync(P.wallpapers, { recursive: true });
    const map = { root: P.root, logs: P.logs, instances: P.instances, wallpapers: P.wallpapers, bundled: wallpapers.bundledDir() };
    if (!map[which]) throw new Error('Unknown folder.');
    return shell.openPath(map[which]);
  });
  handle('shell:open-profile', (id, sub) => {
    const p = profileOrThrow(id);
    const target = sub ? path.resolve(p.gameDir, sub) : p.gameDir;
    if (target !== p.gameDir && !target.startsWith(p.gameDir + path.sep)) throw new Error('Invalid path.');
    fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });
  handle('dialog:folder', async (title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:files', async ({ title, filters, multi } = {}) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose files', properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    return r.canceled ? [] : r.filePaths;
  });

  /* ---- settings */
  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => settings.patch(patch));

  /* ---- wallpapers */
  handle('bg:list', () => wallpapers.list());
  handle('bg:thumb', (id) => wallpapers.thumb(id));
  handle('bg:url', (id) => wallpapers.resolve(id || settings.get().background.wallpaper));
  handle('bg:add', async (files) => {
    const ids = await wallpapers.add(files);
    if (!ids.length) throw new Error('Choose PNG, JPG, WebP, GIF, AVIF, MP4 or WebM files.');
    return ids;
  });
  handle('bg:remove', async (id) => {
    await wallpapers.remove(id);
    if (settings.get().background.wallpaper === id) settings.patch({ background: { wallpaper: null, mode: 'preset' } });
  });

  /* ---- versions */
  handle('versions:minecraft', () => versions.minecraft());
  handle('versions:supported', async (loader) => { const s = await versions.supportedGameVersions(loader); return s ? [...s] : null; });
  handle('versions:loader', async (loader, mc) => versions.loaderVersions(loader, mc));
  handle('java:list', (force) => javaMod.list(!!force));
  handle('java:install', (major) => {
    const job = jobs.create(`Installing Java ${major}`, { kind: 'java' });
    const comp = javaMod.COMPONENT_BY_MAJOR[major];
    (comp ? javaMod.installMojang(comp, (p) => job.update({ stage: 'Downloading', text: `${(p.current / 1048576).toFixed(0)} of ${(p.total / 1048576).toFixed(0)} MB`, total: p.total, current: p.current }), job.signal) : javaMod.install(major, (t) => job.update({ stage: t, indeterminate: true }), job.signal))
      .then(() => job.done('Installed'))
      .catch((e) => job.fail(e));
    return job.id;
  });

  /* ---- profiles */
  handle('profiles:list', () => profiles.list());
  handle('profiles:save', (p) => profiles.save(p));
  handle('profiles:delete', (id, files) => profiles.remove(id, !!files));
  handle('profiles:duplicate', (id, files) => profiles.duplicate(id, !!files));
  handle('profiles:presets', () => presets.list());
  handle('profiles:from-preset', (id, opts) => {
    const job = jobs.create('Creating profile', { kind: 'preset' });
    presets.create(id, opts || {}, job).then((r) => { job.done(r.warnings.length ? `${r.warnings.length} mods skipped` : 'Ready'); send('profiles:changed', { id: r.profile.id, warnings: r.warnings }); })
      .catch((e) => job.fail(e));
    return job.id;
  });
  handle('profiles:add-optifine', async (id, file) => {
    const p = profileOrThrow(id);
    if (!/optifine/i.test(path.basename(file)) || !/\.jar$/i.test(file)) throw new Error('Choose the OptiFine .jar file you downloaded.');
    const dir = path.join(p.gameDir, 'mods');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(file, path.join(dir, path.basename(file)));
    return true;
  });

  /* ---- accounts */
  handle('accounts:list', () => accounts.list());
  handle('accounts:add-microsoft', async (method) => { const a = await accounts.addMicrosoft(method); settings.patch({ activeAccount: a.id }); return a; });
  handle('accounts:add-offline', (name) => { const a = accounts.addOffline(name); if (!settings.get().activeAccount) settings.patch({ activeAccount: a.id }); return a; });
  handle('accounts:select', (id) => { accounts.setActive(id); settings.patch({ activeAccount: id }); });
  handle('accounts:remove', (id) => { accounts.remove(id); settings.patch({ activeAccount: accounts.list().active }); });
  handle('accounts:avatar', (id, fresh) => accounts.avatarTexture(id, !!fresh));
  handle('accounts:local-skin', (id, libId) => accounts.setLocalSkin(id, libId));

  /* ---- skins */
  handle('skins:profile', (id) => accounts.profileOf(id));
  handle('skins:upload', (id, file, variant) => accounts.uploadSkin(id, file, variant));
  handle('skins:upload-library', (id, libId) => { const s = accounts.libraryPath(libId); return accounts.uploadSkin(id, s.file, s.variant); });
  handle('skins:cape', (id, capeId) => accounts.setCape(id, capeId));
  handle('skins:lookup', (name) => accounts.lookup(name));
  handle('skins:library', () => accounts.libraryList());
  handle('skins:library-add', (v) => accounts.libraryAdd(v));
  handle('skins:library-remove', (id) => accounts.libraryRemove(id));
  handle('skins:read-file', async (file) => {
    if (!/\.png$/i.test(file)) throw new Error('Skins must be PNG images.');
    const buf = await fsp.readFile(file);
    if (buf.length > 2 * 1024 * 1024) throw new Error('That image is too large for a skin.');
    return 'data:image/png;base64,' + buf.toString('base64');
  });

  /* ---- game */
  handle('game:launch', (profileId) => {
    launcher.launch(profileId, settings.get().activeAccount).catch((e) => send('game:error', { profileId, message: e.message, code: e.code }));
    settings.patch({ lastProfile: profileId });
    return true;
  });
  handle('game:stop', (id) => launcher.stop(id));
  handle('game:verify', (id) => {
    const p = profileOrThrow(id);
    game.invalidate(p.loaderInstalledId || p.mcVersion);
    game.invalidate(p.mcVersion);
    return true;
  });
  handle('game:status', () => launcher.status());
  handle('game:logs', (id) => launcher.logs(id));
  handle('jobs:list', () => jobs.snapshot());
  handle('jobs:cancel', (id) => jobs.cancel(id));

  /* ---- content */
  handle('content:list', (id, type) => content.list(profileOrThrow(id), type));
  handle('content:toggle', (id, file, enable) => content.toggleMod(profileOrThrow(id), file, enable));
  handle('content:remove', (id, type, file) => content.remove(profileOrThrow(id), type, file));
  handle('content:add', (id, type, files) => content.addFiles(profileOrThrow(id), type, files));
  handle('content:set-packs', (id, names) => {
    if (launcher.isRunning(id)) throw new Error('Close the game first. Minecraft rewrites its options when it exits.');
    return content.setActivePacks(profileOrThrow(id), names);
  });
  handle('content:set-shader', (id, name) => {
    if (launcher.isRunning(id)) throw new Error('Close the game first.');
    return content.setShaderPack(profileOrThrow(id), name);
  });
  handle('content:check-updates', (id, type) => modrinth.checkUpdates(profileOrThrow(id), type));
  handle('content:update', (id, type, item) => {
    const p = profileOrThrow(id);
    const job = jobs.create(`Updating ${item.title || item.file}`, { kind: 'install' });
    modrinth.applyUpdate(p, type, item, job).then(() => { job.done('Updated'); send('content:changed', { profileId: id, type }); }).catch((e) => job.fail(e));
    return job.id;
  });

  /* ---- modrinth */
  handle('mr:search', (o) => modrinth.search(o));
  handle('mr:project', (id) => modrinth.project(id));
  handle('mr:versions', (id, o) => modrinth.versions(id, o));
  handle('mr:install', (profileId, o) => {
    const p = profileOrThrow(profileId);
    const job = jobs.create(`Installing ${o.title || 'content'}`, { kind: 'install' });
    modrinth.install(p, o, job)
      .then((r) => { job.done(r.warnings.length ? `Installed with ${r.warnings.length} warning(s)` : 'Installed'); send('content:changed', { profileId, type: o.type, warnings: r.warnings, installed: r.installed }); })
      .catch((e) => job.fail(e));
    return job.id;
  });
  handle('mr:install-pack', (source) => {
    const job = jobs.create(`Installing ${source.name || 'modpack'}`, { kind: 'modpack' });
    modpacks.installMrpack(source, job)
      .then((profile) => { job.done('Profile created'); send('profiles:changed', { id: profile.id, warnings: [] }); })
      .catch((e) => job.fail(e));
    return job.id;
  });

  /* ---- news */
  handle('news:get', async () => {
    const r = await http.json('https://launchercontent.mojang.com/v2/javaPatchNotes.json', { ttl: 3 * 3600e3 });
    return (r.entries || []).slice(0, 12).map((e) => ({
      title: e.title, version: e.version, type: e.type, date: e.date,
      image: e.image && e.image.url ? 'https://launchercontent.mojang.com' + e.image.url : null,
      summary: String(e.body || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    }));
  });

  /* ---- updates and performance */
  handle('update:status', () => ({ ...updater.get(), repo: updater.repoInfo() }));
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());
  handle('app:metrics', () => perf.metrics());
  handle('app:trim', () => perf.trim());

  /* ---- data */
  handle('data:clear-cache', async () => {
    await fsp.rm(P.cache, { recursive: true, force: true });
    await fsp.mkdir(P.installers, { recursive: true });
    return true;
  });
}

module.exports = { register, setWindow, send };
