import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceStore, sha256Hex } from '../../../packages/schema/resource.mjs';
import { registerSceneResources, summarizeResource } from '../resource-registry.mjs';

const bytes = (text) => new TextEncoder().encode(text);
async function structureAsset(id, text, source) {
  const data = bytes(text);
  return { asset: { id, kind: 'file', path: `assets/${id}.cif`, sha256: await sha256Hex(data), mediaType: 'chemical/x-mmcif',
    provenance: { parserVersion: '1.0.0', source } }, data };
}
const v3 = (assets) => ({ schemaVersion: 3, assets, tools: [], resources: [] });

test('an RCSB structure becomes a CC0 resource carried by the scene, and the asset links to it', async () => {
  const store = createResourceStore();
  const { asset, data } = await structureAsset('source', 'data_6ZPO', { provider: 'RCSB PDB', accession: '6ZPO' });
  const scene = v3([asset, { id: 'preview-1', kind: 'file', path: 'assets/preview-1.json', sha256: 'a'.repeat(64), mediaType: 'application/json', provenance: {} }]);
  const result = await registerSceneResources(store, scene, new Map([[asset.path, data]]));
  assert.deepEqual(result.registered, [{ id: 'res.rcsb.6ZPO', version: asset.sha256.slice(0, 8) }]);
  assert.deepEqual(asset.resource, { id: 'res.rcsb.6ZPO', version: asset.sha256.slice(0, 8), sha256: asset.sha256 });
  assert.equal(scene.resources.length, 1, 'the record travels with the scene');
  assert.equal(scene.assets[1].resource, undefined, 'derived preview geometry is not a resource');
  const [summary] = store.list().map(summarizeResource);
  assert.equal(summary.license, 'CC0-1.0');
  assert.equal(summary.embedAllowed, true);
});

test('a local file is registered as unknown licence and never embeddable', async () => {
  const store = createResourceStore();
  const { asset, data } = await structureAsset('source', 'data_mine', { provider: 'local', accession: 'mine.cif' });
  await registerSceneResources(store, v3([asset]), new Map([[asset.path, data]]));
  const [summary] = store.list().map(summarizeResource);
  assert.match(summary.id, /^res\.local\.[a-f0-9]{8}$/);
  assert.equal(summary.license, 'unknown');
  assert.equal(summary.embedAllowed, false);
});

test('loading the same file twice is idempotent; the same bytes in another scene share one blob', async () => {
  const store = createResourceStore();
  const { asset, data } = await structureAsset('source', 'data_6ZPO', { provider: 'RCSB PDB', accession: '6ZPO' });
  for (let i = 0; i < 2; i++) await registerSceneResources(store, v3([structuredClone(asset)]), new Map([[asset.path, data]]));
  assert.equal(store.list().length, 1);
  assert.equal(store.blobCount, 1);
});

test('a scene that already carries its records is registered from them, without recomputation', async () => {
  const first = await structureAsset('source', 'data_6ZPO', { provider: 'RCSB PDB', accession: '6ZPO' });
  const scene = v3([first.asset]);
  await registerSceneResources(createResourceStore(), scene, new Map([[first.asset.path, first.data]]));
  const reopened = structuredClone(scene), store = createResourceStore();
  const result = await registerSceneResources(store, reopened, new Map([[first.asset.path, first.data]]));
  assert.deepEqual(reopened, scene, 'nothing changes when the scene is already resource-complete');
  assert.equal(result.registered.length, 1);
  assert.equal(store.list().length, 1);
});

test('res-missing and res-hash-mismatch become diagnostics and do not stop the scene', async () => {
  const store = createResourceStore();
  const a = await structureAsset('a', 'data_a', { provider: 'local', accession: 'a.cif' });
  const b = await structureAsset('b', 'data_b', { provider: 'local', accession: 'b.cif' });
  const scene = v3([a.asset, b.asset]);
  const result = await registerSceneResources(store, scene, new Map([[b.asset.path, bytes('tampered')]]));
  assert.deepEqual(result.diagnostics.map(({ code, assetId }) => [code, assetId]).sort(), [['res-hash-mismatch', 'b'], ['res-missing', 'a']]);
  assert.equal(result.registered.length, 0);
  assert.equal(store.list().length, 0);
  assert.equal(a.asset.resource, undefined);
  assert.equal(scene.resources.length, 0);
});
