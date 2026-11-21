import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkovRun, compileMarkovModel } from '../markov-model.mjs';
import { reactionNetwork, uniporter, trackMotor, dynamicFilament, PROCESS_PRESETS } from '../process-models.mjs';

/** Stationary distribution of a continuous-time chain from its rate matrix (rates[i][j] = i -> j), by Gaussian elimination on pi Q = 0, sum pi = 1. */
function stationary(rates) {
  const n = rates.length, Q = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? -rates[i].reduce((a, b, k) => a + (k === i ? 0 : b), 0) : rates[i][j])));
  const A = Array.from({ length: n }, (_, r) => (r < n - 1 ? Array.from({ length: n }, (_, c) => Q[c][r]) : Array(n).fill(1))), b = Array.from({ length: n }, (_, r) => (r === n - 1 ? 1 : 0));
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
  return b.map((v, i) => v / A[i][i]);
}
const run = (declaration, seed, schedule) => createMarkovRun(declaration, seed, schedule);

test('every model compiles and every preset is a valid configuration of the stochastic-process tool', async () => {
  for (const d of [uniporter(), trackMotor(), dynamicFilament(), reactionNetwork({ species: [{ id: 'A', init: 5 }], reactions: [{ id: 'decay', reactants: { A: 1 }, products: {}, k: 1 }] })]) assert.deepEqual(compileMarkovModel(d).errors, []);
  const { normalizeProcessConfig } = await import('../process-tool.mjs');
  for (const preset of PROCESS_PRESETS) assert.doesNotThrow(() => normalizeProcessConfig(preset.config), preset.id);
  assert.deepEqual(PROCESS_PRESETS.map((p) => p.id), ['uniporter', 'motor', 'filament', 'enzyme']);
});

test('E4 first-order decay: the mean follows N0 exp(-kt) and the spread is binomial', () => {
  const d = reactionNetwork({ species: [{ id: 'A', init: 2000 }, { id: 'B', init: 0 }], reactions: [{ id: 'decay', reactants: { A: 1 }, products: { B: 1 }, k: 0.5 }] });
  let sum = 0; const runs = 12; for (let s = 1; s <= runs; s++) sum += run(d, s).at(2).nums.A;
  const mean = sum / runs, expected = 2000 * Math.exp(-1), sigma = Math.sqrt(2000 * Math.exp(-1) * (1 - Math.exp(-1)) / runs);
  assert.ok(Math.abs(mean - expected) < 4 * sigma, `mean ${mean.toFixed(1)} vs ${expected.toFixed(1)} (4 sigma = ${(4 * sigma).toFixed(1)})`);
  const state = run(d, 99).at(5); assert.equal(state.nums.A + state.nums.B, 2000, 'a particle is never lost or made');
});

test('E4 bimolecular reaction follows the rate equation at large numbers; the combinatorics of a dimerisation are right', () => {
  const d = reactionNetwork({ volume: 1000, species: [{ id: 'A', init: 1000 }, { id: 'B', init: 1000 }, { id: 'C', init: 0 }], reactions: [{ id: 'bind', reactants: { A: 1, B: 1 }, products: { C: 1 }, k: 1 }] });
  // dA/dt = -k A B / V with A = B: A(t) = 1 / (1/A0 + k t / V)
  const a = run(d, 5).at(2).nums.A, expected = 1 / (1 / 1000 + 2 / 1000); assert.ok(Math.abs(a - expected) / expected < 0.05, `${a} vs ${expected.toFixed(0)}`);
  const dimer = reactionNetwork({ species: [{ id: 'M', init: 3 }, { id: 'D', init: 0 }], reactions: [{ id: 'dim', reactants: { M: 2 }, products: { D: 1 }, k: 1 }] });
  const { model } = compileMarkovModel(dimer); assert.match(model.transitions[0].rawRate ?? dimer.transitions[0].rate, /M\*\(M-1\)\/2/, '2 monomers pick one of M(M-1)/2 pairs');
  const end = run(dimer, 3).at(1000).nums; assert.deepEqual([end.M, end.D], [1, 1], 'three monomers make one dimer and leave one over');
});

test('E4 birth and death reaches the Poisson steady state (mean b/k, variance equal to the mean)', () => {
  const d = reactionNetwork({ species: [{ id: 'A', init: 100 }], reactions: [{ id: 'birth', reactants: {}, products: { A: 1 }, k: 5 }, { id: 'death', reactants: { A: 1 }, products: {}, k: 0.05 }] });   // mean 5 / 0.05 = 100; about 10 events a second: 20 000 s is 200 000 events, under the engine's cap of 250 000
  const r = run(d, 8), samples = []; for (let t = 200; t <= 19900; t += 25) samples.push(r.at(t).nums.A);   // samples 25 s apart, more than a relaxation time (20 s)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  assert.ok(Math.abs(mean - 100) < 3, `mean ${mean.toFixed(1)}`); assert.ok(variance / mean > 0.75 && variance / mean < 1.3, `Fano factor ${(variance / mean).toFixed(2)}`);
});

test('E4 michaelis-menten: the product appears at the steady-state rate kcat E S / (Km + S)', () => {
  const d = PROCESS_PRESETS.find((p) => p.id === 'enzyme').config.process;
  // E0 = 20, S0 = 600, V = 1000: k1 = 1.5, k-1 = 1, kcat = 0.5 -> Km (in counts) = (1 + 0.5) * V / 1.5 = 1000; early rate = kcat * E0 * S / (Km + S)
  const r = run(d, 4), P1 = r.at(2).nums.P, P2 = r.at(12).nums.P, rate = (P2 - P1) / 10, S = r.at(7).nums.S, expected = 0.5 * 20 * S / (1000 + S);
  assert.ok(Math.abs(rate - expected) / expected < 0.2, `rate ${rate.toFixed(2)}/s vs ${expected.toFixed(2)}/s (S = ${S})`);
  const s = r.at(12).nums; assert.equal(s.E + s.ES, 20, 'the enzyme is conserved'); assert.equal(s.S + s.ES + s.P, 600, 'the substrate is conserved');
});

test('E1 uniporter: the simulated net flux matches the analytic steady state, and it vanishes at equilibrium (detailed balance)', () => {
  const rates = (p) => { const phi = p.z * p.V / (8.314462618 * 310 / 96485.33212), krBack = p.kf * p.kr / p.kb;   // order Ao, Ab, Bb, Bo
    const M = Array.from({ length: 4 }, () => Array(4).fill(0)); M[0][1] = p.kon * p.So; M[1][0] = p.koff; M[1][2] = p.kf * Math.exp(-phi / 2); M[2][1] = p.kb * Math.exp(phi / 2); M[2][3] = p.koff; M[3][2] = p.kon * p.Si; M[3][0] = p.kr; M[0][3] = krBack; return M; };
  const flux = (p) => { const pi = stationary(rates(p)); return pi[2] * p.koff - pi[3] * p.kon * p.Si; };   // released inside minus bound from inside
  const base = { kon: 5, koff: 50, kf: 200, kb: 200, kr: 100, z: 1, So: 100, Si: 10, V: 0.03 };
  const sim = (p, seed) => { const r = run(uniporter({ ...p, V: undefined, So: p.So, Si: p.Si }), seed, [{ time: 0, So: p.So, Si: p.Si, V: p.V }]); const s = r.at(60); return s.observables.flux; };
  const expected = flux(base), got = [1, 2, 3, 4].map((seed) => sim(base, seed)).reduce((a, b) => a + b, 0) / 4;
  assert.ok(expected > 0, 'a downhill gradient moves substrate in'); assert.ok(Math.abs(got - expected) / expected < 0.05, `flux ${got.toFixed(1)}/s vs ${expected.toFixed(1)}/s`);
  // equilibrium: Si / So = exp(-z F V / R T): the analytic flux is zero, and the simulated one is small next to the unidirectional rate
  const phi = 0.03 / (8.314462618 * 310 / 96485.33212), eq = { ...base, Si: base.So * Math.exp(-phi) };
  assert.ok(Math.abs(flux(eq)) < 1e-9, `analytic equilibrium flux ${flux(eq)}`);
  const unidirectional = (() => { const pi = stationary(rates(eq)); return pi[2] * eq.koff; })(), eqSim = [1, 2, 3, 4].map((seed) => sim(eq, seed)).reduce((a, b) => a + b, 0) / 4;
  assert.ok(Math.abs(eqSim) < 0.05 * unidirectional, `at equilibrium the net flux ${eqSim.toFixed(2)}/s is small against the one-way flux ${unidirectional.toFixed(1)}/s`);
  assert.ok(flux({ ...base, V: 0.12 }) < flux(base), 'a voltage against the substrate slows it (z = +1, inside positive)');
});

test('E2 motor: the velocity matches the three-state cycle with backsteps, falls with the load, and the ATP dependence saturates', () => {
  const p = { kon: 2, kStep: 100, kUnbind: 5, kRelease: 200, kBack: 0.5, ATP: 100 };
  const analytic = (ATP, F = 0) => { const kT = 1.380649e-23 * 298 * 1e21, d = 8, M = Array.from({ length: 3 }, () => Array(3).fill(0));   // E, T, D
    const kf = p.kStep * Math.exp(-F * 0.5 * d / kT), kb = p.kBack * Math.exp(F * 0.5 * d / kT); M[0][1] = p.kon * ATP; M[1][2] = kf; M[1][0] = p.kUnbind; M[2][0] = p.kRelease; M[2][1] = kb; const pi = stationary(M); return d * (pi[1] * kf - pi[2] * kb); };
  const sim = (ATP, F, seed) => run(trackMotor({ ...p, ATP, force: F }), seed, [{ time: 0, ATP, F }]).at(200).observables.velocity;
  const mean = (ATP, F) => [1, 2, 3].map((s) => sim(ATP, F, s)).reduce((a, b) => a + b, 0) / 3;
  const v0 = analytic(100); assert.ok(Math.abs(mean(100, 0) - v0) / v0 < 0.05, `velocity ${mean(100, 0).toFixed(1)} vs ${v0.toFixed(1)} nm/s`);
  assert.ok(mean(100, 6) < mean(100, 0) * 0.6, 'a load of 6 pN slows the motor clearly'); const vf = analytic(100, 6); assert.ok(Math.abs(mean(100, 6) - vf) / vf < 0.1, `loaded ${mean(100, 6).toFixed(1)} vs ${vf.toFixed(1)}`);
  assert.ok(mean(1000, 0) > mean(10, 0) * 3 && analytic(1e6) < p.kStep * 8 * 1.001, 'more ATP is faster, and the speed saturates below kStep x step size');
});

test('E3 filament: the mean growth speed and the fraction of time growing follow the two-state phase model', () => {
  const p = { kon: 1, koffGrow: 2, kShrink: 40, kCatastrophe: 0.5, kRescue: 0.2, subunit: 10, init: 100000 };   // a long filament that does not reach zero; about 32 events a second, 3000 s stays under the engine's cap
  const growFrac = p.kRescue / (p.kCatastrophe + p.kRescue), vAnalytic = growFrac * (p.kon * p.subunit - p.koffGrow) - (1 - growFrac) * p.kShrink;   // subunits per second
  const r = run(dynamicFilament(p), 21), s = r.at(3000), vSim = (s.nums.length - p.init) / 3000;
  assert.ok(Math.abs(s.observables.growFraction - growFrac) < 0.1, `grow fraction ${s.observables.growFraction.toFixed(2)} vs ${growFrac.toFixed(2)}`);
  assert.ok(Math.abs(vSim - vAnalytic) < 0.35 * Math.abs(vAnalytic) + 1, `mean speed ${vSim.toFixed(2)} vs ${vAnalytic.toFixed(2)} subunits/s`);
  const grows = run(dynamicFilament({ ...p, kCatastrophe: 0 }), 3).at(100); assert.equal(grows.counters.catastrophes, 0); assert.ok(Math.abs((grows.nums.length - p.init) / 100 - (p.kon * p.subunit - p.koffGrow)) < 4, 'with no catastrophe the filament grows at kon c - koff');
  const short = run(dynamicFilament({ ...p, init: 3, kRescue: 0 }), 5).at(500); assert.ok(short.nums.length >= 0, 'the length never goes below zero');
});

test('bad models are refused with the reason', () => {
  const bad = (f, pattern) => assert.throws(f, pattern);
  bad(() => reactionNetwork({ species: [{ id: 'A', init: 1 }], reactions: [{ id: 'r', reactants: { Z: 1 }, products: {}, k: 1 }] }), /不在物种里/);
  bad(() => reactionNetwork({ species: [{ id: 'A', init: 1 }], reactions: [{ id: 'r', reactants: { A: 4 }, products: {}, k: 1 }] }), /1–3/);
  bad(() => reactionNetwork({ species: [{ id: 'A', init: 1 }, { id: 'A', init: 1 }], reactions: [{ id: 'r', reactants: { A: 1 }, products: {}, k: 1 }] }), /互不相同/);
  bad(() => reactionNetwork({ species: [{ id: 'A', init: 1 }], reactions: [{ id: 'r', reactants: {}, products: {}, k: 1 }] }), /既没有反应物/);
  bad(() => uniporter({ kon: -1 }), /kon/); bad(() => trackMotor({ delta: 2 }), /delta/); bad(() => dynamicFilament({ kShrink: NaN }), /kShrink/);
});
