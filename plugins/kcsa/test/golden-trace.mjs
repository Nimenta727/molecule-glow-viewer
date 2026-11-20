// Records everything observable from the KcsA structure builder, preparation and player so two implementations can be compared exactly.
import { createHash } from 'node:crypto';
import { buildKcsaStructure } from '../structure.mjs';
import { prepareKcsa, createKcsaPlayer } from '../index.mjs';
import { kcsaFixture, previewLayers } from './fixture.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => v instanceof Map ? [...v.entries()] : v));
const digest = (value) => createHash('sha256').update(JSON.stringify(plain(value))).digest('hex');

export async function kcsaTrace({ config, fixture = {} } = {}) {
  const input = kcsaFixture(fixture);
  const structure = buildKcsaStructure(input.model, input.states, config);
  const layers = previewLayers(input.scene);
  structure.decorate(layers, input.scene.nodes);
  const player = createKcsaPlayer({ ...input, state: { seed: 3 }, config });
  const times = [0, 2, 8, 20, 60, 119];
  const snapshots = times.map((time) => { player.seek(time); return plain(player.snapshot()); });
  player.seek(30); player.setParameters({ pH: 7, V: -60 }); player.seek(40);
  const changed = plain(player.snapshot());
  const saved = player.save();
  const restored = plain(createKcsaPlayer({ ...input, state: saved, config }).snapshot());
  const stored = new Map(), assets = [];
  const loaded = { scene: { legacy: input.scene.legacy, assets: [{ ...input.scene.assets[0] }] }, resources: new Map([['assets/source.cif', new Uint8Array([1])]]) };
  await prepareKcsa({ loaded, config, signal: new AbortController().signal, parse: (c, o) => ({ coordinates: [...c.bytes], options: o }),
    loadAccession: async (accession) => ({ bytes: new Uint8Array([accession.length]), source: { provider: 'RCSB PDB', accession }, name: `${accession}.cif` }) });
  return plain({
    fits: Object.fromEntries(Object.entries(structure.fits).map(([id, f]) => [id, { rmsd: f.rmsd, order: f.order }])),
    sites: structure.sites, paths: structure.paths, blockers: structure.blockers, axis: structure.axis, center: structure.center,
    decorated: digest(layers),
    steps: player.steps, navigation: player.navigation, evidence: player.evidence, membrane: player.membrane,
    particleParentId: player.particleParentId, duration: player.duration,
    snapshots, changed, saved, restored,
    prepared: { assets: loaded.scene.assets, models: [...loaded.kcsaModels.keys()] },
  });
}
