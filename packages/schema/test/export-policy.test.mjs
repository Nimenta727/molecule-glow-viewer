import test from 'node:test';
import assert from 'node:assert/strict';
import { planEmbedding } from '../export-policy.mjs';

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
