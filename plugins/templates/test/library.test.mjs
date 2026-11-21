import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createTemplateLibrary, LICENSES, TemplateError, MAX_TEMPLATE_BYTES } from '../library.mjs';
import { writeTemplatePackage, readTemplatePackage } from '../package.mjs';
import { sha256Hex } from '../../../packages/schema/resource.mjs';

const enc = new TextEncoder();
const header = readFileSync(new URL('./fixtures/4AKE-header.cif', import.meta.url));
const FILE = new Uint8Array(header);   // a real header with one coordinate row: enough to be a structure file for the card
const memory = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, _m: m }; };
const lib = (store = memory(), t = { n: 1000 }) => ({ store, library: createTemplateLibrary({ store, now: () => t.n++ }) });

test('a local file becomes a template only with a stated licence; the record says exactly what was stated, and an unknown file never leaves the machine', async () => {
  const { library } = lib();
  await assert.rejects(() => library.importFile({ name: 'mine.cif', bytes: FILE }), (e) => e instanceof TemplateError && e.code === 'license');
  await assert.rejects(() => library.importFile({ name: 'mine.cif', bytes: FILE, license: 'CC-BY-4.0' }), (e) => e.code === 'credit');
  await assert.rejects(() => library.importFile({ name: 'mine.txt', bytes: FILE, license: 'CC0-1.0' }), (e) => e.code === 'format');
  await assert.rejects(() => library.importFile({ name: 'mine.cif', bytes: enc.encode('hello, not a structure'), license: 'CC0-1.0' }), (e) => e.code === 'not-a-structure');
  const open = await library.importFile({ name: 'mine.cif', bytes: FILE, license: 'CC-BY-4.0', credit: '某实验室 2026', title: '我的腺苷酸激酶' });
  assert.ok(open.added); assert.match(open.template.id, /^res\.local\.[a-f0-9]{8}$/); assert.equal(open.template.record.attribution.embedAllowed, true); assert.equal(open.template.record.attribution.credit, '某实验室 2026');
  assert.equal(open.template.record.source.provider, 'local'); assert.equal(open.template.record.card.method, 'X-RAY DIFFRACTION'); assert.equal(open.template.record.card.resolution, '2.2 Å'); assert.equal(open.template.title, '我的腺苷酸激酶');
  const other = createTemplateLibrary({ store: memory() }), priv = await other.importFile({ name: 'mine.cif', bytes: FILE, license: 'unknown' });
  assert.equal(priv.template.record.attribution.embedAllowed, false, 'unknown = private'); assert.ok(Object.values(LICENSES).every((l) => typeof l.open === 'boolean'));
});

test('the same bytes are one template; list is newest first; bytes come back checked against the hash; a damaged copy is refused', async () => {
  const { library, store } = lib(), a = await library.importFile({ name: 'a.cif', bytes: FILE, license: 'CC0-1.0' });
  assert.equal((await library.importFile({ name: 'again.cif', bytes: FILE, license: 'CC0-1.0' })).added, false, 'the same content twice is one template');
  const second = new Uint8Array([...FILE, 10, 35, 32, 120, 10]); const b = await library.importFile({ name: 'b.cif', bytes: second, license: 'CC0-1.0' });
  assert.deepEqual((await library.list()).map((t) => t.id), [b.template.id, a.template.id]);
  assert.deepEqual(await library.bytes(a.template.id), FILE); assert.equal(await sha256Hex(await library.bytes(b.template.id)), b.template.sha256);
  const key = [...store._m.keys()].find((k) => k.endsWith(a.template.sha256)); const damaged = new Uint8Array(FILE); damaged[100] ^= 1; store._m.set(key, damaged);
  await assert.rejects(() => library.bytes(a.template.id), (e) => e.code === 'hash-mismatch'); await assert.rejects(() => library.bytes('res.local.nothing'), (e) => e.code === 'missing');
});

test('an RCSB entry by its code is the same record the workshop uses (CC0, from RCSB); a bad code or a failed download is a clear refusal', async () => {
  const { library } = lib(), loaded = { bytes: FILE, name: '4AKE.cif' };
  await assert.rejects(() => library.addFromRcsb({ accession: 'xx', load: async () => loaded }), (e) => e.code === 'accession');
  await assert.rejects(() => library.addFromRcsb({ accession: '4ake', load: async () => null }), (e) => e.code === 'download');
  const { template } = await library.addFromRcsb({ accession: '4ake', load: async (code) => { assert.equal(code, '4AKE'); return loaded; } });
  assert.equal(template.id, 'res.rcsb.4AKE'); assert.equal(template.record.source.provider, 'rcsb'); assert.equal(template.record.attribution.license, 'CC0-1.0'); assert.equal(template.origin, 'rcsb');
});

test('title and notes can change; the record cannot; removing a template removes its bytes unless another template shares them', async () => {
  const { library, store } = lib(), { template } = await library.importFile({ name: 'a.cif', bytes: FILE, license: 'CC0-1.0' });
  const before = JSON.stringify((await library.get(template.id)).record); await library.update(template.id, { title: '新名字', notes: '备注' });
  const now = await library.get(template.id); assert.equal(now.title, '新名字'); assert.equal(now.notes, '备注'); assert.equal(JSON.stringify(now.record), before);
  assert.equal(await library.remove(template.id), true); assert.equal(await library.remove(template.id), false); assert.deepEqual(await library.list(), []); assert.equal([...store._m.keys()].filter((k) => k.startsWith('glow-template-bytes')).length, 0);
});

test('a store that fails is reported with a reason and leaves nothing half-saved', async () => {
  const broken = { get: async () => undefined, set: async () => { throw new Error('QuotaExceededError'); }, delete: async () => {} };
  await assert.rejects(() => createTemplateLibrary({ store: broken }).importFile({ name: 'a.cif', bytes: FILE, license: 'CC0-1.0' }), (e) => e.code === 'store-failed' && /磁盘|无痕/.test(e.message));
  assert.deepEqual(await createTemplateLibrary({ store: { get: async () => { throw new Error('blocked'); }, set: async () => {}, delete: async () => {} } }).list(), [], 'an unreadable store lists as empty');
  await assert.rejects(() => createTemplateLibrary({ store: memory() }).importFile({ name: 'big.cif', bytes: new Uint8Array(MAX_TEMPLATE_BYTES + 1), license: 'CC0-1.0' }), (e) => e.code === 'too-large');
});

test('a package round-trips; what it states about itself is kept as the sender’s word, never as "from the PDB"', async () => {
  const a = lib(), { template } = await a.library.addFromRcsb({ accession: '4AKE', load: async () => ({ bytes: FILE }) });
  const pack = await a.library.exportPackage(template.id), b = lib(), got = await b.library.importPackage(pack);
  assert.ok(got.added); assert.equal(got.template.record.source.provider, 'local', 'rebuilt as a local file'); assert.match(got.template.record.card.claimedSource, /自称来源：rcsb 4AKE（未核对）/);
  assert.equal(got.template.origin, 'package'); assert.equal(got.template.sha256, template.sha256); assert.deepEqual(await b.library.bytes(got.template.id), FILE); assert.equal(got.template.record.attribution.license, 'CC0-1.0');
  assert.equal((await b.library.importPackage(pack)).added, false, 'importing it again changes nothing');
});

test('a package that lies about its file, has the wrong shape or is not a zip is refused', async () => {
  const a = lib(), { template } = await a.library.importFile({ name: 'a.cif', bytes: FILE, license: 'CC0-1.0' });
  const tampered = new Uint8Array(FILE); tampered[200] ^= 1; const entry = await a.library.get(template.id);
  const bad = await writeTemplatePackage(entry, tampered); await assert.rejects(() => readTemplatePackage(bad), (e) => e.code === 'hash-mismatch');
  await assert.rejects(() => readTemplatePackage(enc.encode('not a zip')), (e) => e.code === 'package'); await assert.rejects(() => readTemplatePackage(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), Error);
});
