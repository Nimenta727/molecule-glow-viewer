import assert from 'node:assert/strict';
import test from 'node:test';
import { cornerLayout, MEMBRANE_ABOVE, LATERAL_FRACTION } from '../corner-layout.mjs';

// a ball-shaped "ribosome" of radius 100 around (10, 20, 30) and a small "channel" far away
const ribosome = []; for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) for (let k = -10; k <= 10; k++) if (i * i + j * j + k * k <= 100) ribosome.push([10 + i * 10, 20 + j * 10, 30 + k * 10]);
const channel = [[500, 500, 500], [510, 500, 500], [500, 510, 500], [500, 500, 510]];
const near = (a, b, tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('the membrane is 60 Å above the top of the ribosome; the channel centroid goes there, 0.3 radius left of the centre in the plane of the view', () => {
  const layout = cornerLayout({ ribosome, eToA: [1, 0, 0], channel });
  assert.equal(layout.top, 120); assert.equal(layout.membraneY, 120 + MEMBRANE_ABOVE); assert.equal(layout.az, Math.atan2(-0, 1));
  const moved = channel.map((p) => p.map((v, i) => v + layout.shift[i])), centroid = moved.reduce((s, p) => s.map((v, i) => v + p[i] / 4), [0, 0, 0]);
  assert.ok(near(centroid, [layout.centre[0] - layout.radius * LATERAL_FRACTION, layout.membraneY, layout.centre[2]]), 'E -> A along +x: left is -x, in the plane z = the centre\'s z');
  assert.ok(Math.abs(layout.radius - 100) < 1e-9 && near(layout.centre, [10, 20, 30]));
});
test('the plane follows the E -> A direction: the channel always lies in the plane through the ribosome centre that contains the vertical and E -> A', () => {
  for (const eToA of [[0, 0, 1], [1, 0, 1], [-1, 0, -2], [0.3, 5, -0.7]]) {
    const layout = cornerLayout({ ribosome, eToA, channel }), moved = channel.map((p) => p.map((v, i) => v + layout.shift[i])), c = moved.reduce((s, p) => s.map((v, i) => v + p[i] / 4), [0, 0, 0]);
    const along = (c[0] - layout.centre[0]) * layout.right[0] + (c[2] - layout.centre[2]) * layout.right[2], across = (c[0] - layout.centre[0]) * Math.sin(layout.az) + (c[2] - layout.centre[2]) * Math.cos(layout.az);
    assert.ok(Math.abs(along + layout.radius * LATERAL_FRACTION) < 1e-9, `left of the centre for ${eToA}`); assert.ok(Math.abs(across) < 1e-9, `in the plane of the view for ${eToA}`);
    assert.ok(Math.abs(Math.hypot(...layout.right) - 1) < 1e-12 && layout.right[1] === 0, 'a horizontal unit vector');
  }
});
test('the crowd box lies under the membrane around the ribosome; the radius comes from the body without tRNAs and mRNA', () => {
  const body = ribosome.filter((p) => p[1] < 100), layout = cornerLayout({ ribosome, body, eToA: [1, 0, 0], channel });
  assert.ok(layout.radius > 0 && Math.abs(layout.radius - cornerLayout({ ribosome, eToA: [1, 0, 0], channel }).radius) > 1, 'the radius is the body\'s, not the whole entry\'s');
  assert.equal(layout.top, 120, 'the membrane height still follows the whole entry (tRNAs and mRNA included)');
  const { min, max } = layout.crowdBox, h = layout.radius + 170;
  assert.ok(near(min, [layout.centre[0] - h, layout.bottom - 70, layout.centre[2] - h]) && near(max, [layout.centre[0] + h, layout.membraneY - 34, layout.centre[2] + h]));
  assert.ok(max[1] < layout.membraneY && min[1] < layout.bottom, 'below the membrane, a little under the ribosome');
});
test('missing input is refused, not guessed', () => {
  assert.throws(() => cornerLayout({ ribosome: [], eToA: [1, 0, 0], channel }), /needs/); assert.throws(() => cornerLayout({ ribosome, eToA: [1, 0, 0], channel: [] }), /needs/); assert.throws(() => cornerLayout({ ribosome, channel }), /needs/);
});
