/**
 * Rewind and intervene (4.4.8) for the data animation. The animation is deterministic: fixed 1/30 s steps from a seed, so the picture at step n depends only on the seed, the
 * settings at the start and the *interventions* made on the way. A Replay keeps the interventions as a log and gets to any step by running the animation from the start
 * (or on from where it is when the target is ahead), applying each intervention at the step where it was made. So:
 *   rewind    = seek to an earlier step (the log stays; running on again reproduces the same future);
 *   intervene = change a switch / slider / the pace / the time scale at the current step, which is logged; made in the past, it ends the old future (the log after it is dropped).
 * Nothing here knows what the animation draws: `make(host)` builds a fresh engine (with `step(dt)` and an optional `kinetics`), `host` holds the two settings the engine reads.
 */
export const STEP = 1 / 30;
export const REPLAY_LIMITS = Object.freeze({ interventions: 200, steps: 30 * 60 * 30 });   // at most 200 interventions; a run of up to 30 minutes can be rewound
export const KINDS = Object.freeze(['control', 'pace', 'scale']);

/** One intervention: { step, kind: 'control' (id, value) | 'pace' (value 0.3–3) | 'scale' (value 'slow' | 'fast') }. Returns the clean entry or throws with the reason. */
export function normalizeIntervention(raw) {
  const step = Number(raw?.step);
  if (!Number.isInteger(step) || step < 0 || step > REPLAY_LIMITS.steps) throw new Error('干预发生的步数无效。');
  if (raw.kind === 'control') {
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 60) throw new Error('控件名无效。');
    const value = typeof raw.value === 'boolean' ? raw.value : Number(raw.value);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('控件的值必须是数字或开关。');
    return { step, kind: 'control', id: raw.id, value };
  }
  if (raw.kind === 'pace') { const value = Number(raw.value); if (!Number.isFinite(value) || value < 0.3 || value > 3) throw new Error('快慢应在 0.3–3 之间。'); return { step, kind: 'pace', value }; }
  if (raw.kind === 'scale') { if (raw.value !== 'slow' && raw.value !== 'fast') throw new Error('时间尺度只能是 slow 或 fast。'); return { step, kind: 'scale', value: raw.value }; }
  throw new Error(`未知的干预类型：${String(raw?.kind).slice(0, 20)}。`);
}

/** A saved log: the entries that are valid, in order of step (entries that are not are dropped and reported in `dropped`). */
export function normalizeLog(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, REPLAY_LIMITS.interventions) : [], log = [];
  let dropped = Array.isArray(raw) ? Math.max(0, raw.length - list.length) : 0;
  for (const item of list) { try { log.push(normalizeIntervention(item)); } catch { dropped++; } }
  return { log: log.map((e, i) => ({ e, i })).sort((a, b) => a.e.step - b.e.step || a.i - b.i).map(({ e }) => e), dropped };
}

export class Replay {
  /** `make(host)` builds a fresh engine for the settings in `host` ({ pace, scale }); `initial` is the starting `host`. */
  constructor({ make, initial = { pace: 1, scale: 'slow' }, log = [] }) {
    this.make = make; this.initial = { ...initial }; this.log = normalizeLog(log).log; this.host = { ...this.initial };
    this.step = 0; this.furthest = 0; this.warnings = [];
    this.engine = null; this.#rebuild(0);
  }
  #apply(entry) {
    try {
      if (entry.kind === 'control') { if (!this.engine.kinetics) throw new Error('这个作品没有可调的控件。'); this.engine.kinetics.setControl(entry.id, entry.value); }
      else this.host[entry.kind] = entry.value;
    } catch (error) { this.warnings.push(`第 ${entry.step} 步的干预已跳过：${error.message}`); }
  }
  #arrive() { for (const entry of this.log) if (entry.step === this.step) this.#apply(entry); }
  #rebuild() { this.engine?.dispose?.(); this.host = { ...this.initial }; this.engine = this.make(this.host); this.step = 0; this.warnings = []; this.#arrive(); }
  /** Run `n` steps on, applying the logged interventions as their steps are reached. Returns the steps run. */
  advance(n) {
    let ran = 0;
    for (; ran < n && this.step < REPLAY_LIMITS.steps; ran++) { this.engine.step(STEP); this.step++; this.#arrive(); }
    this.furthest = Math.max(this.furthest, this.step);
    return ran;
  }
  /** Go to step `target`: on from here when it is ahead, otherwise from the start (a rewind). */
  seek(target) {
    const goal = Math.max(0, Math.min(REPLAY_LIMITS.steps, Math.round(Number(target) || 0)));
    if (goal < this.step) this.#rebuild();
    this.advance(goal - this.step);
    return this.step;
  }
  /** Make an intervention now (it takes effect at once and is logged at this step); one made in the past drops the old future. Returns { dropped } (entries removed). */
  intervene(raw) {
    const entry = normalizeIntervention({ ...raw, step: this.step });
    if (this.log.length >= REPLAY_LIMITS.interventions) throw new Error(`干预记录已满（最多 ${REPLAY_LIMITS.interventions} 条）。`);
    const before = this.log.length;
    this.log = this.log.filter((e) => e.step <= this.step);
    const dropped = before - this.log.length;
    this.furthest = this.step;
    this.log.push(entry); this.#apply(entry);
    return { dropped };
  }
  /** What a saved work keeps: the log and where the animation was. */
  save() { return { version: 1, step: this.step, interventions: this.log.map((e) => ({ ...e })) }; }
  get time() { return this.step * STEP; }
  dispose() { this.engine?.dispose?.(); this.engine = null; }
}
