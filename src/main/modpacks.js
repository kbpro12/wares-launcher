'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { P } = require('./paths');
const http = require('./http');
const zip = require('./zip');
const profiles = require('./profiles');
const versions = require('./versions');
const modrinth = require('./modrinth');

const LOADER_KEYS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };

async function resolveLoaderId(loader, mc, ver) {
  if (loader === 'fabric' || loader === 'quilt' || loader === 'neoforge') return ver;
  const list = await versions.loaderVersions('forge', mc);
  const hit = list.find((x) => x.label === ver || x.id === ver || x.id.startsWith(`${mc}-${ver}`));
  return hit ? hit.id : null;
}

/**
 * Install a Modrinth modpack (.mrpack) as a new profile.
 * source: { file } for a local pack, or { projectId, versionId? } for Modrinth.
 */
async function installMrpack(source, job) {
  let packFile = source.file;
  let title = source.name || null;
  if (!packFile) {
    job.update({ stage: 'Finding pack', indeterminate: true });
    const v = source.versionId ? await modrinth.versionById(source.versionId) : modrinth.pickBest(await modrinth.versions(source.projectId, { type: 'modpack' }));
    if (!v) throw new Error('This modpack has no downloadable version.');
    const f = v.files.find((x) => x.primary) || v.files[0];
    packFile = path.join(P.cache, 'modpacks', modrinth.safeName(f.filename));
    job.update({ stage: 'Downloading pack', text: f.filename, indeterminate: true });
    await http.download(f.url, packFile, { sha1: f.sha1, signal: job.signal });
  }

  const raw = await zip.readEntry(packFile, 'modrinth.index.json', 4 * 1024 * 1024);
  if (!raw) throw new Error('This is not a Modrinth modpack (.mrpack). CurseForge packs are not supported.');
  const index = JSON.parse(raw.toString('utf8'));
  const deps = index.dependencies || {};
  const mc = deps.minecraft;
  const key = Object.keys(LOADER_KEYS).find((k) => deps[k]);
  const loader = key ? LOADER_KEYS[key] : 'vanilla';
  if (!mc) throw new Error('The modpack does not declare a Minecraft version.');
  let loaderVersion = null;
  if (key) {
    loaderVersion = await resolveLoaderId(loader, mc, deps[key]);
    if (!loaderVersion && (loader === 'forge' || loader === 'neoforge')) throw new Error(`Could not find ${loader} ${deps[key]} for Minecraft ${mc}.`);
  }

  const profile = profiles.save({
    name: title || index.name || 'Modpack', mcVersion: mc, loader, loaderVersion,
    icon: { glyph: 'package', color: '#c79a5b' }, jvmPreset: 'balanced', memory: { mode: 'custom', max: 4096, min: 1024 },
    notes: index.summary || '',
  });

  const files = (index.files || []).filter((f) => !(f.env && f.env.client === 'unsupported'));
  const total = files.reduce((n, f) => n + (f.fileSize || 0), 0);
  let done = 0;
  const root = path.resolve(profile.gameDir);
  job.update({ stage: 'Downloading mods', total, current: 0 });
  await http.pool(files, 8, async (f) => {
    const dest = path.resolve(root, f.path);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error(`Unsafe path in modpack: ${f.path}`);
    await http.download(f.downloads[0], dest, {
      sha1: f.hashes && f.hashes.sha1, signal: job.signal,
      onBytes: (n) => { done += n; job.update({ stage: 'Downloading mods', text: path.basename(f.path), total, current: done }); },
    });
  });

  job.update({ stage: 'Applying overrides', indeterminate: true });
  await zip.extractAll(packFile, profile.gameDir, (n) => {
    if (n.startsWith('overrides/')) return n.slice(10);
    if (n.startsWith('client-overrides/')) return n.slice(17);
    return null;
  });
  return profile;
}

module.exports = { installMrpack };
