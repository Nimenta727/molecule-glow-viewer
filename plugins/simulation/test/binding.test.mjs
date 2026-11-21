import assert from 'node:assert/strict';
import test from 'node:test';
import { createBinding, smoluchowskiRate, effectiveKoff, fromMolar } from '../binding.mjs';

const params = { box: 60, particles: 600, D: 50, dt: 0.002, sites: [{ position: [30, 30, 30], radius: 3 }] };   // c = 2.8e-3 nm^-3 (4.6 mM): about 5 absorptions per microsecond

test('same inputs, same history; another seed, another history', () => {
  const a = createBinding({ ...params, seed: 4, reinject: true }), b = createBinding({ ...params, seed: 4, reinject: true }), c = createBinding({ ...params, seed: 5, reinject: true });
  a.run(2); b.run(2); c.run(2);
  assert.deepEqual([...a.positions()], [...b.positions()]); assert.equal(a.counts.bindings, b.counts.bindings); assert.notDeepEqual([...a.positions()], [...c.positions()]);
});

test('with the bath held constant, the absorption rate is the Smoluchowski rate 4 pi D R c (within 18 %: counting noise of about 6 % and two small opposite biases)', () => {
  const expected = smoluchowskiRate({ D: params.D, radius: 3, concentration: params.particles / params.box ** 3 });   // events per microsecond
  const sim = createBinding({ ...params, seed: 9, reinject: true }); sim.run(5);   // the depletion zone forms within R^2 / D = 0.18 us
  const before = sim.counts.bindings; sim.run(45); const rate = (sim.counts.bindings - before) / 45;
  assert.ok(Math.abs(rate - expected) / expected < 0.18, `rate ${rate.toFixed(3)}/us vs Smoluchowski ${expected.toFixed(3)}`);
});

test('the rate is proportional to the concentration', () => {
  const rate = (particles, seed) => { const s = createBinding({ ...params, particles, seed, reinject: true }); s.run(3); const b0 = s.counts.bindings; s.run(35); return (s.counts.bindings - b0) / 35; };
  const ratio = rate(600, 2) / rate(300, 3); assert.ok(Math.abs(ratio - 2) < 0.4, `twice the concentration, ${ratio.toFixed(2)} times the rate`);
});

test('binding and release: the occupancy follows kon c / (kon c + koff_eff) once the recapture of a just-released particle is accounted for', () => {
  const koff = 4, kon = smoluchowskiRate({ D: params.D, radius: 3, concentration: params.particles / params.box ** 3 }), expected = kon / (kon + effectiveKoff({ koff }));   // koff_eff = 2: about 0.72
  const sim = createBinding({ ...params, koff, seed: 6 }); sim.run(5); let occupied = 0, samples = 0;
  for (let t = 0; t < 40; t += 0.5) { sim.run(0.5); occupied += sim.boundCount(); samples++; }
  const fraction = occupied / samples; assert.ok(Math.abs(fraction - expected) < 0.15, `occupancy ${fraction.toFixed(2)} vs ${expected.toFixed(2)}`);
  assert.ok(sim.counts.releases > 50 && Math.abs(sim.counts.bindings - sim.counts.releases) <= 1, 'every binding is matched by a release (to within the one now bound)');
  assert.equal(sim.free() + sim.boundCount(), params.particles, 'no particle is lost');
  // without the release shell a particle put back on the surface is recaptured: the occupancy is clearly higher than the formula with the full koff would say
  const naive = createBinding({ ...params, koff, releaseFactor: 1.0001, seed: 6 }); naive.run(5); let o2 = 0, n2 = 0; for (let t = 0; t < 15; t += 0.5) { naive.run(0.5); o2 += naive.boundCount(); n2++; }
  assert.ok(o2 / n2 > kon / (kon + koff) + 0.05, `released at the surface: occupancy ${(o2 / n2).toFixed(2)}, above the no-rebinding value ${(kon / (kon + koff)).toFixed(2)}`);
});

test('particles never end up inside a site, and a site holds one particle at a time', () => {
  const sim = createBinding({ ...params, sites: [{ position: [15, 15, 15], radius: 3 }, { position: [45, 45, 45], radius: 3 }], koff: 0.05, seed: 3 }); sim.run(20);
  assert.ok(sim.boundCount() <= 2); const x = sim.positions(), where = sim.boundTo();
  for (let i = 0; i < params.particles; i++) if (where[i] < 0) for (const s of [[15, 15, 15], [45, 45, 45]]) { const d = [0, 1, 2].map((k) => { const v = x[3 * i + k] - s[k]; return v - 60 * Math.round(v / 60); }); assert.ok(Math.hypot(...d) > 3 - 1e-9, 'a free particle is outside every site'); }
});

test('bad inputs and a step that is too large are refused with the reason; the unit conversion', () => {
  assert.throws(() => createBinding({ ...params, box: 0 }), /positive/); assert.throws(() => createBinding({ ...params, sites: [] }), /sites need/); assert.throws(() => createBinding({ ...params, koff: -1 }), /koff/); assert.throws(() => createBinding({ ...params, releaseFactor: 1 }), /releaseFactor/);
  assert.throws(() => createBinding({ ...params, dt: 0.1 }), /time step is too large/);
  assert.ok(Math.abs(fromMolar(1) - 0.6022) < 1e-3);
});
