import assert from 'node:assert/strict';
import test from 'node:test';
import { principalAxes, chooseAxis, rotateAbout, spinAngle, AxisError } from '../rotation.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const nearVector = (a, b, eps = 1e-9) => a.forEach((v, i) => near(v, b[i], eps));
const sameLine = (a, b) => near(Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)), 1, 1e-3);   // the test shapes are not perfectly straight
// a ring of 12 points in the xz plane (a c-ring seen along y), 4 high
const ring = Array.from({ length: 12 }, (_, i) => [10 * Math.cos(i * Math.PI / 6), (i % 2) * 0.5, 10 * Math.sin(i * Math.PI / 6)]);
// a rod along x
const rod = Array.from({ length: 20 }, (_, i) => [i * 3, 0.2 * (i % 3), 0.1 * (i % 2)]);

test('principal axes: the rod is long along x, the ring is short along y', () => {
  const r = principalAxes(rod);
  sameLine(r.axes[2], [1, 0, 0]);
  const c = principalAxes(ring);
  sameLine(c.axes[0], [0, 1, 0]);
  assert.ok(c.values[0] < c.values[1] && c.values[1] <= c.values[2] + 1e-9);
});

test('axis modes: sym finds the ring axis and the rod axis; long/short/x/y/z; between two groups', () => {
  sameLine(chooseAxis('sym', { points: ring }).direction, [0, 1, 0]);
  sameLine(chooseAxis('sym', { points: rod }).direction, [1, 0, 0]);
  sameLine(chooseAxis('long', { points: rod }).direction, [1, 0, 0]);
  sameLine(chooseAxis('short', { points: ring }).direction, [0, 1, 0]);
  assert.deepEqual(chooseAxis('z', { points: ring }).direction, [0, 0, 1]);
  const between = chooseAxis('between', { from: [[0, 0, 0], [2, 0, 0]], to: [[1, 10, 0], [1, 12, 0]] });
  nearVector(between.point, [1, 0, 0]);
  nearVector(between.direction, [0, 1, 0]);
});

test('bad input is refused with a message', () => {
  assert.throws(() => chooseAxis('sym', { points: [[0, 0, 0]] }), AxisError);
  assert.throws(() => chooseAxis('between', { from: [], to: [[1, 1, 1]] }), AxisError);
  assert.throws(() => chooseAxis('between', { from: [[1, 1, 1]], to: [[1, 1, 1]] }), AxisError);
  assert.throws(() => chooseAxis('nonsense', { points: ring }), AxisError);
});

test('rotation about an axis through a pivot: points on the axis stay, a full turn returns, a quarter turn moves as expected', () => {
  const axis = { point: [5, 0, 5], direction: [0, 1, 0] };
  nearVector(rotateAbout([5, 7, 5], axis, 1.234), [5, 7, 5]);
  nearVector(rotateAbout([8, 1, 9], axis, 2 * Math.PI), [8, 1, 9], 1e-9);
  const quarter = rotateAbout([6, 0, 5], axis, Math.PI / 2);
  nearVector(quarter, [5, 0, 4], 1e-9);
  near(spinAngle(0.5, 2), 2 * Math.PI);
  near(spinAngle(-1, 0.25, 1), 1 - Math.PI / 2);
});
