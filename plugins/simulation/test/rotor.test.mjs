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

test('flagellar motor controls: the default is the motor as before; CheY-P reverses it with the same protons per turn; the gradient sets the speed; no gradient, no turn, no proton', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('flagellarMotor', { spin: ['rod', 'C 环'] })));
  assert.equal(config.animation.rotor.by, 'rotor'); assert.deepEqual(config.kinetics.controls.map(({ id, default: value }) => [id, value]), [['pmf', 150], ['cw', false]]);
  const make = (kinetics) => new DataAnimation(config.animation, structure, { rng: seededRng(7), kinetics, scale: () => 'fast' });
  const run = (engine, seconds) => { for (let i = 0; i < 30 * seconds; i++) engine.step(1 / 30); return engine; };
  const plain = run(make(null), 40), withControls = run(make(config.kinetics), 40);
  assert.equal(withControls.rotor.angle, plain.rotor.angle, 'default controls: the angle is exactly what it was without them');
  assert.equal(withControls.summary().counters['H⁺（示意）'], plain.summary().counters['H⁺（示意）']);
  const reverse = make(config.kinetics); reverse.kinetics.setControl('cw', true); run(reverse, 40);
  assert.ok(Math.abs(reverse.rotor.angle + plain.rotor.angle) < 1e-9, 'clockwise is the same turns the other way');
  assert.equal(reverse.rotor.travelled, plain.rotor.travelled, 'the turns made are counted without sign');
  assert.equal(reverse.summary().counters['H⁺（示意）'], plain.summary().counters['H⁺（示意）'], 'the protons follow the turns, in either direction');
  const half = make(config.kinetics); half.kinetics.setControl('pmf', 75); run(half, 40);
  assert.ok(Math.abs(half.rotor.travelled - plain.rotor.travelled / 2) < 1e-9, 'half the gradient, half the speed');
  assert.ok(half.summary().counters['H⁺（示意）'] <= plain.summary().counters['H⁺（示意）'] / 2 + 1);
  const stalled = make(config.kinetics); stalled.kinetics.setControl('pmf', 0); run(stalled, 40);
  assert.equal(stalled.rotor.travelled, 0); assert.equal(stalled.rotor.angle, 0); assert.equal(stalled.summary().counters['H⁺（示意）'], 0, 'no gradient: nothing turns, nothing passes');
  const stalledReverse = make(config.kinetics); stalledReverse.kinetics.setControl('pmf', 0); stalledReverse.kinetics.setControl('cw', true); run(stalledReverse, 10);
  assert.equal(stalledReverse.rotor.travelled, 0, 'reversing a motor with no gradient does not make it turn');
});

test('flagellar motor: reversing in the middle of a run turns the rotor back and a replay of the log gives the same angle', () => {
  const config = normalizeDataConfig(mechanismWorkConfig(scene('flagellarMotor', { spin: ['rod'] })));
  const host = { pace: 1, scale: 'fast' }, make = (h) => new DataAnimation(config.animation, structure, { rng: seededRng(7), kinetics: config.kinetics, pace: () => h.pace, scale: () => h.scale });
  const replay = new Replay({ make, host }); replay.seek(30 * 20);
  const forward = replay.engine.rotor.angle; assert.ok(forward > 0);
  replay.intervene({ kind: 'control', id: 'cw', value: true }); replay.seek(30 * 40);
  assert.ok(replay.engine.rotor.angle < forward, 'after the reversal the angle goes back');
  const angle = replay.engine.rotor.angle, travelled = replay.engine.rotor.travelled;
  replay.seek(30 * 10); replay.seek(30 * 40);
  assert.equal(replay.engine.rotor.angle, angle, 'rewinding and running on again, the log makes the same reversal at the same step');
  assert.equal(replay.engine.rotor.travelled, travelled);
});
