import assert from 'node:assert/strict';
import test from 'node:test';
import { DataAnimation } from '../data-animation.mjs';
import { normalizeDataAnimation } from '../data-spec.mjs';
import { normalizeDataConfig } from '../data-tool.mjs';
import { mechanismWorkConfig } from '../works/mechanism-works.mjs';
import { seededRng } from '../../motion/particles.mjs';
import { Replay } from '../replay.mjs';

const points = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) points.push([i * 8 - 44, ((i + j) % 3) * 2 - 2, j * 8 - 44]);
const structure = { points, membraneY: [0], residue: () => null, part: () => null, partPoints: () => [], ligands: [] };
const scene = (process, extra = {}) => ({ process, axisFit: ['x'], up: 'y', membranes: [{ at: 'z', offset: 0 }], ...extra });

test('declaration: a rotor needs parts; perTurn flows and derived counters are read; bad ones are reported', () => {
  const base = { version: 1, compartments: { a: {}, b: {} } };
  assert.match(normalizeDataAnimation({ ...base, rotor: { parts: [] } }).errors[0], /rotor/);
  const { spec, errors } = normalizeDataAnimation({ ...base, rotor: { parts: ['x'], turnsPerSecond: 9, mode: 'bogus' }, flows: [{ species: 'H⁺', via: [[0, 0, 0]], perTurn: 8, phase: 0.5 }],
    derived: [{ name: 'd', terms: { a: 2 }, floor: true }, { name: '', terms: {} }] });
  assert.deepEqual(errors, []); assert.deepEqual([spec.rotor.mode, spec.rotor.turnsPerSecond, spec.flows[0].perTurn, spec.flows[0].phase, spec.derived.length], ['sym', 2, 8, 0.5, 1]);
});

test('flagellar motor: the rotor turns with the clock and every 1/44 turn one proton passes, whatever the speed (fast scale: exact counts)', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('flagellarMotor', { spin: ['rod', 'C 环'] })));
  assert.deepEqual(config.animation.rotor.parts, ['rod', 'C 环']);
  const engine = new DataAnimation(config.animation, structure, { rng: seededRng(7), scale: () => 'fast' });
  const at = (turns) => { while (engine.rotor.travelled < turns) engine.step(1 / 30); return engine.summary().counters['H⁺（示意）']; };
  const c1 = at(2), c2 = at(3), c3 = at(5);
  assert.equal(c2 - c1, 44, 'one whole turn = 44 protons'); assert.equal(c3 - c2, 88);
  assert.ok(Math.abs(engine.rotor.angle - 2 * Math.PI * engine.rotor.travelled) < 1e-9);
  const fast = new DataAnimation(config.animation, structure, { rng: seededRng(7), scale: () => 'fast' }), slow = new DataAnimation(config.animation, structure, { rng: seededRng(7), scale: () => 'slow' });
  for (let i = 0; i < 30 * 40; i++) { fast.step(1 / 30); slow.step(1 / 30); }
  assert.equal(slow.rotor.travelled, fast.rotor.travelled, 'the rotor does not depend on the time scale');
});

test('flagellar motor, slow scale: protons really cross, each stator in turn; the counter follows the rotor', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('flagellarMotor', { spin: ['rod'] })));
  const engine = new DataAnimation(config.animation, structure, { rng: seededRng(7) });
  for (let i = 0; i < 30 * 100; i++) engine.step(1 / 30);
  const made = Math.floor(engine.rotor.travelled * 44), shown = engine.summary().counters['H⁺（示意）'];
  assert.ok(shown >= made - 14 && shown <= made + 11, `${shown} vs ${made}: the journeys still on the way are not counted`);
  assert.deepEqual(Object.values(engine.balance()).filter((v) => v.expected !== v.actual), []);
});

test('respiratory chain: ATP synthase turns on the model\'s ATP flux while there are protons to return; 8 H⁺ and 3 ATP per turn; the ledger is derived', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('respiratoryChain', { spin: ['subunit gamma', 'subunit C1'] })));
  const engine = new DataAnimation(config.animation, structure, { rng: seededRng(7), kinetics: config.kinetics, scale: () => 'fast' });
  let minStock = Infinity;
  for (let i = 0; i < 30 * 400; i++) { engine.step(1 / 30); minStock = Math.min(minStock, engine.summary().counters['H⁺ 膜间隙存量']); }
  const c = engine.summary().counters;
  assert.ok(c['H⁺ 回流（ATP 合酶）'] > 8, `returned ${c['H⁺ 回流（ATP 合酶）']}`);
  assert.equal(c['H⁺ 回流（ATP 合酶）'], Math.floor(engine.rotor.travelled * 8) + (engine.rotor.travelled > 0 ? 1 : 0), '8 H⁺ per turn');
  assert.equal(c['ATP（合酶产出）'], Math.floor(c['H⁺ 回流（ATP 合酶）'] * 3 / 8), 'ATP = H⁺ returned × 3/8');
  assert.equal(c['H⁺ 膜间隙存量'], c['H⁺ 泵出（复合体 I / IV）'] + c['H⁺ 释放到膜间隙（Q 循环）'] - c['H⁺ 回流（ATP 合酶）']);
  assert.equal(c['ATP / NADH'], +(c['ATP（合酶产出）'] / c.NADH).toFixed(2));
  assert.ok(minStock > -2, `the stock of protons in the intermembrane space never goes below the one proton of a single step (${minStock})`);
});

test('the rotor stops without substrate (no flux, no protons); a rewind and replay gives the same angle', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('respiratoryChain', { spin: ['subunit gamma'] })));
  const make = (host) => new DataAnimation(config.animation, structure, { rng: seededRng(7), kinetics: config.kinetics, pace: () => host.pace, scale: () => host.scale });
  const r = new Replay({ make });
  r.advance(30 * 60); r.intervene({ kind: 'control', id: 'sub', value: false }); r.intervene({ kind: 'control', id: 'o2', value: false }); r.advance(30 * 240);
  const angle = r.engine.rotor.angle, turns = r.engine.rotor.travelled;
  r.advance(30 * 60); assert.ok(r.engine.rotor.travelled - turns < 0.5, 'the rotor has (nearly) stopped without substrate');
  const end = r.engine.rotor.angle; r.seek(30 * 300); assert.equal(r.engine.rotor.angle, angle); r.seek(30 * 360); assert.equal(r.engine.rotor.angle, end);
});
