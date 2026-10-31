'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const http = require('./http');

const API = 'https://api.modrinth.com/v2';
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const hashCache = new Map();

const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Modrinth loader slugs compatible with a profile loader. */
function loadersFor(loader) {
  switch (loader) {
    case 'fabric': return ['fabric'];
    case 'quilt': return ['quilt', 'fabric'];
    case 'forge':
    case 'forge-optifine': return ['forge'];
    case 'neoforge': return ['neoforge'];
    default: return [];
  }
}

function safeName(n) {
  const base = path.basename(String(n)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (!base || base === '.' || base === '..') throw new Error('Unsafe file name from server.');
  return base;
}

async function search({ query = '', type = 'mod', mc, loader, category, sort = 'relevance', offset = 0, limit = 20 }) {
  const facets = [[`project_type:${type}`]];
  if (mc) facets.push([`versions:${mc}`]);
  if (type === 'mod' || type === 'modpack') {
    const l = loadersFor(loader);
    if (l.length) facets.push(l.map((x) => `categories:${x}`));
  }
  if (category) facets.push([`categories:${category}`]);
  const url = `${API}/search?${q({ query, facets: JSON.stringify(facets), index: sort, limit, offset })}`;
  const r = await http.json(url, { ttl: 120e3 });
  return {
    total: r.total_hits,
    offset: r.offset,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, author: h.author,
      downloads: h.downloads, follows: h.follows, categories: h.display_categories || h.categories || [],
      updated: h.date_modified, client: h.client_side, server: h.server_side, type: h.project_type,
    })),
  };
}

async function project(id) {
  const p = await http.json(`${API}/project/${encodeURIComponent(id)}`, { ttl: 300e3 });
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, body: p.body, icon: p.icon_url, downloads: p.downloads,
    followers: p.followers, categories: p.categories, gallery: (p.gallery || []).slice(0, 6).map((g) => ({ url: g.url, title: g.title })),
    license: p.license && p.license.name, type: p.project_type, updated: p.updated,
    links: { page: `https://modrinth.com/${p.project_type}/${p.slug}`, source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url },
  };
}

function trimVersion(v) {
  return {
    id: v.id, projectId: v.project_id, name: v.name, number: v.version_number, channel: v.version_type, date: v.date_published,
    gameVersions: v.game_versions, loaders: v.loaders, downloads: v.downloads,
    files: v.files.map((f) => ({ url: f.url, filename: f.filename, primary: f.primary, size: f.size, sha1: f.hashes && f.hashes.sha1 })),
    dependencies: (v.dependencies || []).map((d) => ({ projectId: d.project_id, versionId: d.version_id, type: d.dependency_type })),
  };
}

async function versions(projectId, { mc, loader, type = 'mod' } = {}) {
  const l = type === 'mod' || type === 'modpack' ? loadersFor(loader) : [];
  const url = `${API}/project/${encodeURIComponent(projectId)}/version?${q({
    game_versions: mc ? JSON.stringify([mc]) : '',
    loaders: l.length ? JSON.stringify(l) : '',
  })}`;
  return (await http.json(url, { ttl: 120e3 })).map(trimVersion);
}

async function versionById(id) {
  return trimVersion(await http.json(`${API}/version/${encodeURIComponent(id)}`, { ttl: 300e3 }));
}

function pickBest(list) {
  return list.find((v) => v.channel === 'release') || list.find((v) => v.channel === 'beta') || list[0] || null;
}

/* ------------------------------------------------------ install manifest */

function manifestPath(profile) { return path.join(profile.gameDir, '.wares', 'installed.json'); }

async function readManifest(profile) {
  try { return JSON.parse(await fsp.readFile(manifestPath(profile), 'utf8')); } catch { return { files: {} }; }
}
async function writeManifest(profile, m) {
  await fsp.mkdir(path.dirname(manifestPath(profile)), { recursive: true });
  await fsp.writeFile(manifestPath(profile), JSON.stringify(m, null, 1));
}

async function sha1File(file) {
  const st = await fsp.stat(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (hashCache.has(key)) return hashCache.get(key);
  const h = crypto.createHash('sha1');
  await new Promise((res, rej) => fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', res).on('error', rej));
  const v = h.digest('hex');
  hashCache.set(key, v);
  return v;
}

/* ----------------------------------------------------------------- install */

async function resolveFor(profile, projectId, type, versionId) {
  if (versionId) return versionById(versionId);
  let list = await versions(projectId, { mc: profile.mcVersion, loader: profile.loader, type });
  if (!list.length && type !== 'mod') list = await versions(projectId, { type }); // packs often work across versions
  const best = pickBest(list);
  if (!best) throw new Error(`No version of this ${type} supports Minecraft ${profile.mcVersion}${type === 'mod' ? ' on ' + profile.loader : ''}.`);
  return best;
}

async function installVersion(profile, type, v, ctx, depth = 0) {
  const folder = FOLDERS[type];
  if (!folder) throw new Error('Unsupported content type.');
  const file = v.files.find((f) => f.primary) || v.files[0];
  if (!file) throw new Error('This version has no downloadable file.');
  const rel = `${folder}/${safeName(file.filename)}`;
  const dest = path.join(profile.gameDir, folder, safeName(file.filename));
  ctx.update && ctx.update({ stage: 'Downloading', text: file.filename, indeterminate: true });
  await http.download(file.url, dest, { sha1: file.sha1, signal: ctx.signal });

  const m = ctx.manifest;
  for (const [k, e] of Object.entries(m.files)) {
    if (e.projectId === v.projectId && k !== rel) {
      await fsp.rm(path.join(profile.gameDir, k), { force: true });
      await fsp.rm(path.join(profile.gameDir, k + '.disabled'), { force: true });
      delete m.files[k];
    }
  }
  let meta = ctx.projects.get(v.projectId);
  if (!meta) {
    try { meta = await project(v.projectId); } catch { meta = { title: file.filename, slug: v.projectId, icon: null }; }
    ctx.projects.set(v.projectId, meta);
  }
  m.files[rel] = { projectId: v.projectId, slug: meta.slug, title: meta.title, icon: meta.icon, versionId: v.id, versionNumber: v.number, sha1: file.sha1, installedAt: Date.now() };
  ctx.installed.push({ title: meta.title, filename: file.filename });

  if (ctx.deps && depth < 6) {
    for (const d of v.dependencies) {
      if (d.type !== 'required' || !d.projectId) continue;
      if (Object.values(m.files).some((e) => e.projectId === d.projectId)) continue;
      try {
        const dv = d.versionId ? await versionById(d.versionId) : await resolveFor(profile, d.projectId, type, null);
        await installVersion(profile, type, dv, ctx, depth + 1);
      } catch (e) { ctx.warnings.push(`Dependency skipped: ${e.message}`); }
    }
  }
}

async function install(profile, { projectId, type, versionId, deps = true }, job) {
  const manifest = await readManifest(profile);
  const ctx = { manifest, projects: new Map(), installed: [], warnings: [], deps, update: job && job.update, signal: job && job.signal };
  const v = await resolveFor(profile, projectId, type, versionId);
  await installVersion(profile, type, v, ctx);
  await writeManifest(profile, manifest);
  return { installed: ctx.installed, warnings: ctx.warnings };
}

/* ------------------------------------------------------------------ updates */

async function installedHashes(profile, type) {
  const folder = path.join(profile.gameDir, FOLDERS[type]);
  let names = [];
  try { names = await fsp.readdir(folder); } catch { return []; }
  const files = names.filter((n) => /\.(jar|zip)$/i.test(n));
  const out = [];
  await http.pool(files, 6, async (n) => out.push({ name: n, sha1: await sha1File(path.join(folder, n)) }));
  return out;
}

async function projectsByIds(ids) {
  if (!ids.length) return new Map();
  const list = await http.json(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, { ttl: 300e3 });
  return new Map(list.map((p) => [p.id, p]));
}

/** Identify installed files on Modrinth by hash and report newer compatible versions. */
async function checkUpdates(profile, type) {
  const files = await installedHashes(profile, type);
  if (!files.length) return { updates: [], identified: {} };
  const hashes = files.map((f) => f.sha1);
  const body = (extra) => ({ hashes, algorithm: 'sha1', ...extra });
  const [known, latest] = await Promise.all([
    http.json(`${API}/version_files`, { method: 'POST', body: body({}) }),
    http.json(`${API}/version_files/update`, {
      method: 'POST',
      body: body({ ...(type === 'mod' ? { loaders: loadersFor(profile.loader) } : {}), game_versions: [profile.mcVersion] }),
    }),
  ]);
  const projects = await projectsByIds([...new Set(Object.values(known).map((v) => v.project_id))]);
  const identified = {};
  const updates = [];
  for (const f of files) {
    const k = known[f.sha1];
    if (!k) continue;
    const p = projects.get(k.project_id);
    identified[f.name] = { projectId: k.project_id, slug: p && p.slug, title: p ? p.title : f.name, icon: p && p.icon_url, versionNumber: k.version_number };
    const l = latest[f.sha1];
    if (l && l.id !== k.id) {
      const lf = l.files.find((x) => x.primary) || l.files[0];
      if (lf && lf.hashes.sha1 !== f.sha1) updates.push({ file: f.name, projectId: k.project_id, title: p ? p.title : f.name, from: k.version_number, to: l.version_number, versionId: l.id });
    }
  }
  return { updates, identified };
}

async function applyUpdate(profile, type, { file, projectId, versionId }, job) {
  const manifest = await readManifest(profile);
  const ctx = { manifest, projects: new Map(), installed: [], warnings: [], deps: true, update: job && job.update, signal: job && job.signal };
  const v = await versionById(versionId);
  const disabled = fs.existsSync(path.join(profile.gameDir, FOLDERS[type], safeName(file) + '.disabled'));
  await installVersion(profile, type, v, ctx);
  const oldRel = `${FOLDERS[type]}/${safeName(file)}`;
  const newFile = v.files.find((f) => f.primary) || v.files[0];
  if (safeName(newFile.filename) !== safeName(file)) {
    await fsp.rm(path.join(profile.gameDir, oldRel), { force: true });
    await fsp.rm(path.join(profile.gameDir, oldRel + '.disabled'), { force: true });
    delete manifest.files[oldRel];
  }
  if (disabled) await fsp.rename(path.join(profile.gameDir, FOLDERS[type], safeName(newFile.filename)), path.join(profile.gameDir, FOLDERS[type], safeName(newFile.filename) + '.disabled')).catch(() => {});
  await writeManifest(profile, manifest);
  return { installed: ctx.installed, warnings: ctx.warnings };
}

module.exports = {
  FOLDERS, loadersFor, search, project, versions, versionById, pickBest, install, checkUpdates, applyUpdate,
  readManifest, writeManifest, safeName, sha1File, resolveFor,
};
