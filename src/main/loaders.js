'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { P } = require('./paths');
const http = require('./http');
const zip = require('./zip');
const versions = require('./versions');
const game = require('./game');

const NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', 'forge-optifine': 'Forge + OptiFine', neoforge: 'NeoForge' };

function installerUrl(loader, v) {
  if (loader === 'neoforge') {
    return v.artifact === 'forge'
      ? `https://maven.neoforged.net/releases/net/neoforged/forge/${v.id}/forge-${v.id}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v.id}/neoforge-${v.id}-installer.jar`;
  }
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v.id}/forge-${v.id}-installer.jar`;
}

async function ensureProfilesStub() {
  const f = path.join(P.shared, 'launcher_profiles.json');
  try { await fsp.access(f); } catch { await fsp.writeFile(f, JSON.stringify({ profiles: {}, settings: {}, version: 3 })); }
}

async function listVersionDirs() {
  try { return new Set(await fsp.readdir(P.versions)); } catch { return new Set(); }
}

function runInstaller(javaPath, jar, emit, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', jar, '--installClient', P.shared], { cwd: P.shared, windowsHide: true });
    const tail = [];
    const onData = (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 12) tail.shift();
        emit({ stage: 'Installing loader', text: line.slice(0, 120), indeterminate: true });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Loader installer timed out.')); }, 15 * 60e3);
    const abort = () => child.kill();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Loader installer failed (exit ${code}).\n${tail.slice(-6).join('\n')}`));
    });
  });
}

async function installForgeLike(profile, v, ctx) {
  const { javaPath, emit, signal } = ctx;
  const mc = profile.mcVersion;
  emit({ stage: 'Preparing', text: `Minecraft ${mc}`, indeterminate: true });
  const base = await game.resolveVersion(mc, signal);
  await game.ensureClientJar(base, { signal, onProgress: emit });
  await ensureProfilesStub();

  const jar = path.join(P.installers, `${profile.loader === 'neoforge' ? 'neoforge' : 'forge'}-${v.id}-installer.jar`);
  emit({ stage: 'Downloading loader', text: v.id, indeterminate: true });
  await http.download(installerUrl(profile.loader, v), jar, { signal, skipIfExists: true });

  const before = await listVersionDirs();
  await runInstaller(javaPath, jar, emit, signal);

  let id = null;
  const prof = await zip.readEntry(jar, 'install_profile.json');
  if (prof) {
    try {
      const j = JSON.parse(prof.toString('utf8'));
      id = (typeof j.version === 'string' && j.version) || (j.versionInfo && j.versionInfo.id) || (j.install && j.install.target) || null;
    } catch { /* fall through to diff */ }
  }
  if (!id || !fs.existsSync(path.join(P.versions, id, `${id}.json`))) {
    const after = await listVersionDirs();
    id = [...after].find((d) => !before.has(d) && fs.existsSync(path.join(P.versions, d, `${d}.json`))) || id;
  }
  if (!id || !fs.existsSync(path.join(P.versions, id, `${id}.json`))) {
    throw new Error('The installer finished but the loader profile could not be found.');
  }
  return id;
}

/**
 * Make sure the loader for `profile` is installed.
 * Returns { versionId, loaderVersion, installedFor } - the caller persists these on the profile.
 */
async function ensure(profile, ctx) {
  const { loader, mcVersion: mc } = profile;
  if (loader === 'vanilla') return { versionId: mc };

  const list = await versions.loaderVersions(loader, mc);
  if (!list.length) throw new Error(`${NAMES[loader]} has no build for Minecraft ${mc}.`);
  const wanted = profile.loaderVersion && list.find((x) => x.id === profile.loaderVersion);
  const chosen = wanted || list.find((x) => x.id === versions.pickLoaderVersion(list)) || list[0];
  const key = `${loader}:${mc}:${chosen.id}`;

  if (loader === 'fabric' || loader === 'quilt') {
    const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    const url = `${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(chosen.id)}/profile/json`;
    const j = await http.json(url, { ttl: 6 * 3600e3 });
    const dir = path.join(P.versions, j.id);
    const file = path.join(dir, `${j.id}.json`);
    if (!fs.existsSync(file)) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(file, JSON.stringify(j, null, 2));
    }
    return { versionId: j.id, loaderVersion: chosen.id, installedFor: key };
  }

  if (profile.loaderInstalledFor === key && profile.loaderInstalledId &&
      fs.existsSync(path.join(P.versions, profile.loaderInstalledId, `${profile.loaderInstalledId}.json`)) && !ctx.force) {
    return { versionId: profile.loaderInstalledId, loaderVersion: chosen.id, installedFor: key };
  }
  const id = await installForgeLike(profile, chosen, ctx);
  return { versionId: id, loaderVersion: chosen.id, installedFor: key };
}

module.exports = { ensure, NAMES };
