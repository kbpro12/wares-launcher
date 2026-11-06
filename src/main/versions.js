'use strict';
const http = require('./http');

const HOUR = 3600e3;
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEO_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const NEO_LEGACY_META = 'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml';

const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'forge-optifine', 'neoforge'];

async function minecraft() {
  const m = await http.json(MANIFEST, { ttl: HOUR });
  return {
    latest: m.latest,
    versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url, sha1: v.sha1 })),
  };
}

function xmlVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

/** Map a NeoForge version (21.1.50, 20.4.237-beta, 26.1.0.5) to its Minecraft version. */
function neoToMc(v) {
  const m = v.match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const major = +m[1];
  const minor = +m[2];
  if (major <= 25) return minor === 0 ? `1.${major}` : `1.${major}.${minor}`;
  return `${major}.${minor}`; // year-based Minecraft versions
}

async function forgeIndex() {
  const [xml, promos] = await Promise.all([
    http.text(FORGE_META, { ttl: HOUR }),
    http.json(FORGE_PROMOS, { ttl: HOUR }).catch(() => ({ promos: {} })),
  ]);
  const byMc = {};
  for (const full of xmlVersions(xml)) {
    const mc = full.split('-')[0];
    const ver = full.split('-')[1];
    (byMc[mc] = byMc[mc] || []).push({ id: full, version: ver, recommended: promos.promos[`${mc}-recommended`] === ver, latest: promos.promos[`${mc}-latest`] === ver });
  }
  return byMc;
}

async function neoIndex() {
  const [xml, legacy] = await Promise.all([
    http.text(NEO_META, { ttl: HOUR }),
    http.text(NEO_LEGACY_META, { ttl: HOUR }).catch(() => ''),
  ]);
  const byMc = {};
  for (const v of xmlVersions(xml)) {
    const mc = neoToMc(v);
    if (!mc) continue;
    (byMc[mc] = byMc[mc] || []).push({ id: v, version: v, artifact: 'neoforge', recommended: false, latest: false, beta: /beta|alpha|snapshot/i.test(v) });
  }
  for (const full of xmlVersions(legacy)) {
    const mc = full.split('-')[0];
    (byMc[mc] = byMc[mc] || []).push({ id: full, version: full.slice(mc.length + 1), artifact: 'forge', recommended: false, latest: false });
  }
  for (const list of Object.values(byMc)) {
    const stable = list.filter((x) => !x.beta);
    if (stable.length) stable[stable.length - 1].recommended = true;
    list[list.length - 1].latest = true;
  }
  return byMc;
}

/** Minecraft versions each loader supports. Returns a Set of ids, or null for "all". */
async function supportedGameVersions(loader) {
  switch (loader) {
    case 'fabric': {
      const g = await http.json('https://meta.fabricmc.net/v2/versions/game', { ttl: HOUR });
      return new Set(g.map((x) => x.version));
    }
    case 'quilt': {
      const g = await http.json('https://meta.quiltmc.org/v3/versions/game', { ttl: HOUR });
      return new Set(g.map((x) => x.version));
    }
    case 'forge':
    case 'forge-optifine':
      return new Set(Object.keys(await forgeIndex()));
    case 'neoforge':
      return new Set(Object.keys(await neoIndex()));
    default:
      return null;
  }
}

/** Loader builds for a Minecraft version, newest first. */
async function loaderVersions(loader, mc) {
  if (loader === 'vanilla') return [];
  if (loader === 'fabric' || loader === 'quilt') {
    const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    const list = await http.json(`${base}/versions/loader/${encodeURIComponent(mc)}`, { ttl: HOUR });
    return list.map((x, i) => ({ id: x.loader.version, label: x.loader.version, stable: x.loader.stable !== false && !/beta|pre|rc/i.test(x.loader.version), recommended: i === 0 }));
  }
  if (loader === 'forge' || loader === 'forge-optifine') {
    const list = ((await forgeIndex())[mc] || []).slice().reverse();
    return list.map((x) => ({ id: x.id, label: x.version, stable: true, recommended: x.recommended, latest: x.latest }));
  }
  if (loader === 'neoforge') {
    const list = ((await neoIndex())[mc] || []).slice().reverse();
    return list.map((x) => ({ id: x.id, label: x.version, stable: !x.beta, recommended: x.recommended, latest: x.latest, artifact: x.artifact }));
  }
  return [];
}

/** Pick the default loader build: recommended, else newest stable, else newest. */
function pickLoaderVersion(list) {
  return (list.find((x) => x.recommended) || list.find((x) => x.stable) || list[0] || {}).id || null;
}

/** [major, minor] of a classic "1.x.y" id, or null for snapshots / year-based ids. */
function classicMinor(mc) {
  const m = /^1\.(\d+)/.exec(mc);
  return m ? +m[1] : null;
}

module.exports = { LOADERS, minecraft, supportedGameVersions, loaderVersions, pickLoaderVersion, classicMinor, forgeIndex, neoIndex };
