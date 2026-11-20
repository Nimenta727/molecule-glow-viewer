/**
 * Data animations v1 (classic: `animation` of a scene, src/sim/data-anim.js): compartments, species, pools, flows and reactions written as plain data, with no
 * code in the package. This module reads such a declaration safely: it keeps only the known fields, clamps numbers, caps sizes and checks every reference
 * (a pool, flow or reaction that names a compartment that does not exist is an error here, where the classic simply crashed when it ran).
 * `normalizeDataAnimation(raw)` returns { spec, errors, warnings }; a spec with errors must not be run.
 *
 * Anchors (where in the structure something happens) are written as [x, y, z] or { ligand | ligands | residue | label_seq | part | membrane | centre, offset }. Beyond the classic:
 *   - `ligands: 'SF4,FES'` may list several component codes and be narrowed by `part` (the part the cofactor sits in), then picked: `pick` 'top' | 'bottom' | 'nearest' (to `to`) |
 *     'paired' | 'unpaired' (with / without another of the set within 3.5 Å), `rank` (0 = first), `above` / `below` (an anchor, `margin` Å) as filters, or `chain: 'down' | 'up'`:
 *     the electron-transfer path through all of them (the least sum of squared hops of at most 20 Å, from the top to the bottom or the reverse).
 *     `ring: true` uses the centre of the ring atoms (Mg and the four N of a chlorophyll or heme, as the classic) instead of all atoms; `near: { to, min, max }` (or a list) keeps those within that
 *     distance of an anchor; `pick: 'cycle'` takes the n-th of them in the n-th cycle of a relay (a deterministic stand-in for the classic's random choice).
 *     `else: anchor` is used when none is found, `optional: true` makes it no point at all (a path simply skips it);  `{ mirror: { point, about } }` is `point` reflected through `about`.
 *   - `{ pairMid: <ligands anchor>, maxGap, else }` the middle of the two closest of them (when closer than maxGap Å, else the `else` anchor);  `{ along: { from, to, distance } }` the point `distance` Å
 *     from `from` towards `to`;  a residue anchor may add `nearest: anchor` to take the matching residue closest to it;
 *   - `{ between: [A, B], t }` a point between two anchors;  `{ arm: 'part', fractions: [...], halfHeight }` points along the long horizontal axis of the part's residues near the membrane;
 *   - `onMembrane: { index, dy, blend }` on any anchor: the height moves `blend` of the way to that membrane plus `dy`;  `{ ref: 'name' }` an anchor named in `anchors`.
 * `rotor` (an addition): { parts: [part names], mode, turnsPerSecond, by?, stock? } a part that turns with the animation clock (its angle is a function of the clock, so a replay is exact); a flow with
 *   `perTurn: n` (and `phase`, in turns) sends one molecule every 1/n turn of it instead of at a rate; `derived: [{ name, terms: { counter: weight }, scale?, floor?, per?, round? }]` counters computed from others.
 * `relays` (an addition): a cycle made of phases; the actions of a phase run side by side (each is a flow-shaped journey) and the next phase starts when the waiting ones are done.
 */
export const DATA_LIMITS = Object.freeze({ species: 32, compartments: 16, pools: 32, pool: 200, flows: 16, reactions: 16, via: 64, events: 16, partners: 8, text: 200, name: 60, anchors: 64, relays: 8, phases: 24, actions: 16, relayActions: 120, derived: 16, rotorParts: 12 });
const ANCHOR_KEYS = ['ligand', 'ligands', 'residue', 'label_seq', 'part', 'membrane'];
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== true && v !== false ? Number(v) : fallback);
const str = (v, max = DATA_LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : '');
const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** One anchor, cleaned; null when it is not an anchor at all. */
export function normalizeAnchor(a, depth = 0) {
  if (Array.isArray(a)) return a.length >= 3 && a.slice(0, 3).every((v) => Number.isFinite(Number(v))) ? [Number(a[0]), Number(a[1]), Number(a[2])] : null;
  if (!isObject(a) || depth > 4) return null;
  const out = {}, sub = (v) => normalizeAnchor(v, depth + 1);
  const offset = Array.isArray(a.offset) ? [num(a.offset[0], 0), num(a.offset[1], 0), num(a.offset[2], 0)] : undefined;
  if (a.ref != null) { out.ref = str(String(a.ref), DATA_LIMITS.name); if (!out.ref) return null; }
  else if (a.ligand != null || a.ligands != null) {
    if (a.ligand != null) { out.ligand = str(String(a.ligand), 40); out.index = Math.max(0, Math.round(num(a.index, 0))); }
    else { out.ligands = str(String(a.ligands), 40); if (a.order === 'up' || a.order === 'down') out.order = a.order; }
    if (a.part != null) out.part = str(String(a.part), 240);
    if (['top', 'bottom', 'nearest', 'paired', 'unpaired', 'cycle'].includes(a.pick)) out.pick = a.pick;
    if (a.ring) out.ring = true;
    if (a.optional) out.optional = true;
    if (a.else !== undefined) { const e = sub(a.else); if (!e) return null; out.else = e; }
    if (a.near !== undefined) {
      const list = (Array.isArray(a.near) ? a.near : [a.near]).slice(0, 4).map((n) => { const to = sub(n?.to); return to ? { to, ...(Number.isFinite(Number(n.min)) ? { min: Number(n.min) } : {}), ...(Number.isFinite(Number(n.max)) ? { max: Number(n.max) } : {}) } : null; });
      if (list.some((n) => !n)) return null; out.near = list;
    }
    if (a.chain === 'down' || a.chain === 'up') out.chain = a.chain;
    if (a.take === 'first' || a.take === 'last') out.take = a.take;
    if (a.rank !== undefined) out.rank = Math.max(0, Math.min(63, Math.round(num(a.rank, 0))));
    for (const key of ['to', 'above', 'below']) if (a[key] !== undefined) { const v = sub(a[key]); if (!v) return null; out[key] = v; }
    if (a.margin !== undefined) out.margin = num(a.margin, 0);
    if (out.pick === 'nearest' && !out.to) return null;
  }
  else if (a.pairMid != null) {
    const inner = sub(a.pairMid); if (!inner) return null;
    out.pairMid = inner; out.maxGap = Math.max(0, num(a.maxGap, 12)); if (a.else !== undefined) { const e = sub(a.else); if (!e) return null; out.else = e; }
  }
  else if (a.mirror != null) {
    const point = sub(a.mirror?.point), about = sub(a.mirror?.about); if (!point || !about) return null; out.mirror = { point, about };
  }
  else if (a.along != null) {
    const from = sub(a.along?.from), to = sub(a.along?.to); if (!from || !to) return null;
    out.along = { from, to, distance: num(a.along.distance, 0) };
  }
  else if (a.between != null) {
    const pair = Array.isArray(a.between) && a.between.length === 2 ? a.between.map(sub) : [];
    if (pair.length !== 2 || pair.some((x) => !x)) return null;
    out.between = pair; out.t = Math.max(0, Math.min(1, num(a.t, 0.5)));
  }
  else if (a.arm != null) {
    out.arm = str(String(a.arm), 80); if (!out.arm) return null;
    out.fractions = (Array.isArray(a.fractions) && a.fractions.length ? a.fractions : [0.5]).slice(0, 8).map((f) => Math.max(0, Math.min(1, num(f, 0.5)))); out.halfHeight = Math.max(1, Math.min(200, num(a.halfHeight, 18)));
  }
  else if (a.residue != null) { out.residue = str(String(a.residue), 12); if (a.part != null) out.part = str(String(a.part), 240); if (a.chain != null) out.chain = str(String(a.chain), 8); if (a.nearest !== undefined) { const n = sub(a.nearest); if (!n) return null; out.nearest = n; } }
  else if (a.label_seq != null) { out.label_seq = Math.round(num(a.label_seq, NaN)); if (!Number.isFinite(out.label_seq)) return null; if (a.part != null) out.part = str(String(a.part), 240); if (a.label_asym != null) out.label_asym = str(String(a.label_asym), 8); }
  else if (a.part != null) out.part = str(String(a.part), 240);
  else if (a.membrane != null) out.membrane = Math.max(0, Math.min(1, Math.round(num(a.membrane, 0))));
  else if (!a.centre && !Object.keys(a).every((k) => k === 'offset' || k === 'onMembrane')) return null;
  if (offset) out.offset = offset;
  if (isObject(a.onMembrane)) out.onMembrane = { index: Math.max(0, Math.min(1, Math.round(num(a.onMembrane.index, 0)))), dy: num(a.onMembrane.dy, 0), blend: Math.max(0, Math.min(1, num(a.onMembrane.blend, 1))) };
  return out;
}

/** Every `ref` an anchor (or the anchors inside it) uses. */
export function anchorRefs(a, out = []) {
  if (!isObject(a)) return out;
  if (a.ref) out.push(a.ref);
  for (const key of ['to', 'above', 'below', 'pairMid', 'else', 'nearest']) if (a[key]) anchorRefs(a[key], out);
  if (a.mirror) { anchorRefs(a.mirror.point, out); anchorRefs(a.mirror.about, out); }
  for (const n of a.near ?? []) anchorRefs(n.to, out);
  for (const x of a.between ?? []) anchorRefs(x, out);
  if (a.along) { anchorRefs(a.along.from, out); anchorRefs(a.along.to, out); }
  return out;
}

export function normalizeDataAnimation(raw) {
  const errors = [], warnings = [];
  const spec = { version: 1, species: {}, compartments: {}, pools: [], flows: [], reactions: [], conserved: [] };
  if (!isObject(raw)) return { spec, errors: ['数据动画必须是一个对象。'], warnings };
  if (raw.version !== 1) errors.push(`数据动画版本 ${String(raw.version)} 不受支持（只支持 1）。`);
  const orient = normalizeAnchor(raw.orient?.up);
  if (raw.orient?.up !== undefined) { if (orient) spec.orient = { up: orient }; else warnings.push('orient.up 不是有效的锚点，已忽略。'); }

  for (const [name, s] of Object.entries(isObject(raw.species) ? raw.species : {}).slice(0, DATA_LIMITS.species)) {
    spec.species[str(name, DATA_LIMITS.name)] = { col: typeof s?.col === 'string' && COLOUR.test(s.col) ? s.col : '#ffffff', r: Math.max(0.8, Math.min(6, num(s?.r, 2.4))) };
  }
  const comps = isObject(raw.compartments) && Object.keys(raw.compartments).length ? raw.compartments : { 溶液: {} };
  for (const [name, d] of Object.entries(comps).slice(0, DATA_LIMITS.compartments)) {
    const c = {};
    if (d?.side === 'above' || d?.side === 'below') c.side = d.side;
    if (d?.membrane !== undefined) c.membrane = Math.max(0, Math.min(1, Math.round(num(d.membrane, 0))));
    if (d?.gap !== undefined) c.gap = Math.max(0, num(d.gap, 20));
    if (d?.r !== undefined) c.r = Math.max(0.1, Math.min(10, num(d.r, 1.2)));
    spec.compartments[str(name, DATA_LIMITS.name)] = c;
  }
  const known = new Set(Object.keys(spec.compartments)), where = (value, what) => { if (!known.has(value)) errors.push(`${what}写了不存在的区室“${String(value)}”。`); return str(String(value), DATA_LIMITS.name); };
  const species = (value, what) => { const name = str(typeof value === 'string' ? value : '', DATA_LIMITS.name); if (!name) errors.push(`${what}缺少分子种类。`); return name; };

  // named anchors: the places other anchors, flows and relays refer to by `{ ref: name }`
  if (raw.anchors !== undefined) {
    if (!isObject(raw.anchors)) warnings.push('anchors 必须是 { 名字: 锚点 } 对象，已忽略。');
    else {
      spec.anchors = {};
      for (const [name, a] of Object.entries(raw.anchors).slice(0, DATA_LIMITS.anchors)) { const clean = normalizeAnchor(a); if (clean) spec.anchors[str(name, DATA_LIMITS.name)] = clean; else errors.push(`命名锚点“${name}”不是有效的锚点。`); }
    }
  }

  (Array.isArray(raw.pools) ? raw.pools : []).slice(0, DATA_LIMITS.pools).forEach((p, i) => {
    spec.pools.push({ species: species(p?.species, `第 ${i + 1} 个池`), in: where(p?.in ?? '溶液', `第 ${i + 1} 个池`), n: Math.max(0, Math.min(DATA_LIMITS.pool, Math.round(num(p?.n, 6)))) });
  });

  const rate = (value, what) => { const r = num(value, 0.5); if (!(r > 0)) { warnings.push(`${what}的速率不是正数，它不会发生。`); return 0; } return Math.min(r, 20); };
  const timing = (src, keys) => Object.fromEntries(keys.filter((k) => src?.[k] !== undefined && num(src[k], NaN) >= 0).map((k) => [k, num(src[k], 0)]));
  (Array.isArray(raw.flows) ? raw.flows : []).slice(0, DATA_LIMITS.flows).forEach((f, i) => {
    const what = `第 ${i + 1} 条流`;
    const via = (Array.isArray(f?.via) ? f.via : []).slice(0, DATA_LIMITS.via).map(normalizeAnchor);
    if (!via.length || via.some((a) => a === null)) errors.push(`${what}的路径（via）必须是至少一个有效锚点。`);
    const perTurn = Number.isFinite(Number(f?.perTurn)) && Number(f.perTurn) >= 1 ? Math.min(200, Math.round(Number(f.perTurn))) : 0;
    const flow = { name: str(f?.name, DATA_LIMITS.name) || undefined, species: species(f?.species, what), via: via.filter(Boolean), rate: perTurn ? 0.5 : rate(f?.rate, what),
      ...timing(f, ['free', 'tIn', 'tVia', 'tOut', 'max', 'stoich']), ...(f?.tumble ? { tumble: true } : {}), ...(f?.by === 'rotor' || f?.by === 'rate' ? { by: f.by } : {}) };
    if (perTurn) { flow.perTurn = perTurn; flow.phase = Math.max(0, Math.min(1, num(f?.phase, 0))); }
    if (f?.from != null) flow.from = where(f.from, what); if (f?.to != null) flow.to = where(f.to, what);
    if (typeof f?.labelVia === 'string') flow.labelVia = str(f.labelVia, DATA_LIMITS.name);
    if (typeof f?.counter === 'string' && f.counter) flow.counter = str(f.counter, DATA_LIMITS.name);
    flow.events = (Array.isArray(f?.events) ? f.events : []).slice(0, DATA_LIMITS.events).filter((e) => typeof e?.text === 'string').map((e) => ({ at: Math.max(0, Math.round(num(e.at, 0))), text: str(e.text) }));
    if (!flow.name) delete flow.name;
    spec.flows.push(flow);
  });

  (Array.isArray(raw.reactions) ? raw.reactions : []).slice(0, DATA_LIMITS.reactions).forEach((r, i) => {
    const what = `第 ${i + 1} 个反应`, site = normalizeAnchor(r?.site);
    if (!site) errors.push(`${what}缺少有效的位点（site）。`);
    const partners = (list, key, label) => (Array.isArray(list) ? list : []).slice(0, DATA_LIMITS.partners).map((s) => {
      const out = { species: species(s?.species, `${what}的${label}`) };
      if (s?.[key] != null) out[key] = where(s[key], `${what}的${label}`); else if (key === 'from') errors.push(`${what}的反应物“${out.species}”没有来源区室（from）。`);
      return out;
    });
    const reaction = { site, in: partners(r?.in, 'from', '反应物'), out: partners(r?.out, 'to', '产物'), rate: rate(r?.rate, what), ...timing(r, ['free', 'tIn', 'hold', 'tOut', 'max']) };
    if (!reaction.in.length) errors.push(`${what}没有反应物。`);
    if (typeof r?.name === 'string' && r.name) reaction.name = str(r.name, DATA_LIMITS.name);
    if (typeof r?.text === 'string' && r.text) reaction.text = str(r.text);
    if (typeof r?.counter === 'string' && r.counter) reaction.counter = str(r.counter, DATA_LIMITS.name);
    spec.reactions.push(reaction);
  });

  // Relays (an addition): a cycle of phases; the actions of one phase are flow-shaped journeys that run side by side.
  if (raw.relays !== undefined) {
    const clampInt = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(num(v, d))));
    let total = 0;
    // one action: a flow-shaped journey, or a pause; `then` actions start when it has finished
    const action = (x, where2, depth) => {
      if (x?.pause !== undefined) {
        const pause = { pause: Math.max(0, Math.min(60, num(x.pause, 0))) };
        if (x.stage !== undefined) pause.stage = clampInt(x.stage, 0, 99, 0);
        if (x.wait === false) pause.wait = false;
        if (typeof x.text === 'string' && x.text) { const at = normalizeAnchor(x.at); if (!at) errors.push(`${where2}的文字需要位置（at）。`); else { pause.text = str(x.text); pause.at = at; } }
        return pause;
      }
      const via = (Array.isArray(x?.via) ? x.via : []).slice(0, DATA_LIMITS.via).map((a) => normalizeAnchor(a));
      if (!via.length || via.some((a) => a === null)) errors.push(`${where2}的路径（via）必须是至少一个有效锚点。`);
      const out = { species: species(x?.species, where2), via: via.filter(Boolean), ...timing(x, ['free', 'clear', 'tIn', 'tVia', 'tOut', 'hop', 'delay']) };
      if (x?.from != null) out.from = where(x.from, where2); if (x?.to != null) out.to = where(x.to, where2);
      if (typeof x?.labelVia === 'string') out.labelVia = str(x.labelVia, DATA_LIMITS.name);
      if (typeof x?.counter === 'string' && x.counter) out.counter = str(x.counter, DATA_LIMITS.name);
      if (typeof x?.text === 'string' && x.text) out.text = str(x.text);
      if (x?.wait === false) out.wait = false;
      if (x?.every !== undefined) out.every = clampInt(x.every, 1, 20, 1);
      if (x?.stage !== undefined) out.stage = clampInt(x.stage, 0, 99, 0);
      if (x?.brown) out.brown = true;
      if (x?.tumble) out.tumble = true;
      if (typeof x?.inside === 'string' && x.inside) out.inside = where(x.inside, where2);
      if (Array.isArray(x?.then) && x.then.length) { if (depth >= 2) errors.push(`${where2}的 then 嵌套太深（最多 2 层）。`); else out.then = x.then.slice(0, DATA_LIMITS.actions).map((y, k) => action(y, `${where2}的第 ${k + 1} 个后续动作`, depth + 1)); }
      return out;
    };
    spec.relays = (Array.isArray(raw.relays) ? raw.relays : []).slice(0, DATA_LIMITS.relays).map((r, i) => {
      const what = `第 ${i + 1} 个接力`, relay = { name: str(r?.name, DATA_LIMITS.name) || `接力 ${i + 1}`, rate: rate(r?.rate, what), max: clampInt(r?.max, 1, 4, 1), phases: [] };
      if (r?.gate === 'flux') relay.gate = 'flux';
      if (typeof r?.counter === 'string' && r.counter) relay.counter = str(r.counter, DATA_LIMITS.name);
      const phases = Array.isArray(r?.phases) ? r.phases.slice(0, DATA_LIMITS.phases) : [];
      if (!phases.length) errors.push(`${what}没有阶段（phases）。`);
      phases.forEach((phase, pi) => {
        const list = Array.isArray(phase) ? phase.slice(0, DATA_LIMITS.actions) : [];
        if (!list.length) errors.push(`${what}的第 ${pi + 1} 个阶段没有动作。`);
        relay.phases.push(list.map((x, ai) => { total++; return action(x, `${what}第 ${pi + 1} 阶段的第 ${ai + 1} 个动作`, 0); }));
      });
      return relay;
    });
    if (total > DATA_LIMITS.relayActions) errors.push(`接力的动作太多（最多 ${DATA_LIMITS.relayActions} 个）。`);
  }

  // the rotor and the counters computed from others
  if (raw.rotor !== undefined) {
    const r = isObject(raw.rotor) ? raw.rotor : {}, parts = (Array.isArray(r.parts) ? r.parts : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => str(x.trim(), 80)).slice(0, DATA_LIMITS.rotorParts);
    if (!parts.length) errors.push('rotor 至少要写一个转动的部件名（parts）。');
    spec.rotor = { parts, mode: ['sym', 'long', 'short', 'x', 'y', 'z'].includes(r.mode) ? r.mode : 'sym', turnsPerSecond: Math.max(-2, Math.min(2, num(r.turnsPerSecond, 0.1))) };
    if (r.by === 'rotor' || r.by === 'rate') spec.rotor.by = r.by;
    if (typeof r.stock === 'string' && r.stock) spec.rotor.stock = str(r.stock, DATA_LIMITS.name);
  }
  if (raw.derived !== undefined) {
    spec.derived = (Array.isArray(raw.derived) ? raw.derived : []).slice(0, DATA_LIMITS.derived).flatMap((d, i) => {
      const terms = Object.fromEntries(Object.entries(isObject(d?.terms) ? d.terms : {}).filter(([, w]) => Number.isFinite(Number(w))).map(([k, w]) => [str(k, DATA_LIMITS.name), Number(w)]));
      if (typeof d?.name !== 'string' || !d.name || !Object.keys(terms).length) { warnings.push(`第 ${i + 1} 个派生计数器没有名称或项，已忽略。`); return []; }
      return [{ name: str(d.name, DATA_LIMITS.name), terms, ...(Number.isFinite(Number(d.scale)) ? { scale: Number(d.scale) } : {}), ...(d.floor ? { floor: true } : {}), ...(typeof d.per === 'string' && d.per ? { per: str(d.per, DATA_LIMITS.name) } : {}), ...(Number.isInteger(d.round) && d.round >= 0 && d.round <= 6 ? { round: d.round } : {}) }];
    });
  }

  // every `ref` must name an anchor
  {
    const names = new Set(Object.keys(spec.anchors ?? {})), used = [...anchorRefs(spec.orient?.up), ...spec.flows.flatMap((f) => f.via.flatMap((a) => anchorRefs(a))), ...spec.reactions.flatMap((r) => anchorRefs(r.site)),
      ...(spec.relays ?? []).flatMap((r) => r.phases.flatMap((ph) => ph.flatMap(function walk(x) { return [...(x.via ?? []).flatMap((a) => anchorRefs(a)), ...(x.at ? anchorRefs(x.at) : []), ...(x.then ?? []).flatMap(walk)]; }))), ...Object.values(spec.anchors ?? {}).flatMap((a) => anchorRefs(a))];
    for (const name of new Set(used)) if (!names.has(name)) errors.push(`引用了不存在的命名锚点“${name}”（可用：${[...names].join('、') || '无'}）。`);
  }

  // Conserved quantities (an addition to the classic format): { name, weights: { species: amount } }. A reaction must keep each one.
  (Array.isArray(raw.conserved) ? raw.conserved : []).slice(0, 8).forEach((c, i) => {
    const weights = Object.fromEntries(Object.entries(isObject(c?.weights) ? c.weights : {}).filter(([, w]) => Number.isFinite(Number(w))).map(([k, w]) => [str(k, DATA_LIMITS.name), Number(w)]));
    if (typeof c?.name === 'string' && c.name && Object.keys(weights).length) spec.conserved.push({ name: str(c.name, DATA_LIMITS.name), weights });
    else warnings.push(`第 ${i + 1} 个守恒量没有名称或权重，已忽略。`);
  });
  if (!spec.pools.length && !spec.flows.length && !spec.reactions.length && !spec.relays?.length) warnings.push('这个数据动画没有任何池、流或反应。');
  return { spec, errors, warnings };
}
