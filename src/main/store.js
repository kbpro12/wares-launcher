'use strict';
const fs = require('fs');
const path = require('path');

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

/** Small JSON file store: atomic debounced writes, deep-merge patching. */
class Store {
  constructor(file, defaults) {
    Store.all.add(this);
    this.file = file;
    this.defaults = defaults;
    this.data = merge(defaults, {});
    this._timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = Array.isArray(defaults) ? raw : merge(defaults, raw);
    } catch { /* first run or corrupt: keep defaults */ }
  }
  get() { return this.data; }
  patch(p) { this.data = merge(this.data, p); this._queue(); return this.data; }
  set(d) { this.data = d; this._queue(); return this.data; }
  _queue() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[store] write failed', this.file, e.message); }
  }
}

Store.all = new Set();
Store.flushAll = () => { for (const s of Store.all) s.flush(); };

module.exports = { Store, merge };
