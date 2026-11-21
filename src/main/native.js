'use strict';
/** Bridge to the Rust helper (native/). Any failure falls back to the JS downloader, so the launcher works without it. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXE = process.platform === 'win32' ? 'wares-native.exe' : 'wares-native';
let bin = null;
let probed = false;

function find() {
  if (probed) return bin;
  probed = true;
  const roots = [process.resourcesPath && path.join(process.resourcesPath, 'native'), path.join(__dirname, '..', '..', 'native', 'target', 'release')].filter(Boolean);
  for (const r of roots) { const p = path.join(r, EXE); if (fs.existsSync(p)) { bin = p; break; } }
  return bin;
}

const available = () => !!find();

/**
 * Download tasks natively. Resolves with the tasks that still need the JS fallback.
 * @param {{url:string,dest:string,sha1?:string}[]} tasks
 */
function fetch(tasks, { threads = 16, signal, onBytes, onFile } = {}) {
  return new Promise((resolve) => {
    const exe = find();
    if (!exe) return resolve(tasks);
    const byDest = new Map(tasks.map((t) => [t.dest, t]));
    const failed = new Set();
    let child;
    try { child = spawn(exe, ['fetch', String(threads)], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); } catch { return resolve(tasks); }
    const done = new Set();
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.t === 'b') onBytes && onBytes(m.n);
          else if (m.t === 'f') { done.add(m.d); onFile && onFile(); } else if (m.t === 'e') failed.add(m.d);
        } catch { /* ignore a torn line */ }
      }
    });
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true }); }
    child.on('error', () => resolve(tasks));
    child.on('close', () => {
      if (signal && signal.aborted) return resolve([]);
      resolve([...byDest.values()].filter((t) => !done.has(t.dest)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(tasks.map((t) => `${t.url}\t${t.dest}\t${t.sha1 || ''}\t${t.size || 0}`).join('\n') + '\n');
  });
}

/** Fire-and-forget: warm the OS file cache with the files Java is about to read (helps cold starts, mostly on hard disks). */
function prefetch(files, threads = 4) {
  const exe = find();
  if (!exe || !files.length) return;
  try {
    const c = spawn(exe, ['prefetch', String(threads)], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    c.on('error', () => {});
    c.stdin.on('error', () => {});
    c.stdin.end(files.join('\n') + '\n');
  } catch { /* optional */ }
}

/** Game process: higher priority, no EcoQoS. trimPids: launcher processes whose idle memory is handed back to Windows. */
function boost(gamePid, trimPids = []) {
  const exe = find();
  if (!exe || !gamePid) return;
  try {
    const c = spawn(exe, ['boost', String(gamePid), trimPids.join(',')], { stdio: 'ignore', windowsHide: true });
    c.on('error', () => {});
  } catch { /* optional */ }
}

module.exports = { available, fetch, prefetch, boost };
