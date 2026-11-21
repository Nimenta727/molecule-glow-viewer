import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutCopies } from '../instance-layout.mjs';

const dist = (p, i, j) => Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]);
const minGap = (p, n) => { let m = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m = Math.min(m, dist(p, i, j)); return m; };

test('layouts are seeded and give one matrix and one position per copy', () => {
  const a = layoutCopies({ copies: 50, radius: 3, seed: 7 }), b = layoutCopies({ copies: 50, radius: 3, seed: 7 }), c = layoutCopies({ copies: 50, radius: 3, seed: 8 });
  assert.deepEqual([...a.matrices], [...b.matrices]); assert.notDeepEqual([...a.matrices], [...c.matrices], 'another seed, another orientations');
  assert.deepEqual([...a.positions], [...c.positions], 'the positions do not depend on the seed');
  assert.equal(a.matrices.length, 50 * 16); assert.equal(a.positions.length, 50 * 3);
  for (let i = 0; i < 50; i++) { assert.equal(a.matrices[16 * i + 15], 1); assert.deepEqual([...a.matrices.subarray(16 * i + 12, 16 * i + 15)], [...a.positions.subarray(3 * i, 3 * i + 3)]); }
});

test('every matrix is a proper rotation (orthonormal, determinant 1)', () => {
  const { matrices } = layoutCopies({ copies: 200, radius: 2, seed: 3 });
  for (let i = 0; i < 200; i++) {
    const m = matrices.subarray(16 * i, 16 * i + 16), col = (k) => [m[4 * k], m[4 * k + 1], m[4 * k + 2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const [x, y, z] = [col(0), col(1), col(2)];
    assert.ok(Math.abs(dot(x, x) - 1) < 1e-5 && Math.abs(dot(y, y) - 1) < 1e-5 && Math.abs(dot(z, z) - 1) < 1e-5 && Math.abs(dot(x, y)) < 1e-5 && Math.abs(dot(x, z)) < 1e-5 && Math.abs(dot(y, z)) < 1e-5);
    const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    assert.ok(Math.abs(det - 1) < 1e-5, `determinant ${det}`);
  }
});

test('copies do not overlap: neighbours are at least about two radii apart, in both layouts', () => {
  for (const layout of ['grid', 'sphere']) {
    const { positions } = layoutCopies({ copies: 120, layout, radius: 4 });
    assert.ok(minGap(positions, 120) >= 2 * 4, `${layout}: closest pair ${minGap(positions, 120).toFixed(2)}`);
  }
  assert.ok(minGap(layoutCopies({ copies: 27, layout: 'grid', radius: 4, spread: 2 }).positions, 27) > 2.4 * 4 * 2 - 1e-4, 'spread widens the lattice');
});

test('the extent holds every copy, and bad input is refused', () => {
  for (const layout of ['grid', 'sphere']) {
    const { positions, extent } = layoutCopies({ copies: 64, layout, radius: 5 });
    for (let i = 0; i < 64; i++) assert.ok(Math.hypot(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]) + 5 <= extent + 1e-4);
  }
  assert.throws(() => layoutCopies({ copies: 0, radius: 1 }), /positive integer/); assert.throws(() => layoutCopies({ copies: 1, radius: 0 }), /radius/); assert.throws(() => layoutCopies({ copies: 1, radius: 1, layout: 'ring' }), /unknown layout/);
  assert.equal(layoutCopies({ copies: 1, radius: 1 }).positions.length, 3);
});
