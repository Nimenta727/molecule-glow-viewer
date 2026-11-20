import { PoolSet, FlowStream, SPECIES, speciesOf, createOccupancy, brownPath, shellRegion, seededRng } from './particles.mjs';

/**
 * The free particles of one structure (classic: the pools and fast-mode streams of the motion kit, here as one authored, saveable set). A `spec` lists
 * pools ("N molecules of a species wander in the solution around the structure, never inside protein") and flows ("a stream of a species from one residue
 * group to another"), a time scale ('slow': single molecules; 'fast': streams show where the flux goes) and the seed. `Solution` runs the spec on a fixed
 * 1/30 s step, so the same seed and the same number of steps always give the same picture whatever the frame rate. Pure logic: the caller supplies the
 * structure's points and a `resolveGroup(expression)` (residue positions of a selection, throwing a message when the expression is wrong).
 */
export const STEP = 1 / 30;
export const LIMITS = { pool: 200, pools: 8, flows: 4, cps: 3, expression: 500 };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Cleans a saved or typed spec: known fields only, numbers clamped, bad entries dropped (never throws). */
export function normalizeSolutionSpec(raw) {
  const spec = { seed: 7, scale: 'slow', pools: [], flows: [] };
  if (!raw || typeof raw !== 'object') return spec;
  if (Number.isSafeInteger(raw.seed)) spec.seed = raw.seed;
  if (raw.scale === 'fast') spec.scale = 'fast';
  const name = (v) => (typeof v === 'string' && v.trim() && v.trim().length <= 40 ? v.trim() : null);
  for (const p of Array.isArray(raw.pools) ? raw.pools : []) {
    const species = name(p?.species), n = Math.round(Number(p?.n));
    if (species && Number.isFinite(n) && n >= 1 && spec.pools.length < LIMITS.pools) spec.pools.push({ species, n: Math.min(LIMITS.pool, n) });
  }
  const expr = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, LIMITS.expression) : null);
  for (const f of Array.isArray(raw.flows) ? raw.flows : []) {
    const species = name(f?.species), from = expr(f?.from), to = expr(f?.to), cps = Number(f?.cps);
    if (species && from && to && spec.flows.length < LIMITS.flows) spec.flows.push({ species, from, to, cps: Number.isFinite(cps) ? Math.max(0, Math.min(LIMITS.cps, cps)) : 1 });
  }
  return spec;
}

export class Solution {
  /** points: [x, y, z] per residue (the occupancy); resolveGroup(expression) -> [[x, y, z]...]. */
  constructor({ points, resolveGroup = () => { throw new Error('没有可用的选择'); } }) {
    if (!Array.isArray(points) || !points.length) throw new Error('粒子需要一个结构（没有坐标）');
    this.points = points; this.resolveGroup = resolveGroup; this.occupancy = createOccupancy(points);
    let sum = [0, 0, 0]; for (const p of points) sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
    this.center = sum.map((v) => v / points.length);
    this.radius = Math.max(...points.map((p) => Math.hypot(p[0] - this.center[0], p[1] - this.center[1], p[2] - this.center[2])));
    this.spec = normalizeSolutionSpec(null); this.errors = []; this.steps = 0; this.carry = 0;
    this.#build();
  }
  /** Replace the whole spec (cleaned); everything restarts from the seed at step 0. */
  setSpec(raw) { this.spec = normalizeSolutionSpec(raw); this.#build(); return this.spec; }
  addPool(species, n) { return this.setSpec({ ...this.spec, pools: [...this.spec.pools, { species, n }] }); }
  addFlow(species, from, to, cps = 1) { return this.setSpec({ ...this.spec, flows: [...this.spec.flows, { species, from, to, cps }] }); }
  remove(kind, index) { const list = this.spec[kind === 'flow' ? 'flows' : 'pools'].filter((_, i) => i !== index); return this.setSpec({ ...this.spec, [kind === 'flow' ? 'flows' : 'pools']: list }); }
  setScale(scale) { this.spec.scale = scale === 'fast' ? 'fast' : 'slow'; }
  setCps(index, cps) { const f = this.spec.flows[index]; if (f) f.cps = Math.max(0, Math.min(LIMITS.cps, Number(cps) || 0)); }
  reset() { this.#build(); }

  #build() {
    this.steps = 0; this.carry = 0; this.errors = [];
    const rng = this.rng = seededRng(this.spec.seed), occupancy = this.occupancy;
    this.set = new PoolSet({ rng, occupancy });
    const region = shellRegion(this.center, 0, this.radius + 40, null, { rng, occupancy });
    this.spec.pools.forEach((p, i) => { this.set.pool(`${p.species}@solution#${i}`, { name: p.species, ...speciesOf(p.species), region, n: p.n }); });
    this.flows = [];
    this.spec.flows.forEach((f, i) => {
      try {
        const a = this.#centre(f.from, '起点'), b = this.#centre(f.to, '终点');
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 8) throw new Error('起点和终点的中心几乎重合，画不出路径');
        const paths = [0, 1, 2].map(() => brownPath(a, b, { n: 12, free0: 15, free1: 15 }, { rng, occupancy }));
        this.flows.push({ spec: f, index: i, stream: new FlowStream({ name: f.species, ...speciesOf(f.species), paths, per: 4, v: 60 }, { rng }) });
      } catch (error) { this.errors.push(`第 ${i + 1} 条流：${error.message}`); }
    });
  }
  #centre(expression, what) {
    let group; try { group = this.resolveGroup(expression); } catch (error) { throw new Error(`${what}“${expression}”：${error.message}`); }
    if (!group?.length) throw new Error(`${what}“${expression}”没有选中任何残基`);
    return [0, 1, 2].map((k) => group.reduce((s, p) => s + p[k], 0) / group.length);
  }

  /** Advance by real time `dt` seconds in fixed steps (at most 4 per call, so a long pause does not fast-forward). */
  advance(dt) {
    this.carry += Math.max(0, dt);
    let n = 0;
    while (this.carry >= STEP && n < 4) { this.step(); this.carry -= STEP; n++; }
    if (this.carry > STEP) this.carry = STEP;
    return n;
  }
  step() {
    this.set.update(STEP);
    for (const f of this.flows) f.stream.update(STEP, f.spec.cps);
    this.steps++;
  }
  /** Fast-forward exactly `n` steps (used to bring a restored set to a saved moment). */
  run(n) { for (let i = 0; i < n; i++) this.step(); }

  /** What to draw now, in the structure's own Å coordinates: [{ position, radius, color, alpha, label?, name, kind }]. */
  frame() {
    const showFlows = this.spec.scale === 'fast' && this.flows.length > 0, items = [];
    if (!showFlows) for (const p of this.set.particles()) {
      const s = speciesOf(p.name);
      items.push({ kind: 'pool', name: p.name, position: p.position.slice(), radius: s.r, color: hex(s.col), alpha: p.alpha, ...(p.labelled ? { label: p.name } : {}) });
    }
    if (showFlows) for (const f of this.flows) {
      const s = speciesOf(f.spec.species), snap = f.stream.snapshot();
      snap.forEach((q, i) => items.push({ kind: 'flow', name: q.name, position: q.position, radius: q.scale * 0.77, color: hex(s.col), alpha: 1, ...(i === 0 ? { label: q.name } : {}) }));
    }
    return items;
  }
  /** Summary for the panel: how many of each species are shown and how many particles flow. */
  summary() {
    const pools = this.spec.pools.map((p, i) => { const pool = this.set.pools.get(`${p.species}@solution#${i}`); return { species: p.species, want: p.n, shown: pool ? pool.items.filter((it) => it.mode !== 'out').length : 0 }; });
    return { pools, flows: this.flows.map((f) => ({ species: f.spec.species, cps: f.spec.cps, moving: f.stream.parts.length, emitted: f.stream.emitted })), errors: this.errors.slice(), steps: this.steps };
  }
}

export const SPECIES_NAMES = Object.keys(SPECIES);
