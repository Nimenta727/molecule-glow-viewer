import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceStore, sha256Hex, validateResource, ResourceError } from '../resource.mjs';

const encode = (text) => new TextEncoder().encode(text);
async function record(id, version, text, extra = {}) {
  const bytes = encode(text);
  return {
    record: { format: 'glow-resource', schemaVersion: 1, id, version, kind: 'structure',
      files: [{ path: `assets/res/${id}.cif`, sha256: await sha256Hex(bytes), mediaType: 'chemical/x-mmcif', bytes: bytes.byteLength }],
      source: { provider: 'rcsb', accession: '6ZPO', assemblyId: '1' }, attribution: { license: 'CC0-1.0' }, ...extra },
    files: new Map([[`assets/res/${id}.cif`, bytes]]),
  };
}

test('a valid resource record is accepted and a malformed one is rejected', async () => {
  const { record: ok } = await record('res.rcsb.6ZPO', '1', 'data_6ZPO');
  assert.equal(validateResource(ok).id, 'res.rcsb.6ZPO');
  assert.throws(() => validateResource({ ...ok, kind: 'protein-ish' }), /Resource is invalid/);
  assert.throws(() => validateResource({ ...ok, attribution: {} }), /Resource is invalid/);
  assert.throws(() => validateResource({ ...ok, files: [ok.files[0], ok.files[0]] }), /duplicate file path/);
});

test('res-missing: a store without the bytes or the record reports it precisely', async () => {
  const store = createResourceStore();
  const { record: r } = await record('res.a', '1', 'data_a');
  await assert.rejects(store.add(r, new Map()), (error) => error instanceof ResourceError && error.code === 'res-missing');
  assert.equal(store.has('res.a', '1'), false);
  await assert.rejects(store.resolve({ id: 'res.a', version: '1' }), (error) => error.code === 'res-missing');
});

test('res-hash-mismatch: wrong bytes are refused and nothing is stored', async () => {
  const store = createResourceStore();
  const { record: r } = await record('res.a', '1', 'data_a');
  await assert.rejects(store.add(r, new Map([[r.files[0].path, encode('data_X')]])), (error) => error.code === 'res-hash-mismatch');
  assert.equal(store.has('res.a', '1'), false);
  assert.equal(store.blobCount, 0);
  const good = await record('res.a', '1', 'data_a');
  await store.add(good.record, good.files);
  await assert.rejects(store.resolve({ id: 'res.a', version: '1', sha256: 'f'.repeat(64) }), (error) => error.code === 'res-hash-mismatch');
});

test('res-dedupe: identical bytes under two resources are stored once', async () => {
  const store = createResourceStore();
  const a = await record('res.a', '1', 'same bytes');
  const b = await record('res.b', '1', 'same bytes');
  await store.add(a.record, a.files);
  await store.add(b.record, b.files);
  assert.equal(store.list().length, 2);
  assert.equal(store.blobCount, 1);
});

test('records are immutable and a changed resource needs a new version', async () => {
  const store = createResourceStore();
  const a = await record('res.a', '1', 'v1');
  await store.add(a.record, a.files);
  await assert.rejects(store.add(a.record, a.files), (error) => error.code === 'res-exists');
  const v2 = await record('res.a', '2', 'v2');
  await store.add(v2.record, v2.files);
  assert.ok(store.has('res.a', '1') && store.has('res.a', '2'));
});

test('instances cannot alter the original bytes: resolve hands out copies', async () => {
  const store = createResourceStore();
  const a = await record('res.a', '1', 'original');
  await store.add(a.record, a.files);
  const first = await store.resolve({ id: 'res.a', version: '1' });
  first.files.get(a.record.files[0].path).fill(0);
  const second = await store.resolve({ id: 'res.a', version: '1' });
  assert.equal(new TextDecoder().decode(second.files.get(a.record.files[0].path)), 'original');
});
