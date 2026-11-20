import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdkStructure } from '../structure.mjs';
import { buildRepresentations } from '../../structure/representation.mjs';
import { prepareAdk, createAdkPlayer, ADK_PLAYER, adenylateKinasePlugin } from '../index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { resolveMechanism } from '../../mechanism-catalog.mjs';
import { fixture } from './fixture.mjs';
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

test('with the default work configuration the AdK builder and player behave exactly as before the extraction (golden trace)', async () => {
  const { readFileSync } = await import('node:fs');
  const { adkTrace } = await import('./golden-trace.mjs');
  const { ADK_4AKE_TEMPLATE } = await import('../config.mjs');
  const golden = JSON.parse(readFileSync(new URL('./golden-default.json', import.meta.url), 'utf8'));
  assert.deepEqual(await adkTrace(), golden);
  assert.deepEqual(await adkTrace({ config: ADK_4AKE_TEMPLATE }), golden);
});

test('the same algorithm serves another two-domain protein by configuration alone (no adenylate kinase left in the output)', async () => {
  const { hingeFixture, HINGE_CONFIG } = await import('./fixture.mjs');
  const { open, closed, loaded } = hingeFixture();
  assert.throws(() => buildAdkStructure(open, closed), /需要大肠杆菌 A 链的 214 个/, 'the default template rejects it, naming what it expects');
  const structure = buildAdkStructure(open, closed, HINGE_CONFIG);
  assert(structure.rmsd < 1e-8);
  assert.deepEqual(structure.measurements(1).map(({ name }) => name), ['ARM'], 'only the non-fit domain is measured');
  assert(Math.abs(structure.measurements(1)[0].angle - 30) < 1e-6);
  assert.equal(structure.inhibitor.name, '配体X');
  assert.equal(structure.inhibitor.molecule.length, 2);
  const prepareArgs = { loaded, config: HINGE_CONFIG, signal: new AbortController().signal, parse: () => closed,
    loadAccession: async (accession) => { assert.equal(accession, 'CLOSED'); return { bytes: new Uint8Array([9]), source: { provider: 'test', accession } }; } };
  const prepared = await prepareAdk(prepareArgs);
  assert.equal(loaded.scene.assets[1].id, 'adk-state-CLOSED');
  assert.equal(loaded.scene.assets[1].path, 'assets/adk/CLOSED.cif');
  assert.equal(loaded.scene.assets[1].provenance.mechanismState.accession, 'CLOSED');
  const player = createAdkPlayer({ ...loaded, states: prepared, config: HINGE_CONFIG });
  assert.deepEqual(player.steps.map(({ title }) => title), ['步骤1', '步骤2', '步骤3', '步骤4']);
  assert.deepEqual(player.navigation.views.map(({ id }) => id), ['hinge-protein', 'hinge-mechanism']);
  assert.equal(player.navigation.views[1].title, '铰链闭合');
  assert.match(player.evidence.details, /^OPEN \/ CLOSED B 链 120 个 Cα；BODY 叠合 RMSD .*相对 BODY 的闭合端运动：ARM 30\.00°.*仅为软件测试用的合成数据。$/);
  assert.equal(player.evidence.citation, '铰链演示');
  player.setMorph(1);
  const snapshot = player.snapshot();
  assert.match(snapshot.metrics, /^BODY 叠合 RMSD .*ARM 30\.0° .*（相对 BODY）$/);
  assert.equal(snapshot.particles[0].name, '配体X');
  assert.doesNotMatch(JSON.stringify([player.steps, player.navigation, player.evidence, snapshot.metrics, player.functionalDescription]), /CORE|NMP|LID|AdK|Ap5A|4AKE|1AKE/);
  player.dispose();
});

test('an invalid AdK work configuration is rejected with the offending field named', () => {
  const { open, closed } = fixture();
  const make = (config) => () => buildAdkStructure(open, closed, config);
  assert.throws(make('x'), /配置必须是对象/);
  assert.throws(make({ fitDomain: 'MISSING' }), /fitDomain "MISSING" 不在 domains 中/);
  assert.throws(make({ domains: [{ name: 'A', color: '#000000', ranges: [[5, 2]] }, { name: 'B', color: '#000000', ranges: [[1, 2]] }] }), /domains\[0\]\.ranges\[0\]/);
  assert.throws(make({ domains: [{ name: 'A', color: '#000000', ranges: [[1, 2]] }, { name: 'A', color: '#000000', ranges: [[3, 4]] }], fitDomain: 'A' }), /名称不能重复/);
  assert.throws(make({ domains: [{ name: 'A', color: 'red', ranges: [[1, 2]] }, { name: 'B', color: '#000000', ranges: [[3, 4]] }], fitDomain: 'A' }), /domains\[0\]\.color/);
  assert.throws(make({ protein: { namePattern: '(' } }), /namePattern 不是有效的正则/);
  assert.throws(make({ protein: { residues: 3 } }), /protein\.residues/);
  assert.throws(make({ maxFitRmsd: 0 }), /maxFitRmsd/);
  assert.throws(make({ steps: [{ title: 'only', caption: 'one' }] }), /steps 必须是 4–4 项/);
  assert.throws(make({ ligand: { color: 'x' } }), /ligand\.color/);
});

test('a fit worse than the configured limit is refused with that limit in the message', async () => {
  const { hingeFixture, HINGE_CONFIG } = await import('./fixture.mjs');
  const { open, closed } = hingeFixture();
  const bent = { ...closed, atoms: closed.atoms.map((a, i) => i < 70 ? { ...a, position: [a.position[0] + (i % 7) * 4, a.position[1], a.position[2]] } : a) };
  assert.throws(() => buildAdkStructure(open, bent, { ...HINGE_CONFIG, maxFitRmsd: 0.5 }), /BODY 叠合 RMSD 超过 0\.5 Å/);
});
