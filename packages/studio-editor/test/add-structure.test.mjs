import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeStructure, MAX_STRUCTURES } from '../add-structure.mjs';
import { createStudioSession } from '../session.mjs';
import { upgradeSceneToV3 } from '../../schema/migrate.mjs';
import { validateScene } from '../../schema/documents.mjs';
import { sha256Hex } from '../../schema/resource.mjs';

const text = (value) => new TextEncoder().encode(value);
async function work(title, accession, body) {
  const data = text(body), sha = await sha256Hex(data);
  const v2 = { format: 'glow-scene', schemaVersion: 2, id: `w-${accession}`, title, units: { length: 'meter', time: 'second' },
    assets: [{ id: 'source', kind: 'file', path: 'assets/source.cif', sha256: sha, mediaType: 'chemical/x-mmcif', provenance: { parserVersion: '1.0.0', source: { provider: 'RCSB PDB', accession }, viewerState: { camera: { position: [0, 0, 9], target: [0, 0, 0] } } } }],
    nodes: [{ id: 'chainA', name: 'Chain A', parentId: null, assetId: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, extensions: { 'org.glow.structure': { chainId: 'A', chainKey: 'chain:A', sourceAssetId: 'source' } } }],
    timeline: { duration: 4, tracks: [] }, dependencies: [], evidence: [{ type: 'source', assetId: 'source', source: { provider: 'RCSB PDB', accession } }] };
  const resources = new Map([['assets/source.cif', data]]);
  const { scene } = await upgradeSceneToV3(v2, resources); return { scene, resources };
}

test('a second structure joins the work under new ids and paths, every reference follows, and the first structure is untouched', async () => {
  const a = await work('4AKE', '4AKE', 'data_a'), b = await work('1AKE', '1AKE', 'data_b'), before = JSON.stringify(a.scene);
  const out = mergeStructure(a.scene, a.resources, b.scene, b.resources, { title: '1AKE' });
  assert.equal(out.prefix, 's1'); assert.equal(JSON.stringify(a.scene), before, 'the work is not changed in place');
  assert.deepEqual(out.scene.assets.map((x) => x.id), ['source', 's1-source']); assert.deepEqual(out.scene.assets.map((x) => x.path), ['assets/source.cif', 'assets/s1-source.cif']);
  const node = out.scene.nodes.find((n) => n.id === 's1-chainA'); assert.equal(node.name, '1AKE · Chain A'); assert.equal(node.extensions['org.glow.structure'].sourceAssetId, 's1-source');
  assert.equal(out.scene.assets[1].provenance.viewerState, undefined, 'the added structure brings no viewer state of its own'); assert.deepEqual(out.scene.assets[0].provenance.viewerState.camera.position, [0, 0, 9]);
  assert.equal(out.scene.resources.length, 2); assert.equal(out.scene.resources[1].files[0].path, 'assets/s1-source.cif'); assert.equal(out.scene.evidence.at(-1).assetId, 's1-source');
  assert.deepEqual([...out.resources.keys()], ['assets/source.cif', 'assets/s1-source.cif']); assert.doesNotThrow(() => validateScene(out.scene));
});

test('the same file added twice shares its resource record, ids stay unique, and the number of structures is limited', async () => {
  const a = await work('4AKE', '4AKE', 'data_a'); let { scene, resources } = a;
  for (const expected of ['s1', 's2', 's3']) { const out = mergeStructure(scene, resources, (await work('4AKE', '4AKE', 'data_a')).scene, a.resources); assert.equal(out.prefix, expected); ({ scene, resources } = out); validateScene(scene); }
  assert.equal(scene.resources.length, 1, 'identical bytes are one resource'); assert.equal(new Set([...scene.assets.map((x) => x.id), ...scene.nodes.map((x) => x.id)]).size, scene.assets.length + scene.nodes.length);
  assert.throws(() => mergeStructure(scene, resources, (a.scene), a.resources), (e) => e instanceof RangeError && new RegExp(`最多放 ${MAX_STRUCTURES}`).test(e.message));
  assert.throws(() => mergeStructure({ ...a.scene, schemaVersion: 2 }, a.resources, a.scene, a.resources), /v3/);
});

test('the session adds a structure as one undoable step and keeps the file bytes', async () => {
  const a = await work('4AKE', '4AKE', 'data_a'), b = await work('1AKE', '1AKE', 'data_b'), session = createStudioSession(a.scene, a.resources);
  const prefix = session.addStructure(b.scene, b.resources, { title: '1AKE' }); assert.equal(prefix, 's1'); assert.equal(session.getScene().assets.length, 2); assert.ok(session.getResources().has('assets/s1-source.cif'));
  assert.equal(session.undo(), true); assert.equal(session.getScene().assets.length, 1); assert.equal(session.redo(), true); assert.equal(session.getScene().assets.length, 2);
});
