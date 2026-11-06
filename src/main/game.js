'use strict';
/**
 * Launch engine. Resolves a Minecraft version (including loader profiles that
 * inherit from vanilla), downloads everything it needs and builds the exact
 * command line the official launcher would run.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { P } = require('./paths');
const http = require('./http');
const zip = require('./zip');
const versions = require('./versions');

const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch;
const SEP = process.platform === 'win32' ? ';' : ':';
const BRAND = 'WaresLauncher';
const APP_VERSION = '1.0.0';

/* ------------------------------------------------------------------ rules */

function ruleApplies(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS) return false;
    if (rule.os.arch) {
      const a = rule.os.arch;
      if (a === 'x86' ? ARCH !== 'ia32' : a !== ARCH) return false;
    }
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== v) return false;
  }
  return true;
}

function allowed(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) if (ruleApplies(r, features)) ok = r.action === 'allow';
  return ok;
}

/* ---------------------------------------------------------------- version */

function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at > -1) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [g, a, v, c] = n.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

function libKey(lib) {
  const [g, a, , c] = lib.name.split(':');
  return [g, a, c || ''].join(':');
}

function dedupeLibs(list) {
  const seen = new Set();
  const out = [];
  for (const l of list) {
    const k = libKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

function mergeVersions(p, c) {
  const out = { ...p, ...c };
  out.libraries = dedupeLibs([...(c.libraries || []), ...(p.libraries || [])]);
  if (p.arguments || c.arguments) {
    const pa = p.arguments || {};
    const ca = c.arguments || {};
    out.arguments = { game: [...(pa.game || []), ...(ca.game || [])], jvm: [...(pa.jvm || []), ...(ca.jvm || [])] };
  }
  out.rootId = p.rootId || p.id;
  return out;
}

async function loadVersionJson(id, signal) {
  const file = path.join(P.versions, id, `${id}.json`);
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* fetch below */ }
  const m = await versions.minecraft();
  const entry = m.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Minecraft version ${id} is not available.`);
  await http.download(entry.url, file, { sha1: entry.sha1, signal });
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** Load a version and merge it with every version it inherits from. */
async function resolveVersion(id, signal, depth = 0) {
  if (depth > 5) throw new Error('Version inheritance is too deep.');
  const j = await loadVersionJson(id, signal);
  if (!j.inheritsFrom) return { ...j, rootId: j.id };
  const parent = await resolveVersion(j.inheritsFrom, signal, depth + 1);
  return mergeVersions(parent, j);
}

/* -------------------------------------------------------------- downloads */

function libEntry(lib) {
  if (!allowed(lib.rules)) return null;
  const out = { name: lib.name };
  const nativeKey = lib.natives && lib.natives[OS];
  if (nativeKey) {
    const cls = nativeKey.replace('${arch}', ARCH === 'ia32' ? '32' : '64');
    const d = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
    if (d) out.native = { path: d.path, url: d.url, sha1: d.sha1, size: d.size, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] };
  }
  const art = lib.downloads && lib.downloads.artifact;
  if (art) {
    out.artifact = { path: art.path || mavenPath(lib.name), url: art.url, sha1: art.sha1, size: art.size };
  } else if (!lib.natives) {
    const rel = mavenPath(lib.name);
    const base = lib.url ? (lib.url.endsWith('/') ? lib.url : lib.url + '/') : 'https://libraries.minecraft.net/';
    out.artifact = { path: rel, url: base + rel, sha1: lib.sha1, size: lib.size };
  }
  if (out.artifact && /:natives-/.test(lib.name)) out.nativeJar = true;
  return out;
}

async function missing(tasks) {
  const out = [];
  await http.pool(tasks, 24, async (t) => {
    try {
      const st = await fsp.stat(t.dest);
      if (!t.size || st.size === t.size) return;
    } catch { /* missing */ }
    out.push(t);
  });
  return out;
}

/** Download tasks with a shared progress counter. */
async function runDownloads(tasks, { stage, limit = 10, signal, onProgress }) {
  const todo = await missing(tasks);
  if (!todo.length) return 0;
  const total = todo.reduce((n, t) => n + (t.size || 0), 0);
  let done = 0;
  let lastEmit = 0;
  let files = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    onProgress && onProgress({ stage, current: done, total, files, count: todo.length });
  };
  emit(true);
  await http.pool(todo, limit, async (t) => {
    if (!t.url) {
      const e = new Error(`A required file is missing: ${path.basename(t.dest)}`);
      e.code = 'LOADER_INCOMPLETE';
      throw e;
    }
    await http.download(t.url, t.dest, { sha1: t.sha1, size: t.size, signal, onBytes: (n) => { done += n; emit(); } });
    files++;
    emit();
  });
  emit(true);
  return todo.length;
}

async function extractNatives(entries, dir) {
  const marker = path.join(dir, '.ready');
  try { await fsp.access(marker); return; } catch { /* extract */ }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const isLib = (n) => /\.(dll|so|dylib|jnilib)$/i.test(n);
  for (const e of entries) {
    if (e.native) {
      const file = path.join(P.libraries, e.native.path);
      const ex = e.native.exclude;
      await zip.extractAll(file, dir, (n) => (ex.some((x) => n.startsWith(x)) || n.endsWith('/') ? null : path.basename(n)));
    } else if (e.nativeJar) {
      const file = path.join(P.libraries, e.artifact.path);
      await zip.extractAll(file, dir, (n) => (isLib(n) ? path.basename(n) : null));
    }
  }
  await fsp.writeFile(marker, '1');
}

async function copyIfMissing(src, dest) {
  try { await fsp.access(dest); return; } catch { /* copy */ }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

async function ensureAssets(merged, gameDir, { signal, onProgress, limit }) {
  const ai = merged.assetIndex;
  if (!ai) return { gameAssets: P.assets };
  const idxFile = path.join(P.assets, 'indexes', `${ai.id}.json`);
  await http.download(ai.url, idxFile, { sha1: ai.sha1, size: ai.size, signal });
  const index = JSON.parse(await fsp.readFile(idxFile, 'utf8'));
  const entries = Object.entries(index.objects);
  const tasks = entries.map(([, o]) => {
    const h2 = o.hash.slice(0, 2);
    return { url: `https://resources.download.minecraft.net/${h2}/${o.hash}`, dest: path.join(P.assets, 'objects', h2, o.hash), size: o.size, sha1: o.hash };
  });
  await runDownloads(tasks, { stage: 'Assets', limit, signal, onProgress });

  let gameAssets = P.assets;
  if (index.virtual || index.map_to_resources) {
    const target = index.map_to_resources ? path.join(gameDir, 'resources') : path.join(P.assets, 'virtual', 'legacy');
    if (!index.map_to_resources) gameAssets = target;
    await http.pool(entries, 16, async ([name, o]) => {
      const src = path.join(P.assets, 'objects', o.hash.slice(0, 2), o.hash);
      await copyIfMissing(src, path.join(target, name));
    });
  }
  return { gameAssets };
}

/** Make sure the vanilla client jar for a resolved version exists. */
async function ensureClientJar(merged, { signal, onProgress }) {
  const root = merged.rootId;
  const jar = path.join(P.versions, root, `${root}.jar`);
  const dl = merged.downloads && merged.downloads.client;
  if (dl) await runDownloads([{ url: dl.url, dest: jar, sha1: dl.sha1, size: dl.size }], { stage: 'Game', limit: 1, signal, onProgress });
  return jar;
}

const markerFile = (id) => path.join(P.versions, id, '.wares-ready');

/** Forget that a version was verified, so the next launch re-checks every file. */
function invalidate(id) { try { fs.rmSync(markerFile(id), { force: true }); } catch { /* ignore */ } }

/**
 * Download and stage everything needed to start `merged`.
 * After one successful pass a marker is written; later launches skip the
 * (slow) per-file checks unless `verify` is set.
 */
async function prepare(merged, gameDir, { signal, onProgress, limit = 10, verify = false }) {
  const entries = (merged.libraries || []).map(libEntry).filter(Boolean);
  const mainJar = path.join(P.versions, merged.id, `${merged.id}.jar`);
  const rootJar = path.join(P.versions, merged.rootId, `${merged.rootId}.jar`);
  const nativesDir = path.join(P.versions, merged.id, `natives-${ARCH}`);
  const marker = markerFile(merged.id);
  const lc = merged.logging && merged.logging.client;
  const logFile = lc && lc.file ? path.join(P.assets, 'log_configs', lc.file.id) : null;
  const fast = !verify && fs.existsSync(marker) && fs.existsSync(mainJar) && fs.existsSync(path.join(nativesDir, '.ready')) && (!logFile || fs.existsSync(logFile));

  let gameAssets = P.assets;
  if (fast) {
    try {
      const ai = merged.assetIndex;
      if (ai) {
        const index = JSON.parse(fs.readFileSync(path.join(P.assets, 'indexes', `${ai.id}.json`), 'utf8'));
        if (index.virtual) gameAssets = path.join(P.assets, 'virtual', 'legacy');
      }
    } catch { return prepare(merged, gameDir, { signal, onProgress, limit, verify: true }); }
  } else {
    await ensureClientJar(merged, { signal, onProgress });
    if (merged.id !== merged.rootId) await copyIfMissing(rootJar, mainJar);

    const tasks = [];
    for (const e of entries) {
      if (e.artifact) tasks.push({ url: e.artifact.url, dest: path.join(P.libraries, e.artifact.path), sha1: e.artifact.sha1, size: e.artifact.size });
      if (e.native) tasks.push({ url: e.native.url, dest: path.join(P.libraries, e.native.path), sha1: e.native.sha1, size: e.native.size });
    }
    await runDownloads(tasks, { stage: 'Libraries', limit, signal, onProgress });
    await extractNatives(entries.filter((e) => e.native || e.nativeJar), nativesDir);
    gameAssets = (await ensureAssets(merged, gameDir, { signal, onProgress, limit })).gameAssets;
    if (logFile) await runDownloads([{ url: lc.file.url, dest: logFile, sha1: lc.file.sha1, size: lc.file.size }], { stage: 'Logging', limit: 1, signal });
    try { fs.writeFileSync(marker, String(Date.now())); } catch { /* read-only is fine */ }
  }

  let logArg = null;
  if (lc && logFile) logArg = (lc.argument || '-Dlog4j.configurationFile=${path}').replace('${path}', logFile);

  const classpath = [];
  const seen = new Set();
  for (const e of entries) {
    if (!e.artifact) continue;
    const p = path.join(P.libraries, e.artifact.path);
    if (!seen.has(p)) { seen.add(p); classpath.push(p); }
  }
  classpath.push(mainJar);
  return { classpath, nativesDir, gameAssets, logArg, mainJar, fast };
}

/* ------------------------------------------------------------------- args */

function memArgs(mem) {
  const out = [`-Xmx${mem.max}M`];
  if (mem.min) out.push(`-Xms${Math.min(mem.min, mem.max)}M`);
  return out;
}

const SAFE = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UnlockDiagnosticVMOptions', '-XX:+IgnoreUnrecognizedVMOptions'];

function jvmPresetArgs(preset, javaMajor) {
  switch (preset) {
    case 'fps':
      return [...SAFE, '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=30', '-XX:+DisableExplicitGC', '-XX:+ParallelRefProcEnabled',
        '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=16M', '-XX:G1ReservePercent=15', '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
        '-XX:SurvivorRatio=32', '-XX:MaxTenuringThreshold=1', '-XX:+PerfDisableSharedMem', '-XX:ReservedCodeCacheSize=256M',
        '-XX:-DontCompileHugeMethods', '-XX:+AlwaysActAsServerClassMachine', '-Xshare:auto'];
    case 'balanced':
      return [...SAFE, '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+DisableExplicitGC',
        '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
        '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1'];
    case 'zgc':
      if (javaMajor < 15) return jvmPresetArgs('balanced', javaMajor);
      return javaMajor >= 21 && javaMajor < 23 ? [...SAFE, '-XX:+UseZGC', '-XX:+ZGenerational'] : [...SAFE, '-XX:+UseZGC'];
    case 'lowmem':
      return [...SAFE, '-XX:+UseSerialGC', '-XX:MinHeapFreeRatio=10', '-XX:MaxHeapFreeRatio=25', '-Xss512k', '-Xshare:auto'];
    default:
      return [];
  }
}

/** Pick GC tuning from this machine: small RAM gets the lean collector, everything else the tuned G1. */
function autoPreset(javaMajor) {
  const gb = os.totalmem() / 1024 ** 3;
  if (gb < 6) return 'lowmem';
  return javaMajor >= 17 && gb >= 8 ? 'fps' : 'balanced';
}

function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function buildCommand(merged, ctx) {
  const { auth, gameDir, staged, profile, javaMajor } = ctx;
  const res = profile.resolution || {};
  const hasServer = !!(profile.serverJoin && profile.serverJoin.trim());
  const features = {
    is_demo_user: false,
    has_custom_resolution: !!(res.width && res.height),
    has_quick_plays_support: hasServer,
    is_quick_play_multiplayer: hasServer,
    is_quick_play_singleplayer: false,
    is_quick_play_realms: false,
  };
  const vars = {
    auth_player_name: auth.name,
    version_name: merged.id,
    game_directory: gameDir,
    assets_root: P.assets,
    game_assets: staged.gameAssets,
    assets_index_name: merged.assetIndex ? merged.assetIndex.id : merged.assets || 'legacy',
    auth_uuid: auth.uuid,
    auth_access_token: auth.accessToken,
    auth_session: `token:${auth.accessToken}:${auth.uuid}`,
    clientid: auth.clientId || '0',
    auth_xuid: auth.xuid || '0',
    user_type: auth.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: merged.type || 'release',
    resolution_width: String(res.width || 854),
    resolution_height: String(res.height || 480),
    natives_directory: staged.nativesDir,
    launcher_name: BRAND,
    launcher_version: APP_VERSION,
    classpath: staged.classpath.join(SEP),
    classpath_separator: SEP,
    library_directory: P.libraries,
    quickPlayPath: path.join(gameDir, 'quickPlay.log'),
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: profile.serverJoin || '',
    quickPlayRealms: '',
  };
  const sub = (s) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const flat = (list) => {
    const out = [];
    for (const a of list || []) {
      if (typeof a === 'string') out.push(sub(a));
      else if (allowed(a.rules, features)) (Array.isArray(a.value) ? a.value : [a.value]).forEach((x) => out.push(sub(x)));
    }
    return out;
  };

  let jvm;
  let game;
  const modernQuickPlay = !!merged.arguments && JSON.stringify(merged.arguments.game || []).includes('is_quick_play_multiplayer');
  if (merged.arguments) {
    jvm = flat(merged.arguments.jvm);
    game = flat(merged.arguments.game);
  } else {
    jvm = [`-Djava.library.path=${staged.nativesDir}`, `-Dminecraft.launcher.brand=${BRAND}`, `-Dminecraft.launcher.version=${APP_VERSION}`, '-cp', vars.classpath];
    game = (merged.minecraftArguments || '').split(' ').filter(Boolean).map(sub);
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', vars.classpath);

  if (!merged.arguments || !features.has_custom_resolution) {
    if (res.width && res.height && !merged.arguments) game.push('--width', String(res.width), '--height', String(res.height));
  }
  if (res.fullscreen) game.push('--fullscreen');
  if (hasServer && !modernQuickPlay) {
    const [host, port] = profile.serverJoin.trim().split(':');
    game.push('--server', host, '--port', port || '25565');
  }

  const preset = profile.jvmPreset === 'auto' ? autoPreset(javaMajor) : profile.jvmPreset;
  const userJvm = [
    ...memArgs(ctx.memory),
    ...jvmPresetArgs(preset, javaMajor),
    ...splitArgs(ctx.globalJvmArgs),
    ...splitArgs(profile.jvmArgs),
  ];
  const args = [...userJvm, ...jvm];
  if (staged.logArg) args.push(staged.logArg);
  else {
    const minor = versions.classicMinor(merged.rootId || merged.id);
    if (minor !== null && minor >= 7 && minor <= 18) args.push('-Dlog4j2.formatMsgNoLookups=true'); // Log4Shell mitigation for old versions
  }
  args.push(merged.mainClass, ...game);
  return args;
}

/**
 * Start the game process detached from the launcher, with stdout/stderr going to logFd.
 * Detached means the game keeps running if the launcher is closed.
 */
function start(javaPath, args, gameDir, logFd) {
  fs.mkdirSync(gameDir, { recursive: true });
  const child = spawn(javaPath, args, { cwd: gameDir, windowsHide: true, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  return child;
}

module.exports = {
  OS, ARCH, SEP,
  resolveVersion, loadVersionJson, prepare, invalidate, runDownloads, buildCommand, start, ensureClientJar, splitArgs, allowed,
};
