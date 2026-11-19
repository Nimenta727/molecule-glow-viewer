// Records everything observable from the AdK structure builder and player so two implementations can be compared exactly.
import { createHash } from 'node:crypto';
import { buildAdkStructure, } from '../structure.mjs';
import { buildRepresentations } from '../../structure/representation.mjs';
import { prepareAdk, createAdkPlayer } from '../index.mjs';
import { fixture } from './fixture.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => v instanceof Map ? [...v.entries()] : v));
const digest = (value) => createHash('sha256').update(JSON.stringify(plain(value))).digest('hex');

export async function adkTrace(extra = {}) {
  const { open, closed, loaded } = fixture();
  const structure = buildAdkStructure(open, closed, extra.config);
  const layersFor = (style) => {
    const [group] = buildRepresentations(open, { style });
    const layers = new Map([['preview', group.layers.map((layer, i) => ({ ...layer, pointTargets: group.pointTargets[i] }))]]);
    structure.decorate(layers, loaded.scene.nodes);
    return layers.get('preview');
  };
  const prepareArgs = { loaded, signal: new AbortController().signal, parse: () => closed, config: extra.config,
    loadAccession: async () => ({ bytes: new Uint8Array([1, 2, 3]), source: { provider: 'RCSB PDB', accession: '1AKE' } }) };
  const prepared = await prepareAdk(prepareArgs);
  const player = createAdkPlayer({ ...loaded, states: prepared, config: extra.config });
  const times = [0, 3, 7, 20, 60];
  const snapshots = times.map((time) => { player.seek(time); return plain(player.snapshot()); });
  player.setMorph(1); const closedSnapshot = plain(player.snapshot());
  player.setParameters({ ap5: 0 }); const hidden = plain(player.snapshot());
  const saved = player.save();
  return plain({
    rmsd: structure.rmsd, matched: structure.matched, inhibitor: structure.inhibitor,
    measurements: [0, 0.3, 1].map((f) => structure.measurements(f)),
    blobLayers: digest(layersFor('blob')), functionalLayers: digest(layersFor('functional')),
    assets: loaded.scene.assets, resources: [...loaded.resources.entries()].map(([k, v]) => [k, [...v]]),
    steps: player.steps, navigation: player.navigation, functionalDescription: player.functionalDescription,
    evidence: player.evidence, particleParentId: player.particleParentId,
    snapshots, closedSnapshot, hidden, saved,
  });
}
