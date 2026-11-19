import test from 'node:test';
import assert from 'node:assert/strict';
import { createRcsbSource } from '../index.mjs';

const response = (bytes, { ok = true, status = 200, contentLength = null } = {}) => ({
  ok, status,
  headers: { get(name) { return name === 'content-length' ? contentLength : null; } },
  async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
});

test('normalizes legacy accession syntax and returns copied coordinate data', async () => {
  const calls = [];
  const cache = new Map();
  const source = createRcsbSource({ cache, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return response([1, 2, 3]);
  } });
  const result = await source.load('1k4c');
  assert.equal(calls[0][0], 'https://files.rcsb.org/download/1K4C.cif');
  assert.equal(calls[0][1].signal, undefined);
  assert.deepEqual(result, {
    name: '1K4C.cif', bytes: new Uint8Array([1, 2, 3]),
    source: { provider: 'RCSB PDB', accession: '1K4C' }, mediaType: 'chemical/x-mmcif',
  });
  result.bytes[0] = 99;
  const cached = await source.load('1K4C');
  assert.deepEqual(cached.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(calls.length, 1);
});

test('rejects invalid accession values without making requests', async () => {
  let calls = 0;
  const source = createRcsbSource({ fetchImpl: async () => { calls++; return response([]); } });
  for (const invalid of ['abc', 'A1BC', '1abc/path', ' 1ABC', '1ABC\n', 1234]) {
    await assert.rejects(source.load(invalid), /accession/);
  }
  assert.equal(calls, 0);
});

test('passes AbortSignal to fetch, propagates cancellation, and does not cache failed retrieval', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const cache = new Map();
  const source = createRcsbSource({ cache, fetchImpl: async (_url, { signal }) => {
    receivedSignal = signal;
    controller.abort(new Error('cancelled'));
    signal.throwIfAborted();
    return response([1]);
  } });
  await assert.rejects(source.load('1ABC', { signal: controller.signal }), /cancelled/);
  assert.equal(receivedSignal, controller.signal);
  assert.equal(cache.has('1ABC'), false);
});

test('checks HTTP status and both declared and actual size before caching', async () => {
  let cache = new Map();
  let source = createRcsbSource({ cache, fetchImpl: async () => response([], { ok: false, status: 503 }) });
  await assert.rejects(source.load('1ABC'), /HTTP 503/);
  assert.equal(cache.size, 0);

  source = createRcsbSource({ cache, fetchImpl: async () => response([], { contentLength: 30 * 1024 * 1024 + 1 }) });
  await assert.rejects(source.load('1ABC'), /exceeds 30 MiB/);
  assert.equal(cache.size, 0);

  const huge = new Uint8Array(30 * 1024 * 1024 + 1);
  source = createRcsbSource({ cache, fetchImpl: async () => response(huge) });
  await assert.rejects(source.load('1ABC'), /exceeds 30 MiB/);
  assert.equal(cache.size, 0);
});

test('rejects an already aborted signal before fetch or cache read', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const source = createRcsbSource({ cache: new Map([['1ABC', new Uint8Array([7])]]), fetchImpl: async () => { calls++; return response([]); } });
  await assert.rejects(source.load('1ABC', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('reduced RCSB previews preserve both coordinate blocks and use a separate cache entry', async () => {
  const calls = [];
  const source = createRcsbSource({ fetchImpl: async (url) => {
    calls.push(url);
    const text = url.includes('label_atom_id=CA') ? 'data_ca' : url.includes('label_atom_id=P') ? 'data_p' : 'data_header';
    return response(new TextEncoder().encode(text));
  } });
  const preview = await source.loadBackbone('4hhb');
  assert.equal(new TextDecoder().decode(preview.bytes), 'data_ca\ndata_p\ndata_header\n');
  assert.equal(preview.source.coordinateSet, 'backbone');
  assert.deepEqual(preview.source.queries, calls);
  preview.bytes[0] = 0;
  assert.equal(new TextDecoder().decode((await source.loadBackbone('4HHB')).bytes), 'data_ca\ndata_p\ndata_header\n');
  await source.load('4HHB');
  assert.equal(calls.length, 4);
  assert.match(calls[3], /files\.rcsb\.org\/download/);
});
