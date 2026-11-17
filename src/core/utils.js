/* ----------------------------------------------------------------------------- utils */
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let statusTimer;
function status(msg, keep) {
  statusEl.textContent = msg; statusEl.style.opacity = 1;
  clearTimeout(statusTimer);
  if (!keep) statusTimer = setTimeout(() => statusEl.style.opacity = 0, 4000);
}
/* L2: LRU bounded by size (strings ~2 bytes per char; parsed rows estimated per row); most recently used last */
class LRU {
  constructor(maxBytes, sizeOf) { this.m = new Map(); this.max = maxBytes; this.size = 0; this.sizeOf = sizeOf; }
  has(k) { return this.m.has(k); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v.v; }
  set(k, v) { if (this.m.has(k)) { this.size -= this.m.get(k).n; this.m.delete(k); } const n = this.sizeOf(v); this.m.set(k, { v, n }); this.size += n;
    for (const [k0, e] of this.m) { if (this.size <= this.max || this.m.size <= 1) break; this.m.delete(k0); this.size -= e.n; } return this; }
  clear() { this.m.clear(); this.size = 0; }
}
const cache = new LRU(200 * 1048576, (t) => (t?.length || 0) * 2);
/* RCSB / UniProt downloads belong to the newest load (loads.signal, src/core/session.js): a newer loadScene cancels them.
   Each download in flight is registered in that session (probe().session.resources.fetch). */
async function fetchText(url, opts) {
  const key = url + (opts ? JSON.stringify(opts) : '');
  if (cache.has(key)) return cache.get(key);
  const scened = /^https:\/\/(data|models|files|search)\.rcsb\.org\/|^https:\/\/rest\.uniprot\.org\//.test(url);
  const S = loads.latest, tok = scened ? S.resources.add('fetch', {}, null) : null;
  try {
    const r = await fetch(url, scened && !opts?.signal ? { ...(opts || {}), signal: S.signal } : opts);
    if (!r.ok) throw new Error(`下载失败 ${r.status}: ${url}`);
    const t = await r.text(); cache.set(key, t); return t;
  } finally { if (tok) S.resources.forget(tok); }
}
const kwMatch = (name, key) => {
  if (key.startsWith('/') && key.lastIndexOf('/') > 0) { const i = key.lastIndexOf('/'); return new RegExp(key.slice(1, i), key.slice(i + 1) || 'i').test(name); }
  return name.toLowerCase().includes(key.toLowerCase());
};
const findKey = (obj, name) => obj && Object.keys(obj).find(k => kwMatch(name, k));

