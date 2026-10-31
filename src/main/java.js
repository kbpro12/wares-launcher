'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { P } = require('./paths');
const http = require('./http');
const zip = require('./zip');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? 'java.exe' : 'java';
let cache = null;
let cacheAt = 0;

function probe(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 8000, windowsHide: true }, (err, _o, stderr) => {
      const out = String(stderr || '');
      const m = /version "([^"]+)"/.exec(out);
      if (err && !m) return resolve(null);
      if (!m) return resolve(null);
      const v = m[1];
      const major = v.startsWith('1.') ? +v.split('.')[1] : +v.split(/[.+_-]/)[0];
      resolve({ path: bin, version: v, major, is64: /64-Bit/i.test(out), vendor: (out.split('\n')[1] || '').trim() });
    });
  });
}

async function walkForJava(dir, depth = 4) {
  const hits = [];
  async function rec(d, n) {
    if (n < 0) return;
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'bin') { const j = path.join(p, EXE); if (fs.existsSync(j)) hits.push(j); } else await rec(p, n - 1);
      }
    }
  }
  await rec(dir, depth);
  return hits;
}

async function candidates() {
  const set = new Set();
  const managed = await walkForJava(P.runtime, 8);
  managed.forEach((p) => set.add(p));
  if (process.env.JAVA_HOME) set.add(path.join(process.env.JAVA_HOME, 'bin', EXE));
  set.add('java');
  const roots = IS_WIN
    ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', 'C:\\Program Files\\BellSoft', 'C:\\Program Files\\Amazon Corretto', 'C:\\Program Files (x86)\\Java']
    : process.platform === 'darwin'
      ? ['/Library/Java/JavaVirtualMachines']
      : ['/usr/lib/jvm', '/usr/java', os.homedir() + '/.sdkman/candidates/java'];
  for (const r of roots) {
    let ents = [];
    try { ents = await fsp.readdir(r); } catch { continue; }
    for (const e of ents) {
      const base = path.join(r, e);
      const direct = path.join(base, 'bin', EXE);
      const mac = path.join(base, 'Contents', 'Home', 'bin', EXE);
      if (fs.existsSync(direct)) set.add(direct);
      else if (fs.existsSync(mac)) set.add(mac);
    }
  }
  return [...set];
}

/** Detect installed Java runtimes (cached for 10 minutes). */
async function list(force = false) {
  if (!force && cache && Date.now() - cacheAt < 600e3) return cache;
  const found = [];
  const seen = new Set();
  await http.pool(await candidates(), 6, async (c) => {
    const r = await probe(c);
    if (!r) return;
    const key = `${r.major}|${r.version}|${r.vendor}`;
    r.managed = c.startsWith(P.runtime);
    if (seen.has(key) && !r.managed) return;
    seen.add(key);
    found.push(r);
  });
  found.sort((a, b) => b.major - a.major);
  cache = found;
  cacheAt = Date.now();
  return found;
}

/** Is a runtime of major `have` acceptable for a game that wants `need`? */
function acceptable(have, need) {
  if (need <= 8) return have === 8;
  if (need <= 17) return have >= 17 && have <= 21;
  return have >= need;
}

function adoptiumTarget() {
  const osName = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch };
}

const RUNTIME_INDEX = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const COMPONENT_BY_MAJOR = { 8: 'jre-legacy', 16: 'java-runtime-alpha', 17: 'java-runtime-gamma', 21: 'java-runtime-delta', 25: 'java-runtime-epsilon' };

function platformKey() {
  const a = process.arch;
  if (IS_WIN) return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}

/**
 * Install one of Mojang's own Java runtimes (the same ones the official launcher uses).
 * Files are verified, staged in a temp folder and moved into place when complete.
 */
async function installMojang(component, onProgress = () => {}, signal) {
  const idx = await http.json(RUNTIME_INDEX, { ttl: 6 * 3600e3 });
  const entry = idx[platformKey()] && idx[platformKey()][component] && idx[platformKey()][component][0];
  if (!entry) throw new Error(`Mojang has no ${component} runtime for this system.`);
  const man = await http.json(entry.manifest.url, { ttl: 0 });
  const root = path.join(P.runtime, 'mojang', component);
  const stage = root + '.tmp';
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });

  const files = [];
  const links = [];
  for (const [rel, f] of Object.entries(man.files)) {
    const dest = path.resolve(stage, rel);
    if (dest !== stage && !dest.startsWith(stage + path.sep)) throw new Error('Unsafe path in runtime manifest.');
    if (f.type === 'directory') await fsp.mkdir(dest, { recursive: true });
    else if (f.type === 'file') files.push({ dest, url: f.downloads.raw.url, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, exec: !!f.executable });
    else if (f.type === 'link') links.push({ dest, target: f.target });
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  await http.pool(files, 12, async (f) => {
    await http.download(f.url, f.dest, { sha1: f.sha1, size: f.size, signal, onBytes: (n) => { done += n; onProgress({ current: Math.max(0, done), total }); } });
    if (f.exec && !IS_WIN) await fsp.chmod(f.dest, 0o755).catch(() => {});
  });
  if (!IS_WIN) for (const l of links) { await fsp.mkdir(path.dirname(l.dest), { recursive: true }); await fsp.symlink(l.target, l.dest).catch(() => {}); }
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.rename(stage, root);
  const bins = await walkForJava(root, 6);
  if (!bins.length) throw new Error('The runtime downloaded but contains no Java executable.');
  cache = null;
  return bins[0];
}

async function install(major, onStatus = () => {}, signal) {
  const want = major === 16 ? 17 : major;
  const { osName, arch } = adoptiumTarget();
  const url = `https://api.adoptium.net/v3/binary/latest/${want}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(P.cache, `java-${want}.${IS_WIN ? 'zip' : 'tar.gz'}`);
  const dest = path.join(P.runtime, `java-${want}`);
  onStatus(`Downloading Java ${want}`);
  await http.download(url, archive, { signal });
  onStatus(`Unpacking Java ${want}`);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  if (IS_WIN) {
    await zip.extractAll(archive, dest);
  } else {
    await new Promise((res, rej) => execFile('tar', ['-xzf', archive, '-C', dest], (e) => (e ? rej(e) : res())));
  }
  fsp.unlink(archive).catch(() => {});
  const bins = await walkForJava(dest, 5);
  if (!bins.length) throw new Error(`Java ${want} was downloaded but no runtime was found inside it.`);
  if (!IS_WIN) await fsp.chmod(bins[0], 0o755).catch(() => {});
  cache = null;
  return bins[0];
}

/**
 * Resolve a java executable for a game that needs `major`.
 * Order: explicit override, installed match, managed download.
 */
async function resolve({ major, component, override, autoInstall = true, onStatus = () => {}, onProgress = () => {}, signal }) {
  if (override) return { path: override, major: null, source: 'custom' };
  const all = await list();
  const exact = all.find((j) => j.major === major && j.is64 !== false);
  const ok = exact || all.find((j) => acceptable(j.major, major) && j.is64 !== false);
  if (ok) return { path: ok.path, major: ok.major, source: ok.managed ? 'managed' : 'system' };
  if (!autoInstall) throw new Error(`Java ${major} is required but not installed, and automatic install is turned off in Settings.`);

  const comp = component || COMPONENT_BY_MAJOR[major];
  const errors = [];
  if (comp) {
    try {
      onStatus(`Installing Java ${major}`);
      const p = await installMojang(comp, (pr) => onProgress({ stage: `Installing Java ${major}`, ...pr }), signal);
      return { path: p, major, source: 'managed' };
    } catch (e) { if (signal && signal.aborted) throw e; errors.push(`Mojang runtime: ${e.message}`); }
  }
  try {
    const p = await install(major, onStatus, signal);
    return { path: p, major, source: 'managed' };
  } catch (e) { if (signal && signal.aborted) throw e; errors.push(`Adoptium: ${e.message}`); }
  throw new Error(`Could not install Java ${major} automatically. ${errors.join(' ')} Install Java ${major} yourself and Wares will find it.`);
}

/** Rough default Java requirement when a version JSON has no javaVersion block. */
function guessMajor(mcId) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mcId);
  if (!m) return 21;
  const minor = +m[1];
  const patch = +(m[2] || 0);
  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor < 20 || (minor === 20 && patch < 5)) return 17;
  return 21;
}

module.exports = { list, resolve, install, installMojang, acceptable, guessMajor, probe, COMPONENT_BY_MAJOR };
