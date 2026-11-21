/**
 * Draft recovery for the Studio (4.5.2, failure recovery): the project is saved to a small local store while it is edited, so a closed tab, a crash or a failed export does not lose the work. The
 * store is injected (the Studio uses IndexedDB; tests use a Map): async get(key) / set(key, value) / delete(key). The newest few drafts are kept; each carries the SHA-256 of its bytes, and a draft
 * whose bytes no longer match (a damaged store) is skipped, never offered. Nothing here knows what a project is: the bytes are whatever `encodeProject` made.
 */
export const DRAFT_KEY = 'glow-studio-drafts';
export const MAX_DRAFT_BYTES = 128 * 1024 * 1024;

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const validEntry = (entry) => entry && typeof entry === 'object' && typeof entry.name === 'string' && Number.isFinite(entry.savedAt) && /^[a-f0-9]{64}$/.test(entry.sha256 ?? '') && entry.data instanceof Uint8Array;

export function createRecovery({ store, key = DRAFT_KEY, keep = 3, maxBytes = MAX_DRAFT_BYTES, now = () => Date.now() } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.delete !== 'function') throw new TypeError('recovery needs a store with get, set and delete');
  async function read() {
    let value;
    try { value = await store.get(key); } catch { return []; }
    return Array.isArray(value) ? value.filter(validEntry) : [];
  }
  return {
    /** Saves a draft; returns { saved: true, savedAt, sha256, bytes } or { saved: false, reason }. A store that fails (full disk, private window) is reported, not thrown. */
    async save({ name, bytes }) {
      if (typeof name !== 'string' || !name || !(bytes instanceof Uint8Array)) throw new TypeError('a draft needs a name and bytes');
      if (bytes.byteLength > maxBytes) return { saved: false, reason: 'too-large' };
      const entry = { name, savedAt: now(), sha256: await sha256Hex(bytes), data: new Uint8Array(bytes) };
      const entries = (await read()).filter((item) => item.sha256 !== entry.sha256);   // the same content twice is one draft
      const next = [entry, ...entries].slice(0, keep);
      try { await store.set(key, next); } catch (error) { return { saved: false, reason: 'store-failed', message: error.message }; }
      return { saved: true, savedAt: entry.savedAt, sha256: entry.sha256, bytes: bytes.byteLength };
    },
    /** The drafts newest first, without their bytes. */
    async list() { return (await read()).map(({ name, savedAt, sha256, data }) => ({ name, savedAt, sha256, bytes: data.byteLength })); },
    /** The newest draft whose bytes still match their hash (or the newest of a given name), with the bytes; null when there is none. */
    async latest({ name } = {}) {
      for (const entry of await read()) {
        if (name && entry.name !== name) continue;
        if (await sha256Hex(entry.data) === entry.sha256) return { name: entry.name, savedAt: entry.savedAt, sha256: entry.sha256, bytes: new Uint8Array(entry.data) };
      }
      return null;
    },
    async clear() { try { await store.delete(key); } catch { /* nothing to recover from */ } },
  };
}

/** An IndexedDB-backed store for the browser: one object store, values kept as they are (structured clone). */
export function indexedDbStore({ name = 'glow-studio', indexedDB = globalThis.indexedDB } = {}) {
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async (mode, action) => {
    const db = await open();
    try { return await new Promise((resolve, reject) => { const tx = db.transaction('kv', mode), request = action(tx.objectStore('kv')); tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
    finally { db.close(); }
  };
  return { get: (key) => run('readonly', (store) => store.get(key)), set: (key, value) => run('readwrite', (store) => store.put(value, key)), delete: (key) => run('readwrite', (store) => store.delete(key)) };
}
