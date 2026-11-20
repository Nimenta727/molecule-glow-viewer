import { compileExpression, ExpressionError } from './expression.mjs';

/**
 * Data-only kinetic models for compartments (classic: the `cell: { init, step, controls, series, comps, dots, explain }` that a process wrote as code in
 * src/sim/cell-kinetics.js and src/sim/processes/*). The same model as plain data, with every formula in the safe expression language:
 *
 *   { version: 1, title,
 *     constants: { NADt: 3 },                         numbers the formulas use
 *     state:     { pmf: 0, nadh: 0.5 },               the variables that change, with their start values
 *     inputs:    { effluxed: 'K⁺ 外流' },                       read-only numbers the animation supplies (here: the value of the counter of that name)
 *     controls:  [{ id, type: 'toggle', label, tip, default }, { id, type: 'range', label, min, max, step, default, unit }],
 *     step:      [{ let: 'x', expr }, { set: 'pmf', expr }, ...],   run in order every step; `h` is the step length (s); each line sees what the lines above made
 *     series:    [{ label, range: [lo, hi], color, expr, format: { digits, scale, divide, unit } }],   curves and read-outs; shown as (value / divide * scale).toFixed(digits) + unit
 *     compartments: [{ name, pH: expr }],                                                       pH of each compartment (colour of its volume)
 *     dots:      [{ label, comp, color, ink, r, max, count: expr }],                            how many free molecules to show in a compartment
 *     explain:   [{ when: expr, text: 'text with {expr|digits}' }, ...],                         the first line whose `when` is true is shown
 *     warmup: true }
 *
 * A `let` makes a value for the lines below and for the series, dots and text (the classic step's returned fluxes are just such values; `rate` and `rotor`
 * pace the animation, 1 when not defined). A `set` changes a state variable at once, so later lines see the new value, exactly as the classic code did.
 * Updating is forward Euler on a 0.02 s grid; a model whose numbers stop being finite is stopped and reported rather than drawn.
 */
export const KINETIC_LIMITS = Object.freeze({ constants: 64, state: 32, controls: 16, step: 96, series: 12, compartments: 4, dots: 12, explain: 16, text: 600, name: 40 });
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const RESERVED = new Set(['h', 'true', 'false']);
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const PH_STOPS = [[5.0, '#e8503a'], [5.8, '#ff8a3d'], [6.5, '#f5c84a'], [7.0, '#c9d96a'], [7.5, '#86cfa0'], [8.0, '#6fb1f0'], [8.6, '#5a7fe0']];

/** The colour of a solution at a pH (classic phColour), as '#rrggbb'. Blended in linear light, as three.js does, so the in-between colours are the same. */
const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808049536 : (c * 0.9478672985781991 + 0.0521327014218009) ** 2.4);
const toSRGB = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055);
export function phColour(pH) {
  const S = PH_STOPS, rgb = (hex) => [1, 3, 5].map((k) => toLinear(parseInt(hex.slice(k, k + 2), 16) / 255));
  const out = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, toSRGB(v))) * 255).toString(16).padStart(2, '0')).join('');
  if (pH <= S[0][0]) return out(rgb(S[0][1]));
  for (let i = 1; i < S.length; i++) if (pH <= S[i][0]) { const u = (pH - S[i - 1][0]) / (S[i][0] - S[i - 1][0]), a = rgb(S[i - 1][1]), b = rgb(S[i][1]); return out(a.map((v, k) => v + (b[k] - v) * u)); }
  return out(rgb(S[S.length - 1][1]));
}

/** Reads and compiles a model; returns { model, errors }. A model with errors must not be run. */
export function compileKineticModel(raw) {
  const errors = [], model = { version: 1, title: '', constants: {}, state: {}, controls: [], step: [], series: [], compartments: [], dots: [], explain: [], warmup: true };
  if (!isObject(raw)) return { model, errors: ['动力学模型必须是一个对象。'] };
  if (raw.version !== 1) errors.push(`动力学模型版本 ${String(raw.version)} 不受支持（只支持 1）。`);
  model.title = typeof raw.title === 'string' ? raw.title.slice(0, 80) : '';
  model.warmup = raw.warmup !== false;
  const taken = new Set();
  const declare = (name, what) => { if (typeof name !== 'string' || !KEY.test(name) || RESERVED.has(name)) { errors.push(`${what}的名称“${String(name)}”不合法（字母/数字/下划线，字母开头，不能是 h、true、false）。`); return false; } if (taken.has(name)) { errors.push(`名称“${name}”重复。`); return false; } taken.add(name); return true; };
  for (const [name, v] of Object.entries(isObject(raw.constants) ? raw.constants : {}).slice(0, KINETIC_LIMITS.constants)) if (declare(name, '常量')) { if (num(v) === undefined) errors.push(`常量 ${name} 必须是有限的数。`); else model.constants[name] = v; }
  for (const [name, v] of Object.entries(isObject(raw.state) ? raw.state : {}).slice(0, KINETIC_LIMITS.state)) if (declare(name, '状态变量')) { if (num(v) === undefined) errors.push(`状态变量 ${name} 的初值必须是有限的数。`); else model.state[name] = v; }
  (Array.isArray(raw.controls) ? raw.controls : []).slice(0, KINETIC_LIMITS.controls).forEach((c, i) => {
    if (!declare(c?.id, `第 ${i + 1} 个控件`)) return;
    const base = { id: c.id, label: typeof c.label === 'string' ? c.label.slice(0, 60) : c.id, tip: typeof c.tip === 'string' ? c.tip.slice(0, 200) : '' };
    if (c.type === 'range') {
      const min = num(c.min), max = num(c.max), step = num(c.step), value = num(c.default);
      if (min === undefined || max === undefined || !(step > 0) || min > max || value === undefined || value < min || value > max) errors.push(`控件 ${c.id} 的范围/步长/默认值不合法。`);
      else model.controls.push({ ...base, type: 'range', min, max, step, default: value, unit: typeof c.unit === 'string' ? c.unit.slice(0, 12) : '' });
    } else model.controls.push({ ...base, type: 'toggle', default: Boolean(c.default) });
  });
  model.inputs = {};
  for (const [name, counter] of Object.entries(isObject(raw.inputs) ? raw.inputs : {}).slice(0, 16)) if (declare(name, '输入')) { if (typeof counter !== 'string' || !counter) errors.push(`输入 ${name} 要写成计数器的名称。`); else model.inputs[name] = counter.slice(0, 60); }
  const known = new Set(['h', ...Object.keys(model.constants), ...Object.keys(model.state), ...Object.keys(model.inputs), ...model.controls.map((c) => c.id)]);
  const where = (what, source) => (expr) => { try { return compileExpression(expr, known); } catch (e) { errors.push(`${what}：${e instanceof ExpressionError ? e.message : e}（${String(expr).slice(0, 60)}）`); return null; } };
  const locals = new Set();
  (Array.isArray(raw.step) ? raw.step : []).slice(0, KINETIC_LIMITS.step).forEach((line, i) => {
    const what = `第 ${i + 1} 行步骤`, isSet = typeof line?.set === 'string', name = isSet ? line.set : line?.let;
    if (typeof name !== 'string' || !KEY.test(name)) { errors.push(`${what}要写成 { let: 名称, expr } 或 { set: 状态变量, expr }。`); return; }
    if (isSet && !(name in model.state)) { errors.push(`${what}：set 的“${name}”不是状态变量。`); return; }
    if (!isSet && (taken.has(name) || locals.has(name))) { errors.push(`${what}：let 的“${name}”和已有名称重复。`); return; }
    const fn = where(what)(line.expr);
    if (!fn) return;
    model.step.push({ kind: isSet ? 'set' : 'let', name, fn, source: line.expr });
    if (!isSet) { locals.add(name); known.add(name); }
  });
  const out = where('输出');
  (Array.isArray(raw.series) ? raw.series : []).slice(0, KINETIC_LIMITS.series).forEach((s, i) => {
    const fn = out(s?.expr), range = Array.isArray(s?.range) && s.range.length === 2 && s.range.every((v) => num(v) !== undefined) && s.range[0] < s.range[1] ? s.range : null;
    if (!range) errors.push(`第 ${i + 1} 条曲线的范围必须是 [最小, 最大]。`);
    if (fn && range) model.series.push({ label: String(s.label ?? '').slice(0, 60), range, color: COLOUR.test(s.color) ? s.color : '#4f8ff0', fn, format: { digits: Math.max(0, Math.min(6, Math.round(num(s.format?.digits, 2)))), scale: num(s.format?.scale, 1), divide: num(s.format?.divide, 1) || 1, unit: typeof s.format?.unit === 'string' ? s.format.unit.slice(0, 12) : '' } });
  });
  (Array.isArray(raw.compartments) ? raw.compartments : []).slice(0, KINETIC_LIMITS.compartments).forEach((c, i) => { const fn = out(c?.pH); if (fn) model.compartments.push({ name: String(c.name ?? `区室 ${i + 1}`).slice(0, 60), fn }); });
  (Array.isArray(raw.dots) ? raw.dots : []).slice(0, KINETIC_LIMITS.dots).forEach((d, i) => {
    const fn = out(d?.count);
    if (typeof d?.label !== 'string' || !d.label || typeof d?.comp !== 'string' || !d.comp) { errors.push(`第 ${i + 1} 种粒子需要名称（label）和区室（comp）。`); return; }
    if (fn) model.dots.push({ label: d.label.slice(0, 40), comp: d.comp.slice(0, 60), color: COLOUR.test(d.color) ? d.color : undefined, r: Math.max(0.8, Math.min(6, num(d.r, 2.2))), max: Math.max(1, Math.min(200, Math.round(num(d.max, 60)))), fn });
  });
  (Array.isArray(raw.explain) ? raw.explain : []).slice(0, KINETIC_LIMITS.explain).forEach((e, i) => {
    const when = e?.when === undefined ? (() => 1) : out(e.when), text = typeof e?.text === 'string' ? e.text.slice(0, KINETIC_LIMITS.text) : '';
    if (!when || !text) { if (!text) errors.push(`第 ${i + 1} 条讲解没有文字。`); return; }
    const parts = [];
    for (const piece of text.split(/(\{[^{}]*\})/)) {
      const m = /^\{(.*)\|(\d)\}$/.exec(piece) ?? /^\{(.*)\}$/.exec(piece);
      if (m) { const fn = out(m[1]); if (fn) parts.push({ fn, digits: m[2] === undefined ? 0 : Number(m[2]) }); } else if (piece) parts.push(piece);
    }
    model.explain.push({ when, parts });
  });
  if (!model.step.length) errors.push('动力学模型没有任何步骤。');
  return { model, errors };
}

/** A running model. Controls are `{ id: boolean | number }`; every number it shows is computed from the state, never stored. */
export class KineticSimulation {
  constructor(raw, controls = {}) {
    const { model, errors } = compileKineticModel(raw);
    if (errors.length) throw new Error(`动力学模型无法运行：${errors.join('；')}`);
    this.model = model; this.t = 0; this.tH = 0; this.diverged = false; this.hist = model.series.map(() => []);
    this.state = { ...model.state }; this.inputs = Object.fromEntries(Object.keys(model.inputs).map((k) => [k, 0])); this.ctrl = Object.fromEntries(model.controls.map((c) => [c.id, c.default]));
    for (const [id, value] of Object.entries(controls)) this.setControl(id, value);
    this.derived = {}; this.flux = { rate: 1, rotor: 1 };
    if (model.warmup) for (let i = 0; i < 40; i++) this.#step(0.05);   // a short warm-up: dark / resting start
    else this.#step(0);   // no time passes, but the values the curves and text read (the `let`s) exist from the start
  }
  setControl(id, value) {
    const c = this.model.controls.find((x) => x.id === id);
    if (!c) throw new Error(`没有控件“${id}”。`);
    if (c.type === 'range') { const v = Number(value); if (!Number.isFinite(v) || v < c.min || v > c.max) throw new Error(`${c.label}应在 ${c.min}–${c.max} 之间。`); this.ctrl[id] = v; } else this.ctrl[id] = Boolean(value);
  }
  /** Give the model the current value of its inputs (the animation's counters): { name: number }. */
  setInputs(values) { for (const k of Object.keys(this.inputs)) { const v = Number(values?.[k]); if (Number.isFinite(v)) this.inputs[k] = v; } }
  #scope(extra) {
    const scope = Object.create(null); Object.assign(scope, this.model.constants, this.inputs, this.state, this.derived, extra);
    for (const c of this.model.controls) scope[c.id] = c.type === 'range' ? this.ctrl[c.id] : +this.ctrl[c.id];
    return scope;
  }
  #step(h) {
    const before = { ...this.state }, scope = this.#scope({ h }), derived = {};
    for (const line of this.model.step) {
      const value = line.fn(scope);
      scope[line.name] = value;
      if (line.kind === 'set') this.state[line.name] = value; else derived[line.name] = value;
    }
    if (Object.values(this.state).some((v) => !Number.isFinite(v))) { this.state = before; this.diverged = true; return; }
    this.derived = derived; this.flux = { ...derived, rate: derived.rate ?? 1, rotor: derived.rotor ?? 1 };
  }
  /** Advance by `dt` seconds (sub-steps of at most 0.02 s) and record the curves every 0.25 s. */
  update(dt) {
    if (this.diverged) return;
    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (let i = 0; i < n; i++) { this.#step(h); if (this.diverged) return; }
    this.t += dt; this.tH += dt;
    if (this.tH > 0.25) { this.tH = 0; this.values().forEach((v, i) => { this.hist[i].push(v); if (this.hist[i].length > 240) this.hist[i].shift(); }); }
  }
  #read() { return this.#scope({}); }
  /** The value of each series now. */
  values() { const s = this.#read(); return this.model.series.map((x) => x.fn(s)); }
  /** Each series as { label, value, text, range, color } (text formatted as the model says). */
  readout() { const v = this.values(); return this.model.series.map((x, i) => ({ label: x.label, value: v[i], text: (v[i] / x.format.divide * x.format.scale).toFixed(x.format.digits) + x.format.unit, range: x.range, color: x.color })); }
  /** pH of each compartment, with its solution colour. */
  compartments() { const s = this.#read(); return this.model.compartments.map((c) => { const pH = c.fn(s); return { name: c.name, pH, colour: phColour(pH) }; }); }
  /** How many free molecules each `dots` entry asks for now (the animation's pool follows this number). */
  dots() { const s = this.#read(); return this.model.dots.map((d) => ({ label: d.label, comp: d.comp, color: d.color, r: d.r, count: Math.max(0, Math.min(d.max, d.fn(s))) })); }
  /** The first explanation whose condition holds. */
  explain() {
    const s = this.#read();
    for (const e of this.model.explain) if (e.when(s)) return e.parts.map((p) => (typeof p === 'string' ? p : p.fn(s).toFixed(p.digits))).join('');
    return '';
  }
  /** What a saved work keeps: the state, the control settings and the clock. */
  save() { return { state: { ...this.state }, controls: { ...this.ctrl }, t: this.t }; }
  restore(saved) {
    if (!isObject(saved)) return;
    for (const [k, v] of Object.entries(isObject(saved.state) ? saved.state : {})) if (k in this.state && Number.isFinite(v)) this.state[k] = v;
    for (const [k, v] of Object.entries(isObject(saved.controls) ? saved.controls : {})) { try { this.setControl(k, v); } catch { /* an old control that no longer exists */ } }
    if (Number.isFinite(saved.t)) this.t = saved.t;
  }
}
