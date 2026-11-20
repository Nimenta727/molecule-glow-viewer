import assert from 'node:assert/strict';
import test from 'node:test';
import { DataAnimation, resolveAnchor } from '../data-animation.mjs';
import { normalizeDataAnimation, normalizeAnchor } from '../data-spec.mjs';
import { mechanismWorkConfig } from '../works/mechanism-works.mjs';
import { normalizeDataConfig } from '../data-tool.mjs';
import { seededRng } from '../../motion/particles.mjs';

// a flat structure with the membrane at y = 0 and a few named cofactors: enough to resolve anchors and run the relay
const points = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) points.push([i * 8 - 44, ((i + j) % 3) * 2 - 2, j * 8 - 44]);
const ligand = (comp, part, x, y, z) => ({ comp, part, centre: [x, y, z] });
const structure = (extra = {}) => ({ points, membraneY: [0], residue: () => null, part: () => null, partPoints: () => [], ligands: [], ...extra });
const cofactors = [ligand('SF4', 'nadh x', 0, 90, 0), ligand('SF4', 'nadh x', 0, 76, 0), ligand('SF4', 'nadh x', 0, 62, 0), ligand('SF4', 'nadh x', 0, 48, 0), ligand('SF4', 'nadh x', 30, 90, 0), ligand('FES', 'rieske b-c1', 0, 0, 0), ligand('HEM', 'b-c1', 5, -10, 0), ligand('HEM', 'b-c1', 5, 10, 0)];

test('anchors: cofactors by component, part, pick and chain; between, onMembrane, refs, and cycles are reported', () => {
  const s = structure({ ligands: cofactors }), warnings = [], at = (a, named) => resolveAnchor(normalizeAnchor(a), s, [0, 0, 0], (w) => warnings.push(w), named);
  assert.deepEqual(at({ ligands: 'SF4', part: '/nadh/', chain: 'down' }), [[0, 90, 0], [0, 76, 0], [0, 62, 0], [0, 48, 0]], 'the wire: the isolated cluster 30 Å to the side is not on it');
  assert.deepEqual(at({ ligands: 'SF4', part: '/nadh/', chain: 'down', take: 'last' }), [[0, 48, 0]]);
  assert.deepEqual(at({ ligands: 'HEM', part: 'b-c1', pick: 'top' }), [[5, 10, 0]]);
  assert.deepEqual(at({ ligands: 'HEM', part: 'b-c1', pick: 'nearest', to: [5, -9, 0] }), [[5, -10, 0]]);
  assert.deepEqual(at({ ligands: 'HEM', part: 'b-c1', pick: 'bottom', above: [0, -50, 0], margin: 0 }), [[5, -10, 0]]);
  assert.deepEqual(at({ ligands: 'HEM', part: 'b-c1', pick: 'nearest', to: [5, -9, 0], above: [0, -10, 0], margin: 6 }), [[5, 10, 0]], 'above a reference by a margin');
  assert.deepEqual(at({ between: [[0, 0, 0], [10, 20, 0]], t: 0.25 }), [[2.5, 5, 0]]);
  assert.deepEqual(at({ ligands: 'FES', part: 'rieske', onMembrane: { index: 0, dy: 26, blend: 0.5 }, offset: [1, 0, 0] }), [[1, 13, 0]], 'half way to the membrane plus 26');
  assert.deepEqual(at({ ref: 'a', offset: [0, 1, 0] }, { a: normalizeAnchor([4, 5, 6]) }), [[4, 6, 6]]);
  assert.equal(warnings.length, 0);
  assert.deepEqual(at({ ligands: 'ZZZ' }), [[0, 0, 0]]); assert.match(warnings[0], /没有找到小分子 ZZZ/);
  at({ ref: 'x' }, { x: { ref: 'y' }, y: { ref: 'x' } }); assert.match(warnings.at(-1), /引用了它自己/);
});

test('a declaration with a ref that names nothing, or a relay without phases, is refused by name', () => {
  const base = { version: 1, compartments: { 溶液: {} } };
  assert.match(normalizeDataAnimation({ ...base, flows: [{ species: 'H⁺', via: [{ ref: 'nowhere' }], rate: 1 }] }).errors[0], /不存在的命名锚点“nowhere”/);
  assert.match(normalizeDataAnimation({ ...base, relays: [{ rate: 1, phases: [] }] }).errors[0], /没有阶段/);
  assert.match(normalizeDataAnimation({ ...base, relays: [{ rate: 1, phases: [[{ species: 'e⁻', via: [] }]] }] }).errors[0], /via/);
  assert.equal(normalizeDataAnimation({ ...base, relays: [{ rate: 1, phases: [[{ pause: 1 }]] }] }).errors.length, 0);
});

function run(seconds, { seed = 7, stopAt = null } = {}) {
  const config = normalizeDataConfig(mechanismWorkConfig({ process: 'respiratoryChain', axisFit: ['x'], up: 'y', membranes: [{ at: 'z', offset: 0 }] }));
  const engine = new DataAnimation(config.animation, structure({ ligands: cofactors }), { rng: seededRng(seed), kinetics: config.kinetics });
  const stages = new Set();
  for (let i = 0; i < seconds * 30; i++) {
    if (stopAt !== null && i === stopAt * 30) engine.relays[0].rate = 0;   // no new cycle: let the running ones finish
    engine.step(1 / 30); if (engine.stage !== null) stages.add(engine.stage);
  }
  return { engine, stages };
}

test('respiratory relay: every NADH pumps 6 H⁺, releases 4 in the Q cycle, and two NADH make one water pair; the stages come in order; the metering balances', () => {
  const { engine, stages } = run(240, { stopAt: 100 });
  const cycles = engine.relays[0].n, c = engine.summary().counters;
  assert.ok(cycles >= 3, `cycles ${cycles}`);
  assert.equal(engine.relays[0].busy, 0, 'every cycle finished');
  assert.equal(c.NADH, cycles);
  assert.equal(c['H⁺ 泵出（复合体 I / IV）'], 6 * cycles, '4 by complex I + 1 per electron by complex IV');
  assert.equal(c['H⁺ 释放到膜间隙（Q 循环）'], 4 * cycles);
  assert.equal(c['O₂ → H₂O'], Math.floor(cycles / 2), 'O₂ is reduced after 4 electrons = 2 NADH');
  assert.deepEqual([...stages].sort(), [0, 1, 2, 3, 4, 5, 6]);
  const inv = engine.balance(); for (const [name, { expected, actual }] of Object.entries(inv)) assert.equal(actual, expected, `${name}: ${actual} vs ${expected}`);
  assert.deepEqual(engine.summary().violations, []);
});

test('respiratory relay: deterministic for a seed, different for another; no cycle starts without flux (no substrate)', () => {
  const a = run(60), b = run(60), other = run(60, { seed: 8 });
  assert.deepEqual(a.engine.summary().events, b.engine.summary().events); assert.deepEqual(a.engine.summary().counters, b.engine.summary().counters);
  assert.notDeepEqual(a.engine.frame().items.map((i) => i.position), other.engine.frame().items.map((i) => i.position));
  const config = normalizeDataConfig(mechanismWorkConfig({ process: 'respiratoryChain', axisFit: ['x'], up: 'y', membranes: [{ at: 'z', offset: 0 }] }));
  const dead = new DataAnimation(config.animation, structure({ ligands: cofactors }), { rng: seededRng(7), kinetics: config.kinetics });
  dead.kinetics.setControl('sub', false); dead.kinetics.setControl('o2', false);
  for (let i = 0; i < 30 * 600; i++) dead.step(1 / 30);
  assert.ok(dead.kinetics.flux.rate <= 0.08, `flux ${dead.kinetics.flux.rate}`);
  const before = dead.relays[0].n; for (let i = 0; i < 30 * 120; i++) dead.step(1 / 30);
  assert.equal(dead.relays[0].n, before, 'the chain is stopped: no new cycle');
});

test('fast time scale: the counters keep the same stoichiometry without journeys', () => {
  const config = normalizeDataConfig(mechanismWorkConfig({ process: 'respiratoryChain', axisFit: ['x'], up: 'y', membranes: [{ at: 'z', offset: 0 }] }));
  const engine = new DataAnimation(config.animation, structure({ ligands: cofactors }), { rng: seededRng(7), scale: () => 'fast', kinetics: config.kinetics });
  for (let i = 0; i < 30 * 200; i++) engine.step(1 / 30);
  const c = engine.summary().counters, n = c.NADH;
  assert.ok(n > 5); assert.equal(c['H⁺ 泵出（复合体 I / IV）'], 6 * n); assert.equal(c['H⁺ 释放到膜间隙（Q 循环）'], 4 * n); assert.equal(c['O₂ → H₂O'], Math.floor(n / 2));
});
