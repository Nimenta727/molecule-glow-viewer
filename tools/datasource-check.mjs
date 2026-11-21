// A4 against the live RCSB service (the only built-in source this environment can reach; AlphaFold DB and EMDB are unverified, see plugins/sources/data-source.mjs). A real fetch of 1OMP and 1ANF is made
// through the client, compared with the hashes pinned in tools/fixtures/structures.json, served again from the cache with the network "down", and a tampered cache is refused.
// Usage: node tools/datasource-check.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createSourceClient, memoryStore, resourceFor } from '../plugins/sources/data-source.mjs';

const pinned = new Map(JSON.parse(fs.readFileSync(new URL('./fixtures/structures.json', import.meta.url), 'utf8')).structures.map((s) => [s.id, s]));
let online = true; const real = globalThis.fetch;
const cache = memoryStore(), book = memoryStore(), client = createSourceClient({ fetch: (...args) => (online ? real(...args) : Promise.reject(new TypeError('network is down (simulated)'))), cache, book });
for (const id of ['1OMP', '1ANF']) {
  const got = await client.load('rcsb', id.toLowerCase()), want = pinned.get(id);
  console.log(`${id}: ${got.bytes.byteLength} bytes, sha256 ${got.sha256.slice(0, 16)}…, recorded ${got.recorded}, from cache ${got.fromCache}`);
  assert.equal(got.sha256, want.sha256, `${id} is the file the project pinned`); assert.equal(got.bytes.byteLength, want.bytes);
  assert.equal(got.recorded, true); assert.equal(resourceFor(got).id, `res.rcsb.${id}`); assert.equal(resourceFor(got).version, want.sha256.slice(0, 8));
}
online = false; const again = await client.load('rcsb', '1omp'); console.log(`offline: served from cache = ${again.fromCache}, hash ${again.sha256.slice(0, 16)}…`);
assert.equal(again.fromCache, true); assert.equal(again.sha256, pinned.get('1OMP').sha256);
cache.set(`rcsb/1omp/${again.sha256}`, new TextEncoder().encode('tampered'));
await assert.rejects(() => client.load('rcsb', '1omp'), (e) => e.code === 'hash-mismatch'); console.log('a tampered cache entry is refused');
await assert.rejects(() => createSourceClient({ fetch: () => Promise.reject(new TypeError('down')), cache: memoryStore(), book: memoryStore() }).load('rcsb', '1omp'), (e) => e.code === 'offline'); console.log('with nothing cached and no network: an offline error');
online = true; await assert.rejects(() => client.load('rcsb', 'zzzz'), (e) => e.code === 'http' || e.code === 'bad-accession'); console.log('an entry that does not exist is refused with its reason');
console.log('\nok: the RCSB source against the live service: pinned hashes, offline cache, tamper refusal');
