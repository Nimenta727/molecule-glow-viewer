const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fsp = fs.promises;
const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');
class CacheLimitError extends Error { constructor(message) { super(message); this.name = 'CacheLimitError'; } }

// Bodies go to unique temporary files with bounded concurrency, never to arrayBuffer().
// Metadata is the atomic commit marker. Each generation owns a distinct payload file.
function createResponseCache(directory, { maxResource = 64 * 1024 ** 2, maxTotal = 2 * 1024 ** 3,
  maxConcurrent = 8, timeoutMs = 30000 } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const active = new Set(); let serial = Promise.resolve(), epoch = 0;
  const locked = (work) => {
    const result = serial.then(work); serial = result.catch(() => {}); return result;
  };
  const safeFile = (key, file) => typeof file === 'string' &&
    (file === key + '.bin' || new RegExp('^' + key + '\\.[a-f0-9-]+\\.bin$').test(file));
  function read(url) {
    const key = keyOf(url);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(directory, key + '.json'), 'utf8'));
      const file = meta.file ?? key + '.bin';
      if (!safeFile(key, file) || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > maxResource) return null;
      const location = path.join(directory, file), stat = fs.statSync(location);
      if (!stat.isFile() || stat.size !== meta.size) return null;
      // Open before returning: replacing/evicting metadata cannot select a different body.
      const fd = fs.openSync(location, 'r');
      return new Response(Readable.toWeb(fs.createReadStream(location, { fd })), { headers: {
        'content-type': meta.type || 'application/octet-stream', 'content-length': String(meta.size),
        'access-control-allow-origin': '*', 'x-glow-cache': 'hit' } });
    } catch { return null; }
  }
  async function prune(keep) {
    const files = [];
    for (const name of await fsp.readdir(directory)) {
      if (!/^[a-f0-9]{40}(?:\.[a-f0-9-]+)?\.bin$/.test(name)) continue;
      try { const stat = await fsp.stat(path.join(directory, name)); files.push({ name, size: stat.size, time: stat.mtimeMs }); } catch {}
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= maxTotal) break;
      if (file.name === keep) continue;
      try { await fsp.unlink(path.join(directory, file.name)); total -= file.size; } catch { /* Open Windows reader: retry next commit. */ }
    }
    // Drop obsolete metadata too, so many tiny entries cannot grow without bound.
    for (const name of await fsp.readdir(directory)) if (/^[a-f0-9]{40}\.json$/.test(name)) {
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(directory, name), 'utf8'));
        const key = name.slice(0, -5), file = meta.file ?? key + '.bin';
        if (!safeFile(key, file) || !fs.existsSync(path.join(directory, file))) await fsp.rm(path.join(directory, name), { force: true });
      } catch {}
    }
    return total <= maxTotal;
  }
  async function download(url, fetchResponse, { signal } = {}) {
    if (active.size >= maxConcurrent) throw new CacheLimitError('Too many concurrent structure downloads');
    const controller = new AbortController(), generation = epoch;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Structure download timed out')), timeoutMs);
    active.add(controller);
    const key = keyOf(url), name = key + '.' + crypto.randomUUID() + '.bin';
    const temporary = path.join(directory, name + '.part'), payload = path.join(directory, name);
    const metaTemp = path.join(directory, name.replace(/\.bin$/, '.json.part'));
    let reader, handle, committed = false, response, result, passthrough = false;
    const cancelReader = () => { reader?.cancel(controller.signal.reason).catch(() => {}); };
    controller.signal.addEventListener('abort', cancelReader);
    try {
      controller.signal.throwIfAborted();
      response = await fetchResponse(controller.signal);
      controller.signal.throwIfAborted();
      if (!response.ok) { passthrough = true; return response; }
      const declared = response.headers.get('content-length');
      const expected = declared === null ? null : Number(declared);
      if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > Math.min(maxResource, maxTotal))) {
        await response.body?.cancel(); throw new CacheLimitError('Structure response exceeds size limit');
      }
      handle = await fsp.open(temporary, 'wx');
      const digest = crypto.createHash('sha256'); let size = 0;
      reader = response.body?.getReader();
      controller.signal.throwIfAborted();
      while (reader) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted(); if (done) break;
        size += value.byteLength;
        if (size > Math.min(maxResource, maxTotal)) throw new CacheLimitError('Structure response exceeds size limit');
        digest.update(value);
        // FileHandle.write may perform a partial write.
        let offset = 0;
        while (offset < value.byteLength) offset += (await handle.write(value, offset, value.byteLength - offset)).bytesWritten;
      }
      // net.fetch exposes decoded bytes. Compressed Content-Length describes wire bytes.
      const encoded = response.headers.get('content-encoding');
      if (expected !== null && (!encoded || encoded === 'identity') && size !== expected) throw new Error('Incomplete structure response');
      await handle.close(); handle = null;
      const meta = { url, file: name, size, type: response.headers.get('content-type'), sha256: digest.digest('hex'), at: new Date().toISOString() };
      await locked(async () => {
        controller.signal.throwIfAborted();
        if (epoch !== generation) throw new Error('Cache cleared during download');
        await fsp.rename(temporary, payload);
        if (!await prune(name)) throw new CacheLimitError('Structure cache budget exhausted');
        await fsp.writeFile(metaTemp, JSON.stringify(meta), { flag: 'wx' });
        await fsp.rename(metaTemp, path.join(directory, key + '.json'));
        committed = true;
        const fd = fs.openSync(payload, 'r');
        result = new Response(Readable.toWeb(fs.createReadStream(payload, { fd })), { status: response.status, headers: {
          'content-type': meta.type || 'application/octet-stream', 'content-length': String(size), 'access-control-allow-origin': '*' } });
      });
      controller.signal.throwIfAborted();
      return result;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', cancelReader);
      try { await reader?.cancel(); } catch {} reader?.releaseLock();
      if (!reader && !passthrough) try { await response?.body?.cancel(); } catch {}
      if (controller.signal.aborted) try { await result?.body?.cancel(); } catch {}
      await handle?.close();
      await Promise.all([temporary, metaTemp, ...(!committed ? [payload] : [])].map(file => fsp.rm(file, { force: true }).catch(() => {})));
      active.delete(controller);
    }
  }
  async function clear() {
    epoch++; for (const controller of active) controller.abort(new Error('Cache cleared'));
    await locked(async () => {
      for (const file of await fsp.readdir(directory)) if (/^[a-f0-9]{40}(?:\.[a-f0-9-]+)?\.(?:bin|json)(?:\.part)?$/.test(file)) {
        await fsp.rm(path.join(directory, file), { force: true }).catch(() => {});
      }
    });
  }
  // Clean only this cache's unfinished files after a previous interrupted process.
  for (const name of fs.readdirSync(directory)) if (/^[a-f0-9]{40}\.[a-f0-9-]+\.(?:bin|json)\.part$/.test(name)) fs.rmSync(path.join(directory, name), { force: true });
  return { read, download, clear, prune: () => locked(prune) };
}
module.exports = { createResponseCache, CacheLimitError, keyOf };
