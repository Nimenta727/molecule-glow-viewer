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
const LABELS = { open: 'pH 门打开', close: '门关闭', inact: '过滤器失活', recover: '失活恢复，门关', reopen: '恢复导电',
  'tba+': 'TBA 结合中央腔', 'tba-': 'TBA 解离', 'ba+': 'Ba²⁺ 阻断过滤器', 'ba-': 'Ba²⁺ 解离',
  AB: '水合 K⁺ 进入中央腔', BC: '敲击：K⁺ 进入过滤器', CD: 'K⁺ 释放至胞外', DC: 'K⁺ 从胞外进入',
  DA: '过滤器重新分配', BA: 'K⁺ 退回胞内', CB: '敲击反向', AD: '过滤器反向重排', na: 'Na⁺ 进入腔后被排斥' };
export const conformationWeights = (s, t) => {
  const f = Math.min(1, Math.max(0, (t - s.confTime) / 0.8));
  return s.confFrom.map((weight, i) => weight * (1 - f) + Number(i === s.confTo) * f);
};

// One CTMC on display time, with separately configurable gating and permeation clocks.
// The clocks run continuously; visual interpolation never blocks or advances chemistry.
export function createKinetics(seed, schedule) {
  let rng = seed >>> 0;
  const random = () => { rng = (rng + 0x6d2b79f5) >>> 0; let n = rng; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  const history = [{ time: 0, gate: 'C', perm: 'A', tba: false, ba: false, out: 0, inn: 0, na: 0,
    ns: 0, gateSeconds: 0, openSeconds: 0, confTime: 0, confFrom: [1, 0, 0], confTo: 0, stage: 0, id: 'initial', configIndex: 0,
    permTime: -1, lastPermId: null, naTime: -1 }];
  let pending;
  function clock(previous, time, c) {
    const dt = time - previous.time;
    return { ns: previous.ns + (conducting(previous) ? dt * c.speed * c.ionSpeed : 0),
      gateSeconds: previous.gateSeconds + dt * c.speed * c.gateSpeed,
      openSeconds: previous.openSeconds + (conducting(previous) ? dt * c.speed * c.gateSpeed : 0) };
  }
  function next() {
    const s = history.at(-1), c = schedule[s.configIndex], { f, b } = permeationRates(c);
    const rates = gateRates(s, c).map(([r, id]) => [r * c.gateSpeed * c.speed, id]);
    if (conducting(s)) {
      const edges = { A: [[f[0], 'AB'], [b[3], 'AD']], B: [[b[0], 'BA'], [f[1], 'BC']], C: [[b[1], 'CB'], [f[2], 'CD']], D: [[b[2], 'DC'], [f[3], 'DA']] }[s.perm] ?? [];
      rates.push(...edges.map(([r, id]) => [r * c.ionSpeed * 1e-9 * c.speed, id]));
      if (['A', 'D'].includes(s.perm)) rates.push([f[0] * (c.Nai / c.Ki) * 0.5 * c.ionSpeed * 1e-9 * c.speed, 'na']);
    }
    const total = rates.reduce((sum, [r]) => sum + r, 0);
    const tau = total ? -Math.log(1 - random()) / total : Infinity;
    const boundary = schedule[s.configIndex + 1]?.time ?? Infinity;
    if (s.time + tau >= boundary) return { ...s, ...clock(s, boundary, c), time: boundary, configIndex: s.configIndex + 1, id: 'parameter' };
    if (!Number.isFinite(tau)) return { ...s, time: Infinity };
    let pick = random() * total, id = rates.at(-1)[1];
    for (const [r, name] of rates) { pick -= r; if (pick <= 0) { id = name; break; } }
    const time = s.time + tau, result = { ...s, ...clock(s, time, c), time, id };
    if (['open', 'reopen', 'close', 'recover', 'inact'].includes(id)) {
      result.confFrom = conformationWeights(s, time); result.confTime = time;
      result.gate = id === 'inact' ? 'I' : ['open', 'reopen'].includes(id) ? 'O' : 'C';
      result.confTo = { C: 0, O: 1, I: 2 }[result.gate];
      if (id === 'inact') result.perm = 'X';
      if (['recover', 'reopen'].includes(id)) result.perm = 'A';
      result.stage = id === 'inact' ? 5 : 0;
    } else if (id.startsWith('tba')) result.tba = id.endsWith('+');
    else if (id.startsWith('ba')) result.ba = id.endsWith('+');
    else if (id === 'na') { result.na++; result.naTime = time; }
    else {
      result.perm = id[1];
      result.permTime = time; result.lastPermId = id;
      result.stage = { AB: 1, BC: 3, CD: 4, DC: 4, DA: 2, BA: 1, CB: 3, AD: 2 }[id];
      if (id === 'CD') result.out++;
      if (id === 'DC') result.inn++;
    }
    return result;
  }
  return {
    at(time) {
      while (true) {
        pending ??= next();
        if (pending.time > time) break;
        if (history.length > 250000) throw new Error('KcsA 事件容量已满。');
        history.push(pending); pending = undefined;
      }
      let lo = 0, hi = history.length;
      while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (history[mid].time <= time) lo = mid; else hi = mid; }
      const s = history[lo], c = schedule[s.configIndex];
      return { ...s, ...clock(s, time, c), time, parameters: c, weights: conformationWeights(s, time),
        events: history.slice(Math.max(1, lo - 19), lo + 1).map(({ time, id }) => ({ time, label: LABELS[id] ?? '参数变更' })) };
    },
  };
}
