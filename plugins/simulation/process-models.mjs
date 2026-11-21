/**
 * Process models as declarations for the stochastic-process engine (docs/PLUGIN_ROADMAP.md, E1 to E4): a membrane transporter, a track-walking motor, a growing and shrinking filament and
 * general mass-action reaction networks. Each builder returns a plain declaration (the format of markov-model.mjs) that the existing engine runs, so determinism, seeding, schedules, replay and the process
 * panel come for free; what is new here is the models and their checks. Every model is a TEACHING MODEL with honest rate constants the author chooses: nothing here is a measured rate of any real
 * protein, and the preset values are round numbers picked to show the behaviour, not data. Each one is tested against its analytic answer by running the engine itself (the test files).
 */
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const fail = (message) => { throw new TypeError(message); };
const num = (value, name, { min = -Infinity, max = Infinity } = {}) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} 应为 ${min}–${max} 之间的数。`); return value; };

// ---- E4: reaction networks ----------------------------------------------------------------------------------------------------------------------------

const FALLING = { 1: (s) => s, 2: (s) => `(${s}*(${s}-1)/2)`, 3: (s) => `(${s}*(${s}-1)*(${s}-2)/6)` };
/**
 * Mass-action reactions between counted species, run exactly (Gillespie). A reaction fires at the propensity k * (number of distinct reactant combinations) / volume^(order - 1) (an order-0 source fires at k
 * per second). Reactant stoichiometries up to 3 are supported; up to 16 species and 96 reactions (the engine's limits).
 *   species    [{ id, label?, init, max? }]
 *   reactions  [{ id, label?, reactants: { A: 1, B: 1 }, products: { C: 1 }, k }]    k in 1/s for order 1, volume/s per combination for higher orders (volume given in the same units)
 */
export function reactionNetwork({ title = '反应网络', species, reactions, volume = 1 }) {
  if (!Array.isArray(species) || !species.length || species.length > 16) fail('反应网络需要 1–16 个物种。');
  if (!Array.isArray(reactions) || !reactions.length || reactions.length > 96) fail('反应网络需要 1–96 个反应。');
  num(volume, 'volume', { min: 1e-12 });
  const ids = new Set(species.map((s) => s.id)); if (ids.size !== species.length || [...ids].some((id) => !KEY.test(id) || id === 'dt' || id === 'V')) fail('物种的编号必须互不相同，且是合法名称（字母、数字、下划线，不能叫 dt 或 V）。');
  const numbers = Object.fromEntries(species.map((s) => [s.id, { init: num(s.init, `物种 ${s.id} 的初值`, { min: 0 }), min: 0, max: s.max ?? 1e7 }]));
  const constants = { V: volume }, transitions = [], counters = [];
  for (const r of reactions) {
    if (!KEY.test(r.id ?? '')) fail(`反应编号“${String(r.id)}”不合法。`);
    num(r.k, `反应 ${r.id} 的速率常数 k`, { min: 0 });
    const reactants = Object.entries(r.reactants ?? {}), products = Object.entries(r.products ?? {}), order = reactants.reduce((n, [, v]) => n + v, 0), inc = {};
    for (const [id, v] of reactants) { if (!ids.has(id)) fail(`反应 ${r.id} 的反应物 ${id} 不在物种里。`); if (!Number.isInteger(v) || v < 1 || v > 3) fail(`反应 ${r.id} 对 ${id} 的化学计量应为 1–3 的整数。`); inc[id] = (inc[id] ?? 0) - v; }
    for (const [id, v] of products) { if (!ids.has(id)) fail(`反应 ${r.id} 的产物 ${id} 不在物种里。`); if (!Number.isInteger(v) || v < 1 || v > 50) fail(`反应 ${r.id} 对 ${id} 的化学计量应为 1–50 的整数。`); inc[id] = (inc[id] ?? 0) + v; }
    if (order === 0 && !products.length) fail(`反应 ${r.id} 既没有反应物也没有产物。`);
    for (const id of Object.keys(inc)) if (inc[id] === 0) delete inc[id];   // a catalyst: consumed and made again
    constants[`k_${r.id}`] = r.k;
    const combos = reactants.map(([id, v]) => FALLING[v](id)).join(' * '), rate = order === 0 ? `k_${r.id}` : `k_${r.id} * ${combos}${order > 1 ? ` / pow(V, ${order - 1})` : ''}`;
    transitions.push({ id: r.id, label: r.label ?? r.id, rate, inc, count: { [r.id]: 1 } }); counters.push(r.id);
  }
  return { version: 1, title, constants, parameters: [], variables: {}, numbers, transitions, counters, clocks: [{ name: 'time', add: 'dt' }], observables: species.map((s) => ({ name: s.id, label: s.label ?? s.id, expr: s.id })) };
}

// ---- E1: membrane transporter ---------------------------------------------------------------------------------------------------------------------------

/**
 * A uniporter with alternating access: outward-open empty (Ao), outward-open bound (Ab), inward-open bound (Bb), inward-open empty (Bo), moving a substrate of charge `z` between an outside and an inside
 * concentration under a membrane potential. The rates keep detailed balance by construction: with the return rate of the empty carrier `kr'` fixed by kf * kr / kb, the net flux is zero exactly when
 * Si / So = exp(-z F V / R T) (V = inside minus outside). Concentrations and voltage are parameters, so a schedule can change them and the flux follows.
 *   kon (1/(uM s)), koff (1/s), kf and kb (the bound carrier's turns, 1/s), kr (the empty carrier's turn, 1/s), z (charge of the substrate), temperature (K)
 * Counters: the substrate bound and released on each side; observables `netIn` (released inside minus bound from inside) and `flux` (net per second).
 */
export function uniporter({ title = '交替访问转运体', kon = 5, koff = 50, kf = 200, kb = 200, kr = 100, z = 0, temperature = 310, So = 100, Si = 10, V = 0 } = {}) {
  for (const [name, v] of Object.entries({ kon, koff, kf, kb, kr })) num(v, name, { min: 1e-6, max: 1e9 });
  num(z, 'z', { min: -4, max: 4 }); num(temperature, 'temperature', { min: 200, max: 400 });
  const thermal = 8.314462618 * temperature / 96485.33212;   // RT/F in volts
  return {
    version: 1, title,
    constants: { kon, koff, kf, kb, kr, z, thermal },
    parameters: [
      { id: 'So', label: '外侧底物浓度', min: 0.01, max: 10000, step: 0.5, default: So, unit: 'µM' },
      { id: 'Si', label: '内侧底物浓度', min: 0.01, max: 10000, step: 0.5, default: Si, unit: 'µM' },
      { id: 'V', label: '膜电位（内 − 外）', min: -0.2, max: 0.2, step: 0.005, default: V, unit: 'V' },
    ],
    variables: { c: { values: ['Ao', 'Ab', 'Bb', 'Bo'], init: 'Ao' } },
    derived: [{ name: 'phi', expr: 'z * V / thermal' }, { name: 'krBack', expr: 'kf * kr / kb' }],   // the empty carrier's return rate that keeps detailed balance
    transitions: [
      { id: 'bindOut', label: '外侧结合', when: 'c_Ao', rate: 'kon * So', set: { c: 'Ab' }, count: { boundOut: 1 } },
      { id: 'releaseOut', label: '外侧释放', when: 'c_Ab', rate: 'koff', set: { c: 'Ao' }, count: { releasedOut: 1 } },
      { id: 'turnIn', label: '结合态转向内侧', when: 'c_Ab', rate: 'kf * exp(-phi / 2)', set: { c: 'Bb' } },
      { id: 'turnOut', label: '结合态转回外侧', when: 'c_Bb', rate: 'kb * exp(phi / 2)', set: { c: 'Ab' } },
      { id: 'releaseIn', label: '内侧释放', when: 'c_Bb', rate: 'koff', set: { c: 'Bo' }, count: { releasedIn: 1 } },
      { id: 'bindIn', label: '内侧结合', when: 'c_Bo', rate: 'kon * Si', set: { c: 'Bb' }, count: { boundIn: 1 } },
      { id: 'returnOut', label: '空载体转回外侧', when: 'c_Bo', rate: 'kr', set: { c: 'Ao' } },
      { id: 'returnIn', label: '空载体转向内侧', when: 'c_Ao', rate: 'krBack', set: { c: 'Bo' } },
    ],
    counters: ['boundOut', 'releasedOut', 'releasedIn', 'boundIn'],
    clocks: [{ name: 'time', add: 'dt' }],
    observables: [{ name: 'netIn', label: '净转入的底物数', expr: 'releasedIn - boundIn' }, { name: 'flux', label: '净通量（个/秒）', expr: 'time > 0 ? (releasedIn - boundIn) / time : 0' }],
  };
}

// ---- E2: a motor stepping along a track ---------------------------------------------------------------------------------------------------------------

/**
 * A motor that steps along a track by one step of `stepSize` per ATP: empty (E) -> ATP-bound (T) at kon * [ATP], T -> ADP-bound (D) with a forward step at kStep (slowed by a load force through the
 * usual exp(-F d_f / kT) factor), T -> E when ATP leaves unused (kUnbind), D -> E at kRelease, and a rare backward step D -> T at kBack (sped up by the load). `position` counts steps.
 * force (pN), temperature (K); the load's split of the step (fraction `delta` of the step distance in the forward barrier) is the usual one-barrier model, an assumption of the teaching model.
 */
export function trackMotor({ title = '沿轨道行走的马达', kon = 2, kStep = 100, kUnbind = 5, kRelease = 200, kBack = 0.5, stepSize = 8, delta = 0.5, ATP = 100, force = 0, temperature = 298 } = {}) {
  for (const [name, v] of Object.entries({ kon, kStep, kUnbind, kRelease, kBack })) num(v, name, { min: 1e-6, max: 1e9 });
  num(stepSize, 'stepSize', { min: 0.1, max: 1000 }); num(delta, 'delta', { min: 0, max: 1 }); num(temperature, 'temperature', { min: 200, max: 400 });
  const kT = 1.380649e-23 * temperature * 1e21;   // pN nm
  return {
    version: 1, title,
    constants: { kon, kStep, kUnbind, kRelease, kBack, d: stepSize, delta, kT },
    parameters: [{ id: 'ATP', label: 'ATP 浓度', min: 1, max: 10000, step: 10, default: ATP, unit: 'µM' }, { id: 'F', label: '负载力（与前进方向相反为正）', min: -10, max: 15, step: 0.25, default: force, unit: 'pN' }],
    variables: { m: { values: ['E', 'T', 'D'], init: 'E' } },
    numbers: { position: { init: 0, min: -1e9, max: 1e9 } },
    transitions: [
      { id: 'bindATP', label: '结合 ATP', when: 'm_E', rate: 'kon * ATP', set: { m: 'T' } },
      { id: 'step', label: '向前一步', when: 'm_T', rate: 'kStep * exp(-F * delta * d / kT)', set: { m: 'D' }, inc: { position: 1 }, count: { steps: 1 } },
      { id: 'unbind', label: 'ATP 空载离开', when: 'm_T', rate: 'kUnbind', set: { m: 'E' } },
      { id: 'release', label: '释放 ADP', when: 'm_D', rate: 'kRelease', set: { m: 'E' } },
      { id: 'back', label: '后退一步', when: 'm_D', rate: 'kBack * exp(F * (1 - delta) * d / kT)', set: { m: 'T' }, inc: { position: -1 }, count: { backsteps: 1 } },
    ],
    counters: ['steps', 'backsteps'],
    clocks: [{ name: 'time', add: 'dt' }],
    observables: [{ name: 'distance', label: '走过的距离（nm）', expr: 'position * d' }, { name: 'velocity', label: '平均速度（nm/s）', expr: 'time > 0 ? position * d / time : 0' }],
  };
}

// ---- E3: a filament that grows and shrinks ---------------------------------------------------------------------------------------------------------------

/**
 * One filament (a microtubule or an actin filament as a teaching model) that is either growing or shrinking: while growing it gains a subunit at kon * [subunit] and loses one at koffGrow; it switches
 * to shrinking at the catastrophe rate; while shrinking it loses subunits at kShrink and switches back at the rescue rate. `length` counts subunits (not below 0; a filament that reaches 0 stays at 0 while
 * "shrinking" until rescued). Dynamic instability needs both a catastrophe and a rescue; set kCatastrophe to 0 for a filament that only grows.
 */
export function dynamicFilament({ title = '动态不稳定的丝', kon = 10, koffGrow = 20, kShrink = 400, kCatastrophe = 0.05, kRescue = 0.02, subunit = 10, init = 100 } = {}) {
  for (const [name, v] of Object.entries({ kon, koffGrow, kShrink })) num(v, name, { min: 0, max: 1e9 }); num(kCatastrophe, 'kCatastrophe', { min: 0, max: 1e6 }); num(kRescue, 'kRescue', { min: 0, max: 1e6 }); num(init, 'init', { min: 0, max: 1e6 });
  return {
    version: 1, title,
    constants: { kon, koffGrow, kShrink, kCatastrophe, kRescue },
    parameters: [{ id: 'free', label: '游离亚基浓度', min: 0.1, max: 1000, step: 0.5, default: subunit, unit: 'µM' }],
    variables: { phase: { values: ['grow', 'shrink'], init: 'grow' } },
    numbers: { length: { init, min: 0, max: 1e9 } },
    transitions: [
      { id: 'add', label: '加上一个亚基', when: 'phase_grow', rate: 'kon * free', inc: { length: 1 }, count: { added: 1 } },
      { id: 'lose', label: '失去一个亚基', when: 'phase_grow && length > 0', rate: 'koffGrow', inc: { length: -1 }, count: { lost: 1 } },
      { id: 'catastrophe', label: '突变为缩短', when: 'phase_grow', rate: 'kCatastrophe', set: { phase: 'shrink' }, count: { catastrophes: 1 } },
      { id: 'shrink', label: '缩短一个亚基', when: 'phase_shrink && length > 0', rate: 'kShrink', inc: { length: -1 }, count: { shrunk: 1 } },
      { id: 'rescue', label: '救援为生长', when: 'phase_shrink', rate: 'kRescue', set: { phase: 'grow' }, count: { rescues: 1 } },
    ],
    counters: ['added', 'lost', 'shrunk', 'catastrophes', 'rescues'],
    clocks: [{ name: 'time', add: 'dt' }, { name: 'growTime', add: 'phase_grow ? dt : 0' }],
    observables: [{ name: 'L', label: '长度（亚基数）', expr: 'length' }, { name: 'growFraction', label: '处于生长相的时间比例', expr: 'time > 0 ? growTime / time : 0' }],
  };
}

/** The ready-made starting configurations for the stochastic-process tool: { id, label, config } where config is what scene.tools[].config holds ({ process, schedule, seed, display }). */
export const PROCESS_PRESETS = Object.freeze([
  { id: 'uniporter', label: '交替访问转运体（四态，保持细致平衡）', build: () => ({ process: uniporter(), schedule: [{ time: 0 }], seed: 11, display: [
    { label: '外侧结合', kind: 'counter', name: 'boundOut', digits: 0 }, { label: '内侧释放', kind: 'counter', name: 'releasedIn', digits: 0 }, { label: '净转入', kind: 'observable', name: 'netIn', digits: 0 }, { label: '净通量', kind: 'observable', name: 'flux', digits: 2, unit: '个/秒' }] }) },
  { id: 'motor', label: '沿轨道行走的马达（ATP 驱动，可加负载）', build: () => ({ process: trackMotor(), schedule: [{ time: 0 }], seed: 13, display: [
    { label: '前进步数', kind: 'counter', name: 'steps', digits: 0 }, { label: '后退步数', kind: 'counter', name: 'backsteps', digits: 0 }, { label: '走过的距离', kind: 'observable', name: 'distance', digits: 1, unit: 'nm' }, { label: '平均速度', kind: 'observable', name: 'velocity', digits: 1, unit: 'nm/s' }] }) },
  { id: 'filament', label: '动态不稳定的丝（生长、突变、缩短、救援）', build: () => ({ process: dynamicFilament(), schedule: [{ time: 0 }], seed: 17, display: [
    { label: '长度', kind: 'observable', name: 'L', digits: 0, unit: '亚基' }, { label: '突变次数', kind: 'counter', name: 'catastrophes', digits: 0 }, { label: '救援次数', kind: 'counter', name: 'rescues', digits: 0 }, { label: '生长相时间比例', kind: 'observable', name: 'growFraction', digits: 2 }] }) },
  { id: 'enzyme', label: '酶促反应网络（E + S ⇌ ES → E + P，米氏动力学）', build: () => ({ process: reactionNetwork({ title: '酶促反应', volume: 1000, species: [{ id: 'E', init: 20 }, { id: 'S', init: 600 }, { id: 'ES', init: 0 }, { id: 'P', init: 0 }], reactions: [
    { id: 'bind', label: 'E + S → ES', reactants: { E: 1, S: 1 }, products: { ES: 1 }, k: 1.5 }, { id: 'unbind', label: 'ES → E + S', reactants: { ES: 1 }, products: { E: 1, S: 1 }, k: 1 }, { id: 'cat', label: 'ES → E + P', reactants: { ES: 1 }, products: { E: 1, P: 1 }, k: 0.5 }] }), schedule: [{ time: 0 }], seed: 19, display: [
    { label: '底物 S', kind: 'observable', name: 'S', digits: 0 }, { label: '复合物 ES', kind: 'observable', name: 'ES', digits: 0 }, { label: '产物 P', kind: 'observable', name: 'P', digits: 0 }, { label: '催化次数', kind: 'counter', name: 'cat', digits: 0 }] }) },
].map((preset) => Object.freeze({ id: preset.id, label: preset.label, config: preset.build() })));
