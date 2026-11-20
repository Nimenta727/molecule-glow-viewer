/**
 * Work configuration for the tetrameric potassium-channel player: which structures are the closed / open / inactivated /
 * blocker states, how the channel chains and the pore are recognised (name pattern, residue ranges, ion), blocker residue
 * names, particle and counter labels, step texts, initial experimental conditions and evidence wording are data.
 * The algorithm (structure.mjs, index.mjs) knows geometry and the knock-on cycle; the gating kinetics (kinetics.mjs) is a
 * model with its own range of validity and stays code. KCSA_1K4C_TEMPLATE reproduces the previous built-in behaviour.
 * See docs/CONTRACT_4.3.0.md §4 and §7.
 */
import { createValidators, deepFreeze, isObject } from '../shared/work-config.mjs';
import { validateParameters } from './kinetics.mjs';

const { text, list, color, integer, number, section, fail } = createValidators('KcsA 作品配置');
const NUMERALS = ['', '', '二', '三', '四', '五', '六'];
export const numeral = (n) => NUMERALS[n] ?? String(n);

export const KCSA_1K4C_TEMPLATE = deepFreeze({
  id: 'kcsa-1K4C',
  // `primary` is the scene's own structure (closed channel with filter ions); the others are fitted onto it by the pore residues.
  states: { primary: '1K4C', open: '5VK6', inactivated: '5VKE', tba: '2HVK', barium: '2ITD' },
  protein: { namePattern: 'potassium channel|kcsa', chains: 4 },
  // Residue numbers are author numbering. The filter residues define the pore axis (low → high); sites are K+ positions found in the primary state.
  pore: { fitRange: [60, 80], minPairs: 60, maxFitRmsd: 2, filterResidues: [75, 79], ion: { element: 'K', label: 'K⁺' } },
  blockers: { tba: { residue: 'TBA', name: 'TBA', color: '#ed8b31' }, barium: { residue: 'BA', name: 'Ba²⁺', color: '#36aa70' } },
  particles: { potassium: { name: 'K⁺', color: '#9361ce' }, sodium: { name: 'Na⁺（被排斥）', color: '#2f9fce' } },
  counterLabels: { out: 'K⁺ 外流', in: 'K⁺ 内流', sodium: 'Na⁺ 排斥' },
  membrane: { radius: 2.8 },
  // Initial experimental conditions; any key of the kinetics parameter set (pH, V, Ki, Ko, Nai, TBA, Ba, wt, ionSpeed, gateSpeed).
  conditions: {},
  steps: [
    { title: 'pH 门控', caption: '胞内酸化提高开门速率；中性 pH 时门大多关闭。' },
    { title: 'K⁺ 进入中央腔', caption: '水合 K⁺ 从胞内沿开放结构算出的孔道进入中央腔。' },
    { title: '选择性过滤器', caption: 'S1–S4 位点来自 1K4C 中的 K⁺ 坐标，Na⁺ 进腔后被排斥。' },
    { title: '敲击与反向通量', caption: '离子在四状态敲击循环中重排，电位与浓度决定净通量方向。' },
    { title: '离子释放', caption: 'K⁺ 向胞外释放或反向进入；计数来自离散状态转移。' },
    { title: 'C 型失活', caption: '野生型动力学允许过滤器失活；TBA 和 Ba²⁺ 分别阻断中央腔及过滤器。' },
  ],
  navigation: { idPrefix: 'kcsa', systemTitle: 'KcsA 膜系统', proteinTitle: 'KcsA 四聚体', mechanismTitle: '门控与离子渗透' },
  panel: {
    title: 'KcsA 钾通道', parametersTitle: '环境与阻断剂参数', speedLabel: '模拟时钟倍率', seedLabel: '随机种子',
    evidence: '结构：1K4C / 5VK6 / 5VKE / 2HVK / 2ITD。构象按孔区叠合，粒子和膜为教学显示。门控秒与渗透纳秒分别计时；速率模型用于教学，不是分子动力学。开放结构为 E71A；野生型选项只改变动力学。',
  },
  evidence: {
    citation: 'KcsA 教学播放器',
    note: '门控与四态敲击速率沿用经典模型；渗透和门控默认分别为 10 ns/示意秒、0.05 s/示意秒，可分别调节，均乘模拟时钟倍率。粒子插值不阻塞模拟时钟。',
  },
});

/** Merge a (possibly partial) configuration over the KcsA/1K4C template and validate it. Returns a validated object. */
export function normalizeKcsaConfig(input) {
  if (input == null) return KCSA_1K4C_TEMPLATE;
  if (!isObject(input)) fail('配置必须是对象。');
  const base = KCSA_1K4C_TEMPLATE;
  const states = section(input, base, 'states'), protein = section(input, base, 'protein'), pore = section(input, base, 'pore');
  const blockers = section(input, base, 'blockers'), particles = section(input, base, 'particles'), counterLabels = section(input, base, 'counterLabels');
  const membrane = section(input, base, 'membrane'), navigation = section(input, base, 'navigation'), panel = section(input, base, 'panel');
  const evidence = section(input, base, 'evidence');
  const stateIds = ['primary', 'open', 'inactivated', 'tba', 'barium'].map((role) => text(states[role], `states.${role}`, 12));
  if (new Set(stateIds).size !== stateIds.length) fail('states 中的结构编号不能重复。');
  const namePattern = text(protein.namePattern, 'protein.namePattern', 80);
  try { new RegExp(namePattern, 'i'); } catch { fail('protein.namePattern 不是有效的正则表达式。'); }
  const ends = (value, field) => {
    if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1]) || value[0] < 1 || value[1] <= value[0]) {
      fail(`${field} 必须是 [起, 止] 残基编号（起 < 止）。`);
    }
    return [value[0], value[1]];
  };
  const ion = isObject(pore.ion) ? pore.ion : fail('pore.ion 必须是对象。');
  const steps = list(input.steps ?? base.steps, 'steps', { min: 6, max: 6, item: (step, name) => {
    if (!isObject(step)) fail(`${name} 必须是对象。`);
    return { title: text(step.title, `${name}.title`, 80), caption: text(step.caption, `${name}.caption`) };
  } });
  const blocker = (value, name) => isObject(value)
    ? { residue: text(value.residue, `blockers.${name}.residue`, 8), name: text(value.name, `blockers.${name}.name`, 24), color: color(value.color, `blockers.${name}.color`) }
    : fail(`blockers.${name} 必须是对象。`);
  const particle = (value, name) => isObject(value)
    ? { name: text(value.name, `particles.${name}.name`, 40), color: color(value.color, `particles.${name}.color`) }
    : fail(`particles.${name} 必须是对象。`);
  const conditions = input.conditions === undefined ? base.conditions : isObject(input.conditions) ? validateParameters(input.conditions) : fail('conditions 必须是对象。');
  return {
    id: text(input.id ?? base.id, 'id', 80),
    states: { primary: stateIds[0], open: stateIds[1], inactivated: stateIds[2], tba: stateIds[3], barium: stateIds[4] },
    protein: { namePattern, chains: integer(protein.chains, 'protein.chains', 2, 6) },
    pore: { fitRange: ends(pore.fitRange, 'pore.fitRange'), minPairs: integer(pore.minPairs, 'pore.minPairs', 3, 100000),
      maxFitRmsd: number(pore.maxFitRmsd, 'pore.maxFitRmsd', 0.01, 20), filterResidues: ends(pore.filterResidues, 'pore.filterResidues'),
      ion: { element: text(ion.element, 'pore.ion.element', 3), label: text(ion.label, 'pore.ion.label', 12) } },
    blockers: { tba: blocker(blockers.tba, 'tba'), barium: blocker(blockers.barium, 'barium') },
    particles: { potassium: particle(particles.potassium, 'potassium'), sodium: particle(particles.sodium, 'sodium') },
    counterLabels: { out: text(counterLabels.out, 'counterLabels.out', 24), in: text(counterLabels.in, 'counterLabels.in', 24), sodium: text(counterLabels.sodium, 'counterLabels.sodium', 24) },
    membrane: { radius: number(membrane.radius, 'membrane.radius', 0.1, 100) },
    conditions: { ...conditions },
    steps,
    navigation: { idPrefix: text(navigation.idPrefix, 'navigation.idPrefix', 24), systemTitle: text(navigation.systemTitle, 'navigation.systemTitle', 80),
      proteinTitle: text(navigation.proteinTitle, 'navigation.proteinTitle', 80), mechanismTitle: text(navigation.mechanismTitle, 'navigation.mechanismTitle', 80) },
    panel: { title: text(panel.title, 'panel.title', 60), parametersTitle: text(panel.parametersTitle, 'panel.parametersTitle', 60),
      speedLabel: text(panel.speedLabel, 'panel.speedLabel', 60), seedLabel: text(panel.seedLabel, 'panel.seedLabel', 60), evidence: text(panel.evidence, 'panel.evidence', 1000) },
    evidence: { citation: text(evidence.citation, 'evidence.citation', 120), note: text(evidence.note, 'evidence.note', 500) },
  };
}
