import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { readScenePackage, writeScenePackage } from '../../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../../packages/schema/documents.mjs';
import { decodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../../packages/schema/geometry.mjs';
import { importStructureScene, structurePlugin, STRUCTURE_IMPORTER_ID, STRUCTURE_PLUGIN_ID, STRUCTURE_SERVICE_ID } from '../index.mjs';

const pdb = [
  'ATOM      1  CA  ALA A   1       1.250   2.000   3.000  1.00 10.00           C',
  'ATOM      2  CA  GLY A   2       4.750   2.000   3.000  1.00 10.00           C',
  'ATOM      3  CA  ALA A   3       8.250   3.000   3.000  1.00 10.00           C',
].join('\n') + '\n';

test('official structure importer exports preserved source and a plugin-free geometry preview', async () => {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  const bytes = new TextEncoder().encode(pdb);
  await host.activate(structurePlugin);
  const importer = host.getImporter(STRUCTURE_IMPORTER_ID);
  const { scene, model, resources } = await importer.importScene({ bytes, name: 'test.pdb' });
  assert.deepEqual(host.getService(STRUCTURE_SERVICE_ID, '1.0.0').select(model, { chainId: 'A', residueId: '2' })[0].position, [4.75, 2, 3]);
  await host.deactivate(STRUCTURE_PLUGIN_ID);
  assert.equal(host.getImporter(STRUCTURE_IMPORTER_ID), undefined);

  const reopened = await readScenePackage(await writeScenePackage(scene, resources));
  assert.deepEqual(reopened.resources.get('assets/source.pdb'), bytes);
  const preview = reopened.scene.assets.find(({ mediaType }) => mediaType === GEOMETRY_MEDIA_TYPE);
  const layers = decodeGeometry(reopened.resources.get(preview.path));
  assert.ok(layers.some(({ mode }) => mode === 'triangles'));
  const core = toCoreDocument(reopened.scene, new Set([preview.id]));
  assert.deepEqual(core.assets, [{ id: preview.id, kind: 'geometry' }]);
  assert.equal(core.nodes[0].assetId, preview.id);
});

test('layout keeps coordinates for parts omitted from the geometry preview budget', async () => {
  const secondChain = pdb.split('\n').slice(0, 3)
    .map((row, i) => row.slice(0, 6) + String(i + 4).padStart(5) + row.slice(11, 21) + 'B' + row.slice(22)).join('\n');
  const result = await importStructureScene({ bytes: new TextEncoder().encode(pdb + secondChain), name: 'parts.pdb' },
    { previewGroupLimit: 1, includeLayout: true });
  assert.equal(result.scene.nodes.length, 1);
  assert.deepEqual(result.layout.map(({ name, points }) => [name, points.length]), [['Chain A', 3], ['Chain B', 3]]);
});

test('keeping chains keeps the small molecules in them or within 6 A of their residues (classic keepChains), and drops the far ones and the other chain', async () => {
  const rows = [
    'ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 10.00           C',
    'ATOM      2  CA  GLY A   2       3.800   0.000   0.000  1.00 10.00           C',
    'ATOM      3  CA  ALA B   1      50.000   0.000   0.000  1.00 10.00           C',
    'HETATM    4  K     K C 101       2.000   4.000   0.000  1.00 10.00           K',   // own chain C, 4 A from chain A: kept
    'HETATM    5  K     K D 102      90.000   0.000   0.000  1.00 10.00           K',   // far from everything: dropped
    'HETATM    6  K     K E 103      50.000   3.000   0.000  1.00 10.00           K',   // near chain B only: dropped when only A is kept
    'HETATM    7  O   HOH F 104       2.000   2.000   0.000  1.00 10.00           O',   // water: never kept this way
  ];
  const result = await importStructureScene({ bytes: new TextEncoder().encode(rows.join('\n') + '\n'), name: 'keep.pdb' }, { chains: ['A'], includeLayout: true });
  const atoms = result.model.atoms.map((a) => `${a.residueName}${a.authSeqId}`).sort();
  assert.deepEqual(atoms, ['ALA1', 'GLY2', 'K101']);
});
