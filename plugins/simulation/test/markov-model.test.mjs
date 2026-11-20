import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMarkovModel, createMarkovRun, validateParameterSet, markovRandom } from '../markov-model.mjs';
import { createKinetics, DEFAULTS, PARAMETERS } from '../../kcsa/kinetics.mjs';
import { kcsaMarkov } from './kcsa-markov.mjs';

const full = (extra = {}) => ({ ...DEFAULTS, time: 0, speed: 1, ...extra });
const schedules = {
  'default': [full()],
  'pH and voltage changed at 30 s': [full(), full({ time: 30, pH: 7, V: -60 })],
  'wild type with TBA, then Ba': [full({ wt: 1, TBA: 40, pH: 4.2 }), full({ time: 25, wt: 1, TBA: 0, Ba: 60, V: 80 }), full({ time: 70, Ba: 0, pH: 7.5, speed: 3 })],
  'fast clocks, sodium': [full({ ionSpeed: 40, gateSpeed: 0.5, Nai: 100, V: -30, speed: 2 })],
  'no sodium, high K outside': [full({ Nai: 0, Ko: 150, Ki: 150, V: 20 })],
};
const TIMES = [0, 0.5, 2, 8, 20, 29.99, 30, 60, 119, 300];

test('the KcsA chain written as data declares the same parameters as the plugin and compiles without errors', () => {
  assert.deepEqual(compileMarkovModel(kcsaMarkov).errors, []);
  for (const [id, p] of Object.entries(PARAMETERS)) { const q = kcsaMarkov.parameters.find((x) => x.id === id); assert.ok(q, id); assert.deepEqual([q.min, q.max, q.step, q.default], [p.min, p.max, p.step, p.value], id); }
});

test('same seed, same schedule: the data model and the plugin give the same events at the same times and the same state, bit for bit', () => {
  let compared = 0, events = 0;
  for (const [name, schedule] of Object.entries(schedules)) for (let seed = 1; seed <= 24; seed++) {
    const a = createKinetics(seed, schedule), b = createMarkovRun(kcsaMarkov, seed, schedule);
    for (const t of TIMES) {
      const x = a.at(t), y = b.at(t); compared++;
      assert.deepEqual([y.time, y.vars.gate, y.vars.perm, y.vars.tba === 'on', y.vars.ba === 'on', y.counters.out, y.counters.inn, y.counters.na, y.clocks.ns, y.clocks.gateSeconds, y.clocks.openSeconds, y.configIndex],
        [x.time, x.gate, x.perm, x.tba, x.ba, x.out, x.inn, x.na, x.ns, x.gateSeconds, x.openSeconds, x.configIndex], `${name}, seed ${seed}, t = ${t}`);
      assert.deepEqual(y.events.map((e) => e.label), x.events.map((e) => e.label), `${name}, seed ${seed}, t = ${t}: last events`);
    }
    events += b.events(300).length;
  }
  assert.ok(compared === 5 * 24 * TIMES.length && events > 2000, `${compared} states, ${events} events compared`);
});

test('the history does not depend on how the times are asked for, and rewinding gives the same answer', () => {
  const a = createMarkovRun(kcsaMarkov, 9, schedules['pH and voltage changed at 30 s']), b = createMarkovRun(kcsaMarkov, 9, schedules['pH and voltage changed at 30 s']);
  const forward = [5, 40, 80, 119].map((t) => JSON.stringify(a.at(t))), backward = [119, 80, 40, 5].map((t) => JSON.stringify(b.at(t))).reverse();
  assert.deepEqual(forward, backward); assert.equal(JSON.stringify(a.at(40)), forward[1]);
});

test('observables: the equilibrium potential and the open fraction on the gate clock', () => {
  const run = createMarkovRun(kcsaMarkov, 4, [full({ pH: 4.2 })]), s = run.at(120);
  assert.ok(Math.abs(s.observables.EK - 25.69 * Math.log(5 / 140)) < 1e-12);
  assert.ok(Math.abs(s.observables.openFraction - s.clocks.openSeconds / s.clocks.gateSeconds) < 1e-15 && s.observables.openFraction > 0 && s.observables.openFraction < 1);
});

test('the engine reports mistakes by place and name, and refuses a declaration or schedule that cannot run', () => {
  const errors = (patch) => compileMarkovModel({ ...kcsaMarkov, ...patch }).errors.join('|');
  assert.match(errors({ version: 3 }), /版本 3/); assert.match(errors({ transitions: [] }), /没有任何转移/);
  assert.match(errors({ transitions: [{ id: 'x', rate: 'zzz' }] }), /没有定义“zzz”/); assert.match(errors({ transitions: [{ id: 'x', rate: '1', set: { gate: 'Z' } }] }), /不存在的取值“Z”/);
  assert.match(errors({ transitions: [{ id: 'x', rate: '1', set: { nope: 'a' } }] }), /不存在的变量“nope”/); assert.match(errors({ transitions: [{ id: 'x', rate: '1', count: { nope: 1 } }] }), /不存在的计数器/);
  assert.match(errors({ transitions: [{ id: 'x', rate: '1' }, { id: 'x', rate: '1' }] }), /重复/); assert.match(errors({ variables: { gate: { values: ['C'], init: 'C' } } }), /至少两个/);
  assert.match(errors({ variables: { gate: { values: ['C', 'O'], init: 'Z' } } }), /初值/); assert.match(errors({ parameters: [{ id: 'p', min: 1, max: 0, step: 1, default: 0 }] }), /不合法/);
  assert.match(errors({ clocks: [{ name: 'c', add: 'zzz' }] }), /没有定义“zzz”/); assert.match(errors({ constants: { dt: 1 } }), /重复/);
  assert.throws(() => createMarkovRun({ version: 1 }, 1), /无法运行/);
  assert.throws(() => createMarkovRun(kcsaMarkov, 1, [full({ pH: 99 })]), /pH.*应在/); assert.throws(() => createMarkovRun(kcsaMarkov, 1, [full({ nope: 1 })]), /没有参数“nope”/);
  assert.throws(() => createMarkovRun(kcsaMarkov, 1, [full({ time: 5 })]), /从 0 开始/); assert.throws(() => createMarkovRun(kcsaMarkov, 1, [full(), full({ time: 0 })]), /递增/);
  assert.throws(() => validateParameterSet(compileMarkovModel(kcsaMarkov).model, { wt: 0.5 }), /整数/);
});

test('a chain with nothing left to do stops cleanly; a tiny two-state chain behaves as its rates say', () => {
  const dead = { version: 1, variables: { s: { values: ['a', 'b'], init: 'a' } }, transitions: [{ id: 'go', when: 's_a', rate: '1000', set: { s: 'b' } }] };
  const run = createMarkovRun(dead, 3); assert.equal(run.at(5).vars.s, 'b'); assert.equal(run.at(1e6).vars.s, 'b'); assert.equal(run.events(1e6).length, 1);
  const flip = { version: 1, parameters: [{ id: 'k', min: 0.1, max: 100, step: 0.1, default: 5 }], variables: { s: { values: ['a', 'b'], init: 'a' } }, counters: ['n'],
    transitions: [{ id: 'ab', when: 's_a', rate: 'k', set: { s: 'b' }, count: { n: 1 } }, { id: 'ba', when: 's_b', rate: 'k', set: { s: 'a' } }], clocks: [{ name: 'inB', add: 's_b ? dt : 0' }] };
  let inB = 0, total = 0;
  for (let seed = 1; seed <= 60; seed++) { const s = createMarkovRun(flip, seed).at(200); inB += s.clocks.inB; total += 200; }
  assert.ok(Math.abs(inB / total - 0.5) < 0.03, `time in b ${inB / total}`);
  assert.equal(typeof markovRandom(1)(), 'number');
});
