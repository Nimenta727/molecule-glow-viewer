import assert from 'node:assert/strict';
import test from 'node:test';
import { sub, dot, cross, normalize, distance, lerp } from '../vectors.mjs';
import { nearestAnchors, displaceVertices, rotationAngle, superpose, sumOfSquares, hypotSquared } from '../conformation.mjs';
import { walkPath } from '../path.mjs';

const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
const anchorAt = (ref, at, from = at) => ({ ref, at, from });

test('vector helpers', () => {
  assert.deepEqual(sub([3, 2, 1], [1, 1, 1]), [2, 1, 0]);
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  close(Math.hypot(...normalize([3, 4, 12])), 1);
  assert.equal(distance([0, 0, 0], [3, 4, 0]), 5);
  assert.deepEqual(lerp([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
});

test('nearestAnchors returns the closest anchors nearest-first and keeps the original order on ties', () => {
  const anchors = [[5, 0, 0], [1, 0, 0], [-1, 0, 0], [3, 0, 0], [0, 2, 0]].map((at, i) => anchorAt(i, at));
  assert.deepEqual(nearestAnchors([0, 0, 0], anchors, 3).map(({ anchor }) => anchor.ref), [1, 2, 4], '1 and 2 tie at distance 1: original order');
  assert.deepEqual(nearestAnchors([0, 0, 0], anchors, 10).map(({ anchor }) => anchor.ref), [1, 2, 4, 3, 0]);
  assert.equal(nearestAnchors([0, 0, 0], [], 4).length, 0);
  for (const metric of [sumOfSquares, hypotSquared]) close(metric([0, 0, 0], [3, 4, 0]), 25, 1e-9);
});

test('displaceVertices: a rigid translation of every anchor moves every vertex by that translation (weights sum to one)', () => {
  const anchors = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [2, 2, 0]].map((at, i) => anchorAt(i, at, at.map((v) => v * 20)));   // Å = 20 × display
  const shift = [1.5, -2, 0.5];
  const positions = [0.1, 0.1, 0.1, 0.9, 0.2, 0.4, -0.3, 0.7, 1.1];
  const [moved] = displaceVertices(positions, anchors, [(anchor) => anchor.from.map((v, k) => v + shift[k])], { scale: 0.05 });
  moved.forEach((value, i) => close(value, positions[i] + shift[i % 3] * 0.05));
});

test('displaceVertices: several target states are independent and the identity target changes nothing', () => {
  const anchors = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]].map((at, i) => anchorAt(i, at));
  const positions = [0.5, 0.5, 0.5, 1.5, 0.2, 0.1];
  const [same, up, down] = displaceVertices(positions, anchors,
    [(a) => a.from, (a) => [a.from[0], a.from[1] + 10, a.from[2]], (a) => [a.from[0], a.from[1] - 10, a.from[2]]], { scale: 1 });
  assert.deepEqual(same, positions);
  for (let i = 0; i < positions.length; i += 3) {
    close(up[i + 1], positions[i + 1] + 10); close(down[i + 1], positions[i + 1] - 10);
    close(up[i], positions[i]); close(down[i + 2], positions[i + 2]);
  }
});

test('displaceVertices: nearer anchors dominate, and the number of neighbours is respected', () => {
  const anchors = [anchorAt('near', [0.1, 0, 0]), anchorAt('far', [10, 0, 0])];
  const [only] = displaceVertices([0, 0, 0], anchors, [(a) => [a.from[0] + (a.ref === 'near' ? 1 : 100), 0, 0]], { scale: 1, neighbors: 1 });
  close(only[0], 1);
  const [both] = displaceVertices([0, 0, 0], anchors, [(a) => [a.from[0] + (a.ref === 'near' ? 1 : 100), 0, 0]], { scale: 1, neighbors: 2 });
  assert.ok(both[0] > 1 && both[0] < 3, `blend dominated by the near anchor: ${both[0]}`);
});

test('rotationAngle recovers the angle of a rigid fit', () => {
  const source = [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]];
  for (const degrees of [0, 12.5, 90, 170]) {
    const a = degrees * Math.PI / 180, target = source.map(([x, y, z]) => [x * Math.cos(a) - y * Math.sin(a) + 4, x * Math.sin(a) + y * Math.cos(a) - 1, z + 2]);
    close(rotationAngle(superpose(source, target)), degrees, 1e-6);
  }
});

test('walkPath follows arc length, clamps at the ends and survives a zero-length segment', () => {
  const path = [[0, 0, 0], [10, 0, 0], [10, 10, 0]];
  assert.deepEqual(walkPath(path, 0), [0, 0, 0]);
  assert.deepEqual(walkPath(path, 1), [10, 10, 0]);
  assert.deepEqual(walkPath(path, 0.5), [10, 0, 0], 'halfway by length is the corner');
  close(walkPath(path, 0.25)[0], 5);
  assert.deepEqual(walkPath(path, 2), [10, 10, 0]);
  assert.ok(walkPath([[1, 1, 1], [1, 1, 1], [2, 1, 1]], 0.3).every(Number.isFinite));
});
