'use strict';
/** Resource management: process priority while gaming, cache trimming, memory metrics. */
const os = require('os');
const { app, session } = require('electron');
const settings = require('./settings');

let send = () => {};
let lowered = false;

function setSender(fn) { send = fn; }

function setPrio(pid, prio) { try { os.setPriority(pid, prio); } catch { /* not permitted */ } }

function launcherPids() {
  const pids = new Set([process.pid]);
  try { for (const m of app.getAppMetrics()) pids.add(m.pid); } catch { /* ignore */ }
  return [...pids];
}

/** Give the game the CPU while it runs: keep the launcher's processes at low priority. */
function onGameCount(count) {
  const want = count > 0 && settings.get().perf.lowerPriorityInGame !== false;
  if (want === lowered) return;
  lowered = want;
  const prio = want ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL;
  for (const pid of launcherPids()) setPrio(pid, prio);
  if (want) trim();
}

function boostGame(pid) { setPrio(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); }

/** Drop caches the launcher can rebuild cheaply. */
async function trim() {
  try { await session.defaultSession.clearCache(); } catch { /* ignore */ }
  try { await session.defaultSession.clearCodeCaches({}); } catch { /* ignore */ }
  send('app:trim', {});
}

function metrics() {
  let rss = 0;
  const procs = [];
  try {
    for (const m of app.getAppMetrics()) {
      const mb = (m.memory.workingSetSize || 0) / 1024;
      rss += mb;
      procs.push({ type: m.type, mb: Math.round(mb), cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10 });
    }
  } catch { /* ignore */ }
  return { totalMb: Math.round(rss), processes: procs };
}

module.exports = { setSender, onGameCount, boostGame, trim, metrics };
