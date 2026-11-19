import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareKcsa, kcsaPlugin, KCSA_PLAYER } from '../index.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';

function input() {
  const source = { id: 'primary', kind: 'file', path: 'assets/primary.cif', mediaType: 'chemical/x-mmcif', provenance: { parserVersion: '1.0.0' } };
  return { loaded: { scene: { legacy: { scene: { id: '1K4C' } }, assets: [source] }, resources: new Map([[source.path, new Uint8Array([1])]]) },
    parse: (coordinates, options) => ({ coordinates: [...coordinates.bytes], options }), signal: new AbortController().signal,
    loadAccession: async (accession) => ({ bytes: new Uint8Array([2]), source: { provider: 'RCSB PDB', accession }, name: `${accession}.cif` }) };
}
test('required state fetch failure leaves the scene and resources intact', async () => {
  const args = input();
  const before = structuredClone(args.loaded);
  const load = args.loadAccession;
  args.loadAccession = async (id) => { if (id === '5VKE') throw new Error('offline'); return load(id); };
  await assert.rejects(prepareKcsa(args), /offline/);
  assert.deepEqual(args.loaded, before);
});
test('state coordinates are persisted with hashes and reused without downloading', async () => {
  const args = input();
  await prepareKcsa(args);
  assert.equal(args.loaded.scene.assets.length, 5);
  for (const asset of args.loaded.scene.assets.slice(1)) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  delete args.loaded.kcsaModels;
  args.loadAccession = () => { throw new Error('must not fetch'); };
  await prepareKcsa(args);
  assert.equal(args.loaded.kcsaModels.size, 5);
  assert.equal(args.loaded.scene.assets.length, 5);
  assert.equal(args.loaded.kcsaModels.get('1K4C').options.assemblyId, '1');
});
test('cancellation and an expired plugin factory cannot prepare coordinates', async () => {
  const args = input(), abort = new AbortController(); abort.abort(); args.signal = abort.signal;
  await assert.rejects(prepareKcsa(args), { name: 'AbortError' });
  assert.equal(args.loaded.scene.assets.length, 1);
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin); await host.activate(kcsaPlugin);
  const factory = host.getPlayer(KCSA_PLAYER);
  await host.deactivate(KCSA_PLAYER);
  await assert.rejects(factory.prepare(input()), { name: 'AbortError' });
  assert.throws(() => factory.create({}), /已停用/);
  await host.deactivate('org.glow.structure');
});
