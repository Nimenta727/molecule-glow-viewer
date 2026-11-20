import { createMarkovRun } from '../simulation/markov-model.mjs';
import { KCSA_GATING } from '../simulation/works/kcsa-gating.mjs';
// Rates ported from src/sim/processes/kcsa.js. Units: mV, mM, µM, seconds.
export const PARAMETERS = {
  pH: { label: '胞内 pH', min: 3.5, max: 8, step: 0.1, value: 4 },
  V: { label: '膜电位（mV）', min: -160, max: 150, step: 5, value: 50 },
  Ki: { label: '胞内 K⁺（mM）', min: 1, max: 300, step: 1, value: 140 },
  Ko: { label: '胞外 K⁺（mM）', min: 1, max: 300, step: 1, value: 5 },
  Nai: { label: '胞内 Na⁺（mM）', min: 0, max: 150, step: 5, value: 10 },
  TBA: { label: '胞内 TBA（µM）', min: 0, max: 100, step: 1, value: 0 },
  Ba: { label: '胞内 Ba²⁺（µM）', min: 0, max: 100, step: 1, value: 0 },
  wt: { label: '野生型失活动力学（0=E71A，1=野生型）', min: 0, max: 1, step: 1, value: 0 },
  ionSpeed: { label: '渗透时钟（ns/示意秒）', min: 2, max: 50, step: 1, value: 10 },
  gateSpeed: { label: '门控时钟（s/示意秒）', min: 0.01, max: 1, step: 0.01, value: 0.05 },
};
export const DEFAULTS = Object.fromEntries(Object.entries(PARAMETERS).map(([key, { value }]) => [key, value]));
export function validateParameters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('KcsA 参数需要对象。');
  for (const [key, number] of Object.entries(value)) {
    const p = PARAMETERS[key];
    if (!p || !Number.isFinite(number) || number < p.min || number > p.max || key === 'wt' && !Number.isInteger(number)) throw new Error(`KcsA 参数 ${key} 无效。`);
  }
  return { ...value };
}
export function permeationRates(c) {
  const u = c.V / 25.69, E = (d) => Math.exp(d * u / 2);
  const k1 = 9e8, km1 = 1.5e8, k2 = 1.5e9, km2 = 3e8, k3 = 4.5e8, k4 = 9e8, km4 = 6e8;
  const km3 = k1 * k2 * k3 * k4 / (km1 * km2 * km4);
  return { f: [k1 * c.Ki / 1000 * E(0.15), k2 * E(0.35), k3 * E(0.15), k4 * E(0.35)],
    b: [km1 / E(0.15), km2 / E(0.35), km3 * c.Ko / 1000 / E(0.15), km4 / E(0.35)] };
}
export const reversalPotential = (c) => 25.69 * Math.log(c.Ko / c.Ki);
export function singleChannelCurrent(c) {
  const { f, b } = permeationRates(c), M = Array.from({ length: 4 }, () => Array(5).fill(0));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    M[j][i] += f[i]; M[i][i] -= f[i]; M[i][j] += b[i]; M[j][j] -= b[i];
  }
  M[3] = [1, 1, 1, 1, 1];
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < 4; r++) if (r !== col) {
      const factor = M[r][col] / M[col][col];
      for (let k = col; k <= 4; k++) M[r][k] -= factor * M[col][k];
    }
  }
  const p = M.map((row, i) => row[4] / row[i]);
  return (p[0] * f[0] - p[1] * b[0]) * 1.602e-7;
}
export const conducting = (s) => s.gate === 'O' && !s.tba && !s.ba;
export function gateRates(s, c) {
  const h = 1 / (1 + 10 ** (2 * (c.pH - 4.2))), u = c.V / 25.69, rates = [];
  const add = (rate, id) => { if (rate > 0) rates.push([rate, id]); };
  if (s.gate === 'C') add(50 * h, 'open');
  if (s.gate === 'O') { add(50 * (1 - h) + 2, 'close'); if (c.wt) add(1.2, 'inact'); }
  if (s.gate === 'I') { add(0.3 * (1 - h) + 0.03, 'recover'); add(0.05, 'reopen'); }
  if (s.gate === 'O' && !s.tba && !s.ba && ['A', 'D'].includes(s.perm)) add(c.TBA * Math.exp(0.15 * u), 'tba+');
  if (s.tba && s.gate === 'O') add(3 * Math.exp(-0.15 * u), 'tba-');
  if (s.gate === 'O' && !s.tba && !s.ba && s.perm === 'A') add(0.02 * c.Ba * Math.exp(0.6 * u), 'ba+');
  if (s.ba) add(0.3 * Math.exp(-0.6 * u), 'ba-');
  return rates;
}
export const conformationWeights = (s, t) => {
  const f = Math.min(1, Math.max(0, (t - s.confTime) / 0.8));
  return s.confFrom.map((weight, i) => weight * (1 - f) + Number(i === s.confTo) * f);
};

// The KcsA chain runs on the generic Markov engine since 4.4.8: the model is data (plugins/simulation/works/kcsa-gating.mjs), exact Gillespie sampling on a seeded stream, a
// schedule of parameter changes, clocks and counters. This wrapper keeps the player's view of it: the state at a display time with the fields the player reads. The clocks run
// continuously; visual interpolation never blocks or advances chemistry. The same seed and schedule give the same events at the same times as the hand-written chain did.
const GATE_TARGET = { open: 1, reopen: 1, close: 0, recover: 0, inact: 2 };
const PERMEATION = /^[A-D][A-D]$/, STAGES = { AB: 1, BC: 3, CD: 4, DC: 4, DA: 2, BA: 1, CB: 3, AD: 2 };
export function createKinetics(seed, schedule) {
  const run = createMarkovRun(KCSA_GATING, seed, schedule);
  // What the last events left behind (the conformation the gate is moving between, the stage, when a K+ last moved and when Na+ last entered), folded event by event and kept.
  const folded = [{ time: 0, id: 'initial', confTime: 0, confFrom: [1, 0, 0], confTo: 0, stage: 0, permTime: -1, lastPermId: null, naTime: -1 }];
  function extend(time) {
    run.at(time);
    for (const event of run.eventsBetween(folded.at(-1).time, time)) {
      const d = folded.at(-1), next = { ...d, time: event.time, id: event.id };
      if (event.id in GATE_TARGET) {
        next.confFrom = conformationWeights(d, event.time); next.confTime = event.time; next.confTo = GATE_TARGET[event.id]; next.stage = event.id === 'inact' ? 5 : 0;
      } else if (event.id === 'na') next.naTime = event.time;
      else if (PERMEATION.test(event.id)) { next.permTime = event.time; next.lastPermId = event.id; next.stage = STAGES[event.id]; }
      folded.push(next);
    }
  }
  return {
    at(time) {
      extend(time);
      let lo = 0, hi = folded.length;
      while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (folded[mid].time <= time) lo = mid; else hi = mid; }
      const d = folded[lo], y = run.at(time);
      return { time, gate: y.vars.gate, perm: y.vars.perm, tba: y.vars.tba === 'on', ba: y.vars.ba === 'on', out: y.counters.out, inn: y.counters.inn, na: y.counters.na,
        ns: y.clocks.ns, gateSeconds: y.clocks.gateSeconds, openSeconds: y.clocks.openSeconds, confTime: d.confTime, confFrom: d.confFrom, confTo: d.confTo, stage: d.stage,
        id: d.id, configIndex: y.configIndex, permTime: d.permTime, lastPermId: d.lastPermId, naTime: d.naTime, parameters: y.parameters, weights: conformationWeights(d, time),
        events: y.events.map(({ time: t, label }) => ({ time: t, label })) };
    },
  };
}
