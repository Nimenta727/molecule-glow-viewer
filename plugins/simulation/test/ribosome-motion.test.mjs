import assert from 'node:assert/strict';
import test from 'node:test';
import { ribosomeFrame, applyPose, trnaCoords, mrnaCoords, slerp, RibosomeMotion } from '../ribosome-motion.mjs';

// A made-up ribosome: a straight mRNA, a bent template "tRNA" of 76 residues and three copies of it at E, P and A poses (rotations about y, 40 Å apart along the mRNA).
const shape = (s) => [30 * Math.sin(s / 6), 3 * s - 120, 30 * Math.cos(s / 6) + (s > 60 ? (s - 60) * 2 : 0)];
const rot = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const atoms = [];
for (let i = 0; i < 60; i++) atoms.push({ p: [i * 6 - 100, 0, 0], part: 'mRNA', seq: i + 1, asym: 'M' });
const placed = { E: { a: 0.2, t: [-40, 10, 5] }, P: { a: 0.5, t: [0, 12, 8] }, A: { a: 0.8, t: [40, 10, 5] } };
for (const [asym, { a, t }] of Object.entries(placed)) for (let s = 1; s <= 76; s++) { const q = rot(shape(s), a); atoms.push({ p: [q[0] + t[0], q[1] + t[1], q[2] + t[2]], part: 'tRNA-Phe', seq: s, asym }); }
for (let i = 0; i < 200; i++) atoms.push({ p: [(i % 10) * 20 - 100, (i % 7) * 20 - 60, 50 + Math.floor(i / 10) * 8], part: '16S rRNA', seq: i, asym: 'R' });
// the anticodon of each tRNA (residue 35) must sit at its own place along the mRNA: E first, P, A last. Move the mRNA instead of the tRNAs: put its points under them
atoms.filter((x) => x.part === 'mRNA').forEach((m, i) => { m.p = [-100 + i * 3.5, 12, 60]; });
for (const [asym, x] of [['E', -60], ['P', -20], ['A', 20]]) { const c = atoms.find((v) => v.asym === asym && v.seq === 35); const dx = x - c.p[0]; atoms.filter((v) => v.asym === asym).forEach((v) => { v.p = [v.p[0] + dx, v.p[1], v.p[2]]; }); }
const mrnaAt = (x) => { atoms.filter((v) => v.part === 'mRNA').forEach((m, i) => { m.p = [x + i * 3.5, 12, atoms.find((v) => v.asym === 'P' && v.seq === 35).p[2]]; }); };
mrnaAt(-100);

const frame = ribosomeFrame(atoms);

test('the sites are found by where the anticodons sit along the mRNA: E, P, A; the template is the P tRNA; a pose carries the template onto each chain', () => {
  assert.equal(frame.n, 76); assert.ok(frame.jP > 0);
  for (const [site, asym] of [['E', 'E'], ['P', 'P'], ['A', 'A']]) {
    const chain = atoms.filter((v) => v.asym === asym), moved = frame.T0.map((x) => applyPose(frame, frame.sites[site], x));
    const worst = Math.max(...moved.map((p, i) => Math.hypot(...p.map((v, k) => v - chain[i].p[k]))));
    assert.ok(worst < 1e-6, `${site}: ${worst}`);
  }
  assert.throws(() => ribosomeFrame(atoms.filter((v) => v.asym !== 'E')), /3 个 tRNA/);
});

test('poses: a half way tRNA is between; the acceptor arm leads when hy is set; slerp keeps unit length and takes the short way', () => {
  const { P, E } = frame.sites, last = frame.n - 1;
  const mid = trnaCoords(frame, { pa: P, pb: E, w: 0.5 }), p0 = trnaCoords(frame, { pa: P, pb: E }), p1 = trnaCoords(frame, { pa: P, pb: E, w: 1 });
  const dist = (x, y) => Math.hypot(...x.map((v, k) => v - y[k])), full = dist(p0[10], p1[10]);
  assert.ok(dist(mid[10], p0[10]) > 0 && dist(mid[10], p0[10]) < full && dist(mid[10], p1[10]) < full, 'half way: nearer to each end than they are to each other');
  const hybrid = trnaCoords(frame, { pa: P, pb: E, w: 0, hy: 1 });
  assert.ok(Math.hypot(...hybrid[last].map((v, k) => v - p1[last][k])) < 1e-9, 'the acceptor end is already at E'); assert.ok(Math.hypot(...hybrid[30].map((v, k) => v - p0[30][k])) < 1e-9, 'the anticodon arm has not moved');
  const q = slerp([0, 0, 0, 1], [0, Math.sin(1), 0, Math.cos(1)], 0.5); assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-12);
  assert.deepEqual(slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.3).map((v) => Math.abs(v)), [0, 0, 0, 1]);
  const m0 = mrnaCoords(frame, 0), m3 = mrnaCoords(frame, 3);
  assert.ok(Math.abs(m3[0][0] - m0[3][0]) < 1e-9, 'offset 3: every bead sits where the one 3 further on was'); assert.ok(Math.abs(Math.hypot(...m3[59].map((v, k) => v - m0[59][k])) - 3 * 3.5) < 1e-6);
});

const run = (motion, states, dt = 0.05) => { for (const s of states) { motion.sync(s); for (let t = 0; t < 4; t += dt) motion.step(dt); } };
const at = (motion, site) => { const b = motion.bodies(); return b.trna.find((x) => x.id === b.sites[site]); };
const near = (positions, site) => Math.max(...positions.map((p, i) => Math.hypot(...applyPose(frame, frame.sites[site], frame.T0[i]).map((v, k) => v - p[k]))));

test('one elongation cycle: fMet-tRNA in P; a tRNA comes into A; peptide bond; translocation puts it in P and the old P tRNA in E; the mRNA steps 3 nt', () => {
  const m = new RibosomeMotion(frame, { speed: 0.02 });
  run(m, [{ st: 'init' }, { st: 'post' }]);
  assert.ok(near(at(m, 'P').positions, 'P') < 1e-6 && at(m, 'A') === undefined, 'P occupied, A empty');
  run(m, [{ st: 'tc' }, { st: 'cr' }, { st: 'gtp' }, { st: 'rel' }]);
  assert.equal(m.bodies().trna.length, 2, 'the incoming tRNA is drawn near the A site');
  run(m, [{ st: 'acc' }]);
  assert.ok(near(at(m, 'A').positions, 'A') < 1e-6, 'accommodated into A');
  const incomingId = at(m, 'A').id, oldP = at(m, 'P').id;
  run(m, [{ st: 'pre' }]);
  assert.ok(near(at(m, 'P').positions, 'P') > 1, 'hybrid: the P tRNA is no longer rigidly at P (its acceptor end has moved)');
  run(m, [{ st: 'g' }, { st: 'gpost', E: true }]);
  assert.equal(at(m, 'P').id, incomingId); assert.equal(at(m, 'E').id, oldP);
  assert.ok(near(at(m, 'P').positions, 'P') < 1e-6 && near(at(m, 'E').positions, 'E') < 1e-6, 'translocated');
  assert.ok(Math.abs(m.mOff) < 1e-9, 'the mRNA stepped forward and settled');
  run(m, [{ st: 'post', E: true }, { st: 'post', E: false }]);
  assert.equal(m.bodies().trna.find((x) => x.id === oldP), undefined, 'the E-site tRNA has left');
});

test('a rejected tRNA leaves; termination and recycling clear the ribosome; at high speed the moves snap', () => {
  const m = new RibosomeMotion(frame);
  run(m, [{ st: 'post' }, { st: 'tc' }, { st: 'cr' }, { st: 'rel' }, { st: 'post' }]);
  assert.equal(m.bodies().trna.length, 1, 'only the P tRNA remains'); assert.equal(m.incoming, null);
  run(m, [{ st: 'rf' }, { st: 'term' }, { st: 'init' }]);
  assert.equal(m.bodies().trna.length, 0); assert.equal(m.bodies().mrna.fade, 0);
  const fast = new RibosomeMotion(frame, { speed: 5 });
  fast.sync({ st: 'post' }); assert.equal(fast.busy, false); assert.equal(fast.bodies().trna.length, 1);
});

// Factors: made-up structures of EF-Tu (GTP and GDP forms), EF-G (two forms), RF1, the bent A/T tRNA and an antibiotic site.
const pointsOf = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const factors = () => {
  const at = new Map(); for (let s = 1; s <= 76; s++) { const x = applyPose(frame, frame.sites.A, frame.T0[s - 1]); at.set(s, [x[0] + (s > 20 && s < 50 ? 8 : 0), x[1], x[2] + (s > 20 && s < 50 ? 5 : 0)]); }   // bent in the middle
  return { at, tu: { ref: pointsOf(30, (i) => [i * 2, 0, 0]), gdp: pointsOf(30, (i) => [i * 2, 10, 0]) }, g: { ref: pointsOf(20, (i) => [0, i * 3, 0]), post: pointsOf(20, (i) => [0, i * 3, 12]) }, rf: { ref: pointsOf(10, (i) => [i, i, i]) }, drugs: { TAC: [1, 2, 3] } };
};
const settle = (m, ms = 4) => { for (let t = 0; t < ms; t += 0.05) m.step(0.05); };
const names = (m) => m.bodies().factors.map((f) => f.kind).sort();

test('with factors: EF-Tu comes in with a bent A/T tRNA, changes form and leaves; the tRNA straightens into A; EF-G comes for the translocation and changes form; RF1 comes at termination', () => {
  const m = new RibosomeMotion(frame, { factors: factors() });
  m.sync({ st: 'post' }); settle(m);
  m.sync({ st: 'tc' }); settle(m);
  assert.deepEqual(names(m), ['EF-Tu'], 'the ternary complex: EF-Tu and its tRNA');
  const bent = m.bodies().trna.find((t) => t.id === m.incoming.tr.id).positions, straight = trnaCoords(frame, { pa: frame.sites.A, pb: frame.sites.A });
  assert.ok(Math.hypot(...bent[30].map((v, k) => v - straight[30][k])) > 3, 'the A/T tRNA is bent in the middle'); assert.ok(Math.hypot(...bent[0].map((v, k) => v - straight[0][k])) < 1e-6, 'its ends are in place');
  for (const st of ['cr', 'gtp']) { m.sync({ st }); settle(m, 1); }
  m.sync({ st: 'rel' }); settle(m, 0.7); const mid = m.bodies().factors[0]; assert.ok(mid, 'EF-Tu still there while it changes form');
  settle(m, 3); assert.deepEqual(names(m), [], 'EF-Tu has left');
  m.sync({ st: 'acc' }); settle(m);
  const a = m.bodies().trna.find((t) => t.id === m.bodies().sites.A).positions; assert.ok(near(a, 'A') < 1e-6, 'straightened and in the A site');
  m.sync({ st: 'pre' }); settle(m); m.sync({ st: 'g' }); settle(m); assert.deepEqual(names(m), ['EF-G']);
  const g0 = m.bodies().factors[0].positions[10][2]; m.sync({ st: 'gpost', E: true }); settle(m, 2);
  assert.ok(m.bodies().factors[0].positions[10][2] - g0 > 5, 'EF-G changed to its post-translocation form (the residue moved by 12 · progress)');
  m.sync({ st: 'post', E: true }); settle(m, 3); assert.deepEqual(names(m), [], 'EF-G left');
  m.sync({ st: 'rf' }); settle(m); assert.deepEqual(names(m), ['RF1']); m.sync({ st: 'term' }); settle(m, 3); assert.deepEqual(names(m), []);
});

test('antibiotics: a marker where the drug sits while it is bound; none for a drug without a known site; without factors the old approach still works', () => {
  const m = new RibosomeMotion(frame, { factors: factors() });
  m.sync({ st: 'post', drugs: { TAC: true, PAR: true } }); assert.deepEqual(m.bodies().drugs.map((d) => d.name), ['TAC']); assert.deepEqual(m.bodies().drugs[0].position, [1, 2, 3]);
  m.sync({ st: 'post', drugs: { TAC: false } }); assert.equal(m.bodies().drugs.length, 0);
  const plain = new RibosomeMotion(frame); plain.sync({ st: 'post' }); settle(plain); plain.sync({ st: 'tc' }); settle(plain); assert.equal(plain.bodies().factors.length, 0); assert.equal(plain.bodies().trna.length, 2);
});
