import { compileExpression, ExpressionError } from './expression.mjs';

/**
 * Stochastic state processes as data (4.4.4): a continuous-time Markov chain with the rate formulas written in the safe expression language. The mathematical
 * model is this engine (exact Gillespie sampling on a seeded stream, a schedule of parameter changes, clocks, counters); a work supplies only a declaration:
 *
 *   { version: 1, title,
 *     constants:  { k1: 9e8 },
 *     parameters: [{ id, label, min, max, step, default, unit?, integer? }],         numbers the user or a schedule sets (voltage, pH, concentrations, clock factors)
 *     variables:  { gate: { values: ['C', 'O', 'I'], init: 'C' } },                  the discrete state; a name `gate_O` is 1 while gate is O, else 0
 *     derived:    [{ name: 'h', expr }],                                              shared formulas, evaluated in order before the rates
 *     transitions:[{ id, label, when?, rate, set?: { gate: 'O' }, count?: { out: 1 } }],   in order; a transition runs only while `when` is true and its `rate` is positive
 *     counters:   ['out', 'inn'],
 *     clocks:     [{ name: 'ns', add: 'conducting ? dt * speed * ionSpeed : 0' }],    totals that grow by `add` over each interval (`dt` seconds, state at its start)
 *     observables:[{ name: 'EK', expr }] }                                            numbers to record (may read counters and clocks)
 *
 * The draws are the classic's: one uniform for the waiting time (none when no transition can run), one to choose among the transitions in their order, and a
 * parameter change that falls before the next event is a boundary event that keeps the state. Seeking and replaying give the same history for any partition.
 */
export const MARKOV_LIMITS = Object.freeze({ constants: 64, parameters: 24, variables: 12, values: 16, derived: 32, transitions: 64, counters: 16, clocks: 8, observables: 16, events: 250000 });
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9_+\-]{1,24}$/;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The seeded uniform stream of the KcsA kinetics (a mulberry32 variant), so histories are comparable. */
export function markovRandom(seed) {
  let rng = seed >>> 0;
  return () => { rng = (rng + 0x6d2b79f5) >>> 0; let n = rng; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

/** Reads and compiles a declaration; returns { model, errors }. A model with errors must not be run. */
export function compileMarkovModel(raw) {
  const errors = [], model = { version: 1, title: '', constants: {}, parameters: [], variables: {}, derived: [], transitions: [], counters: [], clocks: [], observables: [] };
  if (!isObject(raw)) return { model, errors: ['随机过程必须是一个对象。'] };
  if (raw.version !== 1) errors.push(`随机过程版本 ${String(raw.version)} 不受支持（只支持 1）。`);
  model.title = typeof raw.title === 'string' ? raw.title.slice(0, 80) : '';
  const taken = new Set(['dt']);
  const declare = (name, what) => { if (typeof name !== 'string' || !KEY.test(name) || name === 'true' || name === 'false') { errors.push(`${what}的名称“${String(name)}”不合法。`); return false; } if (taken.has(name)) { errors.push(`名称“${name}”重复。`); return false; } taken.add(name); return true; };
  for (const [name, v] of Object.entries(isObject(raw.constants) ? raw.constants : {}).slice(0, MARKOV_LIMITS.constants)) if (declare(name, '常量')) { if (!finite(v)) errors.push(`常量 ${name} 必须是有限的数。`); else model.constants[name] = v; }
  (Array.isArray(raw.parameters) ? raw.parameters : []).slice(0, MARKOV_LIMITS.parameters).forEach((p, i) => {
    if (!declare(p?.id, `第 ${i + 1} 个参数`)) return;
    if (![p.min, p.max, p.step, p.default].every(finite) || p.min > p.max || !(p.step > 0) || p.default < p.min || p.default > p.max) { errors.push(`参数 ${p.id} 的范围/步长/默认值不合法。`); return; }
    model.parameters.push({ id: p.id, label: typeof p.label === 'string' ? p.label.slice(0, 80) : p.id, min: p.min, max: p.max, step: p.step, default: p.default, unit: typeof p.unit === 'string' ? p.unit.slice(0, 12) : '', integer: Boolean(p.integer) });
  });
  const flags = new Set(), state0 = {};
  for (const [name, v] of Object.entries(isObject(raw.variables) ? raw.variables : {}).slice(0, MARKOV_LIMITS.variables)) {
    if (!KEY.test(name)) { errors.push(`变量的名称“${name}”不合法。`); continue; }
    const values = Array.isArray(v?.values) ? v.values.slice(0, MARKOV_LIMITS.values) : [];
    if (values.length < 2 || values.some((x) => typeof x !== 'string' || !KEY.test(x)) || new Set(values).size !== values.length) { errors.push(`变量 ${name} 需要至少两个互不相同的取值（字母/数字/下划线）。`); continue; }
    if (!values.includes(v.init)) { errors.push(`变量 ${name} 的初值必须是它的取值之一。`); continue; }
    model.variables[name] = { values, init: v.init }; state0[name] = v.init;
    for (const x of values) { const flag = `${name}_${x}`; if (!declare(flag, `变量 ${name} 的取值标志`)) continue; flags.add(flag); }
  }
  const rateNames = () => new Set([...Object.keys(model.constants), ...model.parameters.map((p) => p.id), ...flags, ...model.derived.map((d) => d.name)]);
  const compile = (what, expr, names) => { try { return compileExpression(expr, names); } catch (e) { errors.push(`${what}：${e instanceof ExpressionError ? e.message : e}（${String(expr).slice(0, 60)}）`); return null; } };
  (Array.isArray(raw.derived) ? raw.derived : []).slice(0, MARKOV_LIMITS.derived).forEach((d, i) => {
    const fn = compile(`第 ${i + 1} 个派生量`, d?.expr, rateNames());
    if (fn && declare(d.name, `第 ${i + 1} 个派生量`)) model.derived.push({ name: d.name, fn });
  });
  const counters = (Array.isArray(raw.counters) ? raw.counters : []).slice(0, MARKOV_LIMITS.counters);
  for (const name of counters) if (declare(name, '计数器')) model.counters.push(name);
  const seen = new Set();
  (Array.isArray(raw.transitions) ? raw.transitions : []).slice(0, MARKOV_LIMITS.transitions).forEach((t, i) => {
    const what = `第 ${i + 1} 个转移`;
    if (typeof t?.id !== 'string' || !ID.test(t.id)) { errors.push(`${what}需要名称（字母数字和 _ + -，至多 24 个字符）。`); return; }
    if (seen.has(t.id)) { errors.push(`转移“${t.id}”重复。`); return; }
    seen.add(t.id);
    const names = rateNames(), when = t.when === undefined ? () => 1 : compile(`${what}“${t.id}”的条件`, t.when, names), rate = compile(`${what}“${t.id}”的速率`, t.rate, names);
    const set = {}, count = {};
    for (const [k, v] of Object.entries(isObject(t.set) ? t.set : {})) { if (!model.variables[k]) errors.push(`${what}“${t.id}”设置了不存在的变量“${k}”。`); else if (!model.variables[k].values.includes(v)) errors.push(`${what}“${t.id}”把 ${k} 设成了不存在的取值“${String(v)}”。`); else set[k] = v; }
    for (const [k, v] of Object.entries(isObject(t.count) ? t.count : {})) { if (!model.counters.includes(k)) errors.push(`${what}“${t.id}”给不存在的计数器“${k}”计数。`); else if (!finite(v)) errors.push(`${what}“${t.id}”的计数必须是数。`); else count[k] = v; }
    if (when && rate) model.transitions.push({ id: t.id, label: typeof t.label === 'string' ? t.label.slice(0, 80) : t.id, when, rate, set, count });
  });
  (Array.isArray(raw.clocks) ? raw.clocks : []).slice(0, MARKOV_LIMITS.clocks).forEach((c, i) => {
    const fn = compile(`第 ${i + 1} 个时钟`, c?.add, new Set([...rateNames(), 'dt']));
    if (fn && declare(c.name, `第 ${i + 1} 个时钟`)) model.clocks.push({ name: c.name, fn });
  });
  (Array.isArray(raw.observables) ? raw.observables : []).slice(0, MARKOV_LIMITS.observables).forEach((o, i) => {
    const fn = compile(`第 ${i + 1} 个观测量`, o?.expr, new Set([...rateNames(), ...model.counters, ...model.clocks.map((c) => c.name)]));
    if (fn && typeof o.name === 'string' && KEY.test(o.name)) model.observables.push({ name: o.name, label: typeof o.label === 'string' ? o.label.slice(0, 80) : o.name, unit: typeof o.unit === 'string' ? o.unit.slice(0, 12) : '', fn });
    else if (fn) errors.push(`第 ${i + 1} 个观测量的名称不合法。`);
  });
  if (!model.transitions.length) errors.push('随机过程没有任何转移。');
  model.initial = state0;
  return { model, errors };
}

/** Checks one full set of parameter values against the declaration; returns a clean copy (throws a message). */
export function validateParameterSet(model, values) {
  if (!isObject(values)) throw new Error('参数需要对象。');
  const out = {};
  for (const p of model.parameters) {
    const v = values[p.id] ?? p.default;
    if (!finite(v) || v < p.min || v > p.max || (p.integer && !Number.isInteger(v))) throw new Error(`参数 ${p.id}（${p.label}）应在 ${p.min}–${p.max} 之间${p.integer ? '且是整数' : ''}。`);
    out[p.id] = v;
  }
  for (const k of Object.keys(values)) if (k !== 'time' && !(k in out)) throw new Error(`没有参数“${k}”。`);
  return out;
}

/**
 * A seeded run. `schedule` is the parameter sets over time: [{ time: 0, ...parameters }, { time: 30, ...changed }, ...] (each a full set; missing ones take the
 * default). `at(time)` gives the state at any time, replaying the same event history however the times are asked for.
 */
export function createMarkovRun(raw, seed, schedule = [{ time: 0 }]) {
  const { model, errors } = compileMarkovModel(raw);
  if (errors.length) throw new Error(`随机过程无法运行：${errors.join('；')}`);
  const sets = schedule.map((entry) => ({ time: entry.time ?? 0, ...validateParameterSet(model, entry) }));
  if (!sets.length || sets[0].time !== 0 || sets.some((s, i) => i && !(s.time > sets[i - 1].time))) throw new Error('参数时间表要从 0 开始并按时间递增。');
  const random = markovRandom(seed);
  const zero = (names) => Object.fromEntries(names.map((n) => [n, 0]));
  const history = [{ time: 0, vars: { ...model.initial }, counters: zero(model.counters), clocks: zero(model.clocks.map((c) => c.name)), configIndex: 0, id: 'initial' }];
  const scopeOf = (state, params, extra = {}) => {
    const scope = Object.create(null);
    Object.assign(scope, model.constants, params);
    for (const [name, v] of Object.entries(model.variables)) for (const x of v.values) scope[`${name}_${x}`] = +(state.vars[name] === x);
    for (const d of model.derived) scope[d.name] = d.fn(scope);
    return Object.assign(scope, extra);
  };
  const advance = (state, time, params) => {
    const dt = time - state.time, scope = scopeOf(state, params, { dt });
    return Object.fromEntries(model.clocks.map((c) => [c.name, state.clocks[c.name] + c.fn(scope)]));
  };
  let pending;
  function next() {
    const s = history.at(-1), params = sets[s.configIndex], scope = scopeOf(s, params);
    const rates = [];
    for (const t of model.transitions) { if (!t.when(scope)) continue; const r = t.rate(scope); if (r > 0) rates.push([r, t]); }
    const total = rates.reduce((sum, [r]) => sum + r, 0);
    const tau = total ? -Math.log(1 - random()) / total : Infinity;
    const boundary = sets[s.configIndex + 1]?.time ?? Infinity;
    if (s.time + tau >= boundary) return { ...s, clocks: advance(s, boundary, params), time: boundary, configIndex: s.configIndex + 1, id: 'parameter' };
    if (!Number.isFinite(tau)) return { ...s, time: Infinity };
    let pick = random() * total, chosen = rates.at(-1)[1];
    for (const [r, t] of rates) { pick -= r; if (pick <= 0) { chosen = t; break; } }
    const time = s.time + tau, result = { ...s, vars: { ...s.vars, ...chosen.set }, counters: { ...s.counters }, clocks: advance(s, time, params), time, id: chosen.id };
    for (const [k, v] of Object.entries(chosen.count)) result.counters[k] += v;
    return result;
  }
  const labels = Object.fromEntries(model.transitions.map((t) => [t.id, t.label]));
  const view = (s, time) => {
    const params = sets[Math.min(s.configIndex, sets.length - 1)], state = { ...s, clocks: advance(s, time, params), time };
    const scope = scopeOf(state, params, { ...state.counters, ...state.clocks });
    return { ...state, parameters: params, observables: Object.fromEntries(model.observables.map((o) => [o.name, o.fn(scope)])) };
  };
  return {
    model,
    /** The state at `time`: the variables, counters, clocks, the parameters in force, the observables, and the last 20 events. */
    at(time) {
      while (true) {
        pending ??= next();
        if (pending.time > time) break;
        if (history.length > MARKOV_LIMITS.events) throw new Error('随机过程事件容量已满。');
        history.push(pending); pending = undefined;
      }
      let lo = 0, hi = history.length;
      while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (history[mid].time <= time) lo = mid; else hi = mid; }
      return { ...view(history[lo], time), events: history.slice(Math.max(1, lo - 19), lo + 1).map(({ time: t, id }) => ({ time: t, id, label: labels[id] ?? '参数变更' })) };
    },
    /** Every event up to `time` (for tests and plots). */
    events(time) { this.at(time); return history.filter((s) => s.time <= time && s.id !== 'initial').map((s) => ({ time: s.time, id: s.id })); },
  };
}
