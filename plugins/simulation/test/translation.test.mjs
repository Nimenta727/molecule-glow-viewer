import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkovRun } from '../markov-model.mjs';
import { translationModel, translationTables, ORFS, TL_K as K, TL_DRUG } from './translation-model.mjs';

const make = (aa, params = {}, seed = 3, opts = {}) => createMarkovRun(translationModel(aa, opts), seed, [{ time: 0, ...params }]);
const long = (c, n) => 'M' + c.repeat(n - 1);

/** The chance that a tRNA of one class, once it has bound, is incorporated (first selection, then proofreading), from the rate constants. */
function incorporation(cls, { par = false } = {}) {
  const pc = K.k2 / (K.k2 + K.km1), k3 = cls === 'c' ? K.k3c : par ? K.k3nPar : K.k3n, km2 = cls === 'c' ? K.km2c : K.km2n;
  const pg = k3 / (k3 + km2), reachGtp = pc * pg / (1 - pc * (1 - pg)), k5 = cls === 'c' ? K.k5c : par ? K.k5nPar : K.k5n, k7 = cls === 'c' ? K.k7c : par ? K.k7nPar : K.k7n;
  return reachGtp * k5 / (k5 + k7);
}
const errorFraction = (opts) => (K.fn * incorporation('n', opts)) / (K.fc * incorporation('c', opts) + K.fn * incorporation('n', opts));

test('the analytic missense error from the rate constants matches the classic calibration: about 5e-4, and about 1e-2 with paromomycin', () => {
  const base = errorFraction({}), par = errorFraction({ par: true });
  assert.ok(base > 4e-4 && base < 6.5e-4, `${base}`); assert.ok(par > 8e-3 && par < 2.5e-2, `${par}`); assert.ok(par / base > 20);
});

test('elongation speed: about 13 amino acids a second (the classic calibration), measured on a long chain so start and release do not count', () => {
  const run = make(long('K', 1500), {}, 11), s = run.at(110);
  assert.equal(s.counters.prot, 0); const rate = s.counters.codAll / s.clocks.T;
  assert.ok(rate > 12 && rate < 14, `${rate.toFixed(2)} aa/s`);
  assert.equal(s.counters.misAll / Math.max(1, s.counters.codAll) < 0.003, true);
});

test('missense errors: the measured fraction follows the analytic one, and paromomycin raises it about thirty-fold', () => {
  const run = make(long('K', 2500), { PAR: 20 }, 5), s = run.at(200), observed = s.counters.misAll / s.counters.codAll;
  assert.ok(s.counters.codAll > 1500, `${s.counters.codAll} codons`);
  // with 20 uM the drug is bound most of the time; the expected error lies between the free and the fully bound values
  const lo = errorFraction({}), hi = errorFraction({ par: true });
  assert.ok(observed > lo * 5 && observed < hi * 1.3, `${observed} (free ${lo}, bound ${hi})`);
  assert.ok(s.nums.mis === s.counters.misAll, 'the per-chain and total counts agree on a chain that never ended');
});

test('the cycle is the classic one: every released protein has the length of its template, and the counts add up', () => {
  const t = translationTables(ORFS.ubq), run = make(ORFS.ubq, {}, 8);
  const hyds = run.events(80).filter((e) => e.id === 'hyd'); assert.ok(hyds.length >= 3);
  for (const e of hyds) { const s = run.at(e.time); assert.equal(s.nums.L, t.n, 'chain length at release'); assert.equal(s.vars.st, 'term'); }
  for (const when of [30, 55, 80, 95]) {   // L keeps the finished chain's length until the next start, so only a chain still being built counts as in progress
    const s = run.at(when), inProgress = ['term', 'init'].includes(s.vars.st) ? 0 : s.nums.L - 1;
    assert.equal(s.counters.codAll, s.counters.prot * (t.n - 1) + inProgress, `t = ${when}: residues added = full chains + the chain in progress`);
  }
  const s = run.at(80);
  assert.equal(s.counters.drop, 0); assert.ok(s.counters.cogOff + s.counters.near1 + s.counters.near2 > 0, 'unproductive encounters are counted');
  assert.ok(s.clocks.nonCognate > 100, 'non-cognate collisions are counted, not drawn');
});

test('blocked steps stop the cycle where the classic says: no tRNA, no EF-G, no release factor', () => {
  assert.equal(make(ORFS.ubq, { TC: 0 }).at(30).counters.codAll, 0);
  const noG = make(ORFS.ubq, { EFG: 0 }).at(30); assert.deepEqual([noG.counters.codAll, noG.vars.st], [1, 'pre']);
  const noRF = make(ORFS.polyu, { RF1: 0 }).at(60); assert.deepEqual([noRF.counters.prot, noRF.vars.st, noRF.nums.k], [0, 'post', 25], 'waits at the stop codon');
});

test('antibiotics act as the classic describes: tetracycline blocks the A site, chloramphenicol slows the peptide bond (most after Ala/Ser/Thr), erythromycin blocks the tunnel, kirromycin and fusidic acid lock the factors', () => {
  const rate = (aa, params, T = 60, seed = 4) => { const s = make(aa, params, seed).at(T); return s.counters.codAll / s.clocks.T; };
  const base = rate(long('K', 1500), {});
  assert.ok(rate(long('K', 1500), { TAC: 50 }) < 0.15 * base, 'tetracycline');
  const gly = rate(long('G', 1500), { CLM: 50 }), ala = rate(long('A', 1500), { CLM: 50 });
  assert.ok(gly < 0.9 * base && ala < 0.5 * gly, `chloramphenicol: ${gly.toFixed(1)} after Gly, ${ala.toFixed(1)} after Ala`);
  const kir = make(long('K', 1500), { KIR: 5 }, 6).at(60); assert.ok(kir.counters.kirN > 0 && kir.counters.codAll / kir.clocks.T < 0.8 * base, 'kirromycin');
  assert.ok(rate(long('K', 1500), { FUA: 20 }) < 0.3 * base, 'fusidic acid');
  const ery = make(ORFS.ubq, { ERY: 5 }, 7).at(120), control = make(ORFS.ubq, {}, 7).at(120);
  assert.ok(ery.counters.drop > 0 && ery.counters.prot < control.counters.prot, `erythromycin: ${ery.counters.drop} dropped, ${ery.counters.prot} finished (control ${control.counters.prot})`);
  const erm = make(ORFS.ermcl, { ERY: 5 }, 9).at(120), ermControl = make(ORFS.ermcl, {}, 9).at(120);
  assert.ok(erm.counters.prot < 0.5 * ermControl.counters.prot, 'ErmCL stalls with erythromycin (the resistance switch)');
});

test('the chain is deterministic for a seed, answers the same however it is asked, and can say what may happen next', () => {
  const a = make(ORFS.ubq, { PAR: 2 }, 21), b = make(ORFS.ubq, { PAR: 2 }, 21);
  assert.deepEqual([40, 10, 25].map((t) => JSON.stringify(a.at(t))).sort(), [25, 10, 40].map((t) => JSON.stringify(b.at(t))).sort());
  const next = a.ratesAt({ vars: { st: 'post' }, nums: { k: 5 }, params: {} });
  assert.deepEqual(next.map(([, id]) => id), ['tcC', 'tcN'], 'with no drug present only the two arrivals are possible');
  assert.equal(next[0][0], K.k1 * 25 * K.fc);
});
