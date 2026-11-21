/**
 * Level of detail for many copies of one prototype (docs/PLUGIN_ROADMAP.md, B1). Pure: no three.js here, so it is tested in Node and the viewport only has to draw what it says.
 *
 * A prototype comes in several levels, most detailed first (the full representation, then coarse blobs, then one ellipsoid, then a tiny marker). For every instance the plan picks a level
 * from how big the instance looks on screen (its bounding sphere in pixels), drops instances outside the view, and then, if the frame would still cost more triangles than the budget,
 * demotes the instances that matter least (the smallest on screen) one level at a time until it fits. A previous plan can be passed so that an instance near a threshold does not flicker
 * between two levels (hysteresis).
 */

/** Pixels the bounding sphere of radius `radius` at `distance` covers across, for a vertical field of view `fov` (radians) and a viewport `height` in pixels. */
export const projectedRadiusPixels = (radius, distance, fov, height) => (radius / (Math.max(distance, 1e-9) * Math.tan(fov / 2))) * (height / 2);

/**
 * Default thresholds: `minPixels` is the on-screen radius from which a level is used. Below the last level's minimum the instance is not drawn at all.
 */
export const DEFAULT_THRESHOLDS = Object.freeze([60, 12, 3, 0.6]);

/**
 * planLevels — which level each instance is drawn at.
 *   centers      Float32Array/array of x,y,z per instance (3 numbers each), in the same units as the camera
 *   radii        a number (all instances alike) or an array/Float32Array of one radius per instance
 *   camera       { position: [x,y,z], direction: [x,y,z] (looking at), fov (vertical, radians), aspect, height (viewport pixels) }
 *   triangles    triangles per instance at each level, most detailed first (its length is the number of levels)
 *   thresholds   minimum on-screen radius (pixels) of each level, descending; default DEFAULT_THRESHOLDS (extended or cut to the number of levels)
 *   budget       optional triangle budget for the whole frame
 *   previous     optional Int8Array from an earlier plan (hysteresis, 15 %)
 * Returns { level: Int8Array (-1 = not drawn), counts: [n per level], culled, triangles, demoted, overBudget }.
 */
export function planLevels({ centers, radii, camera, triangles, thresholds, budget = Infinity, previous = null }) {
  const levels = triangles.length, n = Math.floor(centers.length / 3);
  if (!levels) throw new TypeError('planLevels needs at least one level');
  const limits = Array.from({ length: levels }, (_, i) => thresholds?.[i] ?? DEFAULT_THRESHOLDS[Math.min(i, DEFAULT_THRESHOLDS.length - 1)]);
  const { position, direction, fov, aspect, height } = camera;
  const dirLength = Math.hypot(...direction) || 1, view = direction.map((v) => v / dirLength);
  const halfV = fov / 2, halfH = Math.atan(Math.tan(halfV) * aspect), halfDiagonal = Math.hypot(halfV, halfH) * 1.02;   // a little generous: never cull what is at the edge
  const level = new Int8Array(n), pixels = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = centers[3 * i] - position[0], dy = centers[3 * i + 1] - position[1], dz = centers[3 * i + 2] - position[2], distance = Math.hypot(dx, dy, dz);
    const radius = typeof radii === 'number' ? radii : radii[i];
    if (distance > radius) {   // outside the bounding sphere: it may be behind the camera or outside the cone
      const cosine = (dx * view[0] + dy * view[1] + dz * view[2]) / distance, angle = Math.acos(Math.max(-1, Math.min(1, cosine))), spread = Math.asin(Math.min(1, radius / distance));
      if (angle - spread > halfDiagonal) { level[i] = -1; continue; }
    }
    const px = projectedRadiusPixels(radius, distance, fov, height); pixels[i] = px;
    let chosen = -1;
    for (let l = 0; l < levels; l++) if (px >= limits[l]) { chosen = l; break; }
    const before = previous && i < previous.length ? previous[i] : undefined;
    if (before !== undefined && before >= 0 && chosen >= 0 && before !== chosen) {
      if (before < chosen && px >= limits[before] * 0.85) chosen = before;          // was more detailed: stay until clearly below the threshold
      else if (before > chosen && px < limits[chosen] * 1.15) chosen = before;      // was coarser: move up only when clearly above the threshold
    }
    level[i] = chosen;
  }
  let demoted = 0, total = 0;
  const cost = (l) => (l < 0 ? 0 : triangles[l]);
  for (let i = 0; i < n; i++) total += cost(level[i]);
  if (total > budget) {
    // the instances that look smallest give up detail first; one level at a time, finest level first, so the cost falls as evenly as the budget allows
    for (let l = 0; l < levels - 1 && total > budget; l++) {
      const here = [];
      for (let i = 0; i < n; i++) if (level[i] === l) here.push(i);
      here.sort((a, b) => pixels[a] - pixels[b]);
      for (const i of here) {
        if (total <= budget) break;
        total -= triangles[l] - triangles[l + 1]; level[i] = l + 1; demoted++;
      }
    }
  }
  const counts = new Array(levels).fill(0); let culled = 0;
  for (let i = 0; i < n; i++) { if (level[i] < 0) culled++; else counts[level[i]]++; }
  return { level, counts, culled, triangles: total, demoted, overBudget: total > budget };
}

// ---- proxies: coarser stand-ins built from the prototype's own points ------------------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
const ICO_FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

/** Triangles (flat xyz, counter-clockwise outward) of a unit icosphere with `subdivisions` (0: 20 triangles, 1: 80, 2: 320). */
export function icosphereTriangles(subdivisions = 0) {
  let faces = ICO_FACES.map(([a, b, c]) => [ICO_VERTS[a], ICO_VERTS[b], ICO_VERTS[c]]);
  const mid = (p, q) => { const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], l = Math.hypot(...m); return m.map((x) => x / l); };
  for (let s = 0; s < subdivisions; s++) faces = faces.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  return Float32Array.from(faces.flat(2));
}
/** `unit` icosphere triangles scaled by `scale` ([sx, sy, sz] or one number) and moved to `center`, appended to `out` (a plain array). */
function pushSphere(out, unit, center, scale) {
  const [sx, sy, sz] = typeof scale === 'number' ? [scale, scale, scale] : scale;
  for (let i = 0; i < unit.length; i += 3) out.push(center[0] + unit[i] * sx, center[1] + unit[i + 1] * sy, center[2] + unit[i + 2] * sz);
}

/** Points (flat xyz) -> blobs on a grid of `cell`: [{ center, count }] for every occupied cell, in a deterministic order. */
export function gridBlobs(points, cell) {
  const cells = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const key = `${Math.floor(points[i] / cell)},${Math.floor(points[i + 1] / cell)},${Math.floor(points[i + 2] / cell)}`;
    let c = cells.get(key); if (!c) { c = { sum: [0, 0, 0], count: 0, key }; cells.set(key, c); }
    c.sum[0] += points[i]; c.sum[1] += points[i + 1]; c.sum[2] += points[i + 2]; c.count++;
  }
  return [...cells.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((c) => ({ center: c.sum.map((v) => v / c.count), count: c.count }));
}

/** Coarse stand-in made of one small icosphere per occupied grid cell (radius = `cell` * 0.75, so neighbouring blobs overlap and the outline stays closed). */
export function blobProxy(points, cell) {
  const out = [], unit = icosphereTriangles(0);
  for (const { center } of gridBlobs(points, cell)) pushSphere(out, unit, center, cell * 0.75);
  return Float32Array.from(out);
}

/** The principal axes of a point cloud (3x3 covariance, Jacobi rotations): { center, axes: [[x,y,z] x 3], extents: [half length along each axis] }. */
export function principalBox(points) {
  const n = Math.floor(points.length / 3); if (!n) throw new TypeError('principalBox needs points');
  const c = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += points[3 * i + k] / n;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) { const d = [points[3 * i] - c[0], points[3 * i + 1] - c[1], points[3 * i + 2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a][b] += d[a] * d[b] / n; }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0; for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) off += m[a][b] * m[a][b];
    if (off < 1e-18) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(m[p][q]) < 1e-30) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const a = m[k][p], b = m[k][q]; m[k][p] = cs * a - sn * b; m[k][q] = sn * a + cs * b; }
      for (let k = 0; k < 3; k++) { const a = m[p][k], b = m[q][k]; m[p][k] = cs * a - sn * b; m[q][k] = sn * a + cs * b; }
      for (let k = 0; k < 3; k++) { const a = v[k][p], b = v[k][q]; v[k][p] = cs * a - sn * b; v[k][q] = sn * a + cs * b; }
    }
  }
  const axes = [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]]), extents = axes.map((axis) => { let e = 0; for (let i = 0; i < n; i++) e = Math.max(e, Math.abs((points[3 * i] - c[0]) * axis[0] + (points[3 * i + 1] - c[1]) * axis[1] + (points[3 * i + 2] - c[2]) * axis[2])); return e; });
  return { center: c, axes, extents };
}

/** One ellipsoid along the principal axes of the points (an icosphere of `subdivisions`): the stand-in for an instance a few pixels across. */
export function ellipsoidProxy(points, subdivisions = 1) {
  const { center, axes, extents } = principalBox(points), unit = icosphereTriangles(subdivisions), out = new Float32Array(unit.length);
  for (let i = 0; i < unit.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = center[k] + axes[0][k] * unit[i] * extents[0] + axes[1][k] * unit[i + 1] * extents[1] + axes[2][k] * unit[i + 2] * extents[2];
  return out;
}

/** The marker for an instance of about a pixel: an octahedron (8 triangles) at the centroid with the points' mean distance as its radius. */
export function markerProxy(points) {
  const n = Math.floor(points.length / 3), c = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += points[3 * i + k] / n;
  let r = 0; for (let i = 0; i < n; i++) r += Math.hypot(points[3 * i] - c[0], points[3 * i + 1] - c[1], points[3 * i + 2] - c[2]) / n;
  const [x, y, z] = c, e = Math.max(r, 1e-9);
  const top = [x, y + e, z], bottom = [x, y - e, z], xs = [[x + e, y, z], [x, y, z + e], [x - e, y, z], [x, y, z - e]];
  const tri = []; for (let i = 0; i < 4; i++) { const a = xs[i], b = xs[(i + 1) % 4]; tri.push(...top, ...b, ...a, ...bottom, ...a, ...b); }
  return Float32Array.from(tri);
}

/**
 * The four levels of a prototype, from its full triangle soup (flat xyz) and the points that outline it: [full, blobs, ellipsoid, marker] with their triangle counts.
 * `cell` is the grid size of the blob level, in the prototype's units (about a tenth of its size is a good default, passed by the caller).
 */
export function buildLevels(full, outline, { cell }) {
  const geometries = [full, blobProxy(outline, cell), ellipsoidProxy(outline, 1), markerProxy(outline)];
  return { geometries, triangles: geometries.map((g) => g.length / 9) };
}

/**
 * Colours for a stand-in: every vertex of `soup` (flat xyz) takes the colour of the nearest of `points` (flat xyz, with `colors` flat rgb per point), so a coarse level still shows which part is which.
 * Uses a grid over the points, so it stays fast for tens of thousands of vertices.
 */
export function colorByNearest(soup, points, colors) {
  const n = Math.floor(points.length / 3), out = new Float32Array(soup.length);
  if (!n) return out;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], points[3 * i + k]); max[k] = Math.max(max[k], points[3 * i + k]); }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9), cell = span / Math.max(1, Math.round(Math.cbrt(n))), grid = new Map(), keyOf = (x, y, z) => `${Math.floor((x - min[0]) / cell)},${Math.floor((y - min[1]) / cell)},${Math.floor((z - min[2]) / cell)}`;
  for (let i = 0; i < n; i++) { const key = keyOf(points[3 * i], points[3 * i + 1], points[3 * i + 2]); (grid.get(key) ?? grid.set(key, []).get(key)).push(i); }
  for (let v = 0; v < soup.length; v += 3) {
    const x = soup[v], y = soup[v + 1], z = soup[v + 2], cx = Math.floor((x - min[0]) / cell), cy = Math.floor((y - min[1]) / cell), cz = Math.floor((z - min[2]) / cell);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring < 64 && best < 0; ring++) {   // widen the search until something is found, then take one more ring to be sure the nearest is among them
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
        for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { const d = (points[3 * i] - x) ** 2 + (points[3 * i + 1] - y) ** 2 + (points[3 * i + 2] - z) ** 2; if (d < bestD) { bestD = d; best = i; } }
      }
    }
    if (best < 0) { best = 0; }
    else { const reach = Math.ceil(Math.sqrt(bestD) / cell); for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { const d = (points[3 * i] - x) ** 2 + (points[3 * i + 1] - y) ** 2 + (points[3 * i + 2] - z) ** 2; if (d < bestD) { bestD = d; best = i; } } }
    out[v] = colors[3 * best]; out[v + 1] = colors[3 * best + 1]; out[v + 2] = colors[3 * best + 2];
  }
  return out;
}
