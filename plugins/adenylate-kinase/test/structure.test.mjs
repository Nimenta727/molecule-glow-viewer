import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdkStructure } from '../structure.mjs';
import { buildRepresentations } from '../../structure/representation.mjs';
import { prepareAdk, createAdkPlayer, ADK_PLAYER, adenylateKinasePlugin } from '../index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { resolveMechanism } from '../../mechanism-catalog.mjs';
function fixture() {
  const rotate = (p, degrees) => { const a = degrees * Math.PI / 180; return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]; };
  const atoms = Array.from({ length: 214 }, (_, i) => ({ record: 'ATOM', name: 'CA', element: 'C', residueName: 'ALA',
    modelId: '1', authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', occupancy: 1,
    position: [i % 17, i * i % 23, i / 10] }));
  const open = { format: 'mmcif', atoms, chainNames: { A: 'ADENYLATE KINASE' } };
  const closed = { ...open, atoms: atoms.map((a, i) => {
    const n = i + 1, angle = n >= 30 && n <= 59 ? 25 : n >= 122 && n <= 159 ? 50 : 0;
    return { ...a, position: rotate(rotate(a.position, angle), 40).map((v, k) => v + [50, 30, -20][k]) };
  }) };
  closed.atoms.push(...['P', 'O', 'C'].map((element, i) => ({ ...atoms[0], record: 'HETATM', name: `${element}${i}`, element, residueName: 'AP5', authSeqId: '215', labelSeqId: '', labelChainId: 'C', position: [50 + i, 30, -20] })));
  const node = { id: 'chain-A', parentId: null, assetId: 'preview', extensions: { 'org.glow.structure': { sourceAssetId: 'primary', partName: 'ADENYLATE KINASE' } } };
  const loaded = { model: open, scene: { assets: [{ id: 'primary', path: 'assets/open.cif', provenance: { parserVersion: '1' } }], nodes: [node] }, resources: new Map() };
  return { open, closed, loaded };
}
test('CORE fit removes global motion and measures known domain rotations', () => {
  const { open, closed } = fixture(), structure = buildAdkStructure(open, closed);
  assert(structure.rmsd < 1e-8);
  const domains = structure.measurements(1);
  assert(Math.abs(domains[0].angle - 25) < 1e-6);
  assert(Math.abs(domains[1].angle - 50) < 1e-6);
  for (const domain of structure.measurements(0)) { assert(domain.angle < 1e-5); assert(domain.shift < 1e-8); }
  assert.equal(structure.inhibitor.molecule.length, 3);
});
test('domain splitting retains pick identities and moves exact residue points', () => {
  const { open, closed, loaded } = fixture(), structure = buildAdkStructure(open, closed);
  const [group] = buildRepresentations(open, { style: 'blob' });
  const layers = new Map([['preview', group.layers.map((layer, i) => ({ ...layer, pointTargets: group.pointTargets[i] }))]]);
  structure.decorate(layers, loaded.scene.nodes);
  const points = layers.get('preview').filter((layer) => layer.mode === 'points');
  assert.equal(points.length, 3);
  assert.equal(points.reduce((sum, layer) => sum + layer.pointTargets.length, 0), 214);
  for (const layer of points) {
    assert.equal(layer.conformations.length, 2);
    assert.equal(layer.positions.length, layer.conformations[1].length);
    assert(layer.conformations[1].every(Number.isFinite));
    layer.pointTargets.forEach(({ atom }, index) => {
      const target = structure.closedCoordinates.get(JSON.stringify([atom.authSeqId, atom.labelSeqId, atom.insertionCode]));
      for (let axis = 0; axis < 3; axis++) {
        const expected = layer.positions[index * 3 + axis] + (target[axis] - atom.position[axis]) * 0.05;
        assert(Math.abs(layer.conformations[1][index * 3 + axis] - expected) < 1e-8);
      }
    });
  }
  assert(points.some((layer) => layer.conformations[1].some((v, i) => Math.abs(v - layer.positions[i]) > 0.01)));
});
test('preparation validates before committing, persists raw states and reopens offline', async () => {
  const { closed, loaded } = fixture(), before = structuredClone(loaded.scene.assets);
  const args = { loaded, signal: new AbortController().signal, parse: () => ({ ...closed, atoms: [] }),
    loadAccession: async () => ({ bytes: new Uint8Array([1, 2, 3]), source: { provider: 'RCSB PDB', accession: '1AKE' } }) };
  await assert.rejects(prepareAdk(args)); assert.deepEqual(loaded.scene.assets, before);
  args.parse = () => closed;
  const prepared = await prepareAdk(args);
  assert.equal(loaded.scene.assets.length, 2);
  assert.match(loaded.scene.assets[1].sha256, /^[a-f0-9]{64}$/);
  args.loadAccession = () => { throw new Error('must not fetch'); };
  await prepareAdk(args);
  const player = createAdkPlayer({ ...loaded, states: prepared });
  player.setMorph(1); assert.equal(player.snapshot().particles[0].visible, true);
  assert.equal(player.snapshot().counters.ADP, undefined);
  player.setParameters({ ap5: 0 }); assert.equal(player.snapshot().particles[0].visible, false);
  const restored = createAdkPlayer({ ...loaded, states: prepared, state: player.save() });
  assert.deepEqual(restored.snapshot().domainMeasurements, player.snapshot().domainMeasurements);
  player.dispose(); assert.throws(() => player.snapshot(), /已释放/);
});
test('AdK recognition is limited to declared reference states; expired factories reject', async () => {
  assert.equal(resolveMechanism({ legacy: { scene: { id: '4AKE', states: ['4AKE', '1AKE'] } } }), ADK_PLAYER);
  for (const config of [{ id: '4AKE' }, { id: '1AKE', animation: {} }, { id: '4AKE', states: ['4AKE', '1AKE'], components: [{}] }]) assert.equal(resolveMechanism({ legacy: { scene: config } }), undefined);
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin); await host.activate(adenylateKinasePlugin);
  const factory = host.getPlayer(ADK_PLAYER); await host.deactivate(ADK_PLAYER);
  assert.throws(() => factory.create({}), /已停用/);
  await assert.rejects(factory.prepare({ signal: new AbortController().signal }), { name: 'AbortError' });
});
