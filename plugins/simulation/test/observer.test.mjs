import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleRun, ratesOf, currentFromCounts, toCSV } from '../observer.mjs';
import { createMarkovRun } from '../markov-model.mjs';
import { singleChannelCurrent, DEFAULTS } from '../../kcsa/kinetics.mjs';
import { kcsaMarkov } from './kcsa-markov.mjs';

const full = (extra = {}) => ({ ...DEFAULTS, speed: 1, ...extra });

test('sampling: a point every step, counters never decrease, observables and variables are recorded, a long span widens the step', () => {
  const run = createMarkovRun(kcsaMarkov, 5, [full({ pH: 4.2 })]), s = sampleRun(run, { from: 0, to: 60, step: 1 });
  assert.equal(s.times.length, 61); assert.deepEqual([s.times[0], s.times.at(-1)], [0, 60]);
  for (const name of ['out', 'inn', 'na']) assert.ok(s.counters[name].every((v, i, a) => !i || v >= a[i - 1]), `${name} grows`);
  assert.ok(s.clocks.gateSeconds.at(-1) > s.clocks.gateSeconds[1] && s.observables.EK.every((v) => Math.abs(v + 85.6) < 0.1)); assert.ok(s.vars.gate.includes('O'));
  const wide = sampleRun(run, { from: 0, to: 1000, step: 0.1, maxPoints: 100 }); assert.ok(wide.times.length <= 101);
  assert.throws(() => sampleRun(run, { from: 5, to: 5, step: 1 }), /采样/); assert.throws(() => sampleRun(run, { from: 0, to: 5, step: 0 }), /采样/);
});

test('rates: a counter turns into events per second between samples', () => {
  const run = createMarkovRun(kcsaMarkov, 7, [full({ pH: 4.2 })]), s = sampleRun(run, { from: 0, to: 120, step: 1 }), r = ratesOf(s, 'counters', 'out', 5);
  assert.equal(r.length, s.times.length); assert.ok(r.every((v) => v >= 0)); assert.ok(Math.abs(r.reduce((a, v) => a + v, 0) / r.length - s.counters.out.at(-1) / 120) < s.counters.out.at(-1) / 120);
  assert.throws(() => ratesOf(s, 'counters', 'zzz'), /没有曲线/);
});

test('the current estimated from counted events agrees with the analytic steady-state current (many channels, positive and negative voltage, symmetric concentrations)', () => {
  for (const params of [full({ pH: 4, V: 50 }), full({ pH: 4, V: -60 }), full({ pH: 4, V: 50, Ko: 150, Ki: 150 })]) {
    let out = 0, inn = 0, ns = 0;
    for (let seed = 1; seed <= 96; seed++) { const s = createMarkovRun(kcsaMarkov, seed, [params]).at(150); out += s.counters.out; inn += s.counters.inn; ns += s.clocks.ns; }
    const estimate = currentFromCounts({ out, inn, ns }), exact = singleChannelCurrent(params);
    assert.ok(Math.abs(estimate - exact) < 0.12 * Math.abs(exact) + 0.05, `V = ${params.V} mV: counted ${estimate.toFixed(3)} pA, analytic ${exact.toFixed(3)} pA`);
  }
  assert.equal(currentFromCounts({ out: 5, inn: 1, ns: 0 }), 0);
});

test('CSV: header, one row per sample, text values quoted when needed', () => {
  const run = createMarkovRun(kcsaMarkov, 2, [full()]), csv = toCSV(sampleRun(run, { from: 0, to: 10, step: 2 })).split('\n');
  assert.equal(csv[0].split(',')[0], 'time'); assert.ok(csv[0].includes('out') && csv[0].includes('EK') && csv[0].includes('gate'))
  assert.equal(csv.filter(Boolean).length, 7); assert.equal(csv.at(-1), '');
  const quoted = toCSV({ times: [0], counters: {}, clocks: {}, observables: {}, vars: { name: ['a,"b"'] } }); assert.equal(quoted, 'time,name\n0,"a,""b"""\n');
});
