import { mulberry32 } from '../motion/particles.mjs';

/**
 * Lipid bilayers as geometry (docs/PLUGIN_ROADMAP.md, B3): the shape of a membrane, its two leaflets as triangle meshes, and points on it with their normals, so that proteins can be embedded
 * (C2) and a cell content can be placed against it (C3). Lengths are Å. Pure: nothing here draws; the Viewer turns the meshes into overlay meshes.
 *
 * Shapes: 'plane' ({ width, height }, in the xy plane, normal +z), 'sphere' ({ radius }: a vesicle), 'capsule' ({ radius, length }: a rod with hemispherical ends, along z, the shape of a bacterial cell
 * envelope) and 'ellipsoid' ({ a, b, c }). The "mid-surface" is the middle of the bilayer; the outer leaflet is `thickness / 2` out along the normal, the inner `thickness / 2` in. The normal
 * points away from the inside (for the plane, up).
 *
 * `thickness` defaults to 40 Å for the whole bilayer, a round number for a phospholipid bilayer that the author has not checked against a source; set it from your own reference.
 */
export const DEFAULT_THICKNESS = 40;

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** A parametrised mid-surface: { point(u, v), normal(u, v), area } with u, v in [0, 1]. */
export function midSurface(shape) {
  switch (shape.kind) {
    case 'plane': {
      const { width, height } = shape; if (!(width > 0 && height > 0)) throw new RangeError('plane needs width and height');
      return { kind: 'plane', area: width * height, point: (u, v) => [(u - 0.5) * width, (v - 0.5) * height, 0], normal: () => [0, 0, 1] };
    }
    case 'sphere': {
      const { radius } = shape; if (!(radius > 0)) throw new RangeError('sphere needs a radius');
      const dir = (u, v) => { const phi = 2 * Math.PI * u, z = 1 - 2 * v, r = Math.sqrt(Math.max(0, 1 - z * z)); return [r * Math.cos(phi), r * Math.sin(phi), z]; };   // area-uniform in (u, v)
      return { kind: 'sphere', area: 4 * Math.PI * radius * radius, point: (u, v) => dir(u, v).map((x) => x * radius), normal: (u, v) => dir(u, v) };
    }
    case 'capsule': {
      const { radius, length } = shape; if (!(radius > 0) || !(length >= 0)) throw new RangeError('capsule needs a radius and a length');
      const side = 2 * Math.PI * radius * length, ends = 4 * Math.PI * radius * radius, area = side + ends, cut = side / area;   // v up to `cut` is the cylinder, the rest the two caps
      const pick = (u, v) => {
        const phi = 2 * Math.PI * u;
        if (v < cut) { const z = (v / cut - 0.5) * length; return { p: [radius * Math.cos(phi), radius * Math.sin(phi), z], n: [Math.cos(phi), Math.sin(phi), 0] }; }
        const w = (v - cut) / (1 - cut), top = w >= 0.5, t = top ? (w - 0.5) * 2 : w * 2, zz = top ? 1 - t : -(1 - t), r = Math.sqrt(Math.max(0, 1 - zz * zz)), n = [r * Math.cos(phi), r * Math.sin(phi), zz];
        return { p: [n[0] * radius, n[1] * radius, n[2] * radius + (top ? length / 2 : -length / 2)], n };
      };
      return { kind: 'capsule', area, point: (u, v) => pick(u, v).p, normal: (u, v) => pick(u, v).n };
    }
    case 'ellipsoid': {
      const { a, b, c } = shape; if (!(a > 0 && b > 0 && c > 0)) throw new RangeError('ellipsoid needs a, b and c');
      const dir = (u, v) => { const phi = 2 * Math.PI * u, z = 1 - 2 * v, r = Math.sqrt(Math.max(0, 1 - z * z)); return [r * Math.cos(phi), r * Math.sin(phi), z]; };
      // Knud Thomsen's approximation of the area (relative error under 1.1 %)
      const p = 1.6075, area = 4 * Math.PI * ((((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p));
      return { kind: 'ellipsoid', area, point: (u, v) => { const d = dir(u, v); return [d[0] * a, d[1] * b, d[2] * c]; }, normal: (u, v) => { const d = dir(u, v); return norm([d[0] / a, d[1] / b, d[2] / c]); } };
    }
    default: throw new RangeError(`unknown membrane shape "${shape.kind}"`);
  }
}

/**
 * The membrane as meshes: { outer, inner, surface } where outer and inner are leaflet meshes ({ pos: Float32Array xyz, idx: Uint32Array }) and `surface` is the parametrised mid-surface.
 * `resolution` is the number of quads along u and v (default 48, so about 4600 triangles a leaflet).
 */
export function buildMembrane(shape, { thickness = DEFAULT_THICKNESS, resolution = 48 } = {}) {
  if (!(thickness > 0)) throw new RangeError('thickness must be positive');
  const surface = midSurface(shape), n = Math.max(4, Math.min(256, Math.round(resolution)));
  const leaflet = (offset) => {
    const pos = new Float32Array((n + 1) * (n + 1) * 3), idx = new Uint32Array(n * n * 6);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const u = i / n, v = j / n, p = add(surface.point(u, v), surface.normal(u, v), offset); pos.set(p, 3 * (i + (n + 1) * j));
    }
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = i + (n + 1) * j, b = a + 1, c = a + (n + 1), d = c + 1; idx.set([a, b, d, a, d, c], k); k += 6; }
    return { pos, idx };
  };
  return { outer: leaflet(thickness / 2), inner: leaflet(-thickness / 2), surface, thickness };
}

/**
 * `count` points on the mid-surface with their outward normals, spread evenly by area and seeded: [{ position, normal }]. A blue-noise-like spacing (no two closer than `minDistance`, when given)
 * is made by rejection with a cap on the attempts; the result says how many were placed. Returns { points, placed, requested, minDistance, attempts }.
 */
export function sampleSurface(surface, count, { seed = 1, minDistance = 0, maxAttempts = 40 } = {}) {
  const random = mulberry32(seed >>> 0), points = [], cell = minDistance > 0 ? minDistance : 1, grid = new Map(), key = (p) => p.map((x) => Math.floor(x / cell)).join(',');
  let attempts = 0;
  while (points.length < count && attempts < count * maxAttempts) {
    attempts++;
    const u = random(), v = random(), position = surface.point(u, v), normal = surface.normal(u, v);
    if (minDistance > 0) {
      const [cx, cy, cz] = position.map((x) => Math.floor(x / cell)); let clash = false;
      for (let dx = -1; dx <= 1 && !clash; dx++) for (let dy = -1; dy <= 1 && !clash; dy++) for (let dz = -1; dz <= 1 && !clash; dz++) for (const q of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (Math.hypot(position[0] - q[0], position[1] - q[1], position[2] - q[2]) < minDistance) { clash = true; break; }
      if (clash) continue;
      const k = key(position); (grid.get(k) ?? grid.set(k, []).get(k)).push(position);
    }
    points.push({ position, normal });
  }
  return { points, placed: points.length, requested: count, minDistance, attempts };
}

/**
 * A rotation taking +z to `normal` (axis-angle, Rodrigues): the 3x3 matrix as rows. The identity for +z, a half turn about x for -z.
 */
export function rotationFromZ(normal) {
  const n = norm(normal), c = n[2];
  if (c > 1 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-12) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const axis = norm([-n[1], n[0], 0]), s = Math.sqrt(1 - c * c), t = 1 - c, [x, y, z] = axis;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}

/** Moves points (flat xyz, Å) by the rotation taking +z to `normal`, then by `offset`, then scales by `scale` (to viewport units); returns a new Float32Array. */
export function placePoints(positions, { normal = [0, 0, 1], offset = [0, 0, 0], scale = 1 } = {}) {
  const R = rotationFromZ(normal), out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) for (let r = 0; r < 3; r++) out[i + r] = (R[r][0] * positions[i] + R[r][1] * positions[i + 1] + R[r][2] * positions[i + 2] + offset[r]) * scale;
  return out;
}
