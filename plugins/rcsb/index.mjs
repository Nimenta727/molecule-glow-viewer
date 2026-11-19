const ACCESSION = /^[0-9][A-Z0-9]{3}$/;
const MAX_BYTES = 30 * 1024 * 1024;
const CACHE_ENTRIES = 4;
const mediaType = 'chemical/x-mmcif';

export class RcsbCoordinateLimitError extends RangeError {}

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
      if (length > MAX_BYTES) throw new RcsbCoordinateLimitError('RCSB coordinate file exceeds 30 MiB');
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

  async function fetchCoordinates(url, accession, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal });
    signal?.throwIfAborted();
    if (!response?.ok) throw new Error(`RCSB download failed for ${accession}: HTTP ${response?.status ?? 'unknown'}`);
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      try { await response.body?.cancel(); } catch { /* The declared size remains the failure. */ }
      throw new RcsbCoordinateLimitError('RCSB coordinate file exceeds 30 MiB');
    }
    const bytes = await responseBytes(response, signal);
    signal?.throwIfAborted();
    if (bytes.byteLength > MAX_BYTES) throw new RcsbCoordinateLimitError('RCSB coordinate file exceeds 30 MiB');
    return bytes;
  }

  function cacheBytes(key, bytes) {
    if (ownsCache && !cache.has(key) && cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, new Uint8Array(bytes));
  }

  return Object.freeze({
    async load(accession, { signal } = {}) {
      const normalized = normalize(accession);
      if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      const cached = cache.get(normalized);
      if (cached != null) {
        const bytes = copyBytes(cached);
        if (bytes.byteLength > MAX_BYTES) throw new RcsbCoordinateLimitError('Cached RCSB coordinate file exceeds 30 MiB');
        if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        return { name: `${normalized}.cif`, bytes, source: { provider: 'RCSB PDB', accession: normalized }, mediaType };
      }

      const bytes = await fetchCoordinates(`https://files.rcsb.org/download/${normalized}.cif`, normalized, signal);
      cacheBytes(normalized, bytes);
      return { name: `${normalized}.cif`, bytes, source: { provider: 'RCSB PDB', accession: normalized }, mediaType };
    },
    async loadBackbone(accession, { signal } = {}) {
      const normalized = normalize(accession);
      signal?.throwIfAborted();
      const key = `${normalized}:backbone`;
      const queries = ['CA', 'P'].map((atomId) =>
        `https://models.rcsb.org/v1/${normalized.toLowerCase()}/atoms?label_atom_id=${atomId}&encoding=cif&copy_all_categories=false`);
      queries.push(`https://files.rcsb.org/header/${normalized}.cif`);
      const cached = cache.get(key);
      let bytes = cached == null ? undefined : copyBytes(cached);
      if (bytes?.byteLength > MAX_BYTES) throw new RcsbCoordinateLimitError('Cached RCSB coordinate file exceeds 30 MiB');
      if (!bytes) {
        const request = new AbortController();
        const fetchSignal = signal ? AbortSignal.any([signal, request.signal]) : request.signal;
        let parts;
        try {
          parts = await Promise.all(queries.map((url, index) =>
            fetchCoordinates(url, normalized, index === 2
              ? AbortSignal.any([fetchSignal, AbortSignal.timeout(8000)]) : fetchSignal).catch((error) => {
              if (index !== 2 || fetchSignal.aborted) throw error;
              // A coordinate preview remains useful when the separate annotation endpoint fails.
              return new Uint8Array();
            })));
        } finally {
          request.abort();
        }
        const length = parts.reduce((sum, part) => sum + part.length + 1, 0);
        if (length > MAX_BYTES) throw new RcsbCoordinateLimitError('RCSB coordinate file exceeds 30 MiB');
        bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
          bytes[offset++] = 10; // Separate the ModelServer CIF data blocks.
        }
        cacheBytes(key, bytes);
      }
      signal?.throwIfAborted();
      return {
        name: `${normalized}-backbone.cif`, bytes, mediaType,
        source: { provider: 'RCSB PDB', accession: normalized, coordinateSet: 'backbone', queries },
      };
    },
  });
}
