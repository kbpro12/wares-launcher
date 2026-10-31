'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
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

async function launch(profileId, accountId) {
  const profile = profiles.get(profileId);
  if (!profile) throw new Error('Profile not found.');
  if (running.has(profileId) || starting.has(profileId)) throw new Error('This profile is already running.');
  starting.add(profileId);
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
    const child = game.start(java.path, args, profile.gameDir);
    const run = { child, startedAt: Date.now(), ring: [], pending: [], timer: null, stopped: false, logFile: null, versionId: merged.id };
    running.set(profileId, run);
    starting.delete(profileId);
    perf.boostGame(child.pid);
    perf.onGameCount(running.size);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    run.logFile = fs.createWriteStream(path.join(P.logs, `${profile.name.replace(/[^\w-]+/g, '_')}-${stamp}.log`));
    pruneLogs();
    const push = (text, level) => {
      for (const raw of String(text).split(/\r?\n/)) {
        if (!raw) continue;
        const entry = { t: Date.now(), level: level || levelOf(raw), text: raw };
        run.ring.push(entry);
        if (run.ring.length > RING) run.ring.shift();
        run.pending.push(entry);
        run.logFile.write(raw + '\n');
      }
      if (!run.timer) run.timer = setTimeout(() => { run.timer = null; const batch = run.pending.splice(0); if (batch.length) notify('game:log', { profileId, lines: batch }); }, 120);
    };
    push(`[Wares] ${java.path} (${java.source})${staged.fast ? ' fast start' : ''} - ${profile.name}, Minecraft ${profile.mcVersion}${profile.loader !== 'vanilla' ? ' ' + profile.loader : ''}`, 'meta');
    child.stdout.on('data', (b) => push(b.toString()));
    child.stderr.on('data', (b) => push(b.toString()));
    child.on('error', (e) => push(`[Wares] Process error: ${e.message}`, 'error'));
    child.on('close', (code) => {
      clearTimeout(run.timer);
      const rest = run.pending.splice(0);
      if (rest.length) notify('game:log', { profileId, lines: rest });
      run.logFile.end();
      running.delete(profileId);
      perf.onGameCount(running.size);
      const secs = (Date.now() - run.startedAt) / 1000;
      if (!run.stopped && code !== 0 && secs < 25) game.invalidate(run.versionId); // quick crash: re-verify files next time
      profiles.recordPlay(profileId, secs);
      notify('game:state', { profileId, state: 'closed', code, crashed: !run.stopped && code !== 0 && secs > 0, seconds: secs });
    });
    job.done('Running');
    notify('game:state', { profileId, state: 'running', startedAt: run.startedAt, pid: child.pid });
    return { pid: child.pid };
  } catch (e) {
    starting.delete(profileId);
    job.fail(e);
    notify('game:state', { profileId, state: 'closed', code: null, failed: true });
    throw e;
  } finally {
    starting.delete(profileId);
  }
}

function stop(profileId) {
  const r = running.get(profileId);
  if (!r) return false;
  r.stopped = true;
  r.child.kill();
  setTimeout(() => { try { if (running.has(profileId)) r.child.kill('SIGKILL'); } catch { /* gone */ } }, 4000);
  return true;
}

function status() { return [...running.entries()].map(([profileId, r]) => ({ profileId, startedAt: r.startedAt, pid: r.child.pid })); }
function logs(profileId) { const r = running.get(profileId); return r ? r.ring : []; }
function isRunning(profileId) { return running.has(profileId); }
function anyRunning() { return running.size > 0; }

module.exports = { launch, stop, status, logs, isRunning, anyRunning, setNotifier };
