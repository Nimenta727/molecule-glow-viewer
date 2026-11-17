const ACCESSION = /^[0-9][A-Z0-9]{3}$/;
const MAX_BYTES = 30 * 1024 * 1024;
const CACHE_ENTRIES = 4;
const mediaType = 'chemical/x-mmcif';

function normalize(accession) {
  if (typeof accession !== 'string') throw new TypeError('RCSB accession must be a four-character string');
  const value = accession.toUpperCase();
  if (!ACCESSION.test(value)) throw new TypeError(`Invalid RCSB accession: ${accession}`);
  return value;
}

function copyBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError('Cached coordinate data must be bytes');
}

async function responseBytes(response, signal) {
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('RCSB coordinate file exceeds 30 MiB');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the read failure. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createRcsbSource({ fetchImpl = globalThis.fetch, cache } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const ownsCache = cache === undefined;
  cache ??= new Map();
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') throw new TypeError('cache must provide get and set');

  return Object.freeze({
    async load(accession, { signal } = {}) {
      const normalized = normalize(accession);
      if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      const cached = cache.get(normalized);
      if (cached != null) {
        const bytes = copyBytes(cached);
        if (bytes.byteLength > MAX_BYTES) throw new Error('Cached RCSB coordinate file exceeds 30 MiB');
        if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        return { name: `${normalized}.cif`, bytes, source: { provider: 'RCSB PDB', accession: normalized }, mediaType };
      }

      const response = await fetchImpl(`https://files.rcsb.org/download/${normalized}.cif`, { signal });
      if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      if (!response?.ok) throw new Error(`RCSB download failed for ${normalized}: HTTP ${response?.status ?? 'unknown'}`);
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('RCSB coordinate file exceeds 30 MiB');
      const bytes = await responseBytes(response, signal);
      if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      if (bytes.byteLength > MAX_BYTES) throw new Error('RCSB coordinate file exceeds 30 MiB');
      if (ownsCache && !cache.has(normalized) && cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(normalized, new Uint8Array(bytes));
      return { name: `${normalized}.cif`, bytes, source: { provider: 'RCSB PDB', accession: normalized }, mediaType };
    },
  });
}
