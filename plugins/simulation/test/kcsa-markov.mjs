// The KcsA gating, blocking and permeation chain (plugins/kcsa/kinetics.mjs createKinetics) written as data for the generic Markov engine. It is the acceptance
// evidence of the format: the test runs both with the same seeds and schedules and requires the same events at the same times. It is not a shipped work.
const gs = ' * gateSpeed * speed', io = ' * ionSpeed * 1e-9 * speed';
const clock = (name, add) => ({ name, add });
export const kcsaMarkov = {
  version: 1, title: 'KcsA：pH 门控、阻断与四态敲击渗透',
  constants: { k1: 9e8, km1: 1.5e8, k2: 1.5e9, km2: 3e8, k3: 4.5e8, k4: 9e8, km4: 6e8, km3: 9e8 * 1.5e9 * 4.5e8 * 9e8 / (1.5e8 * 3e8 * 6e8) },
  parameters: [
    { id: 'pH', label: '胞内 pH', min: 3.5, max: 8, step: 0.1, default: 4 }, { id: 'V', label: '膜电位（mV）', min: -160, max: 150, step: 5, default: 50, unit: 'mV' },
    { id: 'Ki', label: '胞内 K⁺（mM）', min: 1, max: 300, step: 1, default: 140, unit: 'mM' }, { id: 'Ko', label: '胞外 K⁺（mM）', min: 1, max: 300, step: 1, default: 5, unit: 'mM' },
    { id: 'Nai', label: '胞内 Na⁺（mM）', min: 0, max: 150, step: 5, default: 10, unit: 'mM' }, { id: 'TBA', label: '胞内 TBA（µM）', min: 0, max: 100, step: 1, default: 0, unit: 'µM' },
    { id: 'Ba', label: '胞内 Ba²⁺（µM）', min: 0, max: 100, step: 1, default: 0, unit: 'µM' }, { id: 'wt', label: '野生型失活动力学（0=E71A，1=野生型）', min: 0, max: 1, step: 1, default: 0, integer: true },
    { id: 'ionSpeed', label: '渗透时钟（ns/示意秒）', min: 2, max: 50, step: 1, default: 10 }, { id: 'gateSpeed', label: '门控时钟（s/示意秒）', min: 0.01, max: 1, step: 0.01, default: 0.05 },
    { id: 'speed', label: '模拟速度', min: 0.01, max: 100, step: 0.01, default: 1 }],
  variables: { gate: { values: ['C', 'O', 'I'], init: 'C' }, perm: { values: ['A', 'B', 'C', 'D', 'X'], init: 'A' }, tba: { values: ['off', 'on'], init: 'off' }, ba: { values: ['off', 'on'], init: 'off' } },
  derived: [
    { name: 'u', expr: 'V / 25.69' }, { name: 'h', expr: '1 / (1 + 10 ^ (2 * (pH - 4.2)))' }, { name: 'conducting', expr: 'gate_O && tba_off && ba_off' },
    { name: 'f0', expr: 'k1 * Ki / 1000 * exp(0.15 * u / 2)' }, { name: 'f1', expr: 'k2 * exp(0.35 * u / 2)' }, { name: 'f2', expr: 'k3 * exp(0.15 * u / 2)' }, { name: 'f3', expr: 'k4 * exp(0.35 * u / 2)' },
    { name: 'b0', expr: 'km1 / exp(0.15 * u / 2)' }, { name: 'b1', expr: 'km2 / exp(0.35 * u / 2)' }, { name: 'b2', expr: 'km3 * Ko / 1000 / exp(0.15 * u / 2)' }, { name: 'b3', expr: 'km4 / exp(0.35 * u / 2)' }],
  counters: ['out', 'inn', 'na'],
  transitions: [
    { id: 'open', label: 'pH 门打开', when: 'gate_C', rate: '50 * h' + gs, set: { gate: 'O' } },
    { id: 'close', label: '门关闭', when: 'gate_O', rate: '(50 * (1 - h) + 2)' + gs, set: { gate: 'C' } },
    { id: 'inact', label: '过滤器失活', when: 'gate_O && wt', rate: '1.2' + gs, set: { gate: 'I', perm: 'X' } },
    { id: 'recover', label: '失活恢复，门关', when: 'gate_I', rate: '(0.3 * (1 - h) + 0.03)' + gs, set: { gate: 'C', perm: 'A' } },
    { id: 'reopen', label: '恢复导电', when: 'gate_I', rate: '0.05' + gs, set: { gate: 'O', perm: 'A' } },
    { id: 'tba+', label: 'TBA 结合中央腔', when: 'gate_O && tba_off && ba_off && (perm_A || perm_D)', rate: 'TBA * exp(0.15 * u)' + gs, set: { tba: 'on' } },
    { id: 'tba-', label: 'TBA 解离', when: 'tba_on && gate_O', rate: '3 * exp(-0.15 * u)' + gs, set: { tba: 'off' } },
    { id: 'ba+', label: 'Ba²⁺ 阻断过滤器', when: 'gate_O && tba_off && ba_off && perm_A', rate: '0.02 * Ba * exp(0.6 * u)' + gs, set: { ba: 'on' } },
    { id: 'ba-', label: 'Ba²⁺ 解离', when: 'ba_on', rate: '0.3 * exp(-0.6 * u)' + gs, set: { ba: 'off' } },
    { id: 'AB', label: '水合 K⁺ 进入中央腔', when: 'conducting && perm_A', rate: 'f0' + io, set: { perm: 'B' } },
    { id: 'AD', label: '过滤器反向重排', when: 'conducting && perm_A', rate: 'b3' + io, set: { perm: 'D' } },
    { id: 'BA', label: 'K⁺ 退回胞内', when: 'conducting && perm_B', rate: 'b0' + io, set: { perm: 'A' } },
    { id: 'BC', label: '敲击：K⁺ 进入过滤器', when: 'conducting && perm_B', rate: 'f1' + io, set: { perm: 'C' } },
    { id: 'CB', label: '敲击反向', when: 'conducting && perm_C', rate: 'b1' + io, set: { perm: 'B' } },
    { id: 'CD', label: 'K⁺ 释放至胞外', when: 'conducting && perm_C', rate: 'f2' + io, set: { perm: 'D' }, count: { out: 1 } },
    { id: 'DC', label: 'K⁺ 从胞外进入', when: 'conducting && perm_D', rate: 'b2' + io, set: { perm: 'C' }, count: { inn: 1 } },
    { id: 'DA', label: '过滤器重新分配', when: 'conducting && perm_D', rate: 'f3' + io, set: { perm: 'A' } },
    { id: 'na', label: 'Na⁺ 进入腔后被排斥', when: 'conducting && (perm_A || perm_D)', rate: 'f0 * (Nai / Ki) * 0.5' + io, count: { na: 1 } }],
  clocks: [clock('ns', 'conducting ? dt * speed * ionSpeed : 0'), clock('gateSeconds', 'dt * speed * gateSpeed'), clock('openSeconds', 'conducting ? dt * speed * gateSpeed : 0')],
  observables: [{ name: 'EK', label: '钾平衡电位', unit: 'mV', expr: '25.69 * log(Ko / Ki)' }, { name: 'openFraction', label: '门控时钟下的开放比例', expr: 'gateSeconds > 0 ? openSeconds / gateSeconds : 0' }],
};
