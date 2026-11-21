import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createSourceClient, memoryStore, resourceFor, SourceError, SOURCES } from '../data-source.mjs';
import { sha256Hex } from '../../../packages/schema/resource.mjs';

const enc = (t) => new TextEncoder().encode(t);
const respond = (bytes, { status = 200, url } = {}) => ({ ok: status >= 200 && status < 300, status, url, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes });
const fake = (handler) => { const calls = []; const f = async (url, init) => { calls.push(url); return handler(url, init); }; f.calls = calls; return f; };
const THE = { rcsb: { acc: '1abc', body: enc('data_1ABC\n#') } };

test('a fetch is validated, hashed, cached and recorded on first use; the second is checked against the record', async () => {
  const f = fake((url) => respond(THE.rcsb.body, { url })), cache = memoryStore(), book = memoryStore(), client = createSourceClient({ fetch: f, cache, book });
  const first = await client.load('rcsb', '1abc'); assert.equal(f.calls[0], 'https://files.rcsb.org/download/1ABC.cif'); assert.deepEqual([...first.bytes], [...THE.rcsb.body]);
  assert.equal(first.recorded, true); assert.equal(first.fromCache, false); assert.equal(first.sha256, await sha256Hex(THE.rcsb.body)); assert.equal(book.get('rcsb/1abc'), first.sha256); assert.ok(cache.has(`rcsb/1abc/${first.sha256}`));
  const second = await client.load('rcsb', '1abc'); assert.equal(second.recorded, false); assert.equal(second.updated, false);
});

test('bad accessions, unknown sources and hosts that are not on the list are refused before any request', async () => {
  const f = fake(() => respond(enc('x'))), client = createSourceClient({ fetch: f });
  await assert.rejects(() => client.load('nope', 'x'), (e) => e.code === 'unknown-source'); await assert.rejects(() => client.load('rcsb', 'not an id'), (e) => e.code === 'bad-accession'); await assert.rejects(() => client.load('emdb', 'EMD-12'), (e) => e.code === 'bad-accession');
  const evil = { x: { id: 'x', name: 'x', hosts: ['good.example'], accession: /^a$/, url: () => 'https://evil.example/a', maxBytes: 10, kind: 'structure' } };
  await assert.rejects(() => createSourceClient({ sources: evil, fetch: f }).load('x', 'a'), (e) => e.code === 'not-allowed-host');
  const plain = { x: { ...evil.x, url: () => 'http://good.example/a' } }; await assert.rejects(() => createSourceClient({ sources: plain, fetch: f }).load('x', 'a'), (e) => e.code === 'not-allowed-host', 'https only');
  assert.equal(f.calls.length, 0, 'nothing was requested');
  const redirect = createSourceClient({ fetch: fake((url) => respond(enc('x'), { url: 'https://evil.example/x' })) }); await assert.rejects(() => redirect.load('rcsb', '1abc'), (e) => e.code === 'not-allowed-host' && /重定向/.test(e.message));
});

test('what is too large is stopped while reading, also after decompression; an HTTP error and a cancelled request are named', async () => {
  const small = { s: { id: 's', name: 's', hosts: ['good.example'], accession: /^a$/, url: () => 'https://good.example/a', maxBytes: 100, kind: 'structure' } };
  await assert.rejects(() => createSourceClient({ sources: small, fetch: fake(() => respond(new Uint8Array(500))) }).load('s', 'a'), (e) => e.code === 'too-large');
  const zip = { s: { ...small.s, maxBytes: 1000, decompress: 'gzip' } }, bomb = gzipSync(new Uint8Array(100000));   // 100 000 zeros compress to about 130 bytes, under the 1000-byte limit, and expand far past it
  assert.ok(bomb.length < 1000); await assert.rejects(() => createSourceClient({ sources: zip, fetch: fake(() => respond(bomb)) }).load('s', 'a'), (e) => e.code === 'too-large' && /解压后/.test(e.message));
  await assert.rejects(() => createSourceClient({ fetch: fake(() => respond(enc(''), { status: 404 })) }).load('rcsb', '1abc'), (e) => e.code === 'http' && /404/.test(e.message));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => createSourceClient({ fetch: fake(() => { throw new Error('should not matter'); }) }).load('rcsb', '1abc', { signal: controller.signal }), (e) => e.code === 'aborted');
});

test('a gzip source is decompressed and hashed on the decompressed bytes', async () => {
  const zip = { z: { id: 'z', name: 'z', hosts: ['good.example'], accession: /^a$/, url: () => 'https://good.example/a', maxBytes: 1000, decompress: 'gzip', kind: 'structure' } }, raw = enc('hello map');
  const r = await createSourceClient({ sources: zip, fetch: fake(() => respond(gzipSync(raw))) }).load('z', 'a'); assert.deepEqual([...r.bytes], [...raw]); assert.equal(r.sha256, await sha256Hex(raw));
});

test('the expected hash is enforced; a file that changed upstream is refused unless the update is asked for; nothing is recorded on a failure', async () => {
  const cache = memoryStore(), book = memoryStore(); let body = enc('version one');
  const client = createSourceClient({ fetch: fake((url) => respond(body, { url })), cache, book }), first = await client.load('rcsb', '1abc');
  await assert.rejects(() => createSourceClient({ fetch: fake((u) => respond(body, { url: u })) }).load('rcsb', '1abc', { expectedSha256: 'f'.repeat(64) }), (e) => e.code === 'hash-mismatch');
  body = enc('version two'); await assert.rejects(() => client.load('rcsb', '1abc'), (e) => e.code === 'changed-upstream' && /allowUpdate/.test(e.message));
  assert.equal(book.get('rcsb/1abc'), first.sha256, 'the record did not move'); assert.ok(!cache.has(`rcsb/1abc/${await sha256Hex(body)}`), 'the refused bytes were not cached');
  const updated = await client.load('rcsb', '1abc', { allowUpdate: true }); assert.equal(updated.updated, true); assert.equal(book.get('rcsb/1abc'), updated.sha256);
});

test('without a network the cache answers, checked against the recorded hash; a tampered cache is refused; nothing seen means an offline error', async () => {
  const cache = memoryStore(), book = memoryStore(); let down = false;
  const f = fake((url) => { if (down) throw new TypeError('fetch failed'); return respond(THE.rcsb.body, { url }); }), client = createSourceClient({ fetch: f, cache, book }), seen = await client.load('rcsb', '1abc');
  down = true; const offline = await client.load('rcsb', '1abc'); assert.equal(offline.fromCache, true); assert.equal(offline.sha256, seen.sha256); assert.deepEqual([...offline.bytes], [...THE.rcsb.body]);
  cache.set(`rcsb/1abc/${seen.sha256}`, enc('tampered')); await assert.rejects(() => client.load('rcsb', '1abc'), (e) => e.code === 'hash-mismatch');
  await assert.rejects(() => createSourceClient({ fetch: f, cache: memoryStore(), book: memoryStore() }).load('rcsb', '1abc'), (e) => e.code === 'offline');
});

test('resources are described by the source kind; the unverified sources say so', async () => {
  const rcsb = createSourceClient({ fetch: fake((u) => respond(enc('data_X\n'), { url: u })) }), got = await rcsb.load('rcsb', '1abc');
  const record = resourceFor(got); assert.equal(record.kind, 'structure'); assert.equal(record.id, 'res.rcsb.1ABC'); assert.equal(record.attribution.license, 'CC0-1.0');
  assert.deepEqual(Object.entries(SOURCES).map(([id, s]) => [id, s.verified]), [['rcsb', true], ['alphafold', false], ['emdb', false]]);
  assert.match(SOURCES.alphafold.note, /unchecked/); assert.match(SOURCES.emdb.note, /unchecked/);
  const af = createSourceClient({ fetch: fake((u) => respond(enc('data_AF\n'), { url: u })) }), afGot = await af.load('alphafold', 'P69441'); assert.equal(afGot.url, 'https://alphafold.ebi.ac.uk/files/AF-P69441-F1-model_v4.cif');
  const pr = resourceFor(afGot, { retrievedAt: '2026-11-21' }); assert.equal(pr.kind, 'predicted-structure'); assert.equal(pr.id, 'res.alphafold.p69441'); assert.equal(pr.source.retrievedAt, '2026-11-21');
  assert.ok(new SourceError('x', 'y') instanceof Error);
});
