import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { readScenePackage, writeScenePackage } from '../../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../../packages/schema/documents.mjs';
import { decodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../../packages/schema/geometry.mjs';
import { structurePlugin, STRUCTURE_IMPORTER_ID, STRUCTURE_PLUGIN_ID, STRUCTURE_SERVICE_ID } from '../index.mjs';

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
