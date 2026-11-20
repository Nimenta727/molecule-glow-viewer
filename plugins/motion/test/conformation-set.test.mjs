import assert from 'node:assert/strict';
import test from 'node:test';
import { cyclicStates, rotatedStates, twoStateTargets, domainMotion } from '../conformation-set.mjs';
import { rotateVector } from '../../structure/alignment.mjs';

const near = (a, b, tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < tol);
const helix = (n) => Array.from({ length: n }, (_, i) => [6 * Math.cos(i * 0.6), 1.5 * i, 6 * Math.sin(i * 0.6)]);
const q = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const key = (a) => String(a.seq);

// k identical subunits placed round a ring (rotated and moved), the first `stable` residues rigid, the tail bent differently in each
const subunits = (k, { n = 40, bend = (i) => 4 * i } = {}) => Array.from({ length: k }, (_, c) => helix(n).map((p, i) => {
  const bent = i > 0.7 * n ? [p[0] + bend(c) * (i - 0.7 * n) / n, p[1], p[2]] : p;
  return { seq: i + 1, position: rotateVector(bent, q(c * 2 * Math.PI / k)).map((v, j) => v + [30 * c, 0, 5 * c][j]) };
}));

test('cyclic states: each subunit has the shape of every sibling carried into its place; rotated lists run through the cycle in order', () => {
  for (const k of [3, 4]) {
    const chains = subunits(k), alt = cyclicStates(chains, { keyOf: key });
    assert.equal(alt.length, k); assert.ok(alt.every((a) => a.length === k));
    for (let c = 0; c < k; c++) {
      assert.ok(alt[c][c].get('1').every((v, i) => Math.abs(v - chains[c][0].position[i]) < 1e-9), 'its own state is its own coordinates');
      for (let o = 0; o < k; o++) assert.ok(near(alt[c][o].get('5'), chains[c][4].position, 1e-6), 'the rigid part is the same in every state');   // residue 5 is in the stable part
      const bentPositions = alt[c].map((state) => state.get('40')); assert.equal(new Set(bentPositions.map((p) => p.map((v) => v.toFixed(3)).join())).size, k, 'the bent tail differs from state to state');
    }
    const states = rotatedStates(alt[1], 1); assert.equal(states.length, k); assert.equal(states[0], alt[1][1]); assert.equal(states[1], alt[1][2 % k]); assert.equal(states[k - 1], alt[1][(1 + k - 1) % k]);
  }
  assert.throws(() => cyclicStates([subunits(1)[0]], { keyOf: key }), /至少需要两条/); assert.throws(() => cyclicStates([[], []], { keyOf: key }), /至少需要两条/);
  assert.throws(() => cyclicStates([subunits(1)[0].slice(0, 3), subunits(1)[0].slice(0, 3)], { keyOf: key }), /不足 3/);
});

// one chain in an open state and a closed state: the core (residues 1-30) is rigid, the middle domain (31-60) swings about 40 degrees, the lid (61-80) 20 degrees the other way
const open = helix(80).map((p, i) => ({ seq: i + 1, position: p }));
const swing = (p, centre, angle) => rotateVector(p.map((v, j) => v - centre[j]), q(angle)).map((v, j) => v + centre[j]);
const closedAtoms = open.map((a, i) => ({ seq: a.seq, position: (i >= 30 && i < 60 ? swing(a.position, open[30].position, 0.7) : i >= 60 ? swing(a.position, open[60].position, -0.35) : a.position).map((v, j) => v + [100, 0, 0][j]) }));
const domains = [{ name: 'MID', contains: (a) => a.seq > 30 && a.seq <= 60 }, { name: 'LID', contains: (a) => a.seq > 60 }];

test('two states: the closed one is fitted onto the open one over the reference domain; refused above the RMSD limit; the domain motions are measured by fraction', () => {
  const set = twoStateTargets(open, closedAtoms, { keyOf: key, inReference: (a) => a.seq <= 30 });
  assert.equal(set.matched, 80); assert.ok(set.rmsd < 1e-6, `${set.rmsd}`); assert.ok(near(set.targets.get('10'), open[9].position, 1e-6), 'the reference domain lies on itself');
  assert.ok(!near(set.targets.get('50'), open[49].position, 0.5), 'the middle domain has moved');
  const motion = (f) => domainMotion({ open, targets: set.targets, core: set.core, keyOf: key, domains }, f);
  assert.deepEqual(motion(0).map((m) => [m.angle, m.shift]), [[0, 0], [0, 0]]);
  const full = motion(1); assert.ok(Math.abs(full[0].angle - 0.7 * 180 / Math.PI) < 1, `MID ${full[0].angle}`); assert.ok(Math.abs(full[1].angle - 0.35 * 180 / Math.PI) < 1, `LID ${full[1].angle}`); assert.ok(full[0].shift > 1);
  const half = motion(0.5); assert.ok(half[0].angle > 0 && half[0].angle < full[0].angle && half[0].shift < full[0].shift);
  // a different reference domain (the middle one) gives a different frame for the same two states
  const other = twoStateTargets(open, closedAtoms, { keyOf: key, inReference: (a) => a.seq > 30 && a.seq <= 60 });
  assert.ok(!near(other.targets.get('5'), set.targets.get('5'), 0.5), 'residue 5 is far from the swing axis'); assert.ok(other.rmsd < 1e-6);
  assert.throws(() => twoStateTargets(open, closedAtoms.map((a) => (a.seq <= 30 ? { ...a, position: a.position.map((v) => v * 1.4) } : a)), { keyOf: key, inReference: (a) => a.seq <= 30, maxRmsd: 0.5 }), /超过 0.5 Å/);
  assert.throws(() => twoStateTargets(open, closedAtoms.slice(1), { keyOf: key, inReference: (a) => a.seq <= 30 }), /没有完整对应/); assert.throws(() => twoStateTargets(open, closedAtoms, { keyOf: key, inReference: (a) => a.seq === 1 }), /不足 3/);
});
