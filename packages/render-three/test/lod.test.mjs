import assert from 'node:assert/strict';
import test from 'node:test';
import { colorByNearest, planLevels, projectedRadiusPixels, icosphereTriangles, gridBlobs, blobProxy, ellipsoidProxy, markerProxy, principalBox, buildLevels } from '../lod.mjs';

const camera = (distanceBack = 0, extra = {}) => ({ position: [0, 0, distanceBack], direction: [0, 0, -1], fov: Math.PI / 3, aspect: 1.5, height: 800, ...extra });
const TRIANGLES = [1000, 100, 20, 8];
const line = (zs, x = 0) => Float32Array.from(zs.flatMap((z) => [x, 0, z]));

test('the on-screen radius shrinks with distance and grows with the radius', () => {
  const near = projectedRadiusPixels(10, 100, Math.PI / 3, 800), far = projectedRadiusPixels(10, 1000, Math.PI / 3, 800);
  assert.ok(Math.abs(near / far - 10) < 1e-9);
  assert.ok(Math.abs(projectedRadiusPixels(20, 100, Math.PI / 3, 800) / near - 2) < 1e-9);
});

test('nearer instances get finer levels, in order, and the ones behind the camera or outside the view are not drawn', () => {
  // radius 10, 60-degree view, 800 px: 6928 / distance pixels. At 80, 300, 900, 2500 and 40000 away that is 86, 23, 7.7, 2.8 and 0.17 px: levels 0, 1, 2, 3 and not drawn.
  const plan = planLevels({ centers: line([-80, -300, -900, -2500, -40000]), radii: 10, camera: camera(), triangles: TRIANGLES });
  assert.deepEqual([...plan.level], [0, 1, 2, 3, -1], 'finest to coarsest, then too small to draw');
  const behind = planLevels({ centers: line([100, -300]), radii: 10, camera: camera(), triangles: TRIANGLES });
  assert.deepEqual([...behind.level], [-1, 1], 'behind the camera');
  const aside = planLevels({ centers: Float32Array.from([5000, 0, -300, 0, 0, -300]), radii: 10, camera: camera(), triangles: TRIANGLES });
  assert.deepEqual([...aside.level], [-1, 1], 'far outside the cone of the view');
  assert.equal(aside.culled, 1); assert.deepEqual(aside.counts, [0, 1, 0, 0]);
});

test('an instance the camera is inside of (or touching) is always drawn at the finest level', () => {
  const plan = planLevels({ centers: line([-5]), radii: 10, camera: camera(), triangles: TRIANGLES });
  assert.equal(plan.level[0], 0);
});

test('the budget is kept by demoting the smallest-looking instances first, one level at a time', () => {
  const zs = Array.from({ length: 20 }, (_, i) => -60 - i);   // all close enough for level 0 (60..79 away: 115..88 px); nearer ones look bigger
  const free = planLevels({ centers: line(zs), radii: 10, camera: camera(), triangles: TRIANGLES });
  assert.equal(free.triangles, 20 * 1000); assert.equal(free.demoted, 0); assert.equal(free.overBudget, false);
  const tight = planLevels({ centers: line(zs), radii: 10, camera: camera(), triangles: TRIANGLES, budget: 12000 });
  assert.ok(tight.triangles <= 12000, `kept: ${tight.triangles}`); assert.equal(tight.overBudget, false); assert.ok(tight.demoted > 0);
  const nearest = tight.level[0], farthest = tight.level[19];
  assert.ok(nearest <= farthest, 'the nearest keeps at least as much detail as the farthest');
  assert.ok(tight.level.every((l, i, all) => i === 0 || l >= all[i - 1]), 'detail never rises with distance');
  const impossible = planLevels({ centers: line(zs), radii: 10, camera: camera(), triangles: TRIANGLES, budget: 10 });
  assert.equal(impossible.overBudget, true, 'a budget below the coarsest level for everything is reported, not hidden');
  assert.ok(impossible.level.every((l) => l === 3), 'everything is at the coarsest level');
});

test('the plan is deterministic and independent of the order of the instances', () => {
  const zs = [-90, -200, -350, -800, -90, -2100], a = planLevels({ centers: line(zs), radii: 10, camera: camera(), triangles: TRIANGLES, budget: 2500 });
  const b = planLevels({ centers: line(zs), radii: 10, camera: camera(), triangles: TRIANGLES, budget: 2500 });
  assert.deepEqual([...a.level], [...b.level]);
  const reversed = zs.slice().reverse(), r = planLevels({ centers: line(reversed), radii: 10, camera: camera(), triangles: TRIANGLES, budget: 2500 });
  assert.equal(r.triangles, a.triangles); assert.deepEqual(r.counts, a.counts);
});

test('hysteresis: an instance near a threshold keeps its level until it is clearly past it, in both directions', () => {
  // radius 10 at distance d covers 10 / (d tan 30deg) * 400 px = 6928 / d; the level-0 threshold is 60 px, reached at d = 115.47
  const at = (d, previous) => planLevels({ centers: line([-d]), radii: 10, camera: camera(), triangles: TRIANGLES, previous });
  assert.equal(at(115).level[0], 0, 'just inside the threshold');
  assert.equal(at(120).level[0], 1, 'just outside, with no history: the coarser level');
  assert.equal(at(120, Int8Array.of(0)).level[0], 0, 'it was fine and is still close to the threshold: kept');
  assert.equal(at(140, Int8Array.of(0)).level[0], 1, 'clearly past the threshold: it changes');
  assert.equal(at(113, Int8Array.of(1)).level[0], 1, 'it was coarse and has only just crossed: kept');
  assert.equal(at(95, Int8Array.of(1)).level[0], 0, 'clearly across: it changes');
});

test('proxies: icospheres, grid blobs, an ellipsoid along the principal axes and an octahedron marker', () => {
  assert.deepEqual([0, 1, 2].map((s) => icosphereTriangles(s).length / 9), [20, 80, 320]);
  const unit = icosphereTriangles(1); for (let i = 0; i < unit.length; i += 3) assert.ok(Math.abs(Math.hypot(unit[i], unit[i + 1], unit[i + 2]) - 1) < 1e-6, 'on the unit sphere');
  // a 10 x 4 x 2 slab of points
  const points = []; for (let x = 0; x <= 10; x++) for (let y = 0; y <= 4; y++) for (let z = 0; z <= 2; z++) points.push(x, y, z);
  const cloud = Float32Array.from(points);
  assert.ok(gridBlobs(cloud, 5).length <= 8 && gridBlobs(cloud, 5).length >= 2);
  assert.equal(blobProxy(cloud, 5).length / 9, gridBlobs(cloud, 5).length * 20, 'twenty triangles a blob');
  const box = principalBox(cloud); assert.ok(Math.abs(Math.abs(box.axes[0][0]) - 1) < 1e-6 || Math.abs(Math.abs(box.axes[1][0]) - 1) < 1e-6 || Math.abs(Math.abs(box.axes[2][0]) - 1) < 1e-6, 'the long axis is x');
  assert.deepEqual([...box.extents].sort((a, b) => b - a).map((e) => Math.round(e * 10) / 10), [5, 2, 1]);
  assert.equal(ellipsoidProxy(cloud, 1).length / 9, 80); assert.equal(markerProxy(cloud).length / 9, 8);
});

test('building the levels gives strictly cheaper stand-ins for a real-sized prototype', () => {
  const full = new Float32Array(9 * 20000), outline = new Float32Array(3 * 2000);
  for (let i = 0; i < outline.length; i += 3) { const t = i / 3; outline[i] = (t % 40) * 2; outline[i + 1] = (Math.floor(t / 40) % 10) * 2; outline[i + 2] = Math.floor(t / 400) * 2; }
  const { geometries, triangles } = buildLevels(full, outline, { cell: 8 });
  assert.equal(geometries.length, 4); assert.equal(triangles[0], 20000);
  assert.ok(triangles[0] > triangles[1] && triangles[1] > triangles[2] && triangles[2] > triangles[3], triangles.join(' > '));
});

test('a stand-in takes the colour of the nearest original point, so coarse levels still show which part is which', () => {
  const points = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]), colors = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const soup = Float32Array.from([1, 1, 0, 9, 1, 0, 1, 9, 0, 4.9, 0, 0, 5.1, 0, 0]);   // near the red, green, blue point, then the two sides of the middle between red and green
  assert.deepEqual([...colorByNearest(soup, points, colors)], [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]);
  // against brute force on random data
  let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const many = Float32Array.from({ length: 3 * 500 }, () => rnd() * 100), tint = Float32Array.from({ length: 3 * 500 }, () => rnd()), probe = Float32Array.from({ length: 3 * 300 }, () => rnd() * 120 - 10);
  const got = colorByNearest(probe, many, tint);
  for (let v = 0; v < probe.length; v += 3) {
    let best = 0, bestD = Infinity; for (let i = 0; i < 500; i++) { const d = (many[3 * i] - probe[v]) ** 2 + (many[3 * i + 1] - probe[v + 1]) ** 2 + (many[3 * i + 2] - probe[v + 2]) ** 2; if (d < bestD) { bestD = d; best = i; } }
    assert.deepEqual([got[v], got[v + 1], got[v + 2]], [tint[3 * best], tint[3 * best + 1], tint[3 * best + 2]]);
  }
});
