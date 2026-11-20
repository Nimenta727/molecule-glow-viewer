/**
 * Macromolecular crowding (classic: buildCrowd in src/repr/crowding.js): fill a box of cytoplasm with coarse rigid copies of real structures so a scene reads as the
 * inside of a cell. Pure placement: no rendering and no downloads; the caller supplies the coarse shapes and the atoms to keep clear, and a random source.
 *
 *   spec = { box: { min: [x,y,z], max: [x,y,z] }, keepSide?: { n: [x,y,z], d } (only points with n·p > d, the half behind a cut plane), keepFn?(p) (any other volume; its size is
 *            estimated by Monte Carlo), phi (target protein volume fraction), cellVol (Å³ of a whole cell: E. coli cytoplasm about 7e11), cell (grid size, 8 Å), maxFill (3000),
 *            clear: [[x,y,z]...] (atoms of the scene to avoid), occPts (more points to avoid),
 *            types: [{ id, label, perCell, fill?, shape: { pts (centred coarse points), r, vol }, keep?(p) }] }
 * The number of copies of a type is perCell * (volume drawn) / cellVol (its abundance per cell); `fill` types then top the box up to `phi` (they stand for the thousands of
 * other proteins). Copies are placed biggest first by random tries, each tested point by point against an 8 Å occupancy grid of the scene and of what is already placed.
 * The random draws and the arithmetic follow the classic, so the same stream gives the same crowd.
 */
const GRID_OFFSET = 2048;

/** A coarse rigid shape of a structure's points (classic: every k-th CA / P, centred; blob radius grown so the volume is kept). */
export function coarseShape(points, { ptsPer, maxPts } = {}) {
  const n = points.length, c = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v * (1 / n));
  const np = ptsPer ? Math.min(maxPts || 40, Math.max(6, Math.round(n / ptsPer))) : 300, k = Math.max(1, Math.ceil(n / np));
  const pts = points.filter((_, i) => i % k === 0).map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  return { pts, n, r: 3.3 * Math.cbrt(k) * 1.12, R: Math.max(...pts.map((p) => Math.hypot(...p))), vol: n * 135 };
}

/** The quaternion of the Euler angles (x, y, z) applied in XYZ order, as [x, y, z, w] (three.js's formula). */
export function eulerQuaternion(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
/** Rotate a point by a quaternion [x, y, z, w]. */
export function rotate(p, [qx, qy, qz, qw]) {
  const [x, y, z] = p, ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/**
 * Places the crowd. `random` is the scenery stream (classic randVis). Returns { bodies: [{ type, center, quaternion, home, phase }], types: [{ ...type, expect, placed }],
 * boxVolume, scale, phi }.
 */
export function placeCrowd(spec, random) {
  const { min, max } = spec.box, size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]], cell = spec.cell || 8, floor = Math.floor;
  const keep = (p) => (!spec.keepSide || spec.keepSide.n[0] * p[0] + spec.keepSide.n[1] * p[1] + spec.keepSide.n[2] * p[2] > spec.keepSide.d) && (!spec.keepFn || spec.keepFn(p));
  let boxVol = size[0] * size[1] * size[2] * (spec.keepSide ? 0.5 : 1);   // only the half behind the cut is filled
  if (spec.keepFn) { let h = 0; for (let i = 0; i < 6000; i++) if (keep([min[0] + random() * size[0], min[1] + random() * size[1], min[2] + random() * size[2]])) h++; boxVol = size[0] * size[1] * size[2] * h / 6000; }
  const occ = new Set(), K = (x, y, z) => ((floor(x / cell) + GRID_OFFSET) * 4096 + floor(y / cell) + GRID_OFFSET) * 4096 + floor(z / cell) + GRID_OFFSET;
  for (const p of spec.clear || []) occ.add(K(p[0], p[1], p[2]));
  for (const p of spec.occPts || []) occ.add(K(p[0], p[1], p[2]));
  const free = (p) => { const x = floor(p[0] / cell) + GRID_OFFSET, y = floor(p[1] / cell) + GRID_OFFSET, z = floor(p[2] / cell) + GRID_OFFSET;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (occ.has(((x + dx) * 4096 + y + dy) * 4096 + z + dz)) return false; return true; };
  const S = spec.types.map((t) => ({ ...t, ...t.shape })), cellVol = spec.cellVol || 7e11;
  if (!S.length) return { bodies: [], types: [], boxVolume: boxVol, scale: boxVol / cellVol, phi: 0 };
  // how many copies: abundance first, then fill types up to the target volume fraction
  const want = S.map((s) => Math.round((s.perCell || 0) * boxVol / cellVol));
  S.forEach((s, i) => { s.expect = want[i]; });
  let vol = S.reduce((a, s, i) => a + want[i] * s.vol, 0); const fillers = S.map((_, i) => i).filter((i) => S[i].fill);
  for (let g = 0; vol < (spec.phi || 0.15) * boxVol && fillers.length && g < (spec.maxFill || 3000); g++) { const i = fillers[g % fillers.length]; want[i]++; vol += S[i].vol; }
  // place: biggest first (ribosomes before small enzymes)
  const order = S.map((_, i) => i).sort((a, b) => S[b].vol - S[a].vol), bodies = [];
  for (const i of order) {
    const s = S[i]; let placed = 0;
    for (let tries = 0; placed < want[i] && tries < want[i] * 40; tries++) {
      const c = [min[0] + random() * size[0], min[1] + random() * size[1], min[2] + random() * size[2]];
      if (!keep(c) || (s.keep && !s.keep(c))) continue;
      const q = eulerQuaternion(random() * 6.3, random() * 6.3, random() * 6.3);
      let ok = true;
      for (const p of s.pts) { const r = rotate(p, q), w = [r[0] + c[0], r[1] + c[1], r[2] + c[2]]; if (!free(w) || w[1] > max[1] + 10) { ok = false; break; } }
      if (!ok) continue;
      for (const p of s.pts) { const r = rotate(p, q); occ.add(K(r[0] + c[0], r[1] + c[1], r[2] + c[2])); }
      bodies.push({ type: i, center: c, quaternion: q, home: c.slice(), phase: random() * 100 }); placed++;
    }
    s.placed = placed;
  }
  const volume = S.reduce((a, s) => a + (s.placed ?? 0) * s.vol, 0);
  return { bodies, types: S, boxVolume: boxVol, scale: boxVol / cellVol, phi: volume / boxVol };
}

/** Where the blobs of one placed copy are at time `t` (a slow Brownian-like drift of at most about 1.6 Å in each direction): [[x, y, z]...]. */
export function bodyBlobs(body, shape, t) {
  const d = [Math.sin(t * 0.21 + body.phase), Math.sin(t * 0.17 + body.phase * 1.3), Math.sin(t * 0.19 + body.phase * 0.7)].map((v, k) => v * 1.6 + body.home[k]);
  return shape.pts.map((p) => { const r = rotate(p, body.quaternion); return [r[0] + d[0], r[1] + d[1], r[2] + d[2]]; });
}
