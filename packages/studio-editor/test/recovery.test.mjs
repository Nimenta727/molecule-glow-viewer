import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecovery } from '../recovery.mjs';

const memory = () => { const map = new Map(); return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } }; };
const bytes = (text) => new TextEncoder().encode(text);
let clock = 1000;
const make = (store = memory(), options = {}) => ({ store, recovery: createRecovery({ store, now: () => (clock += 1000), ...options }) });

test('a saved draft comes back byte for byte; the newest is offered first and only the newest few are kept', async () => {
  const { recovery } = make(undefined, { keep: 2 });
  assert.equal(await recovery.latest(), null);
  for (const text of ['one', 'two', 'three']) assert.equal((await recovery.save({ name: 'p', bytes: bytes(text) })).saved, true);
  const list = await recovery.list(); assert.equal(list.length, 2); assert.ok(list[0].savedAt > list[1].savedAt);
  assert.equal(new TextDecoder().decode((await recovery.latest()).bytes), 'three');
  assert.equal(new TextDecoder().decode((await recovery.latest({ name: 'p' })).bytes), 'three'); assert.equal(await recovery.latest({ name: 'other' }), null);
});
test('the same content twice is one draft; a draft is a copy, not the caller\'s buffer', async () => {
  const { recovery } = make(); const data = bytes('same');
  await recovery.save({ name: 'p', bytes: data }); await recovery.save({ name: 'p', bytes: data }); assert.equal((await recovery.list()).length, 1);
  data[0] = 0; assert.equal(new TextDecoder().decode((await recovery.latest()).bytes), 'same', 'changing the buffer afterwards does not change the draft');
  const got = (await recovery.latest()).bytes; got[0] = 0; assert.equal(new TextDecoder().decode((await recovery.latest()).bytes), 'same', 'nor does changing what was read');
});
test('a damaged draft is skipped, not offered; a damaged store reads as empty', async () => {
  const { store, recovery } = make();
  await recovery.save({ name: 'p', bytes: bytes('good') }); await recovery.save({ name: 'p', bytes: bytes('newer') });
  const [newest, older] = store.map.get('glow-studio-drafts'); newest.data = bytes('tampered');
  assert.equal(new TextDecoder().decode((await recovery.latest()).bytes), 'good', 'the newest was damaged: the next one is offered');
  older.data = bytes('also bad'); assert.equal(await recovery.latest(), null);
  for (const junk of [null, 5, 'x', [{ name: 1 }], [null], { entries: [] }]) { store.map.set('glow-studio-drafts', junk); assert.equal(await recovery.latest(), null); assert.deepEqual(await recovery.list(), []); }
  assert.equal((await recovery.save({ name: 'p', bytes: bytes('fresh') })).saved, true, 'saving works again over a damaged store');
});
test('what cannot be saved is reported, not thrown: too large, a failing store; a throwing read is an empty store', async () => {
  const { recovery } = make(undefined, { maxBytes: 4 });
  assert.deepEqual(await recovery.save({ name: 'p', bytes: bytes('12345') }), { saved: false, reason: 'too-large' });
  const failing = { get: async () => { throw new Error('closed'); }, set: async () => { throw new Error('quota'); }, delete: async () => { throw new Error('closed'); } };
  const broken = createRecovery({ store: failing });
  const result = await broken.save({ name: 'p', bytes: bytes('x') }); assert.equal(result.saved, false); assert.equal(result.reason, 'store-failed'); assert.match(result.message, /quota/);
  assert.equal(await broken.latest(), null); await broken.clear();
  await assert.rejects(recovery.save({ name: '', bytes: bytes('x') }), /name and bytes/); await assert.rejects(recovery.save({ name: 'p', bytes: 'text' }), /name and bytes/);
  assert.throws(() => createRecovery({ store: {} }), /store/);
});
test('clearing forgets every draft', async () => {
  const { recovery } = make(); await recovery.save({ name: 'p', bytes: bytes('x') }); await recovery.clear();
  assert.equal(await recovery.latest(), null); assert.deepEqual(await recovery.list(), []);
});
