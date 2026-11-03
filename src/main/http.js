'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { P } = require('./paths');

const UA = 'VisdomXD/WaresLauncher/1.0.0 (minecraft launcher)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    ...opts,
    headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
  });
  return res;
}

const memo = new Map();
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/**
 * GET JSON with an on-disk cache. Falls back to a stale copy when offline.
 * ttl is in ms; ttl=0 disables the cache read (but still stores the result).
 */
async function json(url, { ttl = 0, headers, method = 'GET', body } = {}) {
  const key = method === 'GET' ? sha(url) : null;
  const file = key ? path.join(P.cache, key + '.json') : null;
  if (file && ttl > 0) {
    const m = memo.get(key);
    if (m && Date.now() - m.t < ttl) return m.v;
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs < ttl) {
        const v = JSON.parse(await fsp.readFile(file, 'utf8'));
        memo.set(key, { t: Date.now(), v });
        return v;
      }
    } catch { /* miss */ }
  }
  try {
    const res = await request(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
    const v = await res.json();
    if (file) {
      memo.set(key, { t: Date.now(), v });
      fsp.writeFile(file, JSON.stringify(v)).catch(() => {});
    }
    return v;
  } catch (e) {
    if (file) {
      try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* no stale copy */ }
    }
    throw e;
  }
}

async function text(url, { ttl = 0 } = {}) {
  const key = sha('txt' + url);
  const file = path.join(P.cache, key + '.txt');
  if (ttl > 0) {
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs < ttl) return await fsp.readFile(file, 'utf8');
    } catch { /* miss */ }
  }
  try {
    const res = await request(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
    const t = await res.text();
    fsp.writeFile(file, t).catch(() => {});
    return t;
  } catch (e) {
    try { return await fsp.readFile(file, 'utf8'); } catch { throw e; }
  }
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

/**
 * Download url -> dest. Skips when dest already exists with the expected size.
 * Verifies sha1 when provided. Retries with back-off.
 */
async function download(url, dest, o = {}) {
  if (o.size) {
    try { if ((await fsp.stat(dest)).size === o.size) return dest; } catch { /* download */ }
  } else if (o.skipIfExists && await exists(dest)) return dest;

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let last;
  for (let attempt = 1; attempt <= (o.tries || 3); attempt++) {
    const tmp = dest + '.part';
    let counted = 0;
    try {
      const res = await request(url, { signal: o.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const hash = crypto.createHash('sha1');
      const t = new Transform({
        transform(chunk, _e, cb) { hash.update(chunk); counted += chunk.length; o.onBytes && o.onBytes(chunk.length); cb(null, chunk); },
      });
      await pipeline(Readable.fromWeb(res.body), t, fs.createWriteStream(tmp));
      if (o.sha1 && hash.digest('hex') !== o.sha1.toLowerCase()) throw new Error(`Checksum mismatch for ${path.basename(dest)}`);
      await fsp.rename(tmp, dest);
      return dest;
    } catch (e) {
      last = e;
      if (counted && o.onBytes) o.onBytes(-counted); // roll back progress for retry
      fsp.unlink(tmp).catch(() => {});
      if (o.signal && o.signal.aborted) throw e;
      if (attempt < (o.tries || 3)) await sleep(600 * attempt);
    }
  }
  throw last;
}

/** Run worker over items with bounded concurrency. Stops on first error. */
async function pool(items, limit, worker) {
  let i = 0;
  let failed = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed) {
      const idx = i++;
      if (idx >= items.length) return;
      try { await worker(items[idx], idx); } catch (e) { failed = failed || e; }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
}

module.exports = { UA, request, json, text, download, pool, exists, sleep, sha };
