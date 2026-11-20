/**
 * Work configuration for the rotary-ATPase player: everything that is *content* (which parts are the ring and the
 * catalytic subunits, nucleotide residue names, step texts, particle labels, evidence wording) lives here as data.
 * The algorithm in index.mjs only knows geometry: axis from ring and head, rotation, three catalytic sites, counting.
 * See docs/CONTRACT_4.3.0.md §4 and §7. ATP_6ZPO_TEMPLATE reproduces the previous built-in behaviour exactly.
 */
import { createValidators, deepFreeze, isObject } from '../shared/work-config.mjs';
import { ROTARY_TEMPLATE, normalizeMachine } from '../motion/conformation-machine.mjs';

const { text, list, color, section } = createValidators('ATP 作品配置');
const particle = (value, label) => ({ name: text(value?.name, `${label}.name`, 40), color: color(value?.color, `${label}.color`) });

export const ATP_6ZPO_TEMPLATE = deepFreeze({
  id: 'atp-synthase-6ZPO',
  // Part-name selectors use the structure plugin's matching: plain text = substring, /regex/ = pattern.
  parts: { ring: 'subunit C1', catalytic: 'subunit beta', rotor: ['subunit gamma', 'subunit delta', 'subunit epsilon', 'subunit C1'] },
  // null accepts any ring size of 3 or more; a number requires exactly that many c subunits (6ZPO: bovine c8).
  counts: { ringSubunits: 8 },
  nucleotides: { bound: ['ADP', 'ATP', 'ANP'], anchorAtom: 'PB', adp: 'ADP', atp: 'ATP', phosphate: 'PO4' },
  particles: {
    proton: { name: 'H⁺', color: '#d75089' }, adp: { name: 'ADP', color: '#209fb8' },
    atp: { name: 'ATP', color: '#e5a52b' }, phosphate: { name: 'Pi', color: '#9f75bf' },
  },
  counterLabels: { atp: 'ATP', proton: 'H⁺' },
  // The time side of the mechanism, as a conformation state machine (plugins/motion/conformation-machine.mjs): the three catalytic sites take turns; the five stages and the window in which the beta shape
  // changes are fractions of one 1/3-turn site cycle; the speed control is turns per (illustrative) second.
  machine: { speed: { min: 0.05, max: 3, default: 0.25, label: '转速' }, stageAt: ROTARY_TEMPLATE.stageAt, morph: ROTARY_TEMPLATE.morph, stepPhases: ROTARY_TEMPLATE.stepPhases },
  eventLabel: '位点打开释放 ATP',
  steps: [
    { title: '质子动力势', caption: '膜两侧的电化学梯度驱动 H⁺ 回流。', parts: ['/subunit a$/'] },
    { title: 'H⁺ 流过 → c 环转动', caption: '牛 c8 环每转一圈对应 8 个 H⁺。', parts: ['/subunit a$/', 'subunit C1'] },
    { title: 'γ 旋转 → β 变构', caption: 'γ 每转 120°，三个 β 位点交换开放、松弛、紧密状态。', parts: ['subunit gamma', 'subunit beta'] },
    { title: 'ADP + Pi → ATP', caption: '紧密位点发生 ATP 形成，粒子和反应路径以示意表达。', parts: ['subunit beta'] },
    { title: '开放位点释放 ATP', caption: '转动驱动位点打开。每圈释放 3 个 ATP。', parts: ['subunit beta', 'subunit gamma'] },
  ],
  navigation: { idPrefix: 'atp', systemTitle: 'ATP 合酶系统', proteinTitle: 'ATP 合酶结构', mechanismTitle: 'ATP 合酶催化机理' },
  panel: {
    title: 'ATP 合酶', speedLabel: '转速（转 / 示意秒）', seedLabel: '随机种子',
    evidence: '结构来自沉积坐标。β 位点在三个实测构象之间插值。粒子、膜和路径为教学示意，时间为示意秒。',
  },
  sceneEvidence: {
    citation: 'ATP 合酶教学播放器',
    details: '牛 c8 环每圈 8 H⁺、3 ATP。β 形状在 6ZPO 三个位点实测坐标之间插值。粒子、路径、膜和时间为示意。',
  },
});

/** Merge a (possibly partial) configuration over the 6ZPO template and validate it. Returns a plain, validated object. */
export function normalizeAtpConfig(input) {
  if (input == null) return ATP_6ZPO_TEMPLATE;
  if (!isObject(input)) throw new TypeError('ATP 作品配置必须是对象。');
  const base = ATP_6ZPO_TEMPLATE;
  const parts = section(input, base, 'parts');
  const counts = section(input, base, 'counts');
  const nucleotides = section(input, base, 'nucleotides');
  const particles = section(input, base, 'particles');
  const navigation = section(input, base, 'navigation');
  const panel = section(input, base, 'panel');
  const sceneEvidence = section(input, base, 'sceneEvidence');
  const counterLabels = section(input, base, 'counterLabels');
  const steps = input.steps ?? base.steps;
  if (!Array.isArray(steps) || steps.length !== 5) throw new TypeError('ATP 作品配置：steps 必须正好有 5 步（与催化循环的 5 个阶段对应）。');
  if (counts.ringSubunits !== null && !(Number.isInteger(counts.ringSubunits) && counts.ringSubunits >= 3 && counts.ringSubunits <= 64)) {
    throw new TypeError('ATP 作品配置：counts.ringSubunits 必须是 3–64 的整数或 null。');
  }
  return {
    id: text(input.id ?? base.id, 'id', 80),
    parts: { ring: text(parts.ring, 'parts.ring', 120), catalytic: text(parts.catalytic, 'parts.catalytic', 120),
      rotor: list(parts.rotor, 'parts.rotor') },
    counts: { ringSubunits: counts.ringSubunits },
    nucleotides: { bound: list(nucleotides.bound, 'nucleotides.bound', { max: 8 }), anchorAtom: text(nucleotides.anchorAtom, 'nucleotides.anchorAtom', 8),
      adp: text(nucleotides.adp, 'nucleotides.adp', 8), atp: text(nucleotides.atp, 'nucleotides.atp', 8), phosphate: text(nucleotides.phosphate, 'nucleotides.phosphate', 8) },
    particles: { proton: particle(particles.proton, 'particles.proton'), adp: particle(particles.adp, 'particles.adp'),
      atp: particle(particles.atp, 'particles.atp'), phosphate: particle(particles.phosphate, 'particles.phosphate') },
    counterLabels: { atp: text(counterLabels.atp, 'counterLabels.atp', 20), proton: text(counterLabels.proton, 'counterLabels.proton', 20) },
    eventLabel: text(input.eventLabel ?? base.eventLabel, 'eventLabel', 80),
    machine: (({ speed, stageAt, morph, stepPhases }) => ({ speed, stageAt, morph, stepPhases }))(normalizeMachine({ kind: 'rotary', ...base.machine, ...(isObject(input.machine) ? input.machine : {}) }, 'ATP 作品配置.machine')),
    steps: steps.map((step, i) => ({ title: text(step?.title, `steps[${i}].title`, 80), caption: text(step?.caption, `steps[${i}].caption`),
      parts: list(step?.parts, `steps[${i}].parts`) })),
    navigation: { idPrefix: text(navigation.idPrefix, 'navigation.idPrefix', 24), systemTitle: text(navigation.systemTitle, 'navigation.systemTitle', 80),
      proteinTitle: text(navigation.proteinTitle, 'navigation.proteinTitle', 80), mechanismTitle: text(navigation.mechanismTitle, 'navigation.mechanismTitle', 80) },
    panel: { title: text(panel.title, 'panel.title', 60), speedLabel: text(panel.speedLabel, 'panel.speedLabel', 60),
      seedLabel: text(panel.seedLabel, 'panel.seedLabel', 60), evidence: text(panel.evidence, 'panel.evidence', 1000) },
    sceneEvidence: { citation: text(sceneEvidence.citation, 'sceneEvidence.citation', 120), details: text(sceneEvidence.details, 'sceneEvidence.details', 1000) },
  };
}
