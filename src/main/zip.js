'use strict';
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

function open(file) {
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (e, z) => (e ? rej(e) : res(z))));
}

function readStream(zip, entry) {
  return new Promise((res, rej) => zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))));
}

async function streamToBuffer(s, max = 8 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of s) { n += c.length; if (n > max) throw new Error('entry too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

/** Read several entries by exact name from one zip. Returns { name: Buffer }. */
async function readEntries(file, names, max) {
  const want = new Set(names);
  const out = {};
  let zip;
  try { zip = await open(file); } catch { return out; }
  return new Promise((resolve) => {
    zip.on('entry', async (entry) => {
      try {
        if (want.has(entry.fileName)) out[entry.fileName] = await streamToBuffer(await readStream(zip, entry), max);
      } catch { /* skip unreadable entry */ }
      zip.readEntry();
    });
    zip.on('end', () => resolve(out));
    zip.on('error', () => resolve(out));
    zip.readEntry();
  });
}

async function readEntry(file, name, max) {
  const r = await readEntries(file, [name], max);
  return r[name] || null;
}

/**
 * Extract entries to dest. map(name) returns a relative output path or null to skip.
 * Guards against path traversal.
 */
async function extractAll(file, dest, map = (n) => n) {
  const zip = await open(file);
  const root = path.resolve(dest);
  return new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', async (entry) => {
      try {
        const rel = map(entry.fileName);
        if (rel && !entry.fileName.endsWith('/')) {
          const out = path.resolve(root, rel);
          if (out !== root && !out.startsWith(root + path.sep)) throw new Error('Unsafe path in archive: ' + entry.fileName);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          const s = await readStream(zip, entry);
          await new Promise((ok, bad) => {
            const w = fs.createWriteStream(out);
            s.pipe(w);
            w.on('finish', ok);
            w.on('error', bad);
            s.on('error', bad);
          });
        }
        zip.readEntry();
      } catch (e) { zip.close(); reject(e); }
    });
    zip.readEntry();
  });
}

module.exports = { readEntries, readEntry, extractAll };
