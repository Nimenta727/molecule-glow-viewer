import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMrc, downsample, factorFor, suggestLevel, isosurface, enclosedVolume, surfaceArea, MapError, MAX_VOXELS } from '../density-map.mjs';

/** A minimal MRC file: header words in their places, then the voxels in file order (columns fastest). */
function makeMrc({ dims, mode = 2, cell, grid, axes = [1, 2, 3], little = true, origin = [0, 0, 0], start = [0, 0, 0], angles = [90, 90, 90], values, label = 'synthetic' }) {
  const bytesPer = mode === 0 ? 1 : mode === 2 ? 4 : 2, total = dims[0] * dims[1] * dims[2], out = new Uint8Array(1024 + total * bytesPer), view = new DataView(out.buffer);
  const i32 = (word, v) => view.setInt32(4 * word, v, little), f32 = (word, v) => view.setFloat32(4 * word, v, little);
  dims.forEach((n, k) => i32(k, n)); i32(3, mode); start.forEach((v, k) => i32(4 + k, v)); (grid ?? dims).forEach((v, k) => i32(7 + k, v)); (cell ?? dims).forEach((v, k) => f32(10 + k, v)); angles.forEach((v, k) => f32(13 + k, v));
  axes.forEach((v, k) => i32(16 + k, v)); origin.forEach((v, k) => f32(49 + k, v)); out.set(little ? [0x44, 0x44, 0, 0] : [0x11, 0x11, 0, 0], 212); out.set(new TextEncoder().encode(label), 224);
  for (let n = 0; n < total; n++) { const at = 1024 + n * bytesPer, v = values[n]; if (mode === 2) view.setFloat32(at, v, little); else if (mode === 1) view.setInt16(at, v, little); else if (mode === 6) view.setUint16(at, v, little); else view.setInt8(at, v); }
  return out;
}
/** Density 1 inside a sphere of radius `r` voxels around the centre, falling linearly to <0 outside: crossing level 0 gives the sphere. */
function sphere(n, r, voxel = 1) {
  const c = (n - 1) / 2, values = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) values[x + n * (y + n * z)] = r - Math.hypot(x - c, y - c, z - c);
  return values;
}

test('a float32 map is read back voxel for voxel with its size, origin and statistics', () => {
  const values = Float32Array.from({ length: 4 * 3 * 2 }, (_, i) => i - 5), map = parseMrc(makeMrc({ dims: [4, 3, 2], cell: [8, 6, 4], origin: [10, 20, 30], values, label: 'my map' }));
  assert.deepEqual(map.dims, [4, 3, 2]); assert.deepEqual([...map.voxelSize], [2, 2, 2]); assert.deepEqual([...map.origin], [10, 20, 30]); assert.deepEqual([...map.data], [...values]);
  assert.equal(map.stats.min, -5); assert.equal(map.stats.max, 18); assert.ok(Math.abs(map.stats.mean - 6.5) < 1e-6); assert.equal(map.label, 'my map');
});

test('byte order, voxel modes, and the older start-index origin', () => {
  const values = Float32Array.from({ length: 8 }, (_, i) => i * 3 - 4);
  const big = parseMrc(makeMrc({ dims: [2, 2, 2], little: false, values })); assert.deepEqual([...big.data], [...values], 'big endian');
  for (const mode of [0, 1, 6]) { const m = parseMrc(makeMrc({ dims: [2, 2, 2], mode, values: Float32Array.from({ length: 8 }, (_, i) => i + 1) })); assert.deepEqual([...m.data], [1, 2, 3, 4, 5, 6, 7, 8], `mode ${mode}`); }
  const old = parseMrc(makeMrc({ dims: [2, 2, 2], cell: [4, 4, 4], start: [5, 6, 7], values })); assert.deepEqual([...old.origin], [10, 12, 14], 'start indices times the voxel size when ORIGIN is zero');
});

test('any axis order is put back into x, y, z', () => {
  // a 2 x 3 x 4 volume with value = 100 x + 10 y + z, written with the axes ordered z (columns), x (rows), y (sections): MAPC=3, MAPR=1, MAPS=2
  const dims = [2, 3, 4], at = (x, y, z) => 100 * x + 10 * y + z, file = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) for (let z = 0; z < 4; z++) file.push(at(x, y, z));
  const map = parseMrc(makeMrc({ dims: [4, 2, 3], axes: [3, 1, 2], cell: [2, 3, 4], grid: [2, 3, 4], values: Float32Array.from(file) }));
  assert.deepEqual(map.dims, dims);
  for (let z = 0; z < 4; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) assert.equal(map.data[x + 2 * (y + 3 * z)], at(x, y, z));
});

test('what cannot be read is refused with the reason', () => {
  const ok = makeMrc({ dims: [2, 2, 2], values: new Float32Array(8) });
  assert.throws(() => parseMrc(new Uint8Array(100)), /太短/);
  assert.throws(() => parseMrc(makeMrc({ dims: [2, 2, 2], angles: [90, 90, 120], values: new Float32Array(8) })), /不是直角/);
  assert.throws(() => parseMrc(makeMrc({ dims: [2, 2, 2], axes: [1, 1, 3], values: new Float32Array(8) })), /轴顺序/);
  const bad = ok.slice(); new DataView(bad.buffer).setInt32(12, 3, true); assert.throws(() => parseMrc(bad), /mode 3/);
  assert.throws(() => parseMrc(ok.slice(0, 1024 + 8)), /比头里声明的体素数据短/);
  const garbage = new Uint8Array(2048).fill(255); assert.throws(() => parseMrc(garbage), MapError);
  const huge = ok.slice(); new DataView(huge.buffer).setInt32(0, 5000, true); new DataView(huge.buffer).setInt32(4, 5000, true); new DataView(huge.buffer).setInt32(8, 5000, true);
  assert.throws(() => parseMrc(huge), new RegExp(`超过上限 ${MAX_VOXELS}`));
});

test('downsampling averages blocks, keeps the extent and the mean', () => {
  const map = parseMrc(makeMrc({ dims: [4, 4, 4], cell: [8, 8, 8], values: Float32Array.from({ length: 64 }, (_, i) => i) })), half = downsample(map, 2);
  assert.deepEqual(half.dims, [2, 2, 2]); assert.deepEqual([...half.voxelSize], [4, 4, 4]);
  assert.ok(Math.abs(half.stats.mean - map.stats.mean) < 1e-5); assert.ok(Math.abs(half.data[0] - (0 + 1 + 4 + 5 + 16 + 17 + 20 + 21) / 8) < 1e-6);
  assert.ok(Math.abs(half.origin[0] - 0.5 * 2 / 2 * 1) < 1e-9 || half.origin[0] === 1, 'the origin moves to the centre of the first block');
  assert.equal(downsample(map, 1), map); assert.throws(() => downsample(map, 0), /正整数/);
  const odd = downsample(parseMrc(makeMrc({ dims: [5, 3, 2], values: new Float32Array(30).fill(2) })), 2); assert.deepEqual(odd.dims, [3, 2, 1]); assert.ok(odd.data.every((v) => v === 2), 'edge blocks average only what exists');
  assert.equal(factorFor([100, 100, 100], 1e6), 1); assert.equal(factorFor([512, 512, 512], 32 * 1024 * 1024), 2);
});

test('the suggested level is the mean plus three standard deviations, and is only a starting point', () => {
  const map = parseMrc(makeMrc({ dims: [2, 2, 2], values: Float32Array.of(0, 0, 0, 0, 0, 0, 0, 8) })); assert.ok(Math.abs(suggestLevel(map) - (map.stats.mean + 3 * map.stats.rms)) < 1e-9);
});

test('the isosurface of a sphere is a closed surface of about the right size, facing outward', () => {
  const n = 41, r = 12, map = { dims: [n, n, n], voxelSize: [1, 1, 1], origin: [-20, -20, -20], data: sphere(n, r), stats: {} };
  const { positions, triangles, truncated } = isosurface(map, 0);
  assert.ok(!truncated && triangles > 1000, `${triangles} triangles`);
  // every vertex lies on the sphere (within a voxel)
  for (let i = 0; i < positions.length; i += 3) assert.ok(Math.abs(Math.hypot(positions[i], positions[i + 1], positions[i + 2]) - r) < 1.0, 'vertex on the sphere');
  const volume = enclosedVolume(positions), area = surfaceArea(positions), V = 4 / 3 * Math.PI * r ** 3, A = 4 * Math.PI * r ** 2;
  assert.ok(volume > 0, 'positive volume: the triangles face outward'); assert.ok(Math.abs(volume - V) / V < 0.03, `volume ${volume.toFixed(0)} vs ${V.toFixed(0)}`); assert.ok(Math.abs(area - A) / A < 0.08, `area ${area.toFixed(0)} vs ${A.toFixed(0)}`);
});

test('the surface is watertight: every edge belongs to two triangles, the net area vector is zero, and no triangle faces inward (also when voxels sit exactly on the level)', () => {
  const n = 21, c = 10, map = { dims: [n, n, n], voxelSize: [1, 1, 1], origin: [0, 0, 0], stats: {}, data: sphere(n, 6) };   // radius 6: grid points exactly on the level (distance 6 along axes and at (2,4,4))
  const { positions } = isosurface(map, 0), edges = new Map(), key = (x, y, z) => [x, y, z].map((v) => v.toFixed(3)).join(',');
  const net = [0, 0, 0]; let inward = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const v = [0, 1, 2].map((k) => key(positions[i + 3 * k], positions[i + 3 * k + 1], positions[i + 3 * k + 2]));
    for (let k = 0; k < 3; k++) { const e = [v[k], v[(k + 1) % 3]].sort().join('|'); edges.set(e, (edges.get(e) ?? 0) + 1); }
    const u = [positions[i + 3] - positions[i], positions[i + 4] - positions[i + 1], positions[i + 5] - positions[i + 2]], w = [positions[i + 6] - positions[i], positions[i + 7] - positions[i + 1], positions[i + 8] - positions[i + 2]];
    const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (let k = 0; k < 3; k++) net[k] += normal[k] / 2;
    const centre = [0, 1, 2].map((k) => (positions[i + k] + positions[i + 3 + k] + positions[i + 6 + k]) / 3 - c);
    if (normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2] <= 0) inward++;
  }
  assert.ok([...edges.values()].every((count) => count === 2), 'every edge is shared by exactly two triangles');
  assert.ok(net.every((v) => Math.abs(v) < 1e-3), `the net area vector is zero (${net.map((v) => v.toFixed(4))})`); assert.equal(inward, 0);
});

test('the voxel size and origin place the surface; a level above or below everything gives nothing; the triangle cap is reported', () => {
  const n = 21, base = { dims: [n, n, n], data: sphere(n, 6), stats: {} };
  const a = isosurface({ ...base, voxelSize: [1, 1, 1], origin: [0, 0, 0] }, 0), b = isosurface({ ...base, voxelSize: [2, 2, 2], origin: [100, 0, 0] }, 0);
  assert.equal(a.triangles, b.triangles); assert.ok(Math.abs(enclosedVolume(b.positions) - 8 * enclosedVolume(a.positions)) / (8 * enclosedVolume(a.positions)) < 1e-3, 'twice the voxel size, eight times the volume (float32 positions: a thousandth)');
  assert.equal(isosurface({ ...base, voxelSize: [1, 1, 1], origin: [0, 0, 0] }, 1000).triangles, 0); assert.equal(isosurface({ ...base, voxelSize: [1, 1, 1], origin: [0, 0, 0] }, -1000).triangles, 0);
  const capped = isosurface({ ...base, voxelSize: [1, 1, 1], origin: [0, 0, 0] }, 0, { maxTriangles: 50 }); assert.equal(capped.truncated, true); assert.ok(capped.triangles < a.triangles);
});
