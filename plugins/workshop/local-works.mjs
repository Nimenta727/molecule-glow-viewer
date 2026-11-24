import { sha256Hex } from '../../packages/schema/resource.mjs';

/**
 * The local works of this machine: every .glow work the person opens or imports is remembered here (name, size, when), so it can be opened again from the workshop's "本地" zone without
 * looking for the file, exported again under its own name, renamed or removed. Kept in an injected store (the apps use IndexedDB; tests use a Map): the list under one key, each file's bytes
 * under its own key, checked against the SHA-256 on the way out. Nothing leaves the machine and nothing here is part of a work or of the workshop catalogue.
 * A store that fails (full disk, private window) is reported with a sentence, never thrown at the person as a stack.
 */
export const MAX_LOCAL_BYTES = 128 * 1024 * 1024;   // the archive limit of a scene package (packages/schema/archive.mjs)
const INDEX_KEY = 'glow-local-works', BYTES_KEY = (id) => `glow-local-work-bytes:${id}`;

export class LocalWorkError extends Error { constructor(code, message) { super(message); this.name = 'LocalWorkError'; this.code = code; } }

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A file name for a work: its title with the characters Windows forbids taken out (Chinese and other letters stay), and ".glow" at the end. */
export function fileNameFor(title, fallback = '作品') {
  const base = clean(title, 120).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80).trim();
  const safe = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? `${base}_` : base;   // reserved device names on Windows
  return `${safe || fallback}.glow`;
}

/** The size of a file in the words a person uses. */
export const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function createLocalWorks({ store, now = () => Date.now() } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.delete !== 'function') throw new TypeError('the local works need a store with get, set and delete');
  async function read() {
    try { const value = await store.get(INDEX_KEY); return Array.isArray(value) ? value.filter((e) => e && /^[a-f0-9]{64}$/.test(e.id ?? '') && typeof e.title === 'string') : []; } catch { return []; }
  }
  async function write(index) { try { await store.set(INDEX_KEY, index); return null; } catch (error) { return error.message || 'store-failed'; } }

  return {
    /** All remembered works, the newest first: [{ id (the SHA-256 of the file), title, fileName, bytes, addedAt }]. */
    async list() { return (await read()).sort((a, b) => b.addedAt - a.addedAt); },
    /**
     * Remembers a work. The same file (same bytes) is kept once: adding it again only updates its title and moves it to the front. `title` is the name the work shows in the workshop.
     */
    async add({ bytes, fileName, title } = {}) {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new LocalWorkError('empty', '文件是空的。');
      if (bytes.byteLength > MAX_LOCAL_BYTES) throw new LocalWorkError('too-large', `文件超过 ${MAX_LOCAL_BYTES / 1048576} MB，不能收进本地。`);
      const id = await sha256Hex(bytes), name = clean(fileName, 120) || fileNameFor(title), shown = clean(title, 120) || name.replace(/\.(glow|json)$/i, '');
      const index = await read(), existing = index.find((e) => e.id === id);
      if (existing) {
        const next = { ...existing, title: shown, fileName: name, addedAt: now() };
        const failed = await write([next, ...index.filter((e) => e.id !== id)]);
        if (failed) throw new LocalWorkError('store-failed', `无法更新本地记录（${failed}）。`);
        return { entry: next, added: false };
      }
      try { await store.set(BYTES_KEY(id), new Uint8Array(bytes)); }
      catch (error) { throw new LocalWorkError('store-failed', `无法保存到本机（${error.message || '存储失败'}）：可能磁盘已满，或浏览器禁止保存（无痕窗口）。作品本身已经打开，只是不会出现在“本地”里。`); }
      const entry = { id, title: shown, fileName: name, bytes: bytes.byteLength, addedAt: now() };
      const failed = await write([entry, ...index]);
      if (failed) { try { await store.delete(BYTES_KEY(id)); } catch { /* nothing more to undo */ } throw new LocalWorkError('store-failed', `无法保存到本机（${failed}）。`); }
      return { entry, added: true };
    },
    /** The bytes of a remembered work, checked against its hash. */
    async bytes(id) {
      const index = await read(); if (!index.some((e) => e.id === id)) throw new LocalWorkError('missing', '本地没有这个作品。');
      let bytes; try { bytes = await store.get(BYTES_KEY(id)); } catch (error) { throw new LocalWorkError('store-failed', `读取失败（${error.message || '存储失败'}）。`); }
      if (!(bytes instanceof Uint8Array)) throw new LocalWorkError('missing', '这个作品的文件已经不在本机了，请重新导入。');
      if (await sha256Hex(bytes) !== id) throw new LocalWorkError('corrupt', '本机保存的文件和记录的校验值对不上（可能已损坏），请重新导入。');
      return bytes;
    },
    async rename(id, title) {
      const shown = clean(title, 120); if (!shown) throw new LocalWorkError('title', '名称不能为空。');
      const index = await read(), at = index.findIndex((e) => e.id === id); if (at < 0) throw new LocalWorkError('missing', '本地没有这个作品。');
      index[at] = { ...index[at], title: shown }; const failed = await write(index); if (failed) throw new LocalWorkError('store-failed', `无法保存名称（${failed}）。`);
      return index[at];
    },
    async remove(id) {
      const index = await read(); if (!index.some((e) => e.id === id)) return false;
      const failed = await write(index.filter((e) => e.id !== id)); if (failed) throw new LocalWorkError('store-failed', `无法删除（${failed}）。`);
      try { await store.delete(BYTES_KEY(id)); } catch { /* the entry is gone; a stray file is only space */ }
      return true;
    },
  };
}
