import test from 'node:test';
import assert from 'node:assert/strict';
import { planEmbedding, hydrateReferences } from '../export-policy.mjs';
import { sha256Hex } from '../resource.mjs';

const HASH = 'a'.repeat(64), HASH2 = 'b'.repeat(64);
const record = (id, provider, embedAllowed) => ({ id, version: 'aaaaaaaa', source: { provider, accession: provider === 'local' ? 'x.pdb' : '4V6F' }, attribution: { license: 'x', embedAllowed } });
const scene = () => ({ id: 's', resources: [record('res.a', 'rcsb', false), record('res.b', 'local', false), record('res.c', 'rcsb', true)],
  assets: [
    { id: 'a', kind: 'file', path: 'assets/a.pdb', sha256: HASH, mediaType: 'chemical/x-pdb', resource: { id: 'res.a', version: 'aaaaaaaa', sha256: HASH } },
    { id: 'b', kind: 'file', path: 'assets/b.pdb', sha256: HASH2, mediaType: 'chemical/x-pdb', resource: { id: 'res.b', version: 'aaaaaaaa', sha256: HASH2 } },
    { id: 'c', kind: 'file', path: 'assets/c.pdb', sha256: HASH, mediaType: 'chemical/x-pdb', resource: { id: 'res.c', version: 'aaaaaaaa', sha256: HASH } },
  ] });
const files = () => new Map([['assets/a.pdb', new Uint8Array([1])], ['assets/b.pdb', new Uint8Array([2])], ['assets/c.pdb', new Uint8Array([3])]]);

test('project mode keeps everything and copies the inputs', () => {
  const input = scene(), plan = planEmbedding(input, files());
  assert.deepEqual(plan.scene, input); assert.notEqual(plan.scene, input);
  assert.equal(plan.resources.size, 3); assert.deepEqual(plan.referenced, []); assert.deepEqual(plan.blocked, []);
});

test('publish mode turns a forbidden resource with a public source into a hash-linked reference and drops its bytes', () => {
  const plan = planEmbedding(scene(), files(), { mode: 'publish' });
  const a = plan.scene.assets.find(({ id }) => id === 'a');
  assert.deepEqual(a, { id: 'a', kind: 'external', source: { provider: 'rcsb', accession: '4V6F' }, mediaType: 'chemical/x-pdb', resource: { id: 'res.a', version: 'aaaaaaaa', sha256: HASH } });
  assert.equal(plan.resources.has('assets/a.pdb'), false);
  assert.deepEqual(plan.referenced, ['a']);
});

test('publish mode keeps allowed resources and blocks forbidden ones that cannot be fetched again', () => {
  const plan = planEmbedding(scene(), files(), { mode: 'publish' });
  assert.equal(plan.scene.assets.find(({ id }) => id === 'c').kind, 'file');
  assert.ok(plan.resources.has('assets/c.pdb'));
  assert.equal(plan.blocked.length, 1); assert.equal(plan.blocked[0].assetId, 'b'); assert.match(plan.blocked[0].reason, /不允许嵌入/);
  assert.ok(plan.resources.has('assets/b.pdb'), 'blocked bytes are not silently dropped');
});

test('unknown mode is refused', () => assert.throws(() => planEmbedding(scene(), files(), { mode: 'x' }), /Unknown export mode/));

async function referenced(bytes) {
  const hash = await sha256Hex(bytes);
  return { hash, scene: { id: 's', resources: [{ id: 'res.a', version: 'aaaaaaaa', files: [{ path: 'assets/a.cif', sha256: hash }], source: { provider: 'rcsb', accession: '4V6F' }, attribution: { license: 'x', embedAllowed: false } }],
    assets: [{ id: 'a', kind: 'external', source: { provider: 'rcsb', accession: '4V6F' }, mediaType: 'chemical/x-mmcif', resource: { id: 'res.a', version: 'aaaaaaaa', sha256: hash } }] } };
}

test('opening a reference fetches the bytes, checks the hash and restores an ordinary file asset', async () => {
  const bytes = new Uint8Array([7, 8, 9]), { hash, scene } = await referenced(bytes);
  let asked;
  const result = await hydrateReferences(scene, new Map(), async (request) => { asked = request; return bytes; });
  assert.equal(asked.accession, '4V6F'); assert.equal(asked.file.path, 'assets/a.cif');
  assert.deepEqual(result.scene.assets[0], { id: 'a', kind: 'file', path: 'assets/a.cif', sha256: hash, mediaType: 'chemical/x-mmcif', resource: { id: 'res.a', version: 'aaaaaaaa', sha256: hash } });
  assert.deepEqual([...result.resources.get('assets/a.cif')], [7, 8, 9]); assert.deepEqual(result.diagnostics, []);
});

test('a wrong hash, a failed fetch or a missing record leaves the reference in place and says why', async () => {
  const { scene } = await referenced(new Uint8Array([1]));
  const wrong = await hydrateReferences(scene, new Map(), async () => new Uint8Array([2]));
  assert.equal(wrong.scene.assets[0].kind, 'external'); assert.equal(wrong.diagnostics[0].code, 'reference-hash-mismatch'); assert.equal(wrong.resources.size, 0);
  const down = await hydrateReferences(scene, new Map(), async () => { throw new Error('离线'); });
  assert.equal(down.diagnostics[0].code, 'reference-fetch-failed'); assert.match(down.diagnostics[0].message, /离线/);
  const bare = await hydrateReferences({ ...scene, resources: [] }, new Map(), async () => new Uint8Array([1]));
  assert.equal(bare.diagnostics[0].code, 'reference-no-record');
});

test('publish then open round-trips: the reference opens back to the same bytes', async () => {
  const bytes = new Uint8Array([4, 5, 6]), hash = await sha256Hex(bytes);
  const input = { id: 's', resources: [{ id: 'res.a', version: 'aaaaaaaa', files: [{ path: 'assets/a.cif', sha256: hash }], source: { provider: 'rcsb', accession: '4V6F' }, attribution: { license: 'x', embedAllowed: false } }],
    assets: [{ id: 'a', kind: 'file', path: 'assets/a.cif', sha256: hash, mediaType: 'chemical/x-mmcif', resource: { id: 'res.a', version: 'aaaaaaaa', sha256: hash } }] };
  const published = planEmbedding(input, new Map([['assets/a.cif', bytes]]), { mode: 'publish' });
  assert.equal(published.resources.size, 0);
  const opened = await hydrateReferences(published.scene, published.resources, async () => bytes);
  assert.deepEqual(opened.scene.assets, input.assets); assert.deepEqual([...opened.resources.get('assets/a.cif')], [4, 5, 6]);
});

test('a published scene with references is still a valid scene document', async () => {
  const { validateScene } = await import('../documents.mjs');
  const h = 'a'.repeat(64);
  const scene = { format: 'glow-scene', schemaVersion: 3, id: 's', title: 't', units: { length: 'meter', time: 'second' }, nodes: [], timeline: { duration: 1, tracks: [] }, dependencies: [], evidence: [], tools: [],
    assets: [{ id: 'a', kind: 'file', path: 'assets/a.cif', sha256: h, mediaType: 'chemical/x-mmcif', resource: { id: 'res.rcsb.4V6F', version: 'aaaaaaaa', sha256: h } }],
    resources: [{ format: 'glow-resource', schemaVersion: 1, id: 'res.rcsb.4V6F', version: 'aaaaaaaa', kind: 'structure', files: [{ path: 'assets/a.cif', sha256: h, mediaType: 'chemical/x-mmcif', bytes: 1 }],
      source: { provider: 'rcsb', accession: '4V6F' }, attribution: { license: 'CC0-1.0', embedAllowed: false } }] };
  const plan = planEmbedding(validateScene(scene), new Map([['assets/a.cif', new Uint8Array([1])]]), { mode: 'publish' });
  assert.equal(validateScene(plan.scene).assets[0].kind, 'external');
});

test('a local file imported through the app ("local file") is blocked, not turned into a reference', () => {
  const input = scene(); input.resources[1].source.provider = 'local file';
  const plan = planEmbedding(input, files(), { mode: 'publish' });
  assert.equal(plan.blocked[0].assetId, 'b'); assert.equal(plan.scene.assets.find(({ id }) => id === 'b').kind, 'file');
});
