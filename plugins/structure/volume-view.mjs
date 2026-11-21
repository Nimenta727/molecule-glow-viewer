import { isosurface, suggestLevel, downsample, factorFor } from './density-map.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from './representation.mjs';

/**
 * A density map as something the viewport can draw (docs/PLUGIN_ROADMAP.md, B2): an isosurface and orthogonal slices as triangle meshes in the viewport's units, placed in the same frame as the
 * structure (`frame.center` is the point of the structure's own coordinates, in Å, that sits at the viewport origin; the Viewer passes the centre of the structure it shows, or the map's centre when
 * there is none). Pure: the viewport gets `{ pos: Float32Array xyz, idx: Uint32Array, colors?: Float32Array rgb }`, the form its overlay mesh already takes.
 */
const SCALE = PRESENTATION_METERS_PER_ANGSTROM;
export const mapCentre = (map) => map.dims.map((n, i) => map.origin[i] + (n - 1) / 2 * map.voxelSize[i]);
const toRoot = (positions, centre) => { const out = new Float32Array(positions.length); for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = (positions[i + k] - centre[k]) * SCALE; return out; };
const sequence = (n) => { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; return idx; };

/**
 * The surface at `level` (a number, or 'auto' for mean + 3 sigma, said to be a heuristic in the result), after reducing the map so that it stays under `maxVoxels` and the mesh under
 * `maxTriangles`. Returns { mesh: { pos, idx }, level, auto, factor, triangles, truncated, note } where `note` says plainly what was reduced.
 */
export function volumeSurface(map, { level = 'auto', maxVoxels = 8 * 1024 * 1024, maxTriangles = 1_500_000, frame } = {}) {
  const auto = level === 'auto', factor = factorFor(map.dims, maxVoxels), work = factor > 1 ? downsample(map, factor) : map, chosen = auto ? suggestLevel(work) : level;
  if (!Number.isFinite(chosen)) throw new TypeError('level must be a number or "auto"');
  const surface = isosurface(work, chosen, { maxTriangles }), centre = frame?.center ?? mapCentre(map);
  const notes = [];
  if (factor > 1) notes.push(`体积太大，已降采样 ${factor} 倍再取等值面（体素 ${work.voxelSize.map((v) => v.toFixed(2)).join(' × ')} Å）`);
  if (surface.truncated) notes.push(`等值面超过 ${maxTriangles} 个三角形，已截断：画面不完整，请提高阈值或降采样`);
  if (auto) notes.push('阈值是均值 + 3 倍均方根的启发式起点，不是沉积者推荐的值，请按需要调整');
  if (!surface.triangles) notes.push('这个阈值下没有等值面（高于最大值或低于最小值）');
  return { mesh: { pos: toRoot(surface.positions, centre), idx: sequence(surface.positions.length / 3) }, level: chosen, auto, factor, triangles: surface.triangles, truncated: surface.truncated, note: notes.join('；') };
}

/** Grey ramp, dark to light, for slices: value -> rgb 0-1 between `lo` and `hi`. */
export const grey = (value, lo, hi) => { const t = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0; return [0.08 + 0.87 * t, 0.08 + 0.87 * t, 0.1 + 0.85 * t]; };

/**
 * One orthogonal slice as a coloured mesh (two triangles per voxel, a grey ramp between `lo` and `hi`, by default the 1st and 99th percentile of the slice so that one bright voxel does not flatten it).
 * `axis` 0, 1, 2 is x, y, z; `index` the voxel layer (0 to n - 1). Returns { mesh: { pos, idx, colors }, lo, hi, layer, of }.
 */
export function volumeSlice(map, axis, index, { lo, hi, frame } = {}) {
  if (![0, 1, 2].includes(axis)) throw new RangeError('axis must be 0, 1 or 2');
  const n = map.dims[axis]; if (!Number.isInteger(index) || index < 0 || index >= n) throw new RangeError(`slice index must be 0..${n - 1}`);
  const [a, b] = [0, 1, 2].filter((k) => k !== axis), [na, nb] = [map.dims[a], map.dims[b]], at = (i, j) => { const v = [0, 0, 0]; v[axis] = index; v[a] = i; v[b] = j; return map.data[v[0] + map.dims[0] * (v[1] + map.dims[1] * v[2])]; };
  const values = new Float32Array(na * nb); for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) values[i + na * j] = at(i, j);
  const sorted = Float32Array.from(values).sort(), percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const low = lo ?? percentile(0.01), high = hi ?? percentile(0.99), centre = frame?.center ?? mapCentre(map);
  const pos = new Float32Array(na * nb * 6 * 3), colors = new Float32Array(na * nb * 6 * 3); let p = 0;
  const corner = (i, j) => { const v = [0, 0, 0]; v[axis] = map.origin[axis] + index * map.voxelSize[axis]; v[a] = map.origin[a] + i * map.voxelSize[a]; v[b] = map.origin[b] + j * map.voxelSize[b]; return v; };
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    // a voxel is a square half a voxel to each side of its centre
    const h = 0.5, quad = [[i - h, j - h], [i + h, j - h], [i + h, j + h], [i - h, j + h]].map(([x, y]) => corner(x, y)), c = grey(values[i + na * j], low, high);
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.set(quad[k], p); colors.set(c, p); p += 3; }
  }
  return { mesh: { pos: toRoot(pos, centre), idx: sequence(pos.length / 3), colors }, lo: low, hi: high, layer: index, of: n };
}
