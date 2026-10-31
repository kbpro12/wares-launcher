'use strict';
/**
 * Auto-update from GitHub Releases via electron-updater.
 * Works only in installed (packaged) builds that were published with electron-builder.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const settings = require('./settings');

let send = () => {};
let updater = null;
let timer = null;
let status = { state: 'idle', current: app.getVersion() };

function setSender(fn) { send = fn; }
function emit(patch) { status = { ...status, ...patch, current: app.getVersion() }; send('update:status', status); }

function plain(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes || '');
  return raw.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900);
}

/** owner/repo declared in package.json build.publish, so the UI can link to the releases page. */
function repoInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    const pub = ((pkg.build || {}).publish || [])[0] || {};
    const configured = pub.owner && pub.repo && !/YOUR_GITHUB/i.test(pub.owner);
    return { owner: pub.owner, repo: pub.repo, configured: !!configured, url: configured ? `https://github.com/${pub.owner}/${pub.repo}/releases` : null };
  } catch { return { configured: false, url: null }; }
}

function ensure() {
  if (updater) return updater;
  if (!app.isPackaged) return null;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('checking-for-update', () => emit({ state: 'checking', error: null }));
  updater.on('update-available', (i) => {
    emit({ state: 'available', version: i.version, notes: plain(i.releaseNotes), date: i.releaseDate });
    if (settings.get().updates.auto !== false) download();
  });
  updater.on('update-not-available', () => emit({ state: 'none', checkedAt: Date.now() }));
  updater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent), speed: p.bytesPerSecond }));
  updater.on('update-downloaded', (i) => emit({ state: 'ready', version: i.version, percent: 100 }));
  updater.on('error', (e) => emit({ state: 'error', error: friendly(e) }));
  return updater;
}

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/404|latest\.yml|Cannot find/i.test(m)) return 'No published release was found on GitHub yet.';
  if (/ENOTFOUND|ETIMEDOUT|ECONN|network|net::/i.test(m)) return 'Could not reach GitHub. Check your internet connection.';
  if (/401|403|rate limit/i.test(m)) return 'GitHub refused the request. The repository may be private or rate-limited.';
  return m.split('\n')[0].slice(0, 200);
}

async function check() {
  const u = ensure();
  if (!u) { emit({ state: 'dev' }); return status; }
  if (!repoInfo().configured) { emit({ state: 'error', error: 'This build has no GitHub repository configured. Set build.publish in package.json.' }); return status; }
  u.allowPrerelease = settings.get().updates.channel === 'beta';
  u.channel = u.allowPrerelease ? 'beta' : 'latest';
  try { await u.checkForUpdates(); } catch (e) { emit({ state: 'error', error: friendly(e) }); }
  return status;
}

async function download() {
  const u = ensure();
  if (!u || status.state === 'downloading' || status.state === 'ready') return;
  try { await u.downloadUpdate(); } catch (e) { emit({ state: 'error', error: friendly(e) }); }
}

function install() { const u = ensure(); if (u && status.state === 'ready') u.quitAndInstall(false, true); }

function start() {
  if (!app.isPackaged) { emit({ state: 'dev' }); return; }
  setTimeout(() => { if (settings.get().updates.auto !== false) check(); }, 8000);
  timer = setInterval(() => { if (settings.get().updates.auto !== false && status.state !== 'downloading' && status.state !== 'ready') check(); }, 6 * 3600e3);
  timer.unref();
}

module.exports = { setSender, start, check, download, install, repoInfo, get: () => status };
