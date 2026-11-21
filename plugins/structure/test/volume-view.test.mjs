import assert from 'node:assert/strict';
import test from 'node:test';
import { volumeSurface, volumeSlice, mapCentre, grey } from '../volume-view.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM as SCALE } from '../representation.mjs';

const n = 21, sphereMap = (voxel = 1, origin = [0, 0, 0]) => { const data = new Float32Array(n * n * n); for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[x + n * (y + n * z)] = 6 - Math.hypot(x - 10, y - 10, z - 10); return { dims: [n, n, n], voxelSize: [voxel, voxel, voxel], origin, data, stats: { min: -10, max: 6, mean: -3, rms: 4 } }; };

test('the surface is placed in the structure\'s frame and scaled to viewport units', () => {
  const map = sphereMap(1, [50, 60, 70]), centre = mapCentre(map); assert.deepEqual(centre, [60, 70, 80]);
  const own = volumeSurface(map, { level: 0 });
  assert.ok(own.triangles > 1000 && !own.truncated && !own.auto); assert.equal(own.mesh.pos.length, own.triangles * 9); assert.equal(own.mesh.idx.length, own.triangles * 3);
  let far = 0; for (let i = 0; i < own.mesh.pos.length; i += 3) far = Math.max(far, Math.hypot(own.mesh.pos[i], own.mesh.pos[i + 1], own.mesh.pos[i + 2]));
  assert.ok(Math.abs(far - 6 * SCALE) < 1.2 * SCALE, `the sphere of 6 Å around the map centre is ${far / SCALE} Å out`);
  const shifted = volumeSurface(map, { level: 0, frame: { center: [50, 70, 80] } });   // the structure's frame is 10 Å to the side
  let x = 0; for (let i = 0; i < shifted.mesh.pos.length; i += 3) x += shifted.mesh.pos[i] / (shifted.mesh.pos.length / 3);
  assert.ok(Math.abs(x - 10 * SCALE) < 0.05 * SCALE, 'the surface sits 10 Å to +x of the frame centre');
});

test('"auto" gives the mean plus three sigma and says it is a heuristic; reductions and empty levels are said', () => {
  const map = sphereMap(), auto = volumeSurface(map, { level: 'auto' });
  assert.equal(auto.auto, true); assert.ok(Math.abs(auto.level - (-3 + 3 * 4)) < 1e-9); assert.match(auto.note, /启发式起点/);
  assert.match(volumeSurface(map, { level: 100 }).note, /没有等值面/);
  const reduced = volumeSurface(map, { level: 0, maxVoxels: 2000 }); assert.ok(reduced.factor > 1); assert.match(reduced.note, /降采样/);
  const capped = volumeSurface(map, { level: 0, maxTriangles: 100 }); assert.equal(capped.truncated, true); assert.match(capped.note, /不完整/);
  assert.throws(() => volumeSurface(map, { level: NaN }), /level/);
});

test('a slice is a coloured mesh of two triangles per voxel on the right plane, with a ramp that ignores one hot voxel', () => {
  const map = sphereMap(), s = volumeSlice(map, 2, 10);
  assert.equal(s.of, n); assert.equal(s.layer, 10); assert.equal(s.mesh.pos.length, n * n * 6 * 3); assert.equal(s.mesh.colors.length, s.mesh.pos.length);
  const zs = new Set(); for (let i = 2; i < s.mesh.pos.length; i += 3) zs.add(Math.round(s.mesh.pos[i] / SCALE * 1000) / 1000);
  assert.deepEqual([...zs], [0], 'every vertex is on the plane z = the map centre layer (viewport z 0)');
  // brightest in the middle (inside the sphere), darkest at the corner
  const colourAt = (i, j) => { const voxel = (j * n + i) * 18; return s.mesh.colors[voxel]; };
  assert.ok(colourAt(10, 10) > colourAt(0, 0));
  const hot = sphereMap(); hot.data[0] = 1e6; const flat = volumeSlice(hot, 2, 0);
  assert.ok(flat.hi < 100, `the hot voxel does not set the ramp (${flat.hi})`);
  assert.throws(() => volumeSlice(map, 3, 0), /axis/); assert.throws(() => volumeSlice(map, 0, 21), /0\.\.20/); assert.throws(() => volumeSlice(map, 0, 1.5), /slice index/);
  assert.deepEqual(grey(5, 5, 5).map((v) => Math.round(v * 100) / 100), [0.08, 0.08, 0.1]); assert.ok(grey(10, 0, 5)[0] > 0.9);
});
