/**
 * Density maps (cryo-EM and electron tomography volumes) as data (docs/PLUGIN_ROADMAP.md, A2): reading an MRC/CCP4 file, reducing it, finding a sensible contour level and turning a level into a
 * triangle surface. Pure functions over bytes and arrays; nothing here draws.
 *
 * What is supported, said plainly: the MRC2014 / CCP4 layout (1024-byte header, optional extended header, then the voxels), modes 0 (int8), 1 (int16), 2 (float32) and 6 (uint16), either byte order,
 * any axis order, and cells with right angles (the orthogonal grid every cryo-EM map uses). A cell with other angles, a complex mode, or a map above MAX_VOXELS is refused with the reason: a
 * wrong picture is worse than none.
 */
export const MAX_VOXELS = 32 * 1024 * 1024;   // 128 MB as float32: what a browser tab can hold next to a structure; larger maps are reduced before they reach this reader

export class MapError extends Error { constructor(message) { super(message); this.name = 'MapError'; } }

/**
 * Reads an MRC/CCP4 map. Returns { dims: [nx, ny, nz] (x fastest, in x, y, z order whatever the file's axis order was), voxelSize: [å, å, å], origin: [x, y, z] (Å, of the first voxel's centre),
 * data: Float32Array, stats: { min, max, mean, rms }, mode, label }.
 */
export function parseMrc(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 1024) throw new MapError('文件太短，不是 MRC/CCP4 体积（至少要有 1024 字节的文件头）。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // byte order from the machine stamp (words 54: 0x44 0x44 = little endian, 0x11 0x11 = big endian); when it is absent, the one that makes the dimensions sane
  const stamp = bytes[212], sane = (little) => { const n = [view.getInt32(0, little), view.getInt32(4, little), view.getInt32(8, little)]; return n.every((v) => v > 0 && v < 65536); };
  const little = stamp === 0x44 ? true : stamp === 0x11 ? false : sane(true) ? true : sane(false) ? false : null;
  if (little === null || !sane(little)) throw new MapError('文件头里的尺寸不合理，不是 MRC/CCP4 体积（或字节序无法判断）。');
  const int = (word) => view.getInt32(4 * word, little), float = (word) => view.getFloat32(4 * word, little);
  const nc = int(0), nr = int(1), ns = int(2), mode = int(3), mx = int(7), my = int(8), mz = int(9), nsymbt = int(23);
  const cell = [float(10), float(11), float(12)], angles = [float(13), float(14), float(15)];
  const axes = [int(16), int(17), int(18)];   // which of x, y, z (1, 2, 3) the columns, rows and sections run along
  if (![0, 1, 2, 6].includes(mode)) throw new MapError(`不支持的体素类型 mode ${mode}（支持 0、1、2、6；复数和其它类型不读）。`);
  if (angles.some((a) => Math.abs(a - 90) > 1e-3) && angles.some((a) => a !== 0)) throw new MapError(`晶胞角度 ${angles.map((a) => a.toFixed(1)).join('、')}° 不是直角：这里只读正交网格的体积。`);
  if (axes.slice().sort().join() !== '1,2,3') throw new MapError(`轴顺序 ${axes.join('、')} 无效（应是 1、2、3 的一个排列）。`);
  const total = nc * nr * ns;
  if (total > MAX_VOXELS) throw new MapError(`体积有 ${total} 个体素，超过上限 ${MAX_VOXELS}：请先降采样再导入。`);
  const bytesPer = mode === 0 ? 1 : mode === 2 ? 4 : 2, start = 1024 + nsymbt;
  if (bytes.byteLength < start + total * bytesPer) throw new MapError(`文件比头里声明的体素数据短（需要 ${start + total * bytesPer} 字节，实际 ${bytes.byteLength}）。`);
  const read = mode === 0 ? (o) => view.getInt8(o) : mode === 1 ? (o) => view.getInt16(o, little) : mode === 6 ? (o) => view.getUint16(o, little) : (o) => view.getFloat32(o, little);
  const dimsFile = [nc, nr, ns], dims = [0, 0, 0]; axes.forEach((axis, k) => { dims[axis - 1] = dimsFile[k]; });
  const grid = [mx || dims[0], my || dims[1], mz || dims[2]], voxelSize = [0, 1, 2].map((i) => (cell[i] > 0 && grid[i] > 0 ? cell[i] / grid[i] : 1));
  const startIndex = [int(4), int(5), int(6)], originWords = [float(49), float(50), float(51)];
  const origin = originWords.some((v) => v !== 0) ? originWords : [0, 1, 2].map((i) => 0);   // MRC2014 ORIGIN (Å); older CCP4 files give start indices instead
  if (originWords.every((v) => v === 0)) { const startXYZ = [0, 0, 0]; axes.forEach((axis, k) => { startXYZ[axis - 1] = startIndex[k]; }); for (let i = 0; i < 3; i++) origin[i] = startXYZ[i] * voxelSize[i]; }
  const data = new Float32Array(total); let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
  let at = start;
  // the file runs columns fastest; place every voxel at its x, y, z position
  const posOf = (c, r, s) => { const file = [c, r, s], xyz = [0, 0, 0]; axes.forEach((axis, k) => { xyz[axis - 1] = file[k]; }); return xyz[0] + dims[0] * (xyz[1] + dims[1] * xyz[2]); };
  for (let s = 0; s < ns; s++) for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const v = read(at); at += bytesPer;
    data[posOf(c, r, s)] = v; if (v < min) min = v; if (v > max) max = v; sum += v; sumSq += v * v;
  }
  const mean = sum / total, rms = Math.sqrt(Math.max(0, sumSq / total - mean * mean));
  return { dims, voxelSize, origin, data, stats: { min, max, mean, rms }, mode, label: new TextDecoder().decode(bytes.subarray(224, 224 + 80)).replace(/\0+$/g, '').trim() };
}

/** Reduces a map by an integer factor (a box average), keeping its extent: { dims, voxelSize, origin, data, stats }. The origin moves to the centre of the first block. */
export function downsample(map, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new MapError('降采样倍数应为正整数。');
  if (factor === 1) return map;
  const [nx, ny, nz] = map.dims, dims = [Math.ceil(nx / factor), Math.ceil(ny / factor), Math.ceil(nz / factor)], data = new Float32Array(dims[0] * dims[1] * dims[2]);
  let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    let total = 0, count = 0;
    for (let k = z * factor; k < Math.min(nz, (z + 1) * factor); k++) for (let j = y * factor; j < Math.min(ny, (y + 1) * factor); j++) for (let i = x * factor; i < Math.min(nx, (x + 1) * factor); i++) { total += map.data[i + nx * (j + ny * k)]; count++; }
    const v = total / count; data[x + dims[0] * (y + dims[1] * z)] = v; if (v < min) min = v; if (v > max) max = v; sum += v; sumSq += v * v;
  }
  const n = data.length, mean = sum / n, voxelSize = map.voxelSize.map((s) => s * factor);
  return { ...map, dims, voxelSize, origin: map.origin.map((o, i) => o + (map.voxelSize[i] * (factor - 1)) / 2), data, stats: { min, max, mean, rms: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) } };
}

/** The smallest integer factor that brings a map under `limit` voxels (1 when it already fits). */
export const factorFor = (dims, limit) => { let f = 1; while (Math.ceil(dims[0] / f) * Math.ceil(dims[1] / f) * Math.ceil(dims[2] / f) > limit) f++; return f; };

/**
 * A starting contour level: the mean plus `sigmas` standard deviations of the map. It is a HEURISTIC to give the author something to start from (the depositor's recommended level, when the
 * entry has one, is better and should win); the author is expected to move it.
 */
export const suggestLevel = (map, sigmas = 3) => map.stats.mean + sigmas * map.stats.rms;

// ---- isosurface: marching tetrahedra ----------------------------------------------------------------------------------------------------------------
// Each cube is cut into six tetrahedra around its main diagonal; each tetrahedron has at most one or two triangles, found from which corners are above the level. No lookup table to get wrong.
const CUBE = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

/**
 * Triangles (flat xyz in Å, counter-clockwise seen from outside, i.e. from where the density is lower than the level) of the surface where the map crosses `level`.
 *   options.maxTriangles  stop and report `truncated` when exceeded (default 3 000 000)
 * Returns { positions: Float32Array, triangles, truncated }.
 */
export function isosurface(map, level, { maxTriangles = 3_000_000 } = {}) {
  const [nx, ny, nz] = map.dims, { data, voxelSize: vs, origin } = map, out = [];
  let triangles = 0, truncated = false;
  const value = (i, j, k) => data[i + nx * (j + ny * k)];
  const point = (a, b, fa, fb) => { const t = (level - fa) / (fb - fa); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const emit = (p, q, r, insidePoint) => {
    // orient so the normal points away from the inside (higher density): the side that contains `insidePoint` is behind the triangle
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (Math.hypot(...n) < 1e-12) return;   // a corner exactly on the level makes two of the three points coincide: no triangle
    const flip = n[0] * (insidePoint[0] - p[0]) + n[1] * (insidePoint[1] - p[1]) + n[2] * (insidePoint[2] - p[2]) > 0;   // the inside corner is strictly above the level, so it is never in the triangle's plane
    const [a, b] = flip ? [r, q] : [q, r];
    for (const v of [p, a, b]) out.push(origin[0] + v[0] * vs[0], origin[1] + v[1] * vs[1], origin[2] + v[2] * vs[2]);
    triangles++;
  };
  for (let k = 0; k < nz - 1 && !truncated; k++) for (let j = 0; j < ny - 1 && !truncated; j++) for (let i = 0; i < nx - 1; i++) {
    const vals = CUBE.map(([dx, dy, dz]) => value(i + dx, j + dy, k + dz));
    let below = 0, above = 0; for (const v of vals) { if (v > level) above++; else below++; }   // a voxel exactly at the level counts as outside
    if (!below || !above) continue;
    const pos = CUBE.map(([dx, dy, dz]) => [i + dx, j + dy, k + dz]);
    for (const tet of TETS) {
      const inside = tet.filter((c) => vals[c] > level), outside = tet.filter((c) => vals[c] <= level);
      if (!inside.length || !outside.length) continue;
      if (inside.length === 1) { const a = inside[0], [b, c, d] = outside; emit(point(pos[a], pos[b], vals[a], vals[b]), point(pos[a], pos[c], vals[a], vals[c]), point(pos[a], pos[d], vals[a], vals[d]), pos[a]); }
      else if (outside.length === 1) { const a = outside[0], [b, c, d] = inside; emit(point(pos[a], pos[b], vals[a], vals[b]), point(pos[a], pos[c], vals[a], vals[c]), point(pos[a], pos[d], vals[a], vals[d]), pos[b]); }
      else {   // two corners on each side: a quadrilateral, as two triangles
        const [a, b] = inside, [c, d] = outside;
        const ac = point(pos[a], pos[c], vals[a], vals[c]), ad = point(pos[a], pos[d], vals[a], vals[d]), bc = point(pos[b], pos[c], vals[b], vals[c]), bd = point(pos[b], pos[d], vals[b], vals[d]);
        emit(ac, ad, bd, pos[a]); emit(ac, bd, bc, pos[a]);
      }
      if (triangles > maxTriangles) { truncated = true; break; }
    }
  }
  return { positions: Float32Array.from(out), triangles, truncated };
}

/** The volume enclosed by a closed triangle soup (divergence theorem; Å^3): a check that a surface is what it claims to be. Positive when the triangles face outward. */
export function enclosedVolume(positions) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [positions[i], positions[i + 1], positions[i + 2], positions[i + 3], positions[i + 4], positions[i + 5], positions[i + 6], positions[i + 7], positions[i + 8]];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}
/** Surface area of a triangle soup (Å^2). */
export function surfaceArea(positions) {
  let area = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2], vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}
