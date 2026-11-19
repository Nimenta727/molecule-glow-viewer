import assert from 'node:assert/strict';
import test from 'node:test';
import { atpSynthasePlugin, ATP_PLAYER, createAtpPlayer } from '../index.mjs';
import { superpose } from '../../structure/alignment.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { fixture } from './fixture.mjs';
import { ATP_6ZPO_TEMPLATE } from '../config.mjs';

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

test('with the default work configuration the player behaves exactly as before the extraction (golden trace)', async () => {
  const { readFileSync } = await import('node:fs');
  const { trace } = await import('./golden-trace.mjs');
  const golden = JSON.parse(readFileSync(new URL('./golden-default.json', import.meta.url), 'utf8'));
  assert.deepEqual(trace(createAtpPlayer({ ...fixture(), state: { seed: 7, speed: 0.25 } })), golden);
  assert.deepEqual(trace(createAtpPlayer({ ...fixture(), state: { seed: 7, speed: 0.25 }, config: ATP_6ZPO_TEMPLATE })), golden);
});

test('the same algorithm serves a different ring size when the work configuration says so (c10: 10 H+ and 3 ATP per turn)', () => {
  const input = fixture({ ring: 10 });
  assert.throws(() => createAtpPlayer({ ...input, state: { seed: 1 } }), /适用于具有 8 个 c 亚基/);
  const player = createAtpPlayer({ ...input, state: { seed: 1, speed: 0.25 }, config: { counts: { ringSubunits: 10 } } });
  const turn = player.seek(4);
  assert.deepEqual(turn.counters, { ATP: 3, 'H⁺': 10 });
  assert.equal(turn.particles.filter(({ name }) => name === 'H⁺').length, 10);
  assert.equal(player.seek(8).counters['H⁺'], 20);
  const any = createAtpPlayer({ ...input, state: { seed: 1 }, config: { counts: { ringSubunits: null } } });
  assert.equal(any.seek(4).counters['H⁺'], 10, 'null accepts the detected ring size');
});

test('another labelling scheme needs only configuration, not code: renamed subunits give identical dynamics', () => {
  const renamed = fixture({ ringName: 'c-ring protomer', betaName: 'F1 catalytic subunit', gammaName: 'central stalk' });
  const config = { parts: { ring: 'c-ring', catalytic: 'F1 catalytic', rotor: ['central stalk', 'c-ring'] },
    steps: ATP_6ZPO_TEMPLATE.steps.map((step) => ({ ...step, parts: ['central stalk', 'F1 catalytic'] })),
    particles: { proton: { name: 'H⁺', color: '#112233' } }, counterLabels: { atp: 'ATP', proton: 'H⁺' } };
  assert.throws(() => createAtpPlayer({ ...renamed, state: { seed: 7 } }), /c 环和 β 亚基/);
  const custom = createAtpPlayer({ ...renamed, state: { seed: 7, speed: 0.25 }, config });
  const standard = createAtpPlayer({ ...fixture(), state: { seed: 7, speed: 0.25 } });
  for (const time of [0, 1, 4, 11.3]) {
    const a = custom.seek(time), b = standard.seek(time);
    assert.deepEqual(a.counters, b.counters);
    assert.deepEqual(a.events, b.events);
    assert.deepEqual([...a.transforms.values()].map((t) => t.rotation), [...b.transforms.values()].map((t) => t.rotation));
  }
  assert.equal(custom.seek(1).particles.find(({ name }) => name === 'H⁺').color, '#112233');
  assert.ok(custom.steps.every(({ nodeIds }) => nodeIds.length > 0), 'step selectors resolve against the renamed parts');
});

test('texts, labels and navigation come from the work configuration', () => {
  const player = createAtpPlayer({ ...fixture(), state: { seed: 1 }, config: {
    navigation: { idPrefix: 'rot', systemTitle: '旋转酶系统', proteinTitle: '旋转酶结构', mechanismTitle: '旋转酶机理' },
    counterLabels: { atp: '产物', proton: '质子' }, eventLabel: '释放产物' } });
  assert.deepEqual(player.navigation.views.map(({ id }) => id), ['rot-system', 'rot-protein', 'rot-mechanism']);
  assert.equal(player.navigation.views[2].title, '旋转酶机理');
  assert.equal(player.navigation.views[2].steps[0].id, 'rot-step-0');
  const snapshot = player.seek(4);
  assert.deepEqual(Object.keys(snapshot.counters), ['产物', '质子']);
  assert.equal(snapshot.events.at(-1).label, '释放产物');
});

test('an invalid work configuration is rejected with the offending field named', () => {
  const make = (config) => () => createAtpPlayer({ ...fixture(), config });
  assert.throws(make('x'), /必须是对象/);
  assert.throws(make({ parts: { ring: '' } }), /parts\.ring/);
  assert.throws(make({ parts: { rotor: [] } }), /parts\.rotor/);
  assert.throws(make({ counts: { ringSubunits: 2 } }), /ringSubunits/);
  assert.throws(make({ counts: { ringSubunits: 8.5 } }), /ringSubunits/);
  assert.throws(make({ steps: ATP_6ZPO_TEMPLATE.steps.slice(0, 4) }), /正好有 5 步/);
  assert.throws(make({ particles: { proton: { name: 'H⁺', color: 'red' } } }), /particles\.proton\.color/);
  assert.throws(make({ navigation: 3 }), /navigation 必须是对象/);
  assert.throws(() => { ATP_6ZPO_TEMPLATE.parts.ring = 'x'; }, TypeError, 'the built-in template is frozen');
});
