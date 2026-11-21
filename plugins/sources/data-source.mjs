import { describeStructureAsset, describePredictedStructure, describeMapResource, sha256Hex } from '../../packages/schema/resource.mjs';
import { parseMrc } from '../structure/density-map.mjs';

/**
 * External data sources as trusted clients (docs/PLUGIN_ROADMAP.md, A4): where a structure or a map comes from, how it is fetched, and what is promised about it. A client only talks to the hosts a
 * source lists, only over https, reads at most the size the source allows (also after decompression), and records the SHA-256 of what it got the first time (trust on first use): a later fetch that
 * gives different bytes is refused unless the caller says the update is wanted. Fetched bytes are cached under their hash, so a machine without a network still opens what it has seen, checked again
 * against the recorded hash. `fetch`, the cache and the hash book are injected (the browser passes its own; tests pass fakes), and a failure never leaves a half-written entry.
 *
 * The built-in source definitions are what the author believes the URLs and licences to be. Only RCSB has been checked against the live service (tools/datasource-check.mjs); AlphaFold DB and EMDB have
 * not (this environment cannot reach them), their licences have not been checked against the current terms, and the `verified` flag on each says so.
 */
export class SourceError extends Error { constructor(code, message) { super(message); this.name = 'SourceError'; this.code = code; } }

export const SOURCES = Object.freeze({
  rcsb: Object.freeze({ id: 'rcsb', name: 'RCSB Protein Data Bank', hosts: ['files.rcsb.org'], accession: /^[0-9][A-Za-z0-9]{3}$/, url: (a) => `https://files.rcsb.org/download/${a.toUpperCase()}.cif`, maxBytes: 64 * 1024 * 1024, kind: 'structure', mediaType: 'chemical/x-mmcif', license: 'CC0-1.0', verified: true }),
  alphafold: Object.freeze({ id: 'alphafold', name: 'AlphaFold Protein Structure Database', hosts: ['alphafold.ebi.ac.uk'], accession: /^[A-Z0-9]{6,10}$/, url: (a) => `https://alphafold.ebi.ac.uk/files/AF-${a}-F1-model_v4.cif`, maxBytes: 32 * 1024 * 1024, kind: 'predicted-structure', mediaType: 'chemical/x-mmcif', license: 'CC-BY-4.0', verified: false,
    note: 'URL pattern and licence are from memory and unchecked: the database may serve a newer model version than v4, and its terms must be read before use.' }),
  emdb: Object.freeze({ id: 'emdb', name: 'Electron Microscopy Data Bank', hosts: ['ftp.ebi.ac.uk'], accession: /^EMD-[0-9]{4,5}$/, url: (a) => { const n = a.slice(4); return `https://ftp.ebi.ac.uk/pub/databases/emdb/structures/${a}/map/emd_${n}.map.gz`; }, maxBytes: 256 * 1024 * 1024, decompress: 'gzip', kind: 'map', mediaType: 'application/x-mrc', license: 'CC0-1.0', verified: false,
    note: 'URL pattern and licence are from memory and unchecked: map file names and the licence must be confirmed against the current EMDB layout.' }),
});

/** In-memory cache and hash book with the interface the client needs: get(key) -> value | undefined, set(key, value). A browser passes IndexedDB/Cache API wrappers with the same two methods. */
export const memoryStore = () => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => { m.set(k, v); }, has: (k) => m.has(k), keys: () => [...m.keys()] }; };

async function readLimited(response, limit, signal) {
  if (!response.body) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > limit) throw new SourceError('too-large', `数据超过上限 ${limit} 字节。`); return bytes; }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > limit) throw new SourceError('too-large', `数据超过上限 ${limit} 字节，已停止读取。`);
      chunks.push(value);
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  const out = new Uint8Array(length); let at = 0; for (const c of chunks) { out.set(c, at); at += c.byteLength; } return out;
}
async function gunzip(bytes, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), reader = stream.getReader(), chunks = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) throw new SourceError('too-large', `解压后超过上限 ${limit} 字节。`); chunks.push(value); } }
  catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('bad-data', `无法解压：${error.message}`); }
  const out = new Uint8Array(length); let at = 0; for (const c of chunks) { out.set(c, at); at += c.byteLength; } return out;
}

/**
 * The client. `sources` defaults to SOURCES; `fetch` is the platform's (or a fake); `cache` and `book` are stores (see memoryStore): the cache holds bytes under "source/accession/sha256", the book holds the
 * recorded hash under "source/accession".
 * load(sourceId, accession, { signal, timeoutMs, expectedSha256, allowUpdate }) -> { bytes, sha256, source, accession, url, fromCache, recorded (first time seen), updated }.
 */
export function createSourceClient({ sources = SOURCES, fetch: fetchImpl = globalThis.fetch, cache = memoryStore(), book = memoryStore(), timeoutMs = 60000 } = {}) {
  return {
    async load(sourceId, accession, { signal, expectedSha256, allowUpdate = false, timeoutMs: ms = timeoutMs } = {}) {
      const source = sources[sourceId]; if (!source) throw new SourceError('unknown-source', `没有数据源“${sourceId}”。`);
      if (typeof accession !== 'string' || !source.accession.test(accession)) throw new SourceError('bad-accession', `“${String(accession)}”不是 ${source.name} 的有效编号。`);
      const url = new URL(source.url(accession)), bookKey = `${sourceId}/${accession}`, recordedHash = book.get(bookKey);
      if (url.protocol !== 'https:' || !source.hosts.includes(url.hostname)) throw new SourceError('not-allowed-host', `${url.hostname} 不在 ${source.name} 允许的主机里。`);
      const fromCache = async (reason) => {
        const hash = expectedSha256 ?? recordedHash; if (!hash) throw new SourceError('offline', `${reason}，且没有这个条目的缓存。`);
        const bytes = cache.get(`${bookKey}/${hash}`); if (!bytes) throw new SourceError('offline', `${reason}，缓存里也没有。`);
        if (await sha256Hex(bytes) !== hash) throw new SourceError('hash-mismatch', '缓存的数据与记录的哈希不符，已拒绝使用。');
        return { bytes, sha256: hash, source, accession, url: url.href, fromCache: true, recorded: false, updated: false };
      };
      let bytes;
      try {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(new SourceError('timeout', `超过 ${ms / 1000} 秒没有响应。`)), ms), both = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        try {
          const response = await fetchImpl(url.href, { signal: both, redirect: 'follow', credentials: 'omit' });
          if (response.url && new URL(response.url).hostname !== url.hostname && !source.hosts.includes(new URL(response.url).hostname)) throw new SourceError('not-allowed-host', `请求被重定向到 ${new URL(response.url).hostname}，不在允许的主机里。`);
          if (!response.ok) throw new SourceError('http', `${source.name} 返回 HTTP ${response.status}。`);
          bytes = await readLimited(response, source.maxBytes, both);
        } finally { clearTimeout(timer); }
        if (source.decompress === 'gzip') bytes = await gunzip(bytes, source.maxBytes);
      } catch (error) {
        if (signal?.aborted) throw new SourceError('aborted', '已取消。');
        if (error instanceof SourceError && !['timeout'].includes(error.code)) throw error;
        return fromCache(error instanceof SourceError ? error.message : `无法连接 ${source.name}（${error.message}）`);   // the network is not there: what was seen before, checked again
      }
      const sha256 = await sha256Hex(bytes);
      if (expectedSha256 && sha256 !== expectedSha256) throw new SourceError('hash-mismatch', `取回的数据与期望的哈希不符（${sha256.slice(0, 12)}… ≠ ${expectedSha256.slice(0, 12)}…）。`);
      if (recordedHash && recordedHash !== sha256 && !allowUpdate) throw new SourceError('changed-upstream', `${source.name} 上的 ${accession} 与第一次取回的不同了（${recordedHash.slice(0, 12)}… → ${sha256.slice(0, 12)}…）；确认要更新再用 allowUpdate。`);
      const recorded = !recordedHash, updated = Boolean(recordedHash && recordedHash !== sha256);
      cache.set(`${bookKey}/${sha256}`, bytes); book.set(bookKey, sha256);   // only after every check passed
      return { bytes, sha256, source, accession, url: url.href, fromCache: false, recorded, updated };
    },
  };
}

/** The resource record for what a client fetched (by the source's kind): a structure, a predicted structure or a density map. `retrievedAt` is recorded when given. */
export function resourceFor(result, { retrievedAt } = {}) {
  const { source, accession, sha256, bytes } = result, common = { provider: source.id, accession, sha256, bytes: bytes.byteLength, license: source.license, url: result.url };
  if (source.kind === 'structure') return describeStructureAsset({ path: `${accession}.cif`, sha256, mediaType: source.mediaType, provenance: { source: { provider: 'RCSB PDB', accession } } }, bytes).record;
  if (source.kind === 'predicted-structure') return describePredictedStructure({ ...common, method: 'AlphaFold', mediaType: source.mediaType, path: `${accession}.cif`, retrievedAt, credit: source.name });
  if (source.kind === 'map') { const map = parseMrc(bytes); return describeMapResource({ ...common, mediaType: source.mediaType, path: `${accession}.map`, map, credit: source.name }); }
  throw new SourceError('unknown-kind', `不认识的资源类型 ${source.kind}。`);
}
