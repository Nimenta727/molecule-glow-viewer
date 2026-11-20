import assert from 'node:assert/strict';
import test from 'node:test';
import { slabPlane, wedgePlanes, isClipped, normalizeClipping } from '../clipping.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('slab: depth 1 removes nothing, depth 0 removes the half facing the viewer, depth is a fraction of the radius', () => {
  assert.equal(slabPlane({ toViewer: [0, 0, 1], center: [0, 0, 0], radius: 10, depth: 1 }), null);
  const half = [slabPlane({ toViewer: [0, 0, 5], center: [0, 0, 0], radius: 10, depth: 0 })];
  assert.equal(isClipped(half, false, [0, 0, 3]), true);
  assert.equal(isClipped(half, false, [0, 0, -3]), false);
  const third = [slabPlane({ toViewer: [0, 0, 1], center: [0, 0, 0], radius: 10, depth: 0.5 })];
  assert.equal(isClipped(third, false, [0, 0, 4.9]), false);
  assert.equal(isClipped(third, false, [0, 0, 5.1]), true);
  assert.equal(slabPlane({ toViewer: [0, 0, 0], center: [0, 0, 0], radius: 10, depth: 0 }), null);
});

test('slab follows the model centre, not the origin', () => {
  const planes = [slabPlane({ toViewer: [1, 0, 0], center: [100, 0, 0], radius: 10, depth: 0 })];
  assert.equal(isClipped(planes, false, [101, 0, 0]), true);
  assert.equal(isClipped(planes, false, [99, 0, 0]), false);
});

test('wedge removes only the points in front, inside the angle, and nothing behind or to the sides', () => {
  const planes = wedgePlanes({ toViewer: [0, 0, 1], center: [0, 0, 0], halfDegrees: 62, margin: 0 });
  const at = (degrees, r = 5, y = 0) => [r * Math.sin(degrees * Math.PI / 180), y, r * Math.cos(degrees * Math.PI / 180)];
  assert.equal(isClipped(planes, true, at(0)), true);
  assert.equal(isClipped(planes, true, at(55)), true);
  assert.equal(isClipped(planes, true, at(-55)), true);
  assert.equal(isClipped(planes, true, at(70)), false);
  assert.equal(isClipped(planes, true, at(-70)), false);
  assert.equal(isClipped(planes, true, at(180)), false);
  assert.equal(isClipped(planes, true, at(0, 5, 40)), true, 'a wedge cuts the whole height (it is around the vertical axis)');
});

test('wedge margin narrows the cut and the axis direction is handled', () => {
  const narrow = wedgePlanes({ toViewer: [0, 0, 1], center: [0, 0, 0], halfDegrees: 62, margin: 1 });
  assert.equal(isClipped(narrow, true, [0, 0, 0.5]), false);
  assert.equal(wedgePlanes({ toViewer: [0, 1, 0], center: [0, 0, 0] }), null);
  const tilted = wedgePlanes({ toViewer: [0, 3, 1], center: [0, 0, 0], margin: 0 });
  assert.equal(isClipped(tilted, true, [0, 0, 2]), true);
});

test('saved clipping state is validated, not trusted', () => {
  assert.equal(normalizeClipping(null), null);
  assert.equal(normalizeClipping({ direction: [0, 0, 0] }), null);
  assert.equal(normalizeClipping({ direction: ['x', 1, 2] }), null);
  const n = normalizeClipping({ enabled: true, direction: [0, 0, 2], depth: 5, scope: 'whatever', wedgeParts: ['a', 7, 'b'] });
  assert.deepEqual(n, { enabled: true, direction: [0, 0, 1], depth: 1, scope: 'all', wedgeParts: ['a', 'b'] });
  assert.equal(normalizeClipping({ direction: [1, 0, 0], enabled: 'yes' }).enabled, false);
  close(normalizeClipping({ direction: [1, 0, 0], depth: -3 }).depth, -1);
});
