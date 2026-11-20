/**
 * The choreography of the respiratory chain (classic: `cycle`, `qoTurn`, `pumpH`, `releaseH`, `takeH`, `shuttle`, `oxygen` of src/sim/processes/respiratory-chain.js) as a data-animation relay.
 * One cycle = one NADH = 2 electrons, drawn particle for particle: NADH gives 2 e⁻ to the Fe–S chain of complex I (4 H⁺ pumped), the quinol is oxidised twice at Qo of complex III (each
 * time 2 H⁺ released, one e⁻ down the low-potential chain bL → bH to Qi, one e⁻ up Rieske → c1 → cytochrome c to complex IV, where 1 H⁺ is pumped and 1 matrix H⁺ is used per e⁻ and O₂
 * becomes water after 4 e⁻). The cofactor positions are anchors found in the structure by what they are (component code, part, relation to each other), as the classic's setup did, so
 * any structure with the same parts runs; nothing here is a coordinate. 
 *
 * Not the classic: the wire of complex I is made of the [4Fe-4S] clusters only (the classic included the [2Fe-2S] ones, and on 5GUP its topmost cluster, N1a, is a dead end more than 20 Å from the
 * rest, so the classic's path falls back to one jump from end to end); cytochrome c is a marker that carries the electron between its two docking points (the protein itself is not moved), the second quinol comes from a point 45 Å
 * to the side instead of the layout's row direction, and O₂ arrives with the fourth electron instead of waiting at the a3–CuB centre.
 */
// the parts, by the original entity names the structure carries (the classic scene's `groupParts` rename them 复合体 I / III / IV for display: its keys are written here as one expression each)
const I = '/NADH|Acyl carrier/', III = '/b-c1|^Cytochrome b$|Cytochrome c1/', IV = '/oxidase/';
const ref = (name, extra = {}) => ({ ref: name, ...extra });
const mem = (dy, blend = 1) => ({ index: 0, dy, blend });
const e = (label, via, extra = {}) => ({ species: 'e⁻', via, labelVia: label, hop: 0.5, ...extra });

export const RESPIRATORY_ANCHORS = Object.freeze({
  feI: { ligands: 'SF4', part: I, chain: 'down' },                                         // the Fe–S wire of complex I, matrix tip → membrane (the [4Fe-4S] clusters N3 … N2)
  tip: { ligands: 'SF4', part: I, chain: 'down', take: 'first' },
  N2: { ligands: 'SF4', part: I, chain: 'down', take: 'last' },
  nadh: { ref: 'tip', offset: [0, 16, 0] },
  qI: { ref: 'N2', onMembrane: mem(0, 0.6) },
  cuA: { ligands: 'CU,CUA', part: IV, pick: 'paired' },
  cuB: { ligands: 'CU,CUA', part: IV, pick: 'unpaired' },
  a3: { ligands: 'HEA', part: IV, pick: 'nearest', to: ref('cuB'), rank: 0 },
  ha: { ligands: 'HEA', part: IV, pick: 'nearest', to: ref('cuB'), rank: 1 },
  c1: { ligands: 'HEC', part: III, pick: 'nearest', to: ref('cuA') },
  bL: { ligands: 'HEM', part: III, pick: 'nearest', to: ref('c1') },
  bH: { ligands: 'HEM', part: III, pick: 'nearest', to: ref('bL'), above: ref('bL'), margin: 6 },
  isp: { ligands: 'FES', part: III, pick: 'nearest', to: { between: [ref('bL'), ref('c1')], t: 0.5 } },
  Qo: { between: [ref('bL'), ref('isp')], t: 0.45 },
  Qi: { ref: 'bH', offset: [0, 7, 0] },
  dock1: { ref: 'c1', offset: [0, -24, 0] },                                               // cytochrome c docks below the complexes, in the intermembrane space
  dock2: { ref: 'cuA', offset: [0, -24, 0] },
  site: { between: [ref('a3'), ref('cuB')], t: 0.5 },                                       // the O₂ centre of complex IV
  pump1: { arm: I, fractions: [0.2] }, pump2: { arm: I, fractions: [0.4] }, pump3: { arm: I, fractions: [0.6] }, pump4: { arm: I, fractions: [0.8] },   // the four proton paths along the membrane arm
});

const pumpPath = (anchor, extra = {}) => [ref(anchor, { onMembrane: mem(24), ...extra }), ref(anchor, { onMembrane: mem(0), ...extra }), ref(anchor, { onMembrane: mem(-24), ...extra })];
const pump = (anchor, delay, extra = {}) => ({ species: 'H⁺', from: 'top', to: 'bot', via: pumpPath(anchor, extra), labelVia: 'H⁺（质子通道）', counter: 'H⁺ 泵出（复合体 I / IV）', wait: false, delay });
const takeH = (site, label) => ({ species: 'H⁺', from: 'top', via: [ref(site, { onMembrane: mem(26) }), ref(site)], labelVia: label, tIn: 1.8, tVia: 0.7, wait: false });
const releaseH = (i) => ({ species: 'H⁺', to: 'bot', via: [ref('Qo', { offset: [(i - 0.5) * 3, 0, 0] }), ref('Qo', { offset: [(i - 0.5) * 3, 0, 0], onMembrane: mem(-24, 0.5) }), ref('Qo', { offset: [(i - 0.5) * 3, 0, 0], onMembrane: mem(-24) })],
  labelVia: 'H⁺（Q 循环释放）', counter: 'H⁺ 释放到膜间隙（Q 循环）', tVia: 0.9, wait: false, delay: i * 0.3 });

/** One quinol oxidised at Qo (n = 1 or 2) and everything that follows from it: the two electron chains, cytochrome c's trip, complex IV, the way back. */
function qoTurn(n) {
  const second = n === 2;
  const lowPotential = e('e⁻（低电位链 bL → bH）', [ref('Qo'), ref('bL'), ref('bH'), ref('Qi')], { hop: 0.6, wait: false, then: second
    ? [{ species: 'H⁺', from: 'top', via: [ref('Qi', { onMembrane: mem(26) }), ref('Qi')], labelVia: 'H⁺ → Qi 位点', tIn: 1.8, tVia: 0.7, wait: false },
       { species: 'H⁺', from: 'top', via: [ref('Qi', { onMembrane: mem(26) }), ref('Qi')], labelVia: 'H⁺ → Qi 位点', tIn: 1.8, tVia: 0.7, wait: false },
       { species: 'QH₂', via: [ref('Qi'), ref('Qi', { offset: [45, 0, 0] })], brown: true, clear: 6, free: 6, tVia: 2.4, text: 'Qi 位点还原：Q•⁻ + e⁻ + 2H⁺ → QH₂（回到醌池）', labelVia: 'QH₂（Qi 生成，回醌池）', wait: false }]
    : [{ species: 'e⁻', via: [ref('Qi'), ref('Qi', { offset: [0, 0.01, 0] })], tVia: 0.2, text: 'Qi 位点：Q + e⁻ → Q•⁻（半醌，等第二个电子）', wait: false }] });
  return [
    [{ ...e('e⁻（Rieske → c1）', [ref('Qo'), ref('isp'), ref('c1'), ref('dock1')], { stage: 3, text: `Qo 位点：QH₂ 氧化（第 ${n} 个）→ Q + 2H⁺ + 2e⁻` }) }, releaseH(0), releaseH(1), lowPotential],
    [{ species: 'cyt c', via: [ref('dock1'), ref('dock2')], brown: true, inside: 'bot', tVia: 2.6, labelVia: 'cyt c · Fe²⁺（带 1 个 e⁻）', stage: 4, text: `细胞色素 c 运送第 ${n} 个 e⁻`, free: 14 }],
    [pump('ha', 0.6, { offset: [n * 4 - 6, 0, 0] }), { ...takeH('cuB', '“化学” H⁺ → O₂'), text: '基质 H⁺ 消耗（复合体 IV 生成水）' },
     { species: 'e⁻', via: [ref('dock2'), ref('cuA'), ref('ha'), ref('a3'), ref('cuB')], labelVia: 'e⁻（CuA → 血红素 a → a3–CuB）', hop: 0.55, stage: 5,
       then: second ? [{ species: 'O₂', from: 'top', via: [ref('site')], labelVia: 'O₂（结合在 a3–CuB）', every: 2, tIn: 2.4, tVia: 0.6, wait: false },
                       { species: 'H₂O', to: 'top', via: [ref('site')], text: 'O₂ + 4e⁻ + 4H⁺ → 2 H₂O', counter: 'O₂ → H₂O', every: 2, tOut: 2.6, wait: false },
                       { species: 'H₂O', to: 'top', via: [ref('site')], every: 2, tOut: 2.6, wait: false }] : [] }],
    [{ species: 'cyt c', via: [ref('dock2'), ref('dock1')], brown: true, inside: 'bot', tVia: 2.6, labelVia: 'cyt c · Fe³⁺', free: 14 }],
  ];
}

/** The relay of the work: one NADH per cycle, started as fast as the compartment model's flux allows. */
export const RESPIRATORY_RELAY = Object.freeze({
  name: '一个 NADH（2 e⁻）', rate: 0.12, max: 1, gate: 'flux',
  phases: [
    [{ species: 'NADH', from: 'top', via: [ref('nadh')], tIn: 2.4, tVia: 0.5, labelVia: 'NADH', counter: 'NADH', stage: 0 },
     { species: 'NAD⁺', to: 'top', via: [ref('nadh')], tOut: 2.6, wait: false, text: 'NADH → NAD⁺ + H⁺ + 2e⁻（2 个电子交给 FMN）' }],
    [pump('pump1', 0.5), pump('pump2', 0.85), pump('pump3', 1.2), pump('pump4', 1.55),
     { ...e('2 e⁻（FMN → 铁硫簇链）', [ref('nadh'), ref('feI'), ref('qI')], { hop: 0.45, stage: 1 }) }],
    [{ species: 'QH₂', via: [ref('qI'), ref('Qo')], brown: true, clear: 6, free: 6, tVia: 3.0, labelVia: 'QH₂（泛醇，在膜内扩散）', stage: 2, text: '复合体 I：Q + 2e⁻ + 2H⁺ → QH₂' }],
    ...qoTurn(1),
    [{ species: 'QH₂', via: [ref('Qo', { offset: [45, 2, 0] }), ref('Qo')], brown: true, clear: 6, free: 6, tVia: 2.2, labelVia: 'QH₂（来自膜内醌池）' }],   // the second quinol of the Q cycle comes from the pool
    ...qoTurn(2),
    [{ pause: 1.2, stage: 6 }],
  ],
});

/**
 * The ATP synthase of the work (classic: the rotor angle `theta` and the `update` that returned 8 H⁺ per turn of the c8 ring and made 3 ATP per turn): the rotor is the parts the scene
 * names in `spin` (the γ stalk and the c ring), turning with the animation clock at the speed of the compartment model's ATP flux and only while the intermembrane space holds protons;
 * every 1/8 turn one H⁺ goes back through the a-subunit / c-ring interface, every 1/3 turn one ATP leaves the F1 head. The proton ledger and the ATP made are derived from the counters:
 * ATP = H⁺ returned × 3/8 (the bovine c8 ring), exactly as the classic counted it.
 */
const ATP_A = '/subunit a$/', ATP_BETA = '/subunit beta/';
export const ATP_SYNTHASE_ANCHORS = Object.freeze({
  atpH0: { part: ATP_A, onMembrane: mem(-34) }, atpH1: { part: ATP_A, onMembrane: mem(-6) }, atpH2: { part: ATP_A, onMembrane: mem(6) }, atpH3: { part: ATP_A, onMembrane: mem(34) },
  atpOut: { part: ATP_BETA, offset: [0, 18, 0] },
});
export const ATP_SYNTHASE_FLOWS = Object.freeze([
  { name: 'H⁺ 经 ATP 合酶回流', species: 'H⁺', from: 'bot', to: 'top', via: ['atpH0', 'atpH1', 'atpH2', 'atpH3'].map((n) => ref(n)), perTurn: 8, labelVia: 'H⁺（ATP 合酶 a 亚基 / c 环）', counter: 'H⁺ 回流（ATP 合酶）' },
  { name: 'ATP 离开 F1', species: 'ATP', to: 'top', via: [ref('atpOut')], perTurn: 3, labelVia: 'ATP（从 F1 头部离开）', tOut: 2.4 },
]);
export const RESPIRATORY_LEDGER = Object.freeze([
  { name: 'H⁺ 膜间隙存量', terms: { 'H⁺ 泵出（复合体 I / IV）': 1, 'H⁺ 释放到膜间隙（Q 循环）': 1, 'H⁺ 回流（ATP 合酶）': -1 } },
  { name: 'ATP（合酶产出）', terms: { 'H⁺ 回流（ATP 合酶）': 1 }, scale: 3 / 8, floor: true },
  { name: 'ATP / NADH', terms: { 'ATP（合酶产出）': 1 }, per: 'NADH', round: 2 },
]);
/** The rotor: the named parts of the scene, 0.25 turn/s at full ATP flux. */
export const respiratoryRotor = (parts) => ({ parts, mode: 'sym', turnsPerSecond: 0.25, by: 'rotor', stock: 'H⁺ 膜间隙存量' });
