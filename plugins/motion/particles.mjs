/**
 * Particles, paths and flows (classic: src/sim/motion-kit.js). Pure logic, no rendering and no page: positions are plain [x, y, z] arrays, and every random
 * number comes from the `rng` the caller supplies ({ sim, vis } - the classic two streams: `sim` for what the simulation decides, `vis` for scenery only).
 * The same seed therefore replays the same particles, and the classic arithmetic is kept term by term so the two can be compared number for number.
 *
 * Three pieces:
 *  - occupancy: a spatial hash of the atoms, so a free molecule never drifts into protein (`busy`, `clearance`, `pushClear`);
 *  - brownPath: a Brownian bridge between two points that keeps clear of protein (a molecule diffusing to its site), plus the centripetal Catmull-Rom
 *    curve a particle then travels along;
 *  - ParticlePool: the free molecules of one kind in one region of bulk solution (take the nearest one for a reaction, give it back to the pool of the
 *    compartment where it ends up), and FlowStream: a stream of particles along fixed paths (the "fast" time scale).
 * Every particle carries a name. A pool or stream without one is refused when it is made, so there can be no unnamed moving particle.
 */

const FLOOR = Math.floor;
const lerp1 = (x, y, t) => (1 - t) * x + t * y;          // THREE.MathUtils.lerp
const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const dist = (a, b) => Math.sqrt(sq(a, b));

/** Gaussian from a uniform source (Box-Muller, the classic's form). */
export const gauss = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(6.283185 * random());

/** The two streams a particle system draws from. A single function is used for both. */
export function makeRng(rng) {
  if (typeof rng === 'function') return { sim: rng, vis: rng };
  if (rng && typeof rng.sim === 'function' && typeof rng.vis === 'function') return rng;
  throw new Error('随机数源必须是函数，或 { sim, vis } 两个函数（同一种子应得到同一段粒子历史）');
}

/** mulberry32, the generator the classic seed option uses. */
export function mulberry32(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The classic pair for one seed: `sim` from the seed, `vis` from the seed xor the golden-ratio constant. */
export function seededRng(seed) { return { sim: mulberry32(seed), vis: mulberry32(seed ^ 0x9E3779B9) }; }

/* ---------------- occupancy ---------------- */

/**
 * Spatial hash of atom positions, cell 5 Å. `clearance(p, R)` is the distance to the nearest atom closer than R (Infinity if none) and leaves the summed
 * direction away from those atoms in `push`; `busy(p, R)` is the early-exit yes/no used every frame; `pushClear` moves a point out of protein.
 */
export function createOccupancy(points, cell = 5) {
  const cells = new Map();
  const key = (x, y, z) => ((x + 4096) * 8192 + y + 4096) * 8192 + z + 4096;
  for (const p of points) { const k = key(FLOOR(p[0] / cell), FLOOR(p[1] / cell), FLOOR(p[2] / cell)); let list = cells.get(k); if (!list) cells.set(k, list = []); list.push(p); }
  const push = [0, 0, 0];
  const clearance = (p, R) => {
    const r = Math.ceil(R / cell), x0 = FLOOR(p[0] / cell), y0 = FLOOR(p[1] / cell), z0 = FLOOR(p[2] / cell), R2 = R * R;
    let best = R2; push[0] = push[1] = push[2] = 0;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const list = cells.get(key(x0 + dx, y0 + dy, z0 + dz)); if (!list) continue;
      for (const q of list) {
        const ex = p[0] - q[0], ey = p[1] - q[1], ez = p[2] - q[2], d2 = ex * ex + ey * ey + ez * ez; if (d2 >= R2) continue;
        if (d2 < best) best = d2;
        const d = Math.sqrt(d2) + 1e-3, w = (R - d) / d; push[0] += ex * w; push[1] += ey * w; push[2] += ez * w;
      }
    }
    return best < R2 ? Math.sqrt(best) : Infinity;
  };
  const busy = (p, R) => {
    const r = Math.ceil(R / cell), x0 = FLOOR(p[0] / cell), y0 = FLOOR(p[1] / cell), z0 = FLOOR(p[2] / cell), R2 = R * R;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const list = cells.get(key(x0 + dx, y0 + dy, z0 + dz)); if (!list) continue;
      for (const q of list) { const ex = p[0] - q[0], ey = p[1] - q[1], ez = p[2] - q[2]; if (ex * ex + ey * ey + ez * ez < R2) return true; }
    }
    return false;
  };
  /** Push `p` (in place) away from atoms until it is at least R away, up to `it` tries. Needs the simulation stream for the rare "dead centre" case. */
  const pushClear = (p, R, random, it = 6) => {
    for (let i = 0; i < it; i++) {
      const d = clearance(p, R); if (d >= R) return true;
      if (push[0] * push[0] + push[1] * push[1] + push[2] * push[2] < 1e-8) { push[0] = gauss(random); push[1] = gauss(random); push[2] = gauss(random); }
      const inv = 1 / (Math.hypot(push[0], push[1], push[2]) || 1), step = Math.min(R - d + 0.6, 4);
      p[0] += push[0] * inv * step; p[1] += push[1] * inv * step; p[2] += push[2] * inv * step;
    }
    return clearance(p, R) >= R * 0.8;
  };
  return { clearance, busy, pushClear, push, size: points.length };
}

/** An occupancy that never blocks anything (no structure loaded). */
export const openSpace = { clearance: () => Infinity, busy: () => false, pushClear: () => true, push: [0, 0, 0], size: 0 };

/* ---------------- Brownian bridge ---------------- */

/**
 * A Brownian bridge from A to B: a random walk pinned at both ends, smoothed, then pushed out of protein (except within `free0` of A and `free1` of B, where
 * the molecule binds to / leaves its site). `keep(p)` may project a point into a compartment. Options: n (22 points), wander (0.3), clear (8.5 Å: the atom list
 * holds one atom per residue, so about 8 Å clears the residue blobs), free0 (0), free1 (9), keep.
 */
export function brownPath(A, B, options = {}, { rng, occupancy = openSpace } = {}) {
  const random = makeRng(rng).sim, n = options.n || 22, L = Math.max(1, dist(A, B)), sig = (options.wander ?? 0.3) * L / Math.sqrt(n), R = options.clear ?? 8.5;
  const W = [[0, 0, 0]];
  for (let i = 1; i <= n; i++) { const g = [gauss(random), gauss(random), gauss(random)], w = W[i - 1]; W.push([w[0] + g[0] * sig, w[1] + g[1] * sig, w[2] + g[2] * sig]); }
  const P = W.map((w, i) => { const t = i / n; return [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * t + w[k] + W[n][k] * -t); });
  for (let s = 0; s < 2; s++) for (let i = 1; i < n; i++) for (let k = 0; k < 3; k++) P[i][k] += ((P[i - 1][k] + P[i + 1][k]) * 0.5 - P[i][k]) * 0.35;
  for (let s = 0; s < 2; s++) for (let i = 1; i < n; i++) {
    if (dist(P[i], B) < (options.free1 ?? 9) || dist(P[i], A) < (options.free0 ?? 0)) continue;
    options.keep?.(P[i]); if (R > 0) occupancy.pushClear(P[i], R, random); options.keep?.(P[i]);
  }
  return P;
}

/* ---------------- curves ---------------- */

/** Centripetal Catmull-Rom through points (THREE.CatmullRomCurve3, 'centripetal'): `point(t)` for t in [0, 1], `length()` by 200 chord segments. */
export function catmullRom(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('路径至少需要两个点');
  const l = points.length;
  const calc = (x0, x1, x2, x3, d0, d1, d2, t) => {
    let t1 = (x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1, t2 = (x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2;
    t1 *= d1; t2 *= d1;
    return x1 + t1 * t + (-3 * x1 + 3 * x2 - 2 * t1 - t2) * t * t + (2 * x1 - 2 * x2 + t1 + t2) * t * t * t;
  };
  const point = (t, out = [0, 0, 0]) => {
    const p = (l - 1) * t; let i = FLOOR(p), w = p - i;
    if (w === 0 && i === l - 1) { i = l - 2; w = 1; }
    const p1 = points[i % l], p2 = points[(i + 1) % l];
    const p0 = i > 0 ? points[(i - 1) % l] : [0, 1, 2].map((k) => points[0][k] - points[1][k] + points[0][k]);
    const p3 = i + 2 >= l ? [0, 1, 2].map((k) => points[l - 1][k] - points[l - 2][k] + points[l - 1][k]) : points[(i + 2) % l];
    let d0 = sq(p0, p1) ** 0.25, d1 = sq(p1, p2) ** 0.25, d2 = sq(p2, p3) ** 0.25;
    if (d1 < 1e-4) d1 = 1; if (d0 < 1e-4) d0 = d1; if (d2 < 1e-4) d2 = d1;
    for (let k = 0; k < 3; k++) out[k] = calc(p0[k], p1[k], p2[k], p3[k], d0, d1, d2, w);
    return out;
  };
  let cached = null;
  const length = () => {
    if (cached == null) { let sum = 0, last = point(0); for (let i = 1; i <= 200; i++) { const cur = point(i / 200); sum += dist(cur, last); last = cur; } cached = sum; }
    return cached;
  };
  return { point, length };
}

/* ---------------- regions of bulk solution ---------------- */

/**
 * A cell-simulation compartment: `u` along B.d, `v` along B.n, `y0 < y < y1`. B = { c, d, n, ulo, uhi, vlo, vhi, ym } with c / d / n as [x, y, z].
 * `inside(p)`, `depth(p)` (how far from the nearest wall, larger = deeper) and `sample(edge)` (a free spot, optionally on a face, or null).
 */
export function boxRegion(B, y0, y1, { rng, occupancy = openSpace }) {
  const vis = makeRng(rng).vis;
  const at = (u, v, y) => [B.c[0] + B.d[0] * u + B.n[0] * v, y + B.d[1] * u + B.n[1] * v, B.c[2] + B.d[2] * u + B.n[2] * v];
  const uv = (p) => { const x = p[0] - B.c[0], z = p[2] - B.c[2]; return [x * B.d[0] + z * B.d[2], x * B.n[0] + z * B.n[2]]; };
  const far = y1 > y0 && Math.abs(y1 - (B.ym ?? 0)) > Math.abs(y0 - (B.ym ?? 0)) ? 1 : -1;
  return {
    inside(p) { const [u, v] = uv(p); return u > B.ulo && u < B.uhi && v > B.vlo && v < B.vhi && p[1] > y0 + 2 && p[1] < y1 - 2; },
    depth(p) { const [u, v] = uv(p); return Math.min(u - B.ulo, B.uhi - u, v - B.vlo, B.vhi - v, far > 0 ? y1 - p[1] : p[1] - y0); },
    sample(edge) {
      for (let k = 0; k < 40; k++) {
        let u = lerp1(B.ulo + 3, B.uhi - 3, vis()), v = lerp1(B.vlo + 3, B.vhi - 3, vis()), y = y0 + 4 + vis() * (y1 - y0 - 8);
        if (edge) { const f = FLOOR(vis() * 5); if (f === 0) u = B.ulo + 4; else if (f === 1) u = B.uhi - 4; else if (f === 2) v = B.vlo + 4; else if (f === 3) v = B.vhi - 4; else y = far > 0 ? y1 - 5 : y0 + 5; }
        const p = at(u, v, y); if (!occupancy.busy(p, 6)) return p;
      }
      return null;
    },
  };
}

/** A shell r0 < distance < r1 around a point (a machine), limited to one compartment by `ok(p)`. */
export function shellRegion(c, r0, r1, ok, { rng, occupancy = openSpace }) {
  const vis = makeRng(rng).vis, inside = ok || (() => true);
  return {
    inside(p) { const d = dist(p, c); return d > r0 && d < r1 && inside(p); },
    depth(p) { return r1 - dist(p, c); },
    sample(edge) {
      for (let k = 0; k < 60; k++) {
        const g = [gauss(vis), gauss(vis), gauss(vis)], inv = 1 / (Math.hypot(...g) || 1), r = edge ? r1 - 4 : lerp1(r0 + 4, r1 - 4, Math.cbrt(vis()));
        const p = [c[0] + g[0] * inv * r, c[1] + g[1] * inv * r, c[2] + g[2] * inv * r];
        if (inside(p) && !occupancy.busy(p, 6)) return p;
      }
      return null;
    },
  };
}

/* ---------------- species ---------------- */

/** The standard little molecules: one look everywhere (colour, radius in Å). */
export const SPECIES = {
  'H⁺': { col: 0xfff27a, r: 2.2 }, 'e⁻': { col: 0x6ff4ff, r: 2.6 }, 'K⁺': { col: 0xb98cff, r: 2.0 }, 'Na⁺': { col: 0x4fc3f7, r: 1.7 },
  'O₂': { col: 0x7ab8ff, r: 3.2 }, 'H₂O': { col: 0xdfe8f5, r: 2.4 }, 'NADH': { col: 0xff6fa8, r: 3.6 }, 'NAD⁺': { col: 0xffb3cf, r: 3.4 },
  'NADPH': { col: 0xff6fa8, r: 3.6 }, 'NADP⁺': { col: 0xffb3cf, r: 3.4 }, 'ATP': { col: 0xff9a2e, r: 3.4 }, 'ADP': { col: 0x46c8ff, r: 3.2 },
  'Pi': { col: 0xc9a2ff, r: 2.4 }, 'PQH₂': { col: 0xffe08a, r: 3.4 }, 'QH₂': { col: 0xffe08a, r: 3.4 }, '光子 hν': { col: 0xff5a5a, r: 2.2 },
  '激发能': { col: 0x9dff6a, r: 2.2 }, 'CO₂': { col: 0xb0b8c8, r: 2.6 },
};
/** Look of a species: a work's own definition first, then the standard table, then a neutral default. */
export const speciesOf = (name, custom = {}) => custom[name] || SPECIES[name] || { col: 0xffffff, r: 2.4 };

/* ---------------- pool ---------------- */

let nextId = 1;
const makeName = (spec) => {
  const name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim() : typeof spec.label === 'string' && spec.label.trim() ? spec.label.trim() : null;
  if (!name) throw new Error('粒子必须有名字（name 或 label），不允许出现未命名的运动粒子');
  return name;
};

/**
 * The free molecules of one kind in one region. Items: { id, name, position, velocity, mode ('free' | 'in' | 'out'), alpha, rotation, labelled }. They diffuse
 * (damped random kicks), bounce off the region walls and protein, fade in as they drift in from the edge, fade out as the surplus leaves, and keep the count
 * near `n` (which a model may change at any time).
 * spec: { name | label, col, r, region, n, clear (7.5 Å), kick (16), maxTags (2), tumble }. `occupancy` and `rng` are shared by the whole scene.
 */
export class ParticlePool {
  constructor(spec, { rng, occupancy = openSpace }) {
    if (!spec.region || typeof spec.region.sample !== 'function') throw new Error(`粒子池“${spec.name || spec.label || '?'}”缺少区域`);
    Object.assign(this, { n: 0, clear: 7.5, kick: 16, maxTags: 2, tumble: false }, spec, { items: [] });
    this.name = makeName(spec); this.random = makeRng(rng); this.occupancy = occupancy;
  }
  add(position, mode, alpha) {
    const item = { id: nextId++, name: this.name, position: position.slice(), velocity: [0, 0, 0], mode, alpha, rotation: [0, 0, 0], labelled: false };
    if (this.tumble) item.rotation = [this.random.vis() * 6, this.random.vis() * 6, 0];
    this.items.push(item); this.retag(); return item;
  }
  fill() { for (let i = 0; i < Math.round(this.n); i++) { const p = this.region.sample(false); if (p) this.add(p, 'free', 1); } }
  /** At most `maxTags` of the particles in the bulk show a name tag at one time. */
  retag() { let k = 0; for (const it of this.items) it.labelled = it.mode !== 'out' && k++ < this.maxTags; }
  /** The free particle nearest `near` goes to work (leaves the pool); none free: one drifts in from the edge of the bulk. */
  take(near) {
    let best = null, bd = Infinity;
    for (const it of this.items) if (it.mode === 'free' || it.mode === 'in') { const d = sq(it.position, near); if (d < bd) { bd = d; best = it; } }
    if (!best) best = this.add(this.region.sample(true) || near.slice(), 'in', 0.05);
    this.items = this.items.filter((x) => x !== best); this.retag(); best.labelled = true; return best;
  }
  /** A particle that finished its job joins this pool (the compartment it ended up in). */
  give(item) { item.alpha = 1; item.mode = 'free'; item.velocity = [0, 0, 0]; this.items.push(item); this.retag(); }
  update(dt) {
    const R = this.region, sim = this.random.sim, live = this.items.filter((i) => i.mode !== 'out').length, want = Math.round(this.n);
    if (live < want && sim() < dt * 6) { const p = R.sample(true); if (p) this.add(p, 'in', 0); }
    if (live > want && sim() < dt * 6) {
      let w = null; for (const it of this.items) if (it.mode === 'free' && (!w || R.depth(it.position) < R.depth(w.position))) w = it;
      if (w) { w.mode = 'out'; this.retag(); }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], p = it.position, v = it.velocity, damp = Math.exp(-dt * 1.5), kick = this.kick * Math.sqrt(dt);
      const gx = gauss(sim), gy = gauss(sim), gz = gauss(sim);
      v[0] = v[0] * damp + gx * kick; v[1] = v[1] * damp + gy * kick; v[2] = v[2] * damp + gz * kick;
      const next = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
      if ((!R.inside(next) && it.mode !== 'out') || this.occupancy.busy(next, this.clear)) { v[0] *= -0.6; v[1] *= -0.6; v[2] *= -0.6; } else { p[0] = next[0]; p[1] = next[1]; p[2] = next[2]; }
      if (this.tumble) { it.rotation[0] += dt * 0.7; it.rotation[1] += dt * 0.5; }
      if (it.mode === 'in') { it.alpha = Math.min(1, it.alpha + dt / 1.2); if (it.alpha >= 1) it.mode = 'free'; }
      else if (it.mode === 'out') { it.alpha -= dt / 1.6; if (it.alpha <= 0) this.items.splice(i, 1); }
    }
  }
}

/** The pools of one scene by key (name + '@' + compartment), so a process that asks for 'H⁺@top' gets the very H⁺ the compartment model shows. */
export class PoolSet {
  constructor({ rng, occupancy = openSpace, species = {} }) { Object.assign(this, { rng, occupancy, species }); this.pools = new Map(); }
  /** Existing pool for `key`, or a new one from `spec` (filled to spec.n). */
  pool(key, spec) {
    let p = this.pools.get(key); if (p) return p;
    p = new ParticlePool({ ...spec, key }, { rng: this.rng, occupancy: this.occupancy }); this.pools.set(key, p); if (spec.n) p.fill(); return p;
  }
  /** Pool of a standard (or work-defined) species in a compartment: look from `speciesOf`, region given by the caller. */
  speciesPool(name, compartment, region, n = 0) {
    const s = speciesOf(name, this.species), key = `${name}@${compartment}`;
    return this.pool(key, { name, col: s.col, r: s.r, region, n });
  }
  update(dt) { for (const p of this.pools.values()) p.update(dt); }
  clear() { this.pools = new Map(); }
  /** Every particle that is currently in a pool, with the name it will be shown by. */
  *particles() { for (const [key, pool] of this.pools) for (const item of pool.items) yield { key, ...item }; }
}

/* ---------------- flow ---------------- */

/**
 * A stream of particles along fixed paths (the classic "fast" time scale: the flux is shown as a stream rather than single events). def: { name | label, col,
 * r, paths: [[point...]...], per (particles per cycle), v (Å/s, 60), spread (1.8 Å), max (400) }. `update(dt, cps)` emits per * cps particles a second at the
 * start of a random path; each follows its path (with a little lateral scatter), grows in and out over the first / last 6 %, and leaves at the end.
 * `snapshot()` lists what to draw: [{ name, position, scale }].
 */
export class FlowStream {
  constructor(def, { rng }) {
    if (!def.paths?.length) throw new Error('流必须至少有一条路径');
    this.def = def; this.name = makeName(def); this.random = makeRng(rng);
    this.curves = def.paths.map((P) => { const c = catmullRom(P); return { c, L: c.length() }; });
    this.max = def.max || 400; this.parts = []; this.acc = 0; this.emitted = 0; this.finished = 0;
  }
  update(dt, cps) {
    const d = this.def, vis = this.random.vis;
    this.acc += dt * cps * d.per;
    while (this.acc >= 1 && this.parts.length < this.max) {
      this.acc -= 1; const k = FLOOR(vis() * this.curves.length), s = d.spread ?? 1.8;
      const off = [gauss(vis) * s, gauss(vis) * s, gauss(vis) * s];
      this.parts.push({ k, u: 0, off, sp: (d.v || 60) * (0.8 + 0.4 * vis()) / this.curves[k].L }); this.emitted++;
    }
    if (this.acc > 1) this.acc = 1;
    for (let i = this.parts.length - 1; i >= 0; i--) { const q = this.parts[i]; q.u += q.sp * dt; if (q.u >= 1) { this.parts.splice(i, 1); this.finished++; } }
  }
  snapshot() {
    return this.parts.map((q) => {
      const pos = this.curves[q.k].c.point(q.u); pos[0] += q.off[0]; pos[1] += q.off[1]; pos[2] += q.off[2];
      return { name: this.name, position: pos, scale: Math.max(0.01, 1.3 * (this.def.r || 2.2) * Math.min(1, q.u / 0.06, (1 - q.u) / 0.06)) };
    });
  }
}
