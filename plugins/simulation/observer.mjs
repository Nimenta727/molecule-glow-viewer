/**
 * Observing a stochastic run (4.4.4): sample a run of markov-model.mjs into series (counters, clocks, observables, the discrete variables), turn counters into
 * rates, estimate the current from counted permeation events, and write the series as CSV. Pure functions over `run.at(time)`; nothing here draws.
 */
export const ELEMENTARY_CHARGE = 1.602e-19;   // C: the value the KcsA kinetics use (singleChannelCurrent's 1.602e-7 pA per event/s is this, times 1e12)

/**
 * Samples `run` every `step` seconds of display time from `from` to `to` (at most `maxPoints` points; a longer span widens the step).
 * Returns { times, counters: {name: []}, clocks: {name: []}, observables: {name: []}, vars: {name: []} }.
 */
export function sampleRun(run, { from = 0, to, step, maxPoints = 2000 } = {}) {
  if (!(to > from) || !(step > 0)) throw new Error('采样需要 to > from 和正的步长。');
  const stride = Math.max(step, (to - from) / (maxPoints - 1)), series = { times: [], counters: {}, clocks: {}, observables: {}, vars: {} };
  for (let t = from; t <= to + 1e-9; t += stride) {
    const s = run.at(Math.min(t, to));
    series.times.push(s.time);
    for (const [group, values] of [['counters', s.counters], ['clocks', s.clocks], ['observables', s.observables], ['vars', s.vars]]) for (const [k, v] of Object.entries(values)) (series[group][k] ??= []).push(v);
  }
  return series;
}

/** Average rate of a counter or clock between consecutive samples (per second of display time); the first point repeats the second. */
export function ratesOf(series, group, name, window = 1) {
  const values = series[group]?.[name], t = series.times;
  if (!values) throw new Error(`没有曲线 ${group}.${name}。`);
  return values.map((_, i) => { const j = Math.max(0, i - window), k = Math.max(i, window); const a = Math.min(j, values.length - 1 - window), b = a + window; return t[b] > t[a] ? (values[b] - values[a]) / (t[b] - t[a]) : 0; });
}

/**
 * Single-channel current in pA from counted events: net outward K⁺ (out - inn) per conducting nanosecond, times the elementary charge.
 * `ns` is the conducting-time clock in ns; 0 when the channel never conducted.
 */
export function currentFromCounts({ out, inn, ns }) {
  return ns > 0 ? (out - inn) / (ns * 1e-9) * ELEMENTARY_CHARGE * 1e12 : 0;
}

/** The series as CSV (header row, one row per sample): time, counters, clocks, observables, then the variables' values. */
export function toCSV(series) {
  const cols = [['time', series.times]];
  for (const group of ['counters', 'clocks', 'observables', 'vars']) for (const [k, v] of Object.entries(series[group])) cols.push([k, v]);
  const cell = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(10)) : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  return [cols.map(([name]) => name).join(','), ...series.times.map((_, i) => cols.map(([, v]) => cell(v[i])).join(','))].join('\n') + '\n';
}

/** The kinds of display rows a work can ask for, and the name each needs. */
export const DISPLAY_KINDS = Object.freeze({ counter: 'counter', observable: 'observable', clock: 'clock', rate: 'counter', current: null, number: 'number' });

/**
 * One display row's value at `time` (display seconds). Row: { kind, name, unit?, digits?, window?, out?, inn?, ns? }
 *   counter / observable / clock / number  the named number now (a number is a whole-number state variable, such as a position or a length)                 rate  the counter's events per second over the last `window` s (default 5)
 *   current                        the single-channel current (pA) estimated from the counts `out`, `inn` and the clock `ns` since the start
 */
export function readDisplay(run, row, time) {
  const at = (t) => run.at(Math.max(0, t));
  if (row.kind === 'counter') return at(time).counters[row.name];
  if (row.kind === 'observable') return at(time).observables[row.name];
  if (row.kind === 'clock') return at(time).clocks[row.name];
  if (row.kind === 'number') return at(time).nums[row.name];
  if (row.kind === 'rate') { const w = Math.min(row.window ?? 5, Math.max(time, 1e-9)), a = at(time - w), b = at(time); return (b.counters[row.name] - a.counters[row.name]) / w; }
  if (row.kind === 'current') { const s = at(time); return currentFromCounts({ out: s.counters[row.out], inn: s.counters[row.inn], ns: s.clocks[row.ns] }); }
  throw new Error(`没有这种显示项“${row.kind}”。`);
}
