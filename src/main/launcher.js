'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { P } = require('./paths');
const game = require('./game');
const javaMod = require('./java');
const loaders = require('./loaders');
const profiles = require('./profiles');
const accounts = require('./accounts');
const jobs = require('./jobs');
const settings = require('./settings');
const perf = require('./perf');

const running = new Map();
const starting = new Set();
const RING = 4000;
let notify = () => {};

function setNotifier(fn) { notify = fn; }

function autoMemory(profile) {
  const totalMb = Math.floor(os.totalmem() / 1048576);
  const modded = profile.loader !== 'vanilla';
  let max = modded ? 4096 : 2560;
  max = Math.min(max, Math.floor(totalMb * (totalMb < 6144 ? 0.5 : 0.6)));
  return { max: Math.max(1024, max), min: 512 };
}

function levelOf(line) {
  if (/\b(FATAL|ERROR)\b|Exception|^\s+at /.test(line)) return 'error';
  if (/\bWARN\b/.test(line)) return 'warn';
  if (/\bDEBUG\b|\bTRACE\b/.test(line)) return 'debug';
  return 'info';
}

function pruneLogs() {
  try {
    const files = fs.readdirSync(P.logs).map((f) => ({ f, t: fs.statSync(path.join(P.logs, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(20)) fs.rmSync(path.join(P.logs, x.f), { force: true });
  } catch { /* ignore */ }
}

function hasOptifine(profile) {
  try { return fs.readdirSync(path.join(profile.gameDir, 'mods')).some((f) => /optifine/i.test(f) && /\.jar$/i.test(f)); } catch { return false; }
}


/* ------------------------------------------------------------------------
 * Running games outlive the launcher. Each game is started detached with its
 * output written to a log file; a small state file remembers which game is
 * running so a later launcher session can re-attach (Stop button, console).
 * ---------------------------------------------------------------------- */

const activeListeners = new Set();
function onActive(fn) { activeListeners.add(fn); }
function listRunning() { return [...running.values()].map((r) => ({ profileId: r.profileId, name: r.name })); }
function emitActive() { const n = running.size + starting.size; for (const f of activeListeners) { try { f(n, listRunning()); } catch { /* listener failed */ } } }

const runFile = () => path.join(P.config, 'running.json');
const bootTime = () => Math.round(Date.now() - os.uptime() * 1000);

function saveRunning() {
  const runs = {};
  for (const [id, r] of running) runs[id] = { pid: r.pid, startedAt: r.startedAt, logPath: r.logPath, versionId: r.versionId, name: r.name };
  try { fs.writeFileSync(runFile(), JSON.stringify({ boot: bootTime(), runs })); } catch { /* optional */ }
}

function isJavaAlive(pid) {
  return new Promise((resolve) => {
    try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return resolve(false); }
    const done = (err, out) => resolve(!err && /java/i.test(String(out)));
    if (process.platform === 'win32') execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 6000 }, done);
    else execFile('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 6000 }, done);
  });
}

function killHard(pid) {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

/** Start tracking a game process: tail its log file, watch for exit, persist state. */
function track(profileId, info, child) {
  const run = {
    profileId, name: info.name, pid: info.pid, startedAt: info.startedAt, logPath: info.logPath, versionId: info.versionId, child: child || null,
    ring: [], pending: [], timer: null, stopped: false, finished: false, offset: info.offset || 0, decoder: new StringDecoder('utf8'), partial: '', fd: null,
  };
  try { run.fd = fs.openSync(run.logPath, 'r'); } catch { /* log missing: console stays empty */ }

  const addLine = (raw, level) => {
    if (!raw) return;
    const entry = { t: Date.now(), level: level || levelOf(raw), text: raw };
    run.ring.push(entry);
    if (run.ring.length > RING) run.ring.shift();
    run.pending.push(entry);
    if (!run.timer) run.timer = setTimeout(() => { run.timer = null; const batch = run.pending.splice(0); if (batch.length) notify('game:log', { profileId, lines: batch }); }, 120);
  };
  run.addLine = addLine;

  run.pump = () => {
    if (run.fd === null) return;
    try {
      const size = fs.fstatSync(run.fd).size;
      if (size < run.offset) run.offset = 0;
      while (size > run.offset) {
        const buf = Buffer.alloc(Math.min(size - run.offset, 512 * 1024));
        const n = fs.readSync(run.fd, buf, 0, buf.length, run.offset);
        if (!n) break;
        run.offset += n;
        const lines = (run.partial + run.decoder.write(buf.subarray(0, n))).split(/\r?\n/);
        run.partial = lines.pop();
        for (const l of lines) addLine(l, /^\[Wares\]/.test(l) ? 'meta' : undefined);
      }
    } catch { /* file busy: try again on the next tick */ }
  };

  run.tailTimer = setInterval(run.pump, 300);
  running.set(profileId, run);
  saveRunning();

  const finish = (code) => {
    if (run.finished) return;
    run.finished = true;
    clearInterval(run.tailTimer);
    clearInterval(run.pollTimer);
    run.pump();
    if (run.partial) addLine(run.partial);
    run.partial = '';
    clearTimeout(run.timer);
    const rest = run.pending.splice(0);
    if (rest.length) notify('game:log', { profileId, lines: rest });
    if (run.fd !== null) { try { fs.closeSync(run.fd); } catch { /* closed */ } run.fd = null; }
    running.delete(profileId);
    saveRunning();
    perf.onGameCount(running.size);
    const secs = (Date.now() - run.startedAt) / 1000;
    profiles.recordPlay(profileId, secs);
    const crashLog = run.ring.slice(-300).some((l) => /#@!@# Game crashed|Crash report saved to/i.test(l.text));
    const failed = code !== null && code !== undefined ? code !== 0 : crashLog;
    if (!run.stopped && failed && secs < 25) game.invalidate(run.versionId); // quick crash: re-verify files next launch
    notify('game:state', { profileId, state: 'closed', code: code === undefined ? null : code, crashed: !run.stopped && failed, seconds: secs });
    emitActive();
  };
  run.finish = finish;

  if (child) {
    child.once('exit', (code) => finish(code));
    child.once('error', (e) => { addLine(`[Wares] Process error: ${e.message}`, 'error'); finish(1); });
  } else {
    run.pollTimer = setInterval(() => { try { process.kill(run.pid, 0); } catch (e) { if (e.code !== 'EPERM') finish(null); } }, 2000);
  }
  emitActive();
  return run;
}

/** Re-attach to games that kept running after the launcher was closed. Call once at startup. */
async function restore() {
  let data;
  try { data = JSON.parse(fs.readFileSync(runFile(), 'utf8')); } catch { return; }
  const sameBoot = Math.abs((data.boot || 0) - bootTime()) < 120000;
  for (const [profileId, info] of Object.entries(data.runs || {})) {
    if (running.has(profileId)) continue;
    if (sameBoot && profiles.get(profileId) && await isJavaAlive(info.pid)) {
      let offset = 0;
      try { offset = Math.max(0, fs.statSync(info.logPath).size - 300 * 1024); } catch { /* no log */ }
      track(profileId, { ...info, offset }, null);
      notify('game:state', { profileId, state: 'running', startedAt: info.startedAt, pid: info.pid });
    } else {
      // The game ended while the launcher was closed: credit the time up to its last log write.
      try { profiles.recordPlay(profileId, Math.max(0, (fs.statSync(info.logPath).mtimeMs - info.startedAt) / 1000)); } catch { /* no log */ }
    }
  }
  saveRunning();
  emitActive();
}

async function launch(profileId, accountId) {
  const profile = profiles.get(profileId);
  if (!profile) throw new Error('Profile not found.');
  if (running.has(profileId) || starting.has(profileId)) throw new Error('This profile is already running.');
  starting.add(profileId);
  emitActive();
  const job = jobs.create(`Launching ${profile.name}`, { kind: 'launch', profileId });
  notify('game:state', { profileId, state: 'starting' });
  const cfg = settings.get();
  const emit = (p) => job.update(p);
  const progress = (p) => job.update({ stage: p.stage, text: p.count ? `${p.files} of ${p.count} files` : '', total: p.total, current: p.current });

  try {
    emit({ stage: 'Signing in', indeterminate: true });
    const auth = await accounts.getAuth(accountId || cfg.activeAccount);

    emit({ stage: 'Checking version', indeterminate: true });
    const vanilla = await game.resolveVersion(profile.mcVersion, job.signal);
    const major = (vanilla.javaVersion && vanilla.javaVersion.majorVersion) || javaMod.guessMajor(profile.mcVersion);
    const java = await javaMod.resolve({
      major, component: vanilla.javaVersion && vanilla.javaVersion.component, override: profile.javaPath || cfg.game.javaPath || null,
      autoInstall: cfg.game.autoInstallJava !== false, signal: job.signal,
      onStatus: (t) => emit({ stage: t, indeterminate: true }),
      onProgress: (p) => emit({ stage: p.stage, text: `${(p.current / 1048576).toFixed(0)} of ${(p.total / 1048576).toFixed(0)} MB`, total: p.total, current: p.current }),
    });

    if (profile.loader === 'forge-optifine' && !hasOptifine(profile)) {
      const e = new Error('OptiFine is not installed in this profile. Download the OptiFine jar for your Minecraft version and add it from the profile editor.');
      e.code = 'NEEDS_OPTIFINE';
      throw e;
    }

    let merged;
    let staged;
    const limit = Math.max(2, Math.min(32, cfg.network.connections || 10));
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await loaders.ensure(profile, { javaPath: java.path, emit, signal: job.signal, force: attempt > 0 });
      if (res.installedFor && (res.installedFor !== profile.loaderInstalledFor || res.versionId !== profile.loaderInstalledId)) {
        profiles.touch(profileId, { loaderInstalledFor: res.installedFor, loaderInstalledId: res.versionId, loaderVersion: profile.loaderVersion || res.loaderVersion });
        Object.assign(profile, { loaderInstalledFor: res.installedFor, loaderInstalledId: res.versionId });
      }
      merged = await game.resolveVersion(res.versionId, job.signal);
      try {
        staged = await game.prepare(merged, profile.gameDir, { signal: job.signal, onProgress: progress, limit, verify: !!cfg.perf.verifyFiles });
        break;
      } catch (e) {
        if (e.code === 'LOADER_INCOMPLETE' && attempt === 0 && profile.loader !== 'vanilla') { emit({ stage: 'Repairing loader', indeterminate: true }); continue; }
        throw e;
      }
    }

    const mem = profile.memory.mode === 'auto' ? autoMemory(profile) : { max: profile.memory.max, min: profile.memory.min };
    const args = game.buildCommand(merged, {
      auth, gameDir: profile.gameDir, staged, profile, javaMajor: java.major || major, memory: mem, globalJvmArgs: cfg.game.jvmArgs,
    });

    emit({ stage: 'Starting Minecraft', indeterminate: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(P.logs, `${profile.name.replace(/[^\w-]+/g, '_')}-${stamp}.log`);
    fs.mkdirSync(P.logs, { recursive: true });
    fs.writeFileSync(logPath, `[Wares] ${java.path} (${java.source})${staged.fast ? ' fast start' : ''} - ${profile.name}, Minecraft ${profile.mcVersion}${profile.loader !== 'vanilla' ? ' ' + profile.loader : ''}\n`);
    pruneLogs();
    const fd = fs.openSync(logPath, 'a');
    let child;
    try { child = game.start(java.path, args, profile.gameDir, fd); } finally { fs.closeSync(fd); }
    await new Promise((r) => setImmediate(r));
    if (!child.pid) throw new Error(`Could not start Java (${java.path}). Check the Java setting for this profile.`);
    const startedAt = Date.now();
    starting.delete(profileId);
    perf.boostGame(child.pid);
    track(profileId, { pid: child.pid, startedAt, logPath, versionId: merged.id, name: profile.name }, child);
    perf.onGameCount(running.size);
    job.done('Running');
    notify('game:state', { profileId, state: 'running', startedAt, pid: child.pid });
    return { pid: child.pid };
  } catch (e) {
    starting.delete(profileId);
    job.fail(e);
    notify('game:state', { profileId, state: 'closed', code: null, failed: true });
    emitActive();
    throw e;
  } finally {
    if (starting.delete(profileId)) emitActive();
  }
}

function stop(profileId) {
  const r = running.get(profileId);
  if (!r) return false;
  r.stopped = true;
  try { if (r.child) r.child.kill(); else process.kill(r.pid); } catch { /* already gone */ }
  setTimeout(() => { if (running.has(profileId) && !r.finished) killHard(r.pid); }, 4000);
  return true;
}

function status() { return [...running.values()].map((r) => ({ profileId: r.profileId, startedAt: r.startedAt, pid: r.pid })); }
function logs(profileId) { const r = running.get(profileId); return r ? r.ring : []; }
function isRunning(profileId) { return running.has(profileId); }
function anyRunning() { return running.size > 0; }
function activeCount() { return running.size + starting.size; }

module.exports = { launch, stop, status, logs, isRunning, anyRunning, activeCount, onActive, restore, listRunning, setNotifier };
