import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalWorks, fileNameFor, sizeText, LocalWorkError, MAX_LOCAL_BYTES } from '../local-works.mjs';

const memory = () => { const map = new Map(); return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } }; };
const bytes = (text) => new TextEncoder().encode(text);

test('a file name keeps the title (Chinese included), drops what Windows forbids, and never ends up empty or a device name', () => {
  assert.equal(fileNameFor('噬菌体 T7: 门户/尾部 (9JYZ)?'), '噬菌体 T7 门户 尾部 (9JYZ).glow');
  assert.equal(fileNameFor('噬菌体 T7：门户'), '噬菌体 T7：门户.glow', 'the full-width colon is a legal character and stays');
  assert.equal(fileNameFor('  ..  '), '作品.glow');
  assert.equal(fileNameFor('CON'), 'CON_.glow');
  assert.equal(fileNameFor('a'.repeat(300)).length, 80 + '.glow'.length);
  assert.equal(sizeText(4222631), '4.0 MB'); assert.equal(sizeText(112829812), '108 MB'); assert.equal(sizeText(500), '1 KB');
});

test('a work is remembered with its name, listed newest first, kept once per file, and read back checked against its hash', async () => {
  let clock = 1000; const lib = createLocalWorks({ store: memory(), now: () => clock++ });
  const first = await lib.add({ bytes: bytes('PK first'), fileName: 'a.glow', title: '门户-尾部复合体' });
  const second = await lib.add({ bytes: bytes('PK second'), fileName: 'b.glow', title: '核心蛋白' });
  assert.equal(first.added, true); assert.equal(second.added, true);
  assert.deepEqual((await lib.list()).map((e) => e.title), ['核心蛋白', '门户-尾部复合体']);
  const again = await lib.add({ bytes: bytes('PK first'), fileName: 'renamed.glow', title: '门户-尾部（新名）' });
  assert.equal(again.added, false, 'the same bytes are the same work');
  const list = await lib.list(); assert.equal(list.length, 2); assert.equal(list[0].title, '门户-尾部（新名）', 'moved to the front with the new name'); assert.equal(list[0].fileName, 'renamed.glow');
  assert.equal(new TextDecoder().decode(await lib.bytes(first.entry.id)), 'PK first');
});

test('rename and remove work, and a missing, damaged or oversized file is refused with a sentence', async () => {
  const store = memory(), lib = createLocalWorks({ store });
  const { entry } = await lib.add({ bytes: bytes('PK x'), title: 'x' });
  assert.equal((await lib.rename(entry.id, '  新名称  ')).title, '新名称');
  await assert.rejects(lib.rename(entry.id, '   '), { code: 'title' });
  store.map.set(`glow-local-work-bytes:${entry.id}`, bytes('PK tampered'));
  await assert.rejects(lib.bytes(entry.id), { code: 'corrupt' });
  assert.equal(await lib.remove(entry.id), true); assert.equal(await lib.remove(entry.id), false); assert.deepEqual(await lib.list(), []);
  await assert.rejects(lib.bytes(entry.id), { code: 'missing' });
  await assert.rejects(lib.add({ bytes: new Uint8Array(0) }), { code: 'empty' });
  await assert.rejects(lib.add({ bytes: { byteLength: MAX_LOCAL_BYTES + 1 } }), LocalWorkError);
});

test('a store that fails is reported as a sentence and leaves no half-saved work behind', async () => {
  const store = memory(); let failBytes = true;
  const lib = createLocalWorks({ store: { get: store.get, delete: store.delete, set: async (k, v) => { if (failBytes && k.startsWith('glow-local-work-bytes')) throw new Error('quota'); await store.set(k, v); } } });
  await assert.rejects(lib.add({ bytes: bytes('PK y'), title: 'y' }), /无法保存到本机/);
  assert.deepEqual(await lib.list(), []);
  failBytes = false; await lib.add({ bytes: bytes('PK y'), title: 'y' }); assert.equal((await lib.list()).length, 1);
});
