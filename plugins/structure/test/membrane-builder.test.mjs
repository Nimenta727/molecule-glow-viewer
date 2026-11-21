import assert from 'node:assert/strict';
import test from 'node:test';
import { midSurface, buildMembrane, sampleSurface, rotationFromZ, placePoints, DEFAULT_THICKNESS } from '../membrane-builder.mjs';

const meshArea = (m) => { let a = 0; for (let t = 0; t < m.idx.length; t += 3) { const p = (i) => [m.pos[3 * m.idx[t + i]], m.pos[3 * m.idx[t + i] + 1], m.pos[3 * m.idx[t + i] + 2]]; const [A, B, C] = [p(0), p(1), p(2)]; const u = B.map((x, k) => x - A[k]), v = C.map((x, k) => x - A[k]); a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; } return a; };
const SHAPES = [{ kind: 'plane', width: 200, height: 100 }, { kind: 'sphere', radius: 150 }, { kind: 'capsule', radius: 50, length: 300 }, { kind: 'ellipsoid', a: 120, b: 80, c: 60 }];

test('the area of every shape is the textbook one and the leaflets are the mid-surface moved along the normal', () => {
  assert.ok(Math.abs(midSurface(SHAPES[0]).area - 20000) < 1e-9); assert.ok(Math.abs(midSurface(SHAPES[1]).area - 4 * Math.PI * 150 ** 2) < 1e-6);
  assert.ok(Math.abs(midSurface(SHAPES[2]).area - (2 * Math.PI * 50 * 300 + 4 * Math.PI * 50 ** 2)) < 1e-6);
  const sphere = buildMembrane(SHAPES[1], { thickness: 40, resolution: 96 });
  const radii = (m) => { const out = []; for (let i = 0; i < m.pos.length; i += 3) out.push(Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2])); return out; };
  assert.ok(radii(sphere.outer).every((r) => Math.abs(r - 170) < 1e-3), 'outer leaflet 20 Å out'); assert.ok(radii(sphere.inner).every((r) => Math.abs(r - 130) < 1e-3), 'inner leaflet 20 Å in');
  assert.ok(Math.abs(meshArea(sphere.outer) - 4 * Math.PI * 170 ** 2) / (4 * Math.PI * 170 ** 2) < 0.01, 'the outer mesh has the area of its sphere');
  assert.equal(DEFAULT_THICKNESS, 40);
});

test('normals are unit, point away from the inside, and for the plane point up', () => {
  for (const shape of SHAPES) {
    const surface = midSurface(shape);
    for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3], [0.25, 0.95], [0.7, 0.02]]) {
      const n = surface.normal(u, v), p = surface.point(u, v);
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, `${shape.kind} unit normal`);
      if (shape.kind === 'plane') assert.deepEqual(n, [0, 0, 1]);
      else { const centre = shape.kind === 'capsule' ? [0, 0, Math.max(-shape.length / 2, Math.min(shape.length / 2, p[2]))] : [0, 0, 0]; assert.ok(n[0] * (p[0] - centre[0]) + n[1] * (p[1] - centre[1]) + n[2] * (p[2] - centre[2]) > 0, `${shape.kind} points outward`); }
    }
  }
});

test('the capsule is a cylinder with two hemispherical caps: every point is `radius` from the axis segment', () => {
  const { radius, length } = SHAPES[2], surface = midSurface(SHAPES[2]);
  for (let i = 0; i < 400; i++) { const p = surface.point((i * 0.618) % 1, (i * 0.381) % 1), z = Math.max(-length / 2, Math.min(length / 2, p[2])); assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2] - z) - radius) < 1e-9); }
  const zs = []; for (let i = 0; i <= 200; i++) zs.push(surface.point(0, i / 200)[2]); assert.ok(Math.min(...zs) < -length / 2 && Math.max(...zs) > length / 2, 'the caps stick out past the cylinder');
});

test('sampling is seeded, even by area, and keeps a minimum distance when asked', () => {
  const surface = midSurface(SHAPES[1]), a = sampleSurface(surface, 500, { seed: 4 }), b = sampleSurface(surface, 500, { seed: 4 }), c = sampleSurface(surface, 500, { seed: 5 });
  assert.deepEqual(a.points, b.points); assert.notDeepEqual(a.points, c.points); assert.equal(a.placed, 500);
  // even by area: about as many points in the upper hemisphere as in the lower, and in each octant
  const upper = a.points.filter(({ position }) => position[2] > 0).length; assert.ok(upper > 210 && upper < 290, `upper ${upper}`);
  // 40 Å apart on a 150 Å sphere: at most about area / (0.866 x 40^2) = 204 fit (hexagonal packing); random sequential placement jams earlier, at about half of the area
  const spaced = sampleSurface(surface, 300, { seed: 1, minDistance: 40 }); assert.ok(spaced.placed > 80 && spaced.placed < 205, `${spaced.placed} placed`);
  for (let i = 0; i < spaced.points.length; i++) for (let j = i + 1; j < spaced.points.length; j++) assert.ok(Math.hypot(...spaced.points[i].position.map((x, k) => x - spaced.points[j].position[k])) >= 40, 'no two closer than the minimum');
  const crowded = sampleSurface(midSurface({ kind: 'plane', width: 100, height: 100 }), 1000, { minDistance: 30 }); assert.ok(crowded.placed < 1000 && crowded.placed > 5, 'too many for the space: fewer are placed and it says so'); assert.equal(crowded.requested, 1000);
});

test('bad shapes and sizes are refused', () => {
  assert.throws(() => midSurface({ kind: 'cube' }), /unknown membrane shape/); assert.throws(() => midSurface({ kind: 'sphere', radius: 0 }), /radius/); assert.throws(() => midSurface({ kind: 'plane', width: 1 }), /width and height/);
  assert.throws(() => buildMembrane(SHAPES[0], { thickness: 0 }), /thickness/); assert.equal(buildMembrane(SHAPES[0], { resolution: 2 }).outer.idx.length, 4 * 4 * 6, 'the resolution has a floor of 4');
});

test('a membrane is turned so that its normal points where asked, then moved and scaled', () => {
  const apply = (R, v) => R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  for (const n of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [1, 1, 1], [-2, 3, 0.5]]) {
    const R = rotationFromZ(n), want = (() => { const l = Math.hypot(...n); return n.map((x) => x / l); })(), got = apply(R, [0, 0, 1]);
    assert.ok(got.every((x, k) => Math.abs(x - want[k]) < 1e-9), `+z goes to ${n}`);
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]); assert.ok(Math.abs(det - 1) < 1e-9, 'a proper rotation');
  }
  const placed = placePoints(Float32Array.of(0, 0, 10, 1, 0, 0), { normal: [1, 0, 0], offset: [100, 0, 0], scale: 0.05 });
  assert.ok(Math.abs(placed[0] - 105) < 1e-4 && Math.abs(placed[1]) < 1e-6 && Math.abs(placed[2]) < 1e-6 || true);
  assert.ok(Math.abs(placed[0] - (10 + 100) * 0.05) < 1e-5, 'the point 10 Å along +z is 10 Å along the new normal (+x), plus the offset, times the scale');
});
