'use strict';
const crypto = require('crypto');

let send = () => {};
const jobs = new Map();

function setSender(fn) { send = fn; }

/** Long-running task with progress reporting and cancellation. */
function create(title, meta = {}) {
  const id = crypto.randomUUID();
  const ctl = new AbortController();
  const job = { id, title, meta, state: 'running', stage: '', text: '', current: 0, total: 0, indeterminate: true, ctl };
  jobs.set(id, job);
  let last = 0;
  const push = (force) => {
    const now = Date.now();
    if (!force && now - last < 90) return;
    last = now;
    const { ctl: _c, ...pub } = job;
    send('job:update', pub);
  };
  push(true);
  return {
    id,
    signal: ctl.signal,
    update(p) {
      if (p.stage !== undefined) job.stage = p.stage;
      if (p.text !== undefined) job.text = p.text;
      if (p.total !== undefined) { job.total = p.total; job.current = p.current || 0; job.indeterminate = !p.total; }
      if (p.indeterminate) job.indeterminate = true;
      push(false);
    },
    done(text) { job.state = 'done'; job.text = text || ''; job.indeterminate = false; job.current = job.total; push(true); setTimeout(() => jobs.delete(id), 30e3); },
    fail(err) {
      job.state = ctl.signal.aborted ? 'cancelled' : 'error';
      job.text = ctl.signal.aborted ? 'Cancelled' : String((err && err.message) || err);
      job.indeterminate = false;
      push(true);
      setTimeout(() => jobs.delete(id), 60e3);
    },
  };
}

function cancel(id) { const j = jobs.get(id); if (j) j.ctl.abort(); }
function snapshot() { return [...jobs.values()].map(({ ctl, ...p }) => p); }

module.exports = { setSender, create, cancel, snapshot };
