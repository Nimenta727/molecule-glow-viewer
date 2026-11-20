import { PoolSet, FlowStream, createOccupancy, brownPath, shellRegion, speciesOf, makeRng, seededRng } from '../motion/particles.mjs';
import { Motion, EventLog } from '../motion/journey.mjs';
import { normalizeDataAnimation } from './data-spec.mjs';

/**
 * The data-only animation engine (classic: PROCESSES.dataAnim in src/sim/data-anim.js). Compartments hold pools of molecules; a flow takes a molecule from one
 * compartment, carries it through a list of anchors and gives it to another; a reaction takes its reactants to a site, consumes them and releases products.
 * Pure logic, no rendering: `step(dt)` advances everything and `frame()` says what to draw. The order inside a step is the classic frame's (start new flows and
 * reactions, tick the journeys, move the pools, then run what the finished journeys continue with), so with the same seed it takes the same random numbers
 * in the same order as the classic engine.
 *
 * Beyond the classic: every event is metered (a ledger of what each species did), declared conserved quantities are checked at every reaction, and a spec with
 * errors is refused instead of crashing when it runs. The structure is supplied by the host as
 *   { points: [[x,y,z]...], ligands: [{ comp, centre }], residue(query) -> point | null, part(name) -> point | null, membraneY: [y...] }.
 */
const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
const hexToNumber = (hex) => parseInt(hex.slice(1), 16);
const hexOf = (n) => '#' + n.toString(16).padStart(6, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Turn the whole structure half a turn about a horizontal axis through `centre` (the classic `orient.up`: the model's PCA axis sign is arbitrary). */
export const flipAboutHorizontal = (p, centre) => [p[0], 2 * centre[1] - p[1], 2 * centre[2] - p[2]];

export class DataAnimation {
  constructor(raw, structure, { rng = seededRng(7), pace = () => 1, scale = () => 'slow' } = {}) {
    const { spec, errors, warnings } = normalizeDataAnimation(raw);
    if (errors.length) throw new Error(`数据动画无法运行：${errors.join('；')}`);
    if (!structure?.points?.length) throw new Error('数据动画需要一个结构（没有坐标）');
    Object.assign(this, { spec, structure, pace, scale, warnings: [...warnings], counters: {}, time: 0, flying: new Set(), violations: [], layer: null });
    this.rng = makeRng(rng);
    this.occupancy = createOccupancy(structure.points);
    this.motion = new Motion({ deferred: true });
    this.events = new EventLog(() => this.time);
    this.ledger = { created: {}, consumed: {}, vanished: {}, taken: {}, given: {} };
    this.#setup();
  }

  /* ---------------- setup ---------------- */
  #warn(text) { if (!this.warnings.includes(text)) this.warnings.push(text); }
  #setup() {
    const { spec, structure } = this, pts = structure.points;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    this.c = lo.map((v, k) => (v + hi[k]) / 2); this.R = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    const custom = Object.fromEntries(Object.entries(spec.species).map(([name, s]) => [name, { col: hexToNumber(s.col), r: clamp(s.r, 0.8, 6) }]));
    this.pools = new PoolSet({ rng: this.rng, occupancy: this.occupancy, species: custom });
    const mem = structure.membraneY ?? [];
    this.comp = {}; this.keepF = {};
    for (const [name, d] of Object.entries(spec.compartments)) {
      const y = mem[d.membrane ?? 0] ?? this.c[1], g = d.gap ?? 20;
      const ok = d.side === 'above' ? (p) => p[1] > y + g : d.side === 'below' ? (p) => p[1] < y - g : () => true;
      this.comp[name] = shellRegion(this.c, 0, (d.r ?? 1.2) * this.R, ok, { rng: this.rng, occupancy: this.occupancy });
      this.keepF[name] = d.side === 'above' ? (p) => { if (p[1] < y + g) p[1] = y + g; } : d.side === 'below' ? (p) => { if (p[1] > y - g) p[1] = y - g; } : undefined;
    }
    this.initialInventory = null;
    for (const p of spec.pools) this.#pool(p.species, p.in, p.n);
    const hot = [], sim = this.rng.sim;
    this.flows = spec.flows.map((f) => {
      const via = f.via.flatMap((a) => this.anchor(a)); hot.push(...via);
      return { ...f, pts: via.length > 1 ? via : [via[0], add(via[0], [0, 0.01, 0])], t: sim(), busy: 0 };
    });
    this.reacts = spec.reactions.flatMap((r) => this.anchor(r.site).map((site) => { hot.push(site); return { ...r, site, t: sim(), busy: 0 }; }));
    for (const x of [...this.flows, ...this.reacts]) if (x.counter) this.counters[x.counter] = 0;
    this.hotPoints = hot;
    this.initialInventory = this.inventory();
  }
  #pool(species, comp, n = 0) { return this.pools.speciesPool(species, comp, this.comp[comp], n); }

  /** Where an anchor is, as a list of points (a `ligands` anchor expands to every copy; none found: the middle of the model, with a warning). */
  anchor(a) {
    const s = this.structure, off = Array.isArray(a) ? [0, 0, 0] : (a.offset ?? [0, 0, 0]), one = (p) => [add(p, off)];
    if (Array.isArray(a)) return [a.slice(0, 3)];
    if (a.ligand != null || a.ligands != null) {
      const comp = String(a.ligand ?? a.ligands).toUpperCase(), L = (s.ligands ?? []).filter((x) => x.comp === comp);
      if (!L.length) { this.#warn(`没有找到小分子 ${comp}：改用模型中心。`); return one(this.c); }
      if (a.ligand != null) return one(L[Math.min(L.length - 1, a.index || 0)].centre);
      const P = []; for (const x of L) if (!P.some((q) => Math.hypot(q[0] - x.centre[0], q[1] - x.centre[1], q[2] - x.centre[2]) < 1)) P.push(x.centre.slice());   // symmetry copies coincide
      const out = P.map((p) => add(p, off)); if (a.order === 'up') out.sort((p, q) => p[1] - q[1]); if (a.order === 'down') out.sort((p, q) => q[1] - p[1]);
      return out;
    }
    if (a.residue != null) {
      const m = /^(-?\d+)([A-Za-z]?)$/.exec(String(a.residue).trim()), p = m ? s.residue?.({ number: +m[1], ins: m[2].toUpperCase(), part: a.part, chain: a.chain }) : null;
      if (!p) this.#warn(`没有找到残基 ${JSON.stringify(a)}：改用模型中心。`);
      return one(p ?? this.c);
    }
    if (a.label_seq != null) {
      const p = s.residue?.({ labelSeq: +a.label_seq, part: a.part, labelAsym: a.label_asym });
      if (!p) this.#warn(`没有找到残基 ${JSON.stringify(a)}：改用模型中心。`);
      return one(p ?? this.c);
    }
    if (a.part != null) { const p = s.part?.(a.part); if (!p) this.#warn(`没有找到部件 ${a.part}：改用模型中心。`); return one(p ?? this.c); }
    if (a.membrane != null) return one([this.c[0], (s.membraneY ?? [])[a.membrane] ?? this.c[1], this.c[2]]);
    return one(this.c);
  }

  /* ---------------- metering ---------------- */
  #count(kind, species) { this.ledger[kind][species] = (this.ledger[kind][species] ?? 0) + 1; }
  #newParticle(species, position, alpha) { const item = { id: `d${this.#n = (this.#n ?? 0) + 1}`, name: species, label: species, position: position.slice(), alpha, rotation: [0, 0, 0], velocity: [0, 0, 0] }; this.flying.add(item); this.#count('created', species); return item; }
  #n = 0;
  #take(species, comp, near) { const item = this.#pool(species, comp).take(near); item.label = species; this.flying.add(item); this.#count('taken', species); return item; }
  #give(item, species, comp) { this.flying.delete(item); this.#pool(species, comp).give(item); this.#count('given', species); }

  /** What is in the scene now, by species: molecules in the pools (not those leaving) plus those on a journey. */
  inventory() {
    const inv = {};
    for (const pool of this.pools.pools.values()) for (const it of pool.items) if (it.mode !== 'out') inv[it.name] = (inv[it.name] ?? 0) + 1;
    for (const it of this.flying) inv[it.name] = (inv[it.name] ?? 0) + 1;
    return inv;
  }
  /** Per species: [initial + created + drifted in - consumed - vanished - drifted out, actual]. They agree when the metering is complete. */
  balance() {
    const drift = { in: {}, out: {} };
    for (const pool of this.pools.pools.values()) { drift.in[pool.name] = (drift.in[pool.name] ?? 0) + pool.drift.in; drift.out[pool.name] = (drift.out[pool.name] ?? 0) + pool.drift.out; }
    const now = this.inventory(), names = new Set([...Object.keys(now), ...Object.keys(this.initialInventory), ...Object.keys(this.ledger.created)]), result = {};
    for (const name of names) {
      const expected = (this.initialInventory[name] ?? 0) + (this.ledger.created[name] ?? 0) + (drift.in[name] ?? 0) - (this.ledger.consumed[name] ?? 0) - (this.ledger.vanished[name] ?? 0) - (drift.out[name] ?? 0);
      result[name] = { expected, actual: now[name] ?? 0 };
    }
    return result;
  }
  /** Value of each declared conserved quantity over the molecules in the scene. */
  quantities() {
    const inv = this.inventory();
    return Object.fromEntries(this.spec.conserved.map((c) => [c.name, Object.entries(c.weights).reduce((sum, [sp, w]) => sum + w * (inv[sp] ?? 0), 0)]));
  }
  #checkConserved(reaction) {
    for (const c of this.spec.conserved) {
      const side = (list) => list.reduce((sum, s) => sum + (c.weights[s.species] ?? 0), 0), before = side(reaction.in), after = side(reaction.out);
      if (Math.abs(before - after) > 1e-9) {
        this.violations.push({ reaction: reaction.name ?? '反应', quantity: c.name, before, after, time: this.time });
        this.events.add(`⚠ ${reaction.name ?? '反应'} 不守恒（${c.name}：${before} → ${after}）`, reaction.site, 4);
      }
    }
  }

  /* ---------------- flows and reactions ---------------- */
  #ctx() { return { rng: this.rng, occupancy: this.occupancy }; }
  #runFlow(f) {
    const k = this.pace(), P = f.pts, sp = f.species, ctx = this.#ctx(), end = P[P.length - 1];
    let item;
    if (f.from) item = this.#take(sp, f.from, P[0]); else item = this.#newParticle(sp, P[0], 0);
    const a0 = item.alpha ?? 1, dur = (f.tVia ?? 0.45 * P.length) / k;
    const legs = [
      f.from ? { path: (it) => brownPath(it.position, P[0], { free1: f.free ?? 6, keep: this.keepF[f.from] }, ctx), dur: (f.tIn ?? 1.6) / k, fadeIn: a0 < 1 ? 0.3 : 0, tumble: f.tumble }
        : { path: [P[0], add(P[0], [0, 0.01, 0])], dur: 0.4, fadeIn: 1 },
      { path: P, dur, ease: true,
        onStart: (it) => {
          if (f.labelVia) it.label = f.labelVia;
          for (const e of f.events) {
            const i = clamp(e.at | 0, 0, P.length - 1), fire = () => this.events.add(e.text, add(P[i], [0, 7, 0]), 2.2), delay = dur * i / Math.max(1, P.length - 1);
            if (delay > 0) this.motion.wait(delay, fire); else this.motion.queue.push(fire);   // the classic never fired an event at index 0 (its zero-length wait never ends)
          }
        },
        onEnd: (it) => { it.label = sp; if (f.counter) this.counters[f.counter]++; } },
    ];
    if (f.to) {
      legs.push({
        path: () => { const pool = this.#pool(sp, f.to), dest = pool.region.sample(false) || add(end, [0, 30, 0]), aim = dest.map((v, i) => v + (end[i] - v) * 0.45);
          return brownPath(end, aim, { free0: f.free ?? 6, free1: 0, keep: this.keepF[f.to] }, ctx); },
        dur: (f.tOut ?? 1.4) / k });
    } else legs.push({ path: [end, add(end, [0, 0.01, 0])], dur: 0.6, fadeOut: 1 });
    this.motion.go(item, legs, { onDone: (it) => {
      if (f.to) this.#give(it, sp, f.to); else { this.flying.delete(it); this.#count('vanished', sp); }
      f.busy--;
    } });
  }
  #runReaction(r) {
    const k = this.pace(), at = r.site, ctx = this.#ctx(), ins = [];
    let waiting = r.in.length;
    r.in.forEach((s, i) => {
      const item = this.#take(s.species, s.from, at), target = add(at, [Math.cos(i * 2.4) * 3, Math.sin(i * 2.4) * 3, 0]);
      ins.push(item);
      this.motion.go(item, [{ path: (it) => brownPath(it.position, target, { free1: r.free ?? 10, keep: this.keepF[s.from] }, ctx), dur: (r.tIn ?? 2.2) / k, fadeIn: (item.alpha ?? 1) < 1 ? 0.3 : 0, tumble: true }],
        { onDone: () => { if (--waiting === 0) this.motion.wait((r.hold ?? 0.5) / k, react); } });
    });
    const react = () => {
      for (const item of ins) { this.flying.delete(item); this.#count('consumed', item.name); }
      if (r.text) this.events.add(r.text, add(at, [0, 8, 0]), 2.2);
      this.#checkConserved(r);
      if (r.counter) this.counters[r.counter]++;
      let remaining = r.out.length;
      if (!remaining) { r.busy--; return; }
      r.out.forEach((s, i) => {
        const start = add(at, [Math.cos(i * 2.4) * 2, 0, Math.sin(i * 2.4) * 2]), item = this.#newParticle(s.species, start, 1);
        const done = (it) => { if (s.to) this.#give(it, s.species, s.to); else { this.flying.delete(it); this.#count('vanished', s.species); } if (--remaining === 0) r.busy--; };
        if (!s.to) { this.motion.go(item, [{ path: [start, add(start, [0, 6, 0])], dur: 1.0, fadeOut: 1 }], { onDone: done }); return; }
        const pool = this.#pool(s.species, s.to), dest = pool.region.sample(false) || add(at, [0, 30, 0]);
        this.motion.go(item, [{ path: (it) => brownPath(it.position, dest, { free0: r.free ?? 10, free1: 0, keep: this.keepF[s.to] }, ctx), dur: (r.tOut ?? 2.4) / k }], { onDone: done });
      });
    };
  }

  /* ---------------- fast time scale ---------------- */
  #buildLayer() {
    const defs = [], look = (n) => speciesOf(n, this.pools.species), smp = (c, near) => this.comp[c]?.sample(false) || add(near, [0, 40, 0]), ctx = this.#ctx();
    const paths = (make) => [0, 1, 2].map(make), mk = (label, species, per, v, ps) => defs.push({ label, col: look(species).col, r: look(species).r, per, v, paths: ps });
    for (const f of this.flows) {
      mk(f.name || f.species, f.species, f.rate * (f.stoich || 1), 70, paths(() => {
        const a = f.from ? brownPath(smp(f.from, f.pts[0]), f.pts[0], { free1: 6, keep: this.keepF[f.from] }, ctx) : [f.pts[0]];
        const e = f.pts[f.pts.length - 1], b = f.to ? brownPath(e, smp(f.to, e), { free0: 6, free1: 0, keep: this.keepF[f.to] }, ctx) : [e];
        return [...a, ...f.pts.slice(1), ...b.slice(1)];
      }));
    }
    for (const r of this.reacts) {
      for (const s of r.in) mk(`${s.species} → ${r.name || '反应'}`, s.species, r.rate, 60, paths(() => brownPath(smp(s.from, r.site), r.site, { free1: 10, keep: this.keepF[s.from] }, ctx)));
      for (const s of r.out) if (s.to) mk(s.species, s.species, r.rate, 60, paths(() => brownPath(r.site, smp(s.to, r.site), { free0: 10, free1: 0, keep: this.keepF[s.to] }, ctx)));
    }
    return defs.map((d) => ({ stream: new FlowStream(d, { rng: this.rng }), def: d }));
  }

  /* ---------------- stepping ---------------- */
  /** Advance by `dt` seconds of scene time. */
  step(dt) {
    this.time += dt;
    const pace = this.pace();
    if (this.scale() === 'fast') {
      this.layer ||= this.#buildLayer();
      for (const { stream } of this.layer) stream.update(dt, pace);
      for (const x of [...this.flows, ...this.reacts]) if (x.counter) { x.acc = (x.acc || 0) + dt * pace * x.rate; while (x.acc >= 1) { x.acc--; this.counters[x.counter]++; } }
    } else {
      for (const f of this.flows) { f.t += dt * f.rate * pace; if (f.t >= 1 && f.busy < (f.max ?? 3)) { f.t = 0; f.busy++; this.#runFlow(f); } else if (f.t > 1) f.t = 1; }
      for (const r of this.reacts) { r.t += dt * r.rate * pace; if (r.t >= 1 && r.busy < (r.max ?? 2)) { r.t = 0; r.busy++; this.#runReaction(r); } else if (r.t > 1) r.t = 1; }
    }
    this.motion.tick(dt);
    this.pools.update(dt);
    this.motion.flush();
    this.events.tick(dt);
  }
  run(steps, dt = 1 / 30) { for (let i = 0; i < steps; i++) this.step(dt); }

  /** What to draw: [{ kind: 'pool' | 'moving' | 'stream', name, position, radius, color, alpha, label? }] and the event tags still showing. */
  frame() {
    const items = [], look = (n) => speciesOf(n, this.pools.species);
    for (const p of this.pools.particles()) items.push({ kind: 'pool', name: p.name, position: p.position, radius: look(p.name).r, color: hexOf(look(p.name).col), alpha: p.alpha, ...(p.labelled ? { label: p.name } : {}) });
    for (const it of this.flying) items.push({ kind: 'moving', name: it.name, position: it.position, radius: look(it.name).r, color: hexOf(look(it.name).col), alpha: it.alpha ?? 1, label: it.label ?? it.name });
    if (this.scale() === 'fast' && this.layer) for (const { stream, def } of this.layer) stream.snapshot().forEach((q, i) => items.push({ kind: 'stream', name: q.name, position: q.position, radius: q.scale * 0.77, color: hexOf(def.col), alpha: 1, ...(i === 0 ? { label: q.name } : {}) }));
    return { items, tags: this.events.tags.map((t) => ({ ...t })) };
  }
  /** Counters, events and metering for the panels and for tests. */
  summary() { return { time: this.time, counters: { ...this.counters }, events: this.events.list(), inventory: this.inventory(), ledger: JSON.parse(JSON.stringify(this.ledger)), quantities: this.quantities(), violations: this.violations.slice(), warnings: this.warnings.slice() }; }
  /** Stop everything (the scene closed): nothing keeps running, nothing is called. */
  dispose() { this.motion.clear(); this.flying.clear(); this.pools.clear(); this.layer = null; }
}
