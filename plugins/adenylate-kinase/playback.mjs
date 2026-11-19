export const PARAMETERS = {
  morph: { label: '构象闭合程度（0=张开，1=闭合）', control: 'range', min: 0, max: 1, step: 0.01, value: 0 },
  auto: { label: '自动往复（0=手动，1=自动）', min: 0, max: 1, step: 1, value: 1 },
  ap5: { label: '显示闭合态 Ap5A 参考（0/1）', min: 0, max: 1, step: 1, value: 1 },
};
export function validateParameters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AdK 参数需要对象。');
  for (const [key, number] of Object.entries(value)) {
    const field = PARAMETERS[key];
    if (!field || !Number.isFinite(number) || number < field.min || number > field.max || key !== 'morph' && !Number.isInteger(number)) throw new Error(`AdK 参数 ${key} 无效。`);
  }
  return { ...value };
}
const PI = Math.PI, TAU = 2 * PI;
const clamp = (value) => Math.min(1, Math.max(0, value));
// Port of the classic frame-loop's sine, endpoint holds and ease-in/out.
export function fractionAtPhase(phase) {
  const f = clamp(((Math.sin(phase) + 1) / 2 - 0.1) / 0.8);
  return f * f * (3 - 2 * f);
}
export function createAdkPlayback(state = {}) {
  let disposed = false, playing = false;
  const seed = Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed <= 4294967295 ? state.seed : 1;
  let time = Number.isFinite(state.time) ? Math.max(0, Math.min(120, state.time)) : 0;
  let playbackRate = [0.25, 1, 2, 5].includes(state.playbackRate) ? state.playbackRate : 1;
  const initial = { time: 0, phase: -PI / 2, speed: state.speed ?? 1, auto: 1, morph: 0, ap5: 1 };
  function entry(value) {
    if (!value || typeof value !== 'object') throw new Error('AdK 播放记录无效。');
    const { time, phase, speed, ...parameters } = value;
    validateParameters(parameters);
    if (!Number.isFinite(time) || time < 0 || time > 120 || !Number.isFinite(phase) || Math.abs(phase) > 200 ||
      !Number.isFinite(speed) || speed < 0.05 || speed > 3 || Object.keys(PARAMETERS).some((key) => parameters[key] == null)) throw new Error('AdK 播放记录无效。');
    return { time, phase, speed, ...parameters };
  }
  let schedule;
  if (state.schedule == null) schedule = [entry(initial)];
  else {
    if (!Array.isArray(state.schedule) || !state.schedule.length || state.schedule.length > 1000) throw new Error('AdK 播放记录超出范围。');
    schedule = state.schedule.map(entry);
    if (schedule[0].time !== 0 || schedule.some((item, i) => i && item.time <= schedule[i - 1].time)) throw new Error('AdK 播放记录顺序无效。');
  }
  const ensureLive = () => { if (disposed) throw new Error('AdK 播放器已释放。'); };
  function at(t) {
    const current = schedule.findLast((item) => item.time <= t);
    const phase = current.phase + (current.auto ? (t - current.time) * 0.35 * current.speed : 0);
    const fraction = current.auto ? fractionAtPhase(phase) : current.morph;
    return { current, phase, fraction };
  }
  function change(patch) {
    ensureLive();
    if (schedule.length >= 1000) throw new Error('AdK 参数变更已达上限。');
    const { current, phase, fraction } = at(time);
    const next = { ...current, ...patch, time, phase, morph: fraction };
    if (patch.morph != null) { next.morph = patch.morph; if (patch.auto == null) next.auto = 0; }
    if (next.auto && (!current.auto || patch.morph != null)) {
      // Resume from the manually chosen shape without jumping to the old oscillator phase.
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (mid * mid * (3 - 2 * mid) < next.morph) lo = mid; else hi = mid; }
      const sin = (0.1 + ((lo + hi) / 2) * 0.8) * 2 - 1;
      const angle = Math.asin(Math.max(-1, Math.min(1, sin)));
      const cycle = Math.floor((phase + PI / 2) / TAU) * TAU;
      next.phase = cycle + (Math.cos(phase) >= 0 ? angle : PI - angle);
    }
    schedule = [...schedule.filter((item) => item.time < time), entry(next)];
  }
  return {
    duration: 120, validateParameters,
    snapshot() {
      ensureLive();
      const { current, phase, fraction } = at(time);
      const stage = fraction < 0.15 ? 0 : fraction > 0.85 ? 2 : Math.cos(phase) >= 0 ? 1 : 3;
      return { time, speed: current.speed, seed, playbackRate, playing, stage, fraction,
        parameters: { morph: fraction, auto: current.auto, ap5: current.ap5 },
        counters: { '闭合程度（%）': Math.round(fraction * 100) },
        conformation: { weights: [1 - fraction, fraction] },
        transforms: new Map(), events: schedule.filter((item) => item.time <= time && item.time > 0).slice(-20).map((item) => ({ time: item.time, label: '构象展示参数变更' })) };
    },
    setParameters(value) { change(validateParameters(value)); },
    setMorph(value) { if (value === 'auto') change({ auto: 1 }); else change(validateParameters({ morph: value })); },
    seek(value) { ensureLive(); if (!Number.isFinite(value)) throw new Error('时间必须有限。'); time = Math.max(0, Math.min(120, value)); if (time === 120) playing = false; },
    advance(dt) { ensureLive(); if (!Number.isFinite(dt) || dt < 0) throw new Error('时间增量无效。'); if (playing) time = Math.min(120, Math.round((time + dt * playbackRate) * 1e9) / 1e9); if (time === 120) playing = false; },
    play() { ensureLive(); if (time < 120) playing = true; }, pause() { ensureLive(); playing = false; },
    setSpeed(speed) { if (!Number.isFinite(speed) || speed < 0.05 || speed > 3) throw new Error('往复倍率应为 0.05–3。'); change({ speed }); },
    setPlaybackRate(value) { ensureLive(); if (![0.25, 1, 2, 5].includes(value)) throw new Error('播放倍率无效。'); playbackRate = value; },
    stepTime(index) { ensureLive(); if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('机制步骤无效。'); return undefined; },
    save() { ensureLive(); return { time, speed: at(time).current.speed, seed, playbackRate, schedule: schedule.map((item) => ({ ...item })) }; },
    dispose() { disposed = true; playing = false; },
  };
}
