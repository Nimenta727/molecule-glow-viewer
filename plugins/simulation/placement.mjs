import { rotateVector } from '../structure/alignment.mjs';
import { sampleSurface } from '../structure/membrane-builder.mjs';
import { mulberry32 } from '../motion/particles.mjs';

/**
 * Placing copies (docs/PLUGIN_ROADMAP.md, C2 and C3). C2: a structure whose membrane placement is known (the steps `placeMembrane` returns: they bring the structure into a frame where the membrane
 * is the plane y = 0 with its normal along +y) is embedded in a membrane at a point and a normal, turned about that normal by a seeded angle. C3: a composition table (what is in the compartment and how
 * many of each) becomes placements: membrane components on the membrane surface, the rest at random free positions inside the volume, no two bodies overlapping, everything seeded. Lengths are Å.
 * Pure: the result is data (a transform per copy) that an instance set (B1) or a complex record (A3) can take. Nothing here says where anything really is in a cell; every placement
 * from here is "illustrative" unless the author supplies better.
 */
const identity = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const matmul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const apply = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

/** [x, y, z, w] -> 3x3 rows. */
export function matrixFromQuaternion([x, y, z, w]) {
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
/** 3x3 rows -> [x, y, z, w], w >= 0. */
export function quaternionFromMatrix(m) {
  const t = m[0][0] + m[1][1] + m[2][2]; let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4]; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s]; }
  const l = Math.hypot(...q); q = q.map((v) => v / l); return q[3] < 0 ? q.map((v) => -v) : q;
}
/** A rotation taking the vector `from` to `to` (shortest arc), 3x3 rows. */
function arc(from, to) {
  const a = norm(from), b = norm(to), c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c > 1 - 1e-12) return identity();
  if (c < -1 + 1e-12) { const perp = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], axis = norm([a[1] * perp[2] - a[2] * perp[1], a[2] * perp[0] - a[0] * perp[2], a[0] * perp[1] - a[1] * perp[0]]); return aboutAxis(axis, Math.PI); }
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], k = 1 / (1 + c);
  return [[1 - k * (v[1] * v[1] + v[2] * v[2]), k * v[0] * v[1] - v[2], k * v[0] * v[2] + v[1]], [k * v[0] * v[1] + v[2], 1 - k * (v[0] * v[0] + v[2] * v[2]), k * v[1] * v[2] - v[0]], [k * v[0] * v[2] - v[1], k * v[1] * v[2] + v[0], 1 - k * (v[0] * v[0] + v[1] * v[1])]];
}
function aboutAxis(axis, angle) { const [x, y, z] = norm(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c; return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]]; }

/** The rigid motion a list of placement steps ({ centre, q: [x,y,z,w] }: subtract the centre, then rotate) amounts to: { R (3x3), t } with x' = R x + t. */
export function rigidFromSteps(steps) {
  let R = identity(), t = [0, 0, 0];
  for (const { centre, q } of steps) { const S = matrixFromQuaternion(q), shifted = [t[0] - centre[0], t[1] - centre[1], t[2] - centre[2]]; R = matmul(S, R); t = apply(S, shifted); }
  return { R, t };
}

/**
 * C2. The transform that embeds a structure in a membrane: after the structure's own placement steps (membrane plane y = 0, normal +y), turn +y onto `normal`, spin about it by `spin` radians, and put
 * the membrane's mid-plane point at the origin of that frame on `point`. `depth` slides the structure along the normal (Å). Returns { position, rotation: [x, y, z, w], scale: [1, 1, 1] } in the frame
 * of the structure's own coordinates (x' = R x + position).
 */
export function embedTransform(steps, { point, normal, spin = 0, depth = 0 }) {
  const { R, t } = rigidFromSteps(steps), up = norm(normal), turn = matmul(aboutAxis(up, spin), arc([0, 1, 0], up)), total = matmul(turn, R), moved = apply(turn, t);
  return { position: moved.map((v, k) => v + point[k] + up[k] * depth), rotation: quaternionFromMatrix(total), scale: [1, 1, 1] };
}

/**
 * C2 on a surface: `count` copies of one structure embedded on the mid-surface of a membrane (membrane-builder `midSurface`), spread by area and kept `2 * radius` apart (the structure's
 * bounding radius, Å), with seeded spins. `inward: true` turns the structure to face the other way (its +y towards the inside). Returns { placements: [{ transform, point, normal }], placed, requested }.
 */
export function embedCopies({ steps, surface, count, radius, seed = 1, inward = false }) {
  const sample = sampleSurface(surface, count, { seed, minDistance: 2 * radius }), random = mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const placements = sample.points.map(({ position, normal }) => {
    const n = inward ? normal.map((v) => -v) : normal;
    return { point: position, normal: n, transform: embedTransform(steps, { point: position, normal: n, spin: random() * 2 * Math.PI }) };
  });
  return { placements, placed: placements.length, requested: count };
}

// ---- C3: composition ---------------------------------------------------------------------------------------------------------------------------------

/** Volume of a protein of `daltons`, in Å^3, at the usual average partial specific volume (0.73 cm^3/g, 1.21 Å^3 per Da). An estimate for crowding, not for any one protein. */
export const volumeFromMass = (daltons) => daltons * 1.21;
const sphereVolume = (r) => (4 / 3) * Math.PI * r ** 3;

/**
 * A region a cell content can fill: `contains(p)` and `bounds`, from a shape (sphere / capsule / ellipsoid / box) and an `inset` kept away from its wall (Å). `volume` is exact or Thomsen/analytic.
 */
export function volumeRegion(shape, { inset = 0 } = {}) {
  switch (shape.kind) {
    case 'sphere': { const r = shape.radius - inset; if (!(r > 0)) throw new RangeError('the inset leaves nothing'); return { bounds: [[-r, -r, -r], [r, r, r]], volume: sphereVolume(r), contains: (p) => Math.hypot(...p) <= r }; }
    case 'ellipsoid': { const { a, b, c } = shape, A = a - inset, B = b - inset, C = c - inset; if (!(A > 0 && B > 0 && C > 0)) throw new RangeError('the inset leaves nothing'); return { bounds: [[-A, -B, -C], [A, B, C]], volume: (4 / 3) * Math.PI * A * B * C, contains: (p) => (p[0] / A) ** 2 + (p[1] / B) ** 2 + (p[2] / C) ** 2 <= 1 }; }
    case 'capsule': { const r = shape.radius - inset, h = shape.length / 2; if (!(r > 0)) throw new RangeError('the inset leaves nothing'); return { bounds: [[-r, -r, -h - r], [r, r, h + r]], volume: Math.PI * r * r * shape.length + sphereVolume(r), contains: (p) => { const z = Math.max(-h, Math.min(h, p[2])); return Math.hypot(p[0], p[1], p[2] - z) <= r; } }; }
    case 'box': { const [x, y, z] = [shape.width / 2 - inset, shape.height / 2 - inset, shape.depth / 2 - inset]; if (!(x > 0 && y > 0 && z > 0)) throw new RangeError('the inset leaves nothing'); return { bounds: [[-x, -y, -z], [x, y, z]], volume: 8 * x * y * z, contains: (p) => Math.abs(p[0]) <= x && Math.abs(p[1]) <= y && Math.abs(p[2]) <= z }; }
    default: throw new RangeError(`unknown region shape "${shape.kind}"`);
  }
}

/**
 * C3: a composition becomes placements.
 *   region       volumeRegion(...) the soluble content fills
 *   membrane     optional { surface (membrane-builder midSurface), steps? } the membrane components sit on
 *   components   [{ id, name, copies, radius (bounding sphere, Å), where: 'volume' | 'membrane' | 'membrane-inward', steps? (C2 placement steps, for membrane components),
 *                   basis: 'measured' | 'estimated' | 'illustrative' (where the copy number comes from), volume? (Å^3 of one copy, for the occupancy report) }]
 * No two bodies overlap (their bounding spheres stay apart; a hash grid keeps it fast). Returns { placements: [{ component, position, transform }], report: [{ id, requested, placed, basis }], occupancy,
 * membraneCoverage (the membrane components' footprint over the membrane area), crowded: [ids that did not fit] }. `occupancy` counts soluble bodies only, by their own volume when given and
 * otherwise by their bounding sphere (an overestimate). Everything is seeded: the same inputs give the same placements.
 */
export function planComposition({ region, membrane, components, seed = 1, maxAttempts = 60 }) {
  const random = mulberry32(seed >>> 0), placed = [], cell = Math.max(1, ...components.map((c) => 2 * c.radius)), grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / cell));
  const fits = (p, radius) => { const [cx, cy, cz] = cellOf(p), reach = Math.ceil((2 * radius) / cell) + 1; for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) for (const q of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (Math.hypot(p[0] - q.p[0], p[1] - q.p[1], p[2] - q.p[2]) < radius + q.radius) return false; return true; };
  const keep = (p, radius) => { const k = cellOf(p).join(','); (grid.get(k) ?? grid.set(k, []).get(k)).push({ p, radius }); };
  const report = [], crowded = [], output = []; let usedVolume = 0, usedArea = 0;
  // the big bodies first, so that the small ones fill the gaps
  for (const component of components.slice().sort((a, b) => b.radius - a.radius)) {
    let n = 0;
    const onMembrane = component.where === 'membrane' || component.where === 'membrane-inward';
    if (onMembrane) {
      if (!membrane) throw new TypeError(`component ${component.id} sits on the membrane but no membrane was given`);
      const sample = sampleSurface(membrane.surface, component.copies * 3, { seed: (seed * 7919 + component.id.length) >>> 0 }), random2 = mulberry32((seed ^ 0xABCDEF) >>> 0);
      for (const { position, normal } of sample.points) {
        if (n >= component.copies) break;
        if (!fits(position, component.radius)) continue;
        keep(position, component.radius); n++;
        const facing = component.where === 'membrane-inward' ? normal.map((v) => -v) : normal;
        output.push({ component: component.id, position, normal: facing, transform: component.steps ? embedTransform(component.steps, { point: position, normal: facing, spin: random2() * 2 * Math.PI }) : { position, rotation: quaternionFromMatrix(arc([0, 0, 1], facing)), scale: [1, 1, 1] } });
      }
    } else {
      const [lo, hi] = region.bounds;
      for (let tries = 0; n < component.copies && tries < component.copies * maxAttempts; tries++) {
        const p = [lo[0] + random() * (hi[0] - lo[0]), lo[1] + random() * (hi[1] - lo[1]), lo[2] + random() * (hi[2] - lo[2])];
        if (!region.contains(p) || !fits(p, component.radius)) continue;
        keep(p, component.radius); n++;
        const u = random(), v = random(), w = random(), a = Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), b = Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v), c = Math.sqrt(u) * Math.sin(2 * Math.PI * w), d = Math.sqrt(u) * Math.cos(2 * Math.PI * w);
        output.push({ component: component.id, position: p, transform: { position: p, rotation: [a, b, c, d], scale: [1, 1, 1] } });   // a uniform random orientation
      }
    }
    if (onMembrane) usedArea += n * Math.PI * component.radius ** 2; else usedVolume += n * (component.volume ?? sphereVolume(component.radius));   // soluble bodies fill volume; membrane bodies cover area (their footprint)
    report.push({ id: component.id, requested: component.copies, placed: n, basis: component.basis ?? 'illustrative' });
    if (n < component.copies) crowded.push(component.id);
  }
  return { placements: output, report: components.map((c) => report.find((r) => r.id === c.id)), occupancy: usedVolume / region.volume, membraneCoverage: membrane ? usedArea / membrane.surface.area : 0, crowded };
}
