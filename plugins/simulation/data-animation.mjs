import { PoolSet, FlowStream, createOccupancy, brownPath, shellRegion, speciesOf, makeRng, seededRng } from '../motion/particles.mjs';
import { Motion, EventLog } from '../motion/journey.mjs';
import { normalizeDataAnimation } from './data-spec.mjs';
import { KineticSimulation } from './kinetic-model.mjs';
import { cofactorChain } from '../structure/site-analysis.mjs';
import { principalAxes } from '../motion/rotation.mjs';

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
export const STEP = 1 / 30;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Turn the whole structure half a turn about a horizontal axis through `centre` (the classic `orient.up`: the model's PCA axis sign is arbitrary). */
export const flipAboutHorizontal = (p, centre) => [p[0], 2 * centre[1] - p[1], 2 * centre[2] - p[2]];


/** The classic keyword match for a part name: the name contains the key (any case), or the key is /regex/flags. */
export function matchPart(name, key) {
  if (key.startsWith('/') && key.lastIndexOf('/') > 0) { const i = key.lastIndexOf('/'); try { return new RegExp(key.slice(1, i), key.slice(i + 1) || 'i').test(name); } catch { return false; } }
  return name.toLowerCase().includes(key.toLowerCase());
}
const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * Where an anchor is in `structure`, as a list of points; `centre` is where a missing one falls back to, `warn(text)` hears about it, `named` holds the anchors a `{ ref }` names.
 * The structure may also supply `partPoints(name)` (the positions of a part's residues, for `arm` anchors); its ligands may carry the `part` they sit in.
 */
export function resolveAnchor(a, s, centre, warn = () => {}, named = {}, trail = [], env = {}) {
  if (Array.isArray(a)) return [a.slice(0, 3)];
  const sub = (x, name) => resolveAnchor(x, s, centre, warn, named, name ? [...trail, name] : trail, env), first = (x) => sub(x)[0];
  const off = a.offset ?? [0, 0, 0], one = (p) => [add(p, off)];
  let points;
  if (a.ref != null) {
    if (!named[a.ref]) { warn(`没有命名锚点“${a.ref}”：改用模型中心。`); points = one(centre); }
    else if (trail.includes(a.ref)) { warn(`命名锚点“${a.ref}”引用了它自己（${[...trail, a.ref].join(' → ')}）：改用模型中心。`); points = one(centre); }
    else points = sub(named[a.ref], a.ref).map((p) => add(p, off));
  } else if (a.pairMid != null) {
    const list = sub(a.pairMid); let best = null, gap = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const d = dist3(list[i], list[j]); if (d < gap) { gap = d; best = [list[i], list[j]]; } }
    points = best && gap < a.maxGap ? [[0, 1, 2].map((k) => (best[0][k] + best[1][k]) / 2)] : a.else ? sub(a.else) : one(centre);
  } else if (a.mirror != null) {
    const p = first(a.mirror.point), q = first(a.mirror.about);
    points = one([0, 1, 2].map((k) => 2 * q[k] - p[k]));
  } else if (a.along != null) {
    const p = first(a.along.from), q = first(a.along.to), d = dist3(p, q) || 1;
    points = one([0, 1, 2].map((k) => p[k] + (q[k] - p[k]) / d * a.along.distance));
  } else if (a.between != null) { const [p, q] = [first(a.between[0]), first(a.between[1])]; points = one([0, 1, 2].map((k) => p[k] + (q[k] - p[k]) * a.t)); }
  else if (a.arm != null) points = armPoints(a, s, centre, warn).map((p) => add(p, off));
  else if (a.ligand != null || a.ligands != null) points = ligandPoints(a, s, centre, warn, sub, first, env).map((p) => add(p, off));
  else if (a.residue != null) {
    const m = /^(-?\d+)([A-Za-z]?)$/.exec(String(a.residue).trim()), query = m ? { number: +m[1], ins: m[2].toUpperCase(), part: a.part, chain: a.chain } : null;
    let p = query ? s.residue?.(query) : null;
    if (p && a.nearest && s.residues) { const ref = first(a.nearest), all = s.residues(query); if (all.length) p = all.reduce((best, q) => (dist3(q, ref) < dist3(best, ref) ? q : best)); }   // among the residues of that number, the one closest to the reference
    if (!p) warn(`没有找到残基 ${JSON.stringify(a)}：改用模型中心。`);
    points = one(p ?? centre);
  } else if (a.label_seq != null) {
    const p = s.residue?.({ labelSeq: +a.label_seq, part: a.part, labelAsym: a.label_asym });
    if (!p) warn(`没有找到残基 ${JSON.stringify(a)}：改用模型中心。`);
    points = one(p ?? centre);
  } else if (a.part != null) { const p = s.part?.(a.part); if (!p) warn(`没有找到部件 ${a.part}：改用模型中心。`); points = one(p ?? centre); }
  else if (a.membrane != null) points = one([centre[0], (s.membraneY ?? [])[a.membrane] ?? centre[1], centre[2]]);
  else points = one(centre);
  if (a.onMembrane) {
    const y = (s.membraneY ?? [])[a.onMembrane.index];
    if (y === undefined) warn('onMembrane 指的那层膜不存在：高度保持不变。');
    else points = points.map((p) => [p[0], p[1] + (y + a.onMembrane.dy - p[1]) * a.onMembrane.blend, p[2]]);
  }
  return points;
}

/** The cofactors an anchor names, narrowed, picked or chained as it says (see data-spec.mjs). */
function ligandPoints(a, s, centre, warn, sub, first, env = {}) {   // (`sub` and `first` resolve the anchors inside it)
  const comps = String(a.ligand ?? a.ligands).toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
  let L = (s.ligands ?? []).filter((x) => comps.includes(x.comp));
  if (a.part != null) L = L.filter((x) => matchPart((a.ring && x.ringPart !== undefined ? x.ringPart : x.part) ?? '', a.part));   // with `ring` the protein is the one nearest the ring centre, as the classic judged it
  const missing = (what) => { if (a.else) return sub(a.else); if (a.optional) return []; warn(`${what}：改用模型中心。`); return [centre.slice()]; };
  if (!L.length) return missing(`没有找到小分子 ${comps.join('/')}${a.part != null ? `（部件 ${a.part}）` : ''}`);
  if (a.ligand != null && !a.pick && !a.chain) return [(a.ring && L[Math.min(L.length - 1, a.index || 0)].ring ? L[Math.min(L.length - 1, a.index || 0)].ring : L[Math.min(L.length - 1, a.index || 0)].centre).slice()];
  const at = (x) => (a.ring && x.ring ? x.ring : x.centre);
  let P = []; for (const x of L) if (!P.some((q) => dist3(q, at(x)) < 1)) P.push(at(x).slice());   // symmetry copies coincide
  for (const n of a.near ?? []) { const ref = first(n.to); P = P.filter((p) => { const d = dist3(p, ref); return (n.min === undefined || d > n.min) && (n.max === undefined || d < n.max); }); }
  if (a.above) { const y = first(a.above)[1] + (a.margin ?? 0); P = P.filter((p) => p[1] > y); }
  if (a.below) { const y = first(a.below)[1] - (a.margin ?? 0); P = P.filter((p) => p[1] < y); }
  if (!P.length) return missing(`筛选后没有剩下小分子 ${comps.join('/')}`);
  if (a.chain) {
    const chain = cofactorChain(P.map((position) => ({ position })), { direction: a.chain === 'up' ? [0, -1, 0] : [0, 1, 0] });
    const path = chain ? chain.map((c) => c.position) : P.slice(0, 1);
    return a.take === 'first' ? [path[0]] : a.take === 'last' ? [path[path.length - 1]] : path;
  }
  if (a.pick) {
    const near = (p, q) => dist3(p, q) < 3.5, rank = a.rank ?? 0;
    let order;
    if (a.pick === 'cycle') order = P;   // the n-th of them in the n-th cycle (see `cycle` in the relay)
    else if (a.pick === 'top') order = [...P].sort((p, q) => q[1] - p[1]);
    else if (a.pick === 'bottom') order = [...P].sort((p, q) => p[1] - q[1]);
    else if (a.pick === 'nearest') { const ref = first(a.to); order = [...P].sort((p, q) => dist3(p, ref) - dist3(q, ref)); }
    else {   // a binuclear centre (CuA): members with a partner within 3.5 Å; or the lone ones (CuB)
      const paired = P.filter((p) => P.some((q) => q !== p && near(p, q))), lone = P.filter((p) => !paired.includes(p));
      order = a.pick === 'paired' ? (paired.length ? paired : [...P].sort((p, q) => p[1] - q[1])) : (lone.length ? lone : [...P].sort((p, q) => q[1] - p[1]));
    }
    return [a.pick === 'cycle' ? order[((env.cycle ?? 0) + rank) % order.length] : order[Math.min(rank, order.length - 1)]];
  }
  if (a.order === 'up') P.sort((p, q) => p[1] - q[1]); if (a.order === 'down') P.sort((p, q) => q[1] - p[1]);
  return P;
}

/**
 * Points along the long axis of a part's residues near the membrane (the classic proton-pumping positions along the membrane arm of complex I): the longest principal axis of those
 * residues, projected onto the horizontal plane, from the lowest to the highest position along it, at the given fractions, at the height of the first membrane.
 */
function armPoints(a, s, centre, warn) {
  const y0 = (s.membraneY ?? [])[0] ?? centre[1], all = s.partPoints?.(a.arm) ?? [], arm = all.filter((p) => Math.abs(p[1] - y0) < a.halfHeight);
  if (arm.length < 20) { warn(`部件 ${a.arm} 在膜附近的残基太少：沿用它的中心。`); const c = s.part?.(a.arm) ?? centre; return a.fractions.map(() => [c[0], y0, c[2]]); }
  const pc = principalAxes(arm), flat = [pc.axes[2][0], 0, pc.axes[2][2]], norm = Math.hypot(flat[0], flat[1], flat[2]) || 1, e = flat.map((v) => v / norm);
  const ts = arm.map((p) => (p[0] - pc.centre[0]) * e[0] + (p[1] - pc.centre[1]) * e[1] + (p[2] - pc.centre[2]) * e[2]), lo = Math.min(...ts), hi = Math.max(...ts);
  return a.fractions.map((f) => [pc.centre[0] + e[0] * (lo + (hi - lo) * f), y0, pc.centre[2] + e[2] * (lo + (hi - lo) * f)]);
}

/**
 * The two volumes drawn for a compartment model's pH (classic: the pH volumes of cell-kinetics.js): a box above the membrane and one below it, as wide as the structure (plus a margin), from
 * `gap` Å off the membrane to `reach` Å beyond the structure. In the engine's frame (membrane normal vertical). Returns { top: { min, max }, bot: { min, max } }.
 */
export function compartmentBoxes(structure, { gap = 30, margin = 80, reach = 120 } = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of structure.points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const ym = (structure.membraneY ?? [])[0] ?? (lo[1] + hi[1]) / 2;
  return { top: { min: [lo[0] - margin, ym + gap, lo[2] - margin], max: [hi[0] + margin, Math.max(hi[1] + reach, ym + gap + 1), hi[2] + margin] },
    bot: { min: [lo[0] - margin, Math.min(lo[1] - reach, ym - gap - 1), lo[2] - margin], max: [hi[0] + margin, ym - gap, hi[2] + margin] } };
}
/** The triangles of an axis-aligned box: { positions: [[x, y, z]...] (8), indices: [a, b, c...] (12 triangles) }. */
export function boxTriangles({ min, max }) {
  const positions = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  return { positions, indices: [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3] };
}

/** The middle of the box around a structure's points, and half its diagonal (the classic centre and size of a model). */
export function structureBox(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { centre: lo.map((v, k) => (v + hi[k]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
}

/** Does the declared `orient.up` anchor sit below the middle? Then the host turns the whole structure half a turn (flipAboutHorizontal) before running. */
export function needsFlip(raw, structure) {
  const { spec } = normalizeDataAnimation(raw);
  if (!spec.orient?.up) return false;
  const { centre } = structureBox(structure.points);
  return resolveAnchor(spec.orient.up, structure, centre)[0][1] < centre[1];
}

export class DataAnimation {
  constructor(raw, structure, { rng = seededRng(7), pace = () => 1, scale = () => 'slow', kinetics = null } = {}) {
    const { spec, errors, warnings } = normalizeDataAnimation(raw);
    if (errors.length) throw new Error(`数据动画无法运行：${errors.join('；')}`);
    if (!structure?.points?.length) throw new Error('数据动画需要一个结构（没有坐标）');
    Object.assign(this, { spec, structure, basePace: pace, scale, warnings: [...warnings], counters: {}, time: 0, flying: new Set(), violations: [], layer: null });
    this.rng = makeRng(rng);
    this.occupancy = createOccupancy(structure.points);
    this.motion = new Motion({ deferred: true });
    this.events = new EventLog(() => this.time);
    this.ledger = { created: {}, consumed: {}, vanished: {}, taken: {}, given: {} };
    this.#setup();
    this.#attachKinetics(kinetics);
  }
  /** The animation's tempo: the host's pace, scaled by the compartment model's flux the way the classic did (clamped to 0.5-1.8). */
  pace = () => this.basePace() * (this.kinetics ? Math.max(0.5, Math.min(1.8, this.kinetics.flux.rate)) : 1);

  /**
   * An optional compartment model (concentrations, pH, membrane potential; see kinetic-model.mjs). Its `dots` say how many free molecules each compartment
   * shows: the pool named `label@compartment` follows that number, and the animation's own pool of that name is the same pool. The model reads the
   * animation's counters as its inputs.
   */
  #attachKinetics(raw) {
    if (!raw) return;
    const kinetics = new KineticSimulation(raw);
    for (const dot of kinetics.model.dots) if (!(dot.comp in this.spec.compartments)) throw new Error(`动力学模型的粒子“${dot.label}”写了不存在的区室“${dot.comp}”（可用：${Object.keys(this.spec.compartments).join('、')}）。`);
    this.kinetics = kinetics; this.kineticDots = kinetics.model.dots.map((dot) => ({ dot, pool: null, filled: false }));
    this.#followKinetics();
  }
  #followKinetics() {
    const k = this.kinetics, counts = k.dots();
    k.setInputs(Object.fromEntries(Object.entries(k.model.inputs).map(([name, counter]) => [name, this.counters[counter] ?? 0])));
    this.kineticDots.forEach((d, i) => {
      d.pool ??= this.pools.pool(`${d.dot.label}@${d.dot.comp}`, { name: d.dot.label, ...speciesOf(d.dot.label, this.pools.species), ...(d.dot.color ? { col: hexToNumber(d.dot.color) } : {}), r: d.dot.r, region: this.comp[d.dot.comp], n: 0, maxTags: 2 });
      d.pool.n = counts[i].count;
      if (!d.filled) { d.filled = true; const had = d.pool.items.length; d.pool.fill(); this.initialInventory[d.pool.name] = (this.initialInventory[d.pool.name] ?? 0) + d.pool.items.length - had; }   // the first fill is part of the starting stock
    });
  }

  /* ---------------- setup ---------------- */
  #warn(text) { if (!this.warnings.includes(text)) this.warnings.push(text); }
  #setup() {
    const { spec, structure } = this, pts = structure.points;
    const box = structureBox(pts); this.c = box.centre; this.R = box.radius;
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
    const dynamic = (x) => JSON.stringify(x).includes('"pick":"cycle"');   // resolved again for each cycle
    const prepare = (a) => {
      if (a.pause !== undefined) return a.at ? { ...a, pt: this.anchor(a.at)[0] } : a;
      const via = a.via.flatMap((x) => this.anchor(x)); hot.push(...via);
      return { ...a, pts: via.length > 1 ? via : [via[0], add(via[0], [0, 0.01, 0])], ...(dynamic(a.via) ? { dynamic: true } : {}), ...(a.then ? { then: a.then.map(prepare) } : {}) };
    };
    this.relays = (spec.relays ?? []).map((r) => ({ ...r, t: sim(), acc: 0, busy: 0, n: 0, phases: r.phases.map((phase) => phase.map(prepare)) }));
    const walk = (a) => [a, ...(a.then ?? []).flatMap(walk)];
    for (const x of [...this.flows, ...this.reacts, ...this.relays, ...this.relays.flatMap((r) => r.phases.flat().flatMap(walk))]) if (x.counter) this.counters[x.counter] = 0;
    this.stage = null;
    this.rotor = spec.rotor ? { ...spec.rotor, travelled: 0, angle: 0 } : null;   // `travelled` = whole turns made (never negative), `angle` = the signed angle in radians
    this.derived = spec.derived ?? [];
    for (const f of this.flows) if (f.perTurn) f.fired = 0;
    for (const d of this.derived) this.counters[d.name] = 0;
    this.hotPoints = hot;
    this.initialInventory = this.inventory();
  }
  #pool(species, comp, n = 0) { return this.pools.speciesPool(species, comp, this.comp[comp], n); }

  /** Where an anchor is, as a list of points (a `ligands` anchor expands to every copy; none found: the middle of the model, with a warning). */
  anchor(a, env = {}) { return resolveAnchor(a, this.structure, this.c, (text) => this.#warn(text), this.spec.anchors ?? {}, [], env); }

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
  #runFlow(f, after = () => { f.busy--; }) {
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
      after();
    } });
  }
  /* ---------------- the rotor: a part that turns with the clock, and flows that follow its turns ---------------- */
  /** The rotor's speed follows the compartment model's flux (`by`) and, with `stock`, the stock of the proton ledger: no protons to return, no turn (the classic rotorRate). */
  #turnRotor(dt, pace) {
    const r = this.rotor;
    let factor = r.by && this.kinetics ? this.kinetics.flux[r.by] ?? 1 : 1;
    if (r.stock) { const stock = this.counters[r.stock] ?? 0; factor *= stock >= 1 ? Math.min(1, 0.3 + stock / 12) : 0; }
    const turns = r.turnsPerSecond * factor * pace * dt;
    r.travelled += Math.abs(turns); r.angle += 2 * Math.PI * turns;
    for (const f of this.flows) {
      if (!f.perTurn) continue;
      const due = r.travelled > 0 && r.travelled >= f.phase ? Math.floor((r.travelled - f.phase) * f.perTurn + 1e-9) + 1 : 0;   // a rotor that has not moved at all lets nothing through, not even the stator whose phase is 0
      for (; f.fired < due; f.fired++) {
        if (this.scale() === 'fast') { if (f.counter) this.counters[f.counter]++; } else this.#runFlow(f, () => {});   // the fast scale shows no journeys: the counters keep the stoichiometry
      }
    }
  }
  #derive() {
    for (const d of this.derived) {
      let v = Object.entries(d.terms).reduce((sum, [name, w]) => sum + w * (this.counters[name] ?? 0), 0) * (d.scale ?? 1);
      if (d.floor) v = Math.floor(v + 1e-9);
      if (d.per) v = this.counters[d.per] ? v / this.counters[d.per] : 0;
      this.counters[d.name] = d.round !== undefined ? +v.toFixed(d.round) : v;
    }
  }

  /* ---------------- relays: a cycle of phases (an addition to the classic) ---------------- */
  /** A relay that needs the compartment model's flux starts no cycle while the flux is (nearly) zero, as the classic did. */
  #relayOpen(r) { return !r.gate || !this.kinetics || this.kinetics.flux.rate > 0.08; }
  #due(a, cycle) { return !a.every || (cycle + 1) % a.every === 0; }
  #countRelay(r) {   // the fast scale shows no journeys: the counters of every action (follow-ups too) keep the stoichiometry
    const cycle = r.n++, each = (a) => { if (a.counter && this.#due(a, cycle)) this.counters[a.counter]++; (a.then ?? []).forEach((x) => { if (this.#due(x, cycle)) each(x); }); };
    if (r.counter) this.counters[r.counter]++; r.phases.flat().forEach((a) => { if (this.#due(a, cycle)) each(a); });
  }
  #runRelay(r) {
    const cycle = r.n++, run = (i) => {
      if (i >= r.phases.length) { r.busy--; if (r.counter) this.counters[r.counter]++; return; }
      const todo = r.phases[i].filter((a) => this.#due(a, cycle));
      let waiting = todo.filter((a) => a.wait !== false).length, moved = false;
      const next = () => { if (!moved) { moved = true; run(i + 1); } };
      for (const a of todo) this.#launch(a, () => { if (a.wait !== false && --waiting === 0) next(); }, cycle);
      if (!waiting) next();
    };
    run(0);
  }
  /** One action of a relay: a flow-shaped journey. `hop` paces it per 20 Å hop (electrons between cofactors); `brown` joins its points by wandering paths. */
  #launch(a, done, cycle = 0) {
    const k = this.pace(), ctx = this.#ctx();
    if (a.pause !== undefined) { this.motion.wait(Math.max(0.001, a.pause) / k, () => { if (a.stage !== undefined) this.stage = a.stage; if (a.text && a.pt) this.events.add(a.text, add(a.pt, [0, 7, 0]), 2.2); done(); }); return; }
    let pts = a.pts;
    if (a.dynamic) { const via = a.via.flatMap((x) => this.anchor(x, { cycle })); pts = via.length > 1 ? via : [via[0], add(via[0], [0, 0.01, 0])]; }
    if (a.brown) { const keep = a.inside ? this.keepF[a.inside] : undefined; pts = pts.slice(0, 1); for (let i = 1; i < a.pts.length; i++) pts.push(...brownPath(a.pts[i - 1], a.pts[i], { n: 14, clear: a.clear ?? 12, free0: a.free ?? 14, free1: a.free ?? 14, wander: 0.25, keep }, ctx).slice(1)); }
    const tVia = a.tVia ?? (a.hop ? pts.slice(1).reduce((sum, p, i) => sum + a.hop * (0.35 + dist3(pts[i], p) / 20), 0) : undefined);
    const flow = { species: a.species, pts, from: a.from, to: a.to, free: a.free, tIn: a.tIn, tOut: a.tOut, tVia, labelVia: a.labelVia, counter: a.counter, tumble: a.tumble, events: [] };
    const start = () => {
      if (a.stage !== undefined) this.stage = a.stage;
      if (a.text) this.events.add(a.text, add(pts[0], [0, 7, 0]), 2.2);
      this.#runFlow(flow, () => { done(); for (const next of a.then ?? []) if (this.#due(next, cycle)) this.#launch(next, () => {}, cycle); });
    };
    if (a.delay > 0) this.motion.wait(a.delay / k, start); else start();
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
      if (f.perTurn) continue;   // these follow the rotor, not a rate
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
    if (this.kinetics) { this.kinetics.update(dt); this.#followKinetics(); }
    const pace = this.pace();
    if (this.rotor) this.#turnRotor(dt, pace);
    if (this.scale() === 'fast') {
      this.layer ||= this.#buildLayer();
      for (const { stream } of this.layer) stream.update(dt, pace);
      for (const x of [...this.flows, ...this.reacts]) if (x.counter && !x.perTurn) { x.acc = (x.acc || 0) + dt * pace * x.rate; while (x.acc >= 1) { x.acc--; this.counters[x.counter]++; } }
      for (const r of this.relays) if (this.#relayOpen(r)) { r.acc += dt * pace * r.rate; while (r.acc >= 1) { r.acc--; this.#countRelay(r); } }   // fast: the counters keep the stoichiometry
    } else {
      for (const f of this.flows) if (!f.perTurn) { f.t += dt * f.rate * pace * (f.by && this.kinetics ? this.kinetics.flux[f.by] ?? 1 : 1); if (f.t >= 1 && f.busy < (f.max ?? 3)) { f.t = 0; f.busy++; this.#runFlow(f); } else if (f.t > 1) f.t = 1; }
      for (const r of this.reacts) { r.t += dt * r.rate * pace; if (r.t >= 1 && r.busy < (r.max ?? 2)) { r.t = 0; r.busy++; this.#runReaction(r); } else if (r.t > 1) r.t = 1; }
      for (const r of this.relays) { r.t += dt * r.rate * pace; if (r.t >= 1 && r.busy < r.max && this.#relayOpen(r)) { r.t = 0; r.busy++; this.#runRelay(r); } else if (r.t > 1) r.t = 1; }
    }
    this.#derive();
    this.motion.tick(dt);
    this.pools.update(dt);
    this.motion.flush();
    this.events.tick(dt);
  }
  run(steps, dt = 1 / 30) { for (let i = 0; i < steps; i++) this.step(dt); }
  /** Advance by real time in fixed 1/30 s steps (at most 4 per call, so a long pause does not fast-forward); the picture then depends only on the seed and the step count. */
  advance(dt) {
    this.carry = (this.carry ?? 0) + Math.max(0, dt);
    let n = 0;
    while (this.carry >= STEP && n < 4) { this.step(STEP); this.carry -= STEP; n++; }
    if (this.carry > STEP) this.carry = STEP;
    return n;
  }

  /** What to draw: [{ kind: 'pool' | 'moving' | 'stream', name, position, radius, color, alpha, label? }] and the event tags still showing. */
  frame() {
    const items = [], look = (n) => speciesOf(n, this.pools.species);
    for (const p of this.pools.particles()) items.push({ kind: 'pool', name: p.name, position: p.position, radius: look(p.name).r, color: hexOf(look(p.name).col), alpha: p.alpha, ...(p.labelled ? { label: p.name } : {}) });
    for (const it of this.flying) items.push({ kind: 'moving', name: it.name, position: it.position, radius: look(it.name).r, color: hexOf(look(it.name).col), alpha: it.alpha ?? 1, label: it.label ?? it.name });
    if (this.scale() === 'fast' && this.layer) for (const { stream, def } of this.layer) stream.snapshot().forEach((q, i) => items.push({ kind: 'stream', name: q.name, position: q.position, radius: q.scale * 0.77, color: hexOf(def.col), alpha: 1, ...(i === 0 ? { label: q.name } : {}) }));
    return { items, tags: this.events.tags.map((t) => ({ ...t })) };
  }
  /** Counters, events and metering for the panels and for tests. */
  summary() { return { stage: this.stage, rotor: this.rotor ? { angle: this.rotor.angle, turns: this.rotor.travelled } : null, kinetics: this.kinetics ? { readout: this.kinetics.readout(), compartments: this.kinetics.compartments(), explain: this.kinetics.explain(), diverged: this.kinetics.diverged } : null, time: this.time, counters: { ...this.counters }, events: this.events.list(), inventory: this.inventory(), ledger: JSON.parse(JSON.stringify(this.ledger)), quantities: this.quantities(), violations: this.violations.slice(), warnings: this.warnings.slice() }; }
  /** Stop everything (the scene closed): nothing keeps running, nothing is called. */
  dispose() { this.kinetics = null; this.motion.clear(); this.flying.clear(); this.pools.clear(); this.layer = null; }
}
