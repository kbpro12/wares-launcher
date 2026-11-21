'use strict';
/**
 * Self-update from GitHub Releases via electron-updater.
 * Flow: check -> "available" (the UI asks the user) -> download on request -> "ready" -> restart.
 * Only installed (packaged) builds can update; running from source reports state "dev".
 */
const { app } = require('electron');
const settings = require('./settings');

const REPO = { owner: 'kbpro12', repo: 'wares-launcher' };

let send = () => {};
let updater = null;
let timer = null;
let status = { state: 'idle', current: app.getVersion() };

function setSender(fn) { send = fn; }
function emit(patch) { status = { ...status, ...patch, current: app.getVersion() }; send('update:status', status); }

function plain(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes || '');
  return raw.replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 1200);
}

function repoInfo() {
  return { ...REPO, configured: true, url: `https://github.com/${REPO.owner}/${REPO.repo}/releases` };
}

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/404|latest\.yml|Cannot find|No published versions/i.test(m)) return 'No published release was found on GitHub yet.';
  if (/ENOTFOUND|ETIMEDOUT|ECONN|EAI_AGAIN|network|net::/i.test(m)) return 'Could not reach GitHub. Check your internet connection.';
  if (/401|403|rate limit/i.test(m)) return 'GitHub refused the request. Try again in a few minutes.';
  return m.split('\n')[0].slice(0, 200);
}

function ensure() {
  if (updater) return updater;
  if (!app.isPackaged) return null;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.setFeedURL({ provider: 'github', owner: REPO.owner, repo: REPO.repo });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.logger = null;
  updater.on('checking-for-update', () => emit({ state: 'checking', error: null }));
  updater.on('update-available', (i) => {
    emit({ state: 'available', version: i.version, notes: plain(i.releaseNotes), date: i.releaseDate, percent: 0 });
    if (settings.get().updates.autoDownload) download();
  });
  updater.on('update-not-available', () => emit({ state: 'none', checkedAt: Date.now(), version: null }));
  updater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent), speed: p.bytesPerSecond }));
  updater.on('update-downloaded', (i) => emit({ state: 'ready', version: i.version, percent: 100 }));
  updater.on('error', (e) => emit({ state: 'error', error: friendly(e) }));
  return updater;
}

async function check() {
  const u = ensure();
  if (!u) { emit({ state: 'dev' }); return status; }
  if (status.state === 'downloading' || status.state === 'ready') return status;
  u.allowPrerelease = settings.get().updates.channel === 'beta';
  try { await u.checkForUpdates(); } catch (e) { emit({ state: 'error', error: friendly(e) }); }
  return status;
}

async function download() {
  const u = ensure();
  if (!u || status.state === 'downloading' || status.state === 'ready') return;
  emit({ state: 'downloading', percent: 0 });
  try { await u.downloadUpdate(); } catch (e) { emit({ state: 'error', error: friendly(e) }); }
}

/** Silent install and relaunch. */
function install() {
  const u = ensure();
  if (u && status.state === 'ready') setImmediate(() => u.quitAndInstall(true, true));
}

function start() {
  if (!app.isPackaged) { emit({ state: 'dev' }); return; }
  setTimeout(() => { if (settings.get().updates.auto !== false) check(); }, 6000);
  timer = setInterval(() => { if (settings.get().updates.auto !== false) check(); }, 2 * 3600e3);
  timer.unref();
}

module.exports = { setSender, start, check, download, install, repoInfo, get: () => status };
