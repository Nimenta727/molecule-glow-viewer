import assert from 'node:assert/strict';
import test from 'node:test';
import { valenceGeometry, AROMATIC } from '../molecule-geometry.mjs';

const atom = (x, y = 0, z = 0, color = '#fff') => ({ position: [x, y, z], color, radius: 1 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('bond order decides the number of sticks and dashes', () => {
  const atoms = [atom(0), atom(1.4), atom(2.4, 1)];
  const count = (order) => { const g = valenceGeometry(atoms, [[0, 1, order]]); return [g.sticks.length, g.dashes.length]; };
  assert.deepEqual(count(1), [1, 0]);
  assert.deepEqual(count(2), [2, 0]);
  assert.deepEqual(count(3), [3, 0]);
  assert.deepEqual(count(AROMATIC), [1, 3]);
});

test('double-bond sticks are parallel to the bond, apart from each other, and in the plane of a neighbouring bond', () => {
  const atoms = [atom(0), atom(1.4), atom(2.1, 1.2)];
  const { sticks } = valenceGeometry(atoms, [[0, 1, 2], [1, 2, 1]]);
  const double = sticks.slice(0, 2);
  for (const s of double) { near(s.a[0] - s.b[0], -1.4); near(s.a[1] - s.b[1], 0); near(s.a[2] - s.b[2], 0); }
  near(Math.hypot(...double[0].a.map((v, k) => v - double[1].a[k])), 0.26);
  assert.ok(Math.abs(double[0].a[2]) < 1e-9 && Math.abs(double[1].a[2]) < 1e-9, 'offset stays in the xy-plane of the neighbouring bond');
});

test('atoms with bonds are small joints, atoms without bonds (ions) are full balls, scale applies to every length', () => {
  const atoms = [atom(0), atom(1.4), { position: [9, 9, 9], color: '#0f0', radius: 1.2 }];
  const g = valenceGeometry(atoms, [[0, 1, 1]], 0.05);
  near(g.balls[0].radius, 0.15 * 0.05);
  near(g.balls[2].radius, 1.2 * 0.05);
  near(g.sticks[0].radius, 0.15 * 0.05);
  const g1 = valenceGeometry(atoms, [[0, 1, 1]], 1);
  near(g1.sticks[0].radius, 0.15);
});

test('degenerate bonds (same position) are skipped and a stick keeps both atom colours', () => {
  assert.equal(valenceGeometry([atom(0), atom(0)], [[0, 1, 1]]).sticks.length, 0);
  const s = valenceGeometry([atom(0, 0, 0, '#f00'), atom(1, 0, 0, '#00f')], [[0, 1, 1]]).sticks[0];
  assert.deepEqual([s.colorA, s.colorB], ['#f00', '#00f']);
});
