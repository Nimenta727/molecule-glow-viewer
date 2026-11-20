/**
 * The conformation state machine (4.4.8): the time and state side of a mechanism whose structure changes along a cycle, as data. A machine is a PHASE CLOCK with a replayable schedule of controls and
 * a PROFILE that turns the phase into what the Viewer shows: the stage (which step is lit), the conformation (which states the structure is between), the cycle events and the counters. The structure
 * side (which parts, the superpositions, the interpolation of coordinates) stays with the caller: the machine only says *how far along* and *between which states*.
 *
 *   kind 'rotary'      the phase is turns of a rotor (rate = the speed control, turns per second). `sites` identical sites take turns in the same states, one site cycle per 1/sites turn; within a
 *                      site cycle `stageAt` (four thresholds) cut five stages and the structure is changing between `morph.start` and `morph.start + morph.span`. Cycle events and counters count
 *                      completed site cycles and (per turn) the rotor's own units. (F1Fo ATP synthase: 3 sites, 8 or 10 or 14 c subunits.)
 *   kind 'oscillating' the phase is an angle of a back-and-forth swing; fraction = ease((sin(phase)+1)/2 mapped from [lo, lo + span] to [0, 1]) so both ends hold for a while; the controls include a manual
 *                      fraction and an automatic flag, and handing back to automatic continues from the shape just chosen. (Two-state domain closure: adenylate kinase.)
 * Both keep the controls as a schedule (the first entry at time 0, times strictly increasing, at most 1000): a change made at the current time ends everything after it, so the same schedule gives
 * the same history on any seek, step or reopening. `createMachine(spec, state, { seed, units })` returns the player-shaped object (seek, advance, play, pause, setSpeed, setParameters, setMorph,
 * setPlaybackRate, stepTime, snapshot, save, dispose); `snapshot()` holds only what the machine knows: { time, speed, seed, playbackRate, playing, stage, conformation, counters, events, ... }.
 * New profiles register with `registerProfile(kind, { normalize, create })`.
 */
export const MACHINE_DURATION = 120, MACHINE_SCHEDULE_LIMIT = 1000, PLAYBACK_RATES = Object.freeze([0.25, 1, 2, 5]);
const PI = Math.PI, TAU = 2 * PI;
const round = (v) => Math.round(v * 1e9) / 1e9, clamp01 = (v) => Math.min(1, Math.max(0, v)), smooth = (v) => { const f = clamp01(v); return f * f * (3 - 2 * f); };
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fail = (label, text) => { throw new Error(`${label}：${text}`); };
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' && v !== true && v !== false ? Number(v) : d);

export const ROTARY_TEMPLATE = Object.freeze({
  kind: 'rotary', sites: 3, speed: Object.freeze({ min: 0.05, max: 3, default: 0.25, label: '转速' }),
  stageAt: Object.freeze([0.1, 0.25, 0.8, 0.93]), morph: Object.freeze({ start: 0.25, span: 0.6 }), stepPhases: Object.freeze([0, 0.17, 0.5, 0.86, 0.96]),
  counters: Object.freeze({ cycles: 'ATP', unit: 'H⁺' }), eventLabel: '位点打开释放 ATP',
});
export const OSCILLATING_TEMPLATE = Object.freeze({
  kind: 'oscillating', rate: 0.35, start: -PI / 2, lo: 0.1, span: 0.8, stages: Object.freeze({ low: 0.15, high: 0.85 }), steps: 4,
  speed: Object.freeze({ min: 0.05, max: 3, default: 1, label: '往复倍率' }), manual: 'morph', auto: 'auto',
  parameters: Object.freeze({
    morph: Object.freeze({ label: '构象闭合程度（0=张开，1=闭合）', control: 'range', min: 0, max: 1, step: 0.01, value: 0, integer: false }),
    auto: Object.freeze({ label: '自动往复（0=手动，1=自动）', min: 0, max: 1, step: 1, value: 1, integer: true }),
    ap5: Object.freeze({ label: '显示闭合态参考（0/1）', min: 0, max: 1, step: 1, value: 1, integer: true }),
  }),
  counters: Object.freeze({ percent: '闭合程度（%）' }), eventLabel: '构象展示参数变更',
});

// ------------------------------------------------------------------------------------------------ the profiles
const PROFILES = new Map();
export function registerProfile(kind, profile) { if (PROFILES.has(kind)) throw new Error(`构象机剖面 ${kind} 已存在。`); PROFILES.set(kind, profile); }

/** Validates a machine declaration (a partial one is merged over the template of its kind); returns the clean spec. */
export function normalizeMachine(raw, label = '构象机') {
  if (!isObject(raw) || !PROFILES.has(raw.kind)) throw new Error(`${label}：kind 必须是 ${[...PROFILES.keys()].join(' 或 ')}。`);
  return PROFILES.get(raw.kind).normalize(raw, label);
}
export function createMachine(spec, state = {}, options = {}) {
  if (!PROFILES.has(spec?.kind)) throw new Error('构象机的声明无效（先用 normalizeMachine 检查）。');
  return PROFILES.get(spec.kind).create(spec, state ?? {}, options);
}

/** The pieces both profiles share: the playhead, the playback rate, disposal. */
/** `roundTime`: step the playhead on a 1e-9 grid (a swing compared across many small steps and one seek) or exactly (a rotor, whose completed-cycle counts sit on whole fractions of a turn). */
function clock(label, state, { roundTime }) {
  let disposed = false, playing = false, time = Number.isFinite(state.time) ? Math.max(0, Math.min(MACHINE_DURATION, state.time)) : 0;
  let playbackRate = PLAYBACK_RATES.includes(state.playbackRate) ? state.playbackRate : 1;
  const live = () => { if (disposed) throw new Error(`${label}已释放。`); };
  return {
    live, get time() { return time; }, get playing() { return playing; }, get playbackRate() { return playbackRate; }, get disposed() { return disposed; },
    seek(value) { live(); if (!Number.isFinite(value)) throw new TypeError('时间必须是有限数值。'); time = Math.max(0, Math.min(MACHINE_DURATION, value)); if (time === MACHINE_DURATION) playing = false; },
    advance(dt) { live(); if (!Number.isFinite(dt) || dt < 0) throw new TypeError('时间增量无效。'); if (playing) { const next = time + dt * playbackRate; time = Math.min(MACHINE_DURATION, roundTime ? round(next) : next); } if (time === MACHINE_DURATION) playing = false; },
    play() { live(); if (time < MACHINE_DURATION) playing = true; }, pause() { live(); playing = false; },
    setPlaybackRate(value) { live(); if (!PLAYBACK_RATES.includes(value)) throw new TypeError('无效的播放倍率。'); playbackRate = value; },
    dispose() { disposed = true; playing = false; },
  };
}
const speedSpec = (raw, base, label) => {
  const s = isObject(raw) ? raw : {}, min = num(s.min, base.min), max = num(s.max, base.max), def = num(s.default, base.default);
  if (!(min > 0 && max >= min && def >= min && def <= max)) fail(label, 'speed 的 min、max、default 要满足 0 < min ≤ default ≤ max。');
  return { min, max, default: def, label: typeof s.label === 'string' && s.label ? s.label.slice(0, 20) : base.label };
};
const labelText = (v, d, what, label) => { const t = v === undefined ? d : v; if (typeof t !== 'string' || !t || t.length > 80) fail(label, `${what} 必须是 1–80 个字的文字。`); return t; };

/* ---------------------------------------------------------------- rotary */
registerProfile('rotary', {
  normalize(raw, label) {
    const T = ROTARY_TEMPLATE, sites = num(raw.sites, T.sites);
    if (!Number.isInteger(sites) || sites < 2 || sites > 16) fail(label, 'sites 必须是 2–16 的整数。');
    const stageAt = raw.stageAt === undefined ? [...T.stageAt] : raw.stageAt;
    if (!Array.isArray(stageAt) || stageAt.length !== 4 || stageAt.some((v, i) => !Number.isFinite(v) || v <= 0 || v >= 1 || (i && v <= stageAt[i - 1]))) fail(label, 'stageAt 必须是 4 个递增的 0–1 之间的数（把一个位点周期切成 5 个阶段）。');
    const morph = { start: num(raw.morph?.start, T.morph.start), span: num(raw.morph?.span, T.morph.span) };
    if (!(morph.start >= 0 && morph.span > 0 && morph.start + morph.span <= 1)) fail(label, 'morph 的 start ≥ 0、span > 0、start + span ≤ 1。');
    const stepPhases = raw.stepPhases === undefined ? [...T.stepPhases] : raw.stepPhases;
    if (!Array.isArray(stepPhases) || stepPhases.length !== 5 || stepPhases.some((v) => !Number.isFinite(v) || v < 0 || v >= 1)) fail(label, 'stepPhases 必须是 5 个 0–1 之间的数（每个机制步骤跳到的位点周期相位）。');
    const counters = { cycles: labelText(raw.counters?.cycles, T.counters.cycles, 'counters.cycles', label), unit: labelText(raw.counters?.unit, T.counters.unit, 'counters.unit', label) };
    return { kind: 'rotary', sites, speed: speedSpec(raw.speed, T.speed, label), stageAt, morph, stepPhases, counters, eventLabel: labelText(raw.eventLabel, T.eventLabel, 'eventLabel', label) };
  },
  create(spec, state, options) {
    const label = options.label ?? '播放器', base = clock(label, state, { roundTime: false }), { min, max } = spec.speed, units = options.units ?? 1;
    const seed = Number.isSafeInteger(options.seed) ? options.seed : 1;
    let speed = Number.isFinite(state.speed) ? Math.max(min, Math.min(max, state.speed)) : spec.speed.default;
    let rates = Array.isArray(state.rates) && state.rates.length <= MACHINE_SCHEDULE_LIMIT && state.rates.every((e, i) => Number.isFinite(e.time) && e.time >= 0 && e.time <= MACHINE_DURATION && Number.isFinite(e.speed) && e.speed >= min && e.speed <= max && (i ? e.time > state.rates[i - 1].time : e.time === 0))
      ? state.rates.map((e) => ({ ...e })) : [{ time: 0, speed }];
    if (!rates.length) rates = [{ time: 0, speed }];
    const turnsAt = (seconds) => { let turns = 0; for (let i = 0; i < rates.length && rates[i].time < seconds; i++) { const end = Math.min(seconds, rates[i + 1]?.time ?? seconds); turns += (end - rates[i].time) * rates[i].speed; } return round(turns); };
    const timeAtTurn = (turn) => { let previous = 0; for (let i = 0; i < rates.length; i++) { const available = ((rates[i + 1]?.time ?? MACHINE_DURATION) - rates[i].time) * rates[i].speed; if (previous + available >= turn) return rates[i].time + (turn - previous) / rates[i].speed; previous += available; } return MACHINE_DURATION; };
    const n = spec.sites, [a, b, c, d] = spec.stageAt;
    const machine = {
      duration: MACHINE_DURATION, kind: 'rotary', spec, seed, turnsAt, timeAtTurn,
      snapshot() {
        base.live();
        const time = base.time, turns = turnsAt(time);
        speed = rates.findLast((e) => e.time <= time)?.speed ?? rates[0].speed;
        const phase = (turns * n) % 1, stage = phase < a ? 0 : phase < b ? 1 : phase < c ? 2 : phase < d ? 3 : 4, completed = Math.floor(turns * n + 1e-9), events = [];
        for (let i = Math.max(1, completed - 19); i <= completed; i++) events.push({ time: round(timeAtTurn(i / n)), label: spec.eventLabel, [spec.counters.cycles]: i });
        return { time, speed, seed, playbackRate: base.playbackRate, playing: base.playing, stage, events, turns,
          counters: { [spec.counters.cycles]: completed, [spec.counters.unit]: Math.floor(turns * units + 1e-9) },
          conformation: { from: Math.floor(turns * n) % n, fraction: smooth((phase - spec.morph.start) / spec.morph.span) } };
      },
      seek: (v) => { base.seek(v); return machine.snapshot(); },
      advance: (dt) => { base.advance(dt); return machine.snapshot(); },
      play: base.play, pause: base.pause, setPlaybackRate: base.setPlaybackRate, dispose: base.dispose,
      setSpeed(value) {
        base.live();
        if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`${spec.speed.label}范围为 ${min}–${max}。`);
        if (rates.length >= MACHINE_SCHEDULE_LIMIT) throw new Error('本次播放的转速变更已达上限，请按种子重置。');
        const time = base.time; rates = rates.filter((e) => e.time < time); rates.push({ time, speed: value });
        return machine.snapshot();
      },
      stepTime(index) { const phase = spec.stepPhases[index]; if (phase === undefined) throw new TypeError('无效的机制步骤。'); return timeAtTurn((Math.floor(turnsAt(base.time) * n) + phase) / n); },
      save() { return { time: base.time, speed, seed, ...(base.playbackRate !== 1 ? { playbackRate: base.playbackRate } : {}), ...(rates.length > 1 ? { rates: rates.map((e) => ({ ...e })) } : {}) }; },
    };
    return machine;
  },
});

/* ---------------------------------------------------------------- oscillating */
registerProfile('oscillating', {
  normalize(raw, label) {
    const T = OSCILLATING_TEMPLATE, rate = num(raw.rate, T.rate), lo = num(raw.lo, T.lo), span = num(raw.span, T.span), start = num(raw.start, T.start);
    if (!(rate > 0 && rate <= 10)) fail(label, 'rate 必须是 0–10 之间的正数（每个速度单位的相位速度，弧度/秒）。');
    if (!(lo >= 0 && span > 0 && lo + span <= 1)) fail(label, 'lo ≥ 0、span > 0、lo + span ≤ 1（两端保持的范围）。');
    const stages = { low: num(raw.stages?.low, T.stages.low), high: num(raw.stages?.high, T.stages.high) };
    if (!(stages.low > 0 && stages.high > stages.low && stages.high < 1)) fail(label, 'stages 的 low、high 要满足 0 < low < high < 1。');
    const parameters = {};
    for (const [key, p] of Object.entries(isObject(raw.parameters) ? raw.parameters : T.parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(key) || !isObject(p)) fail(label, `参数名 ${key} 无效。`);
      const min = num(p.min, 0), max = num(p.max, 1), value = num(p.value, min);
      if (!(max > min && value >= min && value <= max)) fail(label, `参数 ${key} 的范围或初值无效。`);
      parameters[key] = { label: typeof p.label === 'string' ? p.label.slice(0, 80) : key, ...(p.control ? { control: String(p.control).slice(0, 12) } : {}), min, max, step: num(p.step, 1), value, integer: p.integer !== undefined ? Boolean(p.integer) : key !== (raw.manual ?? T.manual) };   // whole numbers (switches), except the manual fraction
    }
    const manual = raw.manual ?? T.manual, auto = raw.auto ?? T.auto;
    if (!parameters[manual] || !parameters[auto]) fail(label, `manual（${manual}）和 auto（${auto}）必须是 parameters 里的参数。`);
    const steps = num(raw.steps, T.steps); if (!Number.isInteger(steps) || steps < 1 || steps > 12) fail(label, 'steps 必须是 1–12 的整数。');
    const counters = { percent: labelText(raw.counters?.percent, T.counters.percent, 'counters.percent', label) };
    return { kind: 'oscillating', rate, start, lo, span, stages, parameters, manual, auto, steps, speed: speedSpec(raw.speed, T.speed, label), counters, eventLabel: labelText(raw.eventLabel, T.eventLabel, 'eventLabel', label) };
  },
  create(spec, state, options) {
    const label = options.label ?? '播放器', base = clock(label, state, { roundTime: true }), { parameters: P, manual, auto } = spec, { min, max } = spec.speed;
    const seed = Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed <= 4294967295 ? state.seed : (Number.isSafeInteger(options.seed) ? options.seed : 1);
    const fractionAtPhase = (phase) => smooth(((Math.sin(phase) + 1) / 2 - spec.lo) / spec.span);
    const validateParameters = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}参数需要对象。`);
      for (const [key, number] of Object.entries(value)) { const f = P[key]; if (!f || !Number.isFinite(number) || number < f.min || number > f.max || (f.integer && !Number.isInteger(number))) throw new Error(`${label}参数 ${key} 无效。`); }
      return { ...value };
    };
    const initial = { time: 0, phase: spec.start, speed: state.speed ?? spec.speed.default, ...Object.fromEntries(Object.entries(P).map(([k, p]) => [k, p.value])) };
    function entry(value) {
      if (!value || typeof value !== 'object') throw new Error(`${label}播放记录无效。`);
      const { time, phase, speed, ...parameters } = value; validateParameters(parameters);
      if (!Number.isFinite(time) || time < 0 || time > MACHINE_DURATION || !Number.isFinite(phase) || Math.abs(phase) > 200 || !Number.isFinite(speed) || speed < min || speed > max || Object.keys(P).some((k) => parameters[k] == null)) throw new Error(`${label}播放记录无效。`);
      return { time, phase, speed, ...parameters };
    }
    let schedule;
    if (state.schedule == null) schedule = [entry(initial)];
    else {
      if (!Array.isArray(state.schedule) || !state.schedule.length || state.schedule.length > MACHINE_SCHEDULE_LIMIT) throw new Error(`${label}播放记录超出范围。`);
      schedule = state.schedule.map(entry);
      if (schedule[0].time !== 0 || schedule.some((item, i) => i && item.time <= schedule[i - 1].time)) throw new Error(`${label}播放记录顺序无效。`);
    }
    function at(t) {
      const current = schedule.findLast((item) => item.time <= t), phase = current.phase + (current[auto] ? (t - current.time) * spec.rate * current.speed : 0);
      return { current, phase, fraction: current[auto] ? fractionAtPhase(phase) : current[manual] };
    }
    function change(patch) {
      base.live();
      if (schedule.length >= MACHINE_SCHEDULE_LIMIT) throw new Error(`${label}参数变更已达上限。`);
      const time = base.time, { current, phase, fraction } = at(time), next = { ...current, ...patch, time, phase, [manual]: fraction };
      if (patch[manual] != null) { next[manual] = patch[manual]; if (patch[auto] == null) next[auto] = 0; }
      if (next[auto] && (!current[auto] || patch[manual] != null)) {   // resume from the manually chosen shape without jumping to the old oscillator phase
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (mid * mid * (3 - 2 * mid) < next[manual]) lo = mid; else hi = mid; }
        const sin = (spec.lo + ((lo + hi) / 2) * spec.span) * 2 - 1, angle = Math.asin(Math.max(-1, Math.min(1, sin))), cycle = Math.floor((phase + PI / 2) / TAU) * TAU;
        next.phase = cycle + (Math.cos(phase) >= 0 ? angle : PI - angle);
      }
      schedule = [...schedule.filter((item) => item.time < time), entry(next)];
    }
    const machine = {
      duration: MACHINE_DURATION, kind: 'oscillating', spec, seed, validateParameters, parameters: P, fractionAtPhase,
      snapshot() {
        base.live();
        const time = base.time, { current, phase, fraction } = at(time), stage = fraction < spec.stages.low ? 0 : fraction > spec.stages.high ? 2 : Math.cos(phase) >= 0 ? 1 : 3;
        return { time, speed: current.speed, seed, playbackRate: base.playbackRate, playing: base.playing, stage, fraction,
          parameters: { ...Object.fromEntries(Object.keys(P).map((k) => [k, current[k]])), [manual]: fraction },
          counters: { [spec.counters.percent]: Math.round(fraction * 100) }, conformation: { weights: [1 - fraction, fraction] },
          events: schedule.filter((item) => item.time <= time && item.time > 0).slice(-20).map((item) => ({ time: item.time, label: spec.eventLabel })) };
      },
      seek: (v) => { base.seek(v); return machine.snapshot(); }, advance: (dt) => { base.advance(dt); return machine.snapshot(); },
      play: base.play, pause: base.pause, setPlaybackRate: base.setPlaybackRate, dispose: base.dispose,
      setParameters(value) { change(validateParameters(value)); },
      setMorph(value) { if (value === 'auto') change({ [auto]: 1 }); else change(validateParameters({ [manual]: value })); },
      setSpeed(speed) { if (!Number.isFinite(speed) || speed < min || speed > max) throw new Error(`${spec.speed.label}应为 ${min}–${max}。`); change({ speed }); },
      stepTime(index) { base.live(); if (!Number.isInteger(index) || index < 0 || index >= spec.steps) throw new Error('机制步骤无效。'); return undefined; },
      save() { base.live(); return { time: base.time, speed: at(base.time).current.speed, seed, playbackRate: base.playbackRate, schedule: schedule.map((item) => ({ ...item })) }; },
    };
    return machine;
  },
});
export const machineKinds = () => [...PROFILES.keys()];
