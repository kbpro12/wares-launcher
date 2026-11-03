'use strict';
/**
 * Wallpaper presets from files. Two sources are scanned:
 *   bundled: renderer/assets/wallpapers  (ships with the launcher)
 *   user:    <data folder>/wallpapers    (drop files here, or use "Add files")
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { nativeImage } = require('electron');
const { P } = require('./paths');

const KINDS = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image', '.mp4': 'video', '.webm': 'video' };

function bundledDir() {
  const d = path.join(__dirname, '..', '..', 'renderer', 'assets', 'wallpapers');
  const unpacked = d.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : d;
}

function pretty(file) {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function scan(dir, source) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => KINDS[path.extname(n).toLowerCase()]).sort().map((n) => {
    const file = path.join(dir, n);
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* ignore */ }
    return { id: `${source}/${n}`, name: pretty(n), file, kind: KINDS[path.extname(n).toLowerCase()], ext: path.extname(n).slice(1).toLowerCase(), source, size };
  });
}

function all() { return [...scan(bundledDir(), 'bundled'), ...scan(P.wallpapers, 'user')]; }

function list() { return all().map(({ file, ...r }) => ({ ...r, url: pathToFileURL(file).href })); }

function find(id) { return all().find((w) => w.id === id) || null; }

/** { url, kind } for a wallpaper id, or null when the file is gone. */
function resolve(id) {
  const w = id && find(id);
  if (!w) return null;
  return { url: pathToFileURL(w.file).href + `?v=${Math.round(fs.statSync(w.file).mtimeMs)}`, kind: w.kind };
}

async function add(files) {
  await fsp.mkdir(P.wallpapers, { recursive: true });
  const added = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!KINDS[ext]) continue;
    let name = path.basename(f).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    let n = 1;
    while (fs.existsSync(path.join(P.wallpapers, name))) name = `${path.basename(f, ext)}-${++n}${ext}`;
    await fsp.copyFile(f, path.join(P.wallpapers, name));
    added.push(`user/${name}`);
  }
  return added;
}

async function remove(id) {
  const w = find(id);
  if (!w || w.source !== 'user') throw new Error('Only wallpapers you added can be removed.');
  await fsp.rm(w.file, { force: true });
}

/** Small JPEG data URL for PNG/JPEG wallpapers, cached on disk. Other kinds return null. */
async function thumb(id) {
  const w = find(id);
  if (!w || !['png', 'jpg', 'jpeg'].includes(w.ext)) return null;
  const st = await fsp.stat(w.file);
  const key = crypto.createHash('sha1').update(`${w.file}|${st.size}|${st.mtimeMs}`).digest('hex');
  const cached = path.join(P.thumbs, key + '.jpg');
  try { return 'data:image/jpeg;base64,' + (await fsp.readFile(cached)).toString('base64'); } catch { /* build below */ }
  try {
    const img = nativeImage.createFromPath(w.file);
    if (img.isEmpty()) return null;
    const jpg = img.resize({ width: 360, quality: 'good' }).toJPEG(72);
    await fsp.mkdir(P.thumbs, { recursive: true });
    await fsp.writeFile(cached, jpg);
    return 'data:image/jpeg;base64,' + jpg.toString('base64');
  } catch { return null; }
}

module.exports = { list, resolve, add, remove, thumb, bundledDir };
