import assert from 'node:assert/strict';
import test from 'node:test';
import { atpSynthasePlugin, ATP_PLAYER, createAtpPlayer } from '../index.mjs';
import { superpose } from '../../structure/alignment.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';

function fixture() {
  const names = { C: 'ATP synthase subunit C1', G: 'ATP synthase subunit gamma' };
  const atoms = [];
  for (let i = 0; i < 8; i++) {
    names[`C${i}`] = names.C;
    atoms.push({ name: 'CA', element: 'C', record: 'ATOM', modelId: '1',
      authChainId: `C${i}`, labelChainId: `C${i}`, labelSeqId: String(i + 1), authSeqId: String(i + 1),
      residueName: 'GLY', position: [10 * Math.cos(i * Math.PI / 4), 0, 10 * Math.sin(i * Math.PI / 4)] });
  }
  for (let chain = 0; chain < 3; chain++) {
    const id = String(chain);
    names[id] = 'ATP synthase subunit beta';
    for (let i = 0; i < 6; i++) atoms.push({ name: 'CA', element: 'C', record: 'ATOM', modelId: '1',
      authChainId: id, labelChainId: id, labelSeqId: String(i + 1), authSeqId: String(i + 1),
      residueName: 'ALA', position: [Math.cos(chain * 2 * Math.PI / 3) * 15 + i,
        35 + i % 2, Math.sin(chain * 2 * Math.PI / 3) * 15 + i * (i > 2 ? chain + 1 : 1)] });
  }
  const scene = { assets: [{ id: 'source', kind: 'file', mediaType: 'chemical/x-mmcif' }],
    nodes: Object.entries(names).map(([id, partName]) => ({
      id, assetId: id, parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      extensions: { 'org.glow.structure': { sourceAssetId: 'source', partName, chainId: id } },
    })) };
  return { model: { format: 'mmcif', atoms, chainNames: names }, scene };
}

test('Horn alignment recovers a rigid rotation without changing source coordinates', () => {
  const source = [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]];
  const target = source.map(([x, y, z]) => [-y + 4, x + 5, z + 6]);
  const fit = superpose(target, source);
  source.forEach((point, i) => assert.ok(Math.hypot(...fit(point).map((value, j) => value - target[i][j])) < 1e-8));
});

test('ATP player seeks deterministically and produces 8 H+ and 3 ATP per complete turn', () => {
  const input = fixture();
  const a = createAtpPlayer({ ...input, state: { seed: 7, speed: 0.25 } });
  const b = createAtpPlayer({ ...input, state: { seed: 7, speed: 0.25 } });
  a.play();
  for (let i = 0; i < 120; i++) a.advance(1 / 30);
  const stepped = a.snapshot(), sought = b.seek(4);
  assert.deepEqual(stepped.counters, { ATP: 3, 'H⁺': 8 });
  assert.deepEqual(stepped.counters, sought.counters);
  assert.deepEqual(stepped.events, sought.events);
  stepped.particles.forEach((particle, i) => assert.ok(Math.hypot(...particle.position.map((value, j) =>
    value - sought.particles[i].position[j])) < 1e-8));
  a.pause();
  const paused = a.snapshot().time;
  a.advance(10);
  assert.equal(a.snapshot().time, paused);
  const saved = a.save();
  const restored = createAtpPlayer({ ...input, state: saved });
  assert.deepEqual(restored.snapshot().counters, a.snapshot().counters);
  assert.equal(restored.snapshot().playing, false);
  assert.ok([...a.seek(1).transforms.keys()].every((id) => id.startsWith('C') || id === 'G'));
  a.seek(4);
  a.setSpeed(0.5);
  assert.deepEqual(a.snapshot().counters, { ATP: 3, 'H⁺': 8 });
  const varied = a.seek(6);
  assert.deepEqual(varied.counters, { ATP: 6, 'H⁺': 16 });
  const replay = createAtpPlayer({ ...input, state: a.save() });
  assert.deepEqual(replay.snapshot().events, varied.events);
  assert.deepEqual(replay.seek(0).counters, { ATP: 0, 'H⁺': 0 });
  a.dispose();
  assert.throws(() => a.snapshot(), /释放/);
});

test('deactivating the official plugin removes its panel and disposes all active players', async () => {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  await host.activate(atpSynthasePlugin);
  const player = host.getPlayer(ATP_PLAYER).create(fixture());
  assert.equal(host.getPanel(ATP_PLAYER).title, 'ATP 合酶');
  await host.deactivate(ATP_PLAYER);
  assert.equal(host.getPlayer(ATP_PLAYER), undefined);
  assert.equal(host.getPanel(ATP_PLAYER), undefined);
  assert.throws(() => player.snapshot(), /释放/);
});
