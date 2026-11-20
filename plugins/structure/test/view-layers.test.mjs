import assert from 'node:assert/strict';
import test from 'node:test';
import { structurePlugin, STRUCTURE_IMPORTER_ID, STRUCTURE_SERVICE_ID } from '../index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { decodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../../packages/schema/geometry.mjs';
import { buildRepresentations } from '../representation.mjs';
import { buildStructureLayers, structureSources, STRUCTURE_STYLES } from '../view-layers.mjs';

const atom = (serial, name, residue, chain, seq, x, y, z) =>
  `ATOM  ${String(serial).padStart(5)}  ${name.padEnd(3)} ${residue} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 10.00           C`;
const pdb = ['A', 'B'].flatMap((chain, c) => Array.from({ length: 8 }, (_, i) => atom(c * 8 + i + 1, 'CA', i % 2 ? 'GLY' : 'ALA', chain, i + 1, i * 3.6 + c * 2, Math.sin(i) * 2 + c * 12, Math.cos(i) * 2))).join('\n') + '\n';

async function imported() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  const { scene, model, resources } = await host.getImporter(STRUCTURE_IMPORTER_ID).importScene({ bytes: new TextEncoder().encode(pdb), name: 'two.pdb' });
  const layers = new Map();
  for (const asset of scene.assets) if (asset.mediaType === GEOMETRY_MEDIA_TYPE) layers.set(asset.id, decodeGeometry(resources.get(asset.path)));
  return { scene, model, layers, build: host.getRepresentation('org.glow.structure.preview').build, service: host.getService(STRUCTURE_SERVICE_ID, '1.0.0') };
}

test('every chain node gets the layers of the asked style, in place of its preview geometry', async () => {
  const { scene, model, layers, build } = await imported();
  const source = structureSources(scene)[0];
  const previews = [...layers.keys()];
  assert.equal(previews.length, 2);
  const before = new Map(layers);
  for (const style of STRUCTURE_STYLES) {
    const result = buildStructureLayers({ scene, models: new Map([[source.id, model]]), layers: new Map(before), build, style, defaultStyle: 'blob' });
    assert.equal(result.representationSource, source);
    for (const id of previews) {
      const replaced = result.layers.get(id);
      assert.ok(replaced.length > 0 && replaced.every((layer) => layer.representationStyle === style), `${style}: ${id}`);
      assert.notEqual(replaced, before.get(id), 'the preview was replaced');
    }
  }
  assert.deepEqual([...before.keys()], previews, 'the caller\'s own map is not modified when a copy is passed');
});

test('the style comes from the request, then the stored style of the structure, then the default', async () => {
  const { scene, model, layers, build } = await imported();
  const source = structureSources(scene)[0], models = new Map([[source.id, model]]);
  const styleOf = (extra) => {
    const copy = structuredClone(scene);
    Object.assign(structureSources(copy)[0].provenance, extra);
    const result = buildStructureLayers({ scene: copy, models, layers: new Map(layers), build, ...extra.__ask, defaultStyle: 'backbone' });
    return [...result.layers.values()][0][0].representationStyle;
  };
  assert.equal(styleOf({}), 'backbone', 'default');
  assert.equal(styleOf({ viewerStyle: 'cartoon' }), 'cartoon', 'stored');
  assert.equal(styleOf({ viewerStyle: 'cartoon', __ask: { style: 'surface' } }), 'surface', 'asked');
  assert.equal(styleOf({ viewerStyle: 'not-a-style' }), 'backbone', 'a stored style that is not known is ignored');
});

test('a preview that cannot be matched keeps its geometry, and a structure without a model is left alone', async () => {
  const { scene, model, layers, build } = await imported();
  const source = structureSources(scene)[0];
  const [first] = [...layers.keys()];
  const stray = structuredClone(scene);
  const node = stray.nodes.find((item) => item.assetId === first);
  node.extensions['org.glow.structure'].chainKey = 'chain:does-not-exist';
  const kept = buildStructureLayers({ scene: stray, models: new Map([[source.id, model]]), layers: new Map(layers), build, style: 'blob' });
  assert.equal(kept.layers.get(first), layers.get(first), 'unmatched chain: preview geometry stays');
  const noModel = buildStructureLayers({ scene, models: new Map(), layers: new Map(layers), build, style: 'blob' });
  assert.equal(noModel.representationSource, undefined);
  assert.deepEqual([...noModel.layers.values()], [...layers.values()]);
});

test('pick targets are reported for callers that keep them, and the legacy style and colour of a preview win', async () => {
  const { scene, model, layers, build } = await imported();
  const source = structureSources(scene)[0], seen = [];
  buildStructureLayers({ scene, models: new Map([[source.id, model]]), layers: new Map(layers), build, style: 'blob', onTarget: (target, from, primary) => seen.push([target.kind, from.id, primary]) });
  assert.ok(seen.length >= 16, 'one pick target per residue');
  assert.ok(seen.every(([, id, primary]) => id === source.id && primary === true));
  const legacy = structuredClone(scene);
  const [first] = [...layers.keys()];
  const asset = legacy.assets.find(({ id }) => id === first);
  Object.assign(asset.provenance, { legacyStyle: 'cartoon', legacyColor: '#123456' });
  const result = buildStructureLayers({ scene: legacy, models: new Map([[source.id, model]]), layers: new Map(layers), build, style: 'blob' });
  const mine = result.layers.get(first);
  assert.ok(mine.every((layer) => layer.representationStyle === 'cartoon'), 'the preview\'s own legacy style wins over the asked one');
  assert.ok(mine.filter((layer) => layer.mode !== 'points' && layer.role !== 'functional-core').every((layer) => layer.color === '#123456'));
  assert.notEqual([...result.layers.entries()].find(([id]) => id !== first)[1][0].representationStyle, 'cartoon');
});
