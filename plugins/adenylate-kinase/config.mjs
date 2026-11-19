/**
 * Work configuration for the two-state conformation player used for adenylate kinase: which chain and domains move,
 * which two reference structures are the end states, the reference ligand, and all step / evidence wording are data.
 * The algorithm (structure.mjs, playback.mjs) only knows geometry: fit on a reference domain, interpolate residue
 * positions, measure domain rotation and shift. ADK_4AKE_TEMPLATE reproduces the previous built-in behaviour exactly.
 * See docs/CONTRACT_4.3.0.md §4 and §7.
 */
import { createValidators, deepFreeze, isObject } from '../shared/work-config.mjs';

const { text, list, color, integer, number, section, fail } = createValidators('AdK 作品配置');

export const ADK_4AKE_TEMPLATE = deepFreeze({
  id: 'adk-4AKE-1AKE',
  // End-state structures: `open` is the scene's primary structure, `closed` is fetched/stored as a second resource.
  states: { open: '4AKE', closed: '1AKE' },
  // The moving chain. `namePattern` is a case-insensitive regular expression for the deposited chain / part name.
  protein: { organism: '大肠杆菌', chain: 'A', residues: 214, namePattern: 'adenylate kinase' },
  // Residue ranges use author numbering. The fit domain is superposed first; every other domain is measured against it.
  domains: [
    { name: 'CORE', ranges: [[1, 29], [60, 121], [160, 214]], color: '#819fc5' },
    { name: 'NMP', ranges: [[30, 59]], color: '#79b29c' },
    { name: 'LID', ranges: [[122, 159]], color: '#dba565' },
  ],
  fitDomain: 'CORE',
  maxFitRmsd: 3,
  ligand: { residue: 'AP5', chain: 'A', name: 'Ap5A', color: '#bd6db6' },
  steps: [
    { title: '底物结合（讲解）', caption: 'ATP 与 AMP 的结合位点位于 CORE / LID 和 NMP 域。本展示中的 Ap5A 是 1AKE 抑制剂参考，不是正在反应的底物。' },
    { title: 'LID / NMP 闭合', caption: '4AKE 与 1AKE 在 CORE 上叠合后，LID 和 NMP 域向活性位点关闭。中间形状是两套坐标的教学插值。' },
    { title: '磷酰基转移（讲解）', caption: 'AdK 催化 ATP + AMP ⇌ 2 ADP。1AKE 的 Ap5A 跨越两个核苷酸位点；此构象展示不执行化学反应或累计产物。' },
    { title: '打开与释放（讲解）', caption: '构象往复展示 LID / NMP 重新打开；产物释放通过文字说明，时间轴单位为示意秒。' },
  ],
  navigation: { idPrefix: 'adk', proteinTitle: 'AdK：CORE / NMP / LID', mechanismTitle: 'AdK 构象与催化讲解' },
  panel: {
    title: 'AdK 腺苷酸激酶', parametersTitle: '构象与参考配体', speedLabel: '构象往复倍率', seedLabel: '重放种子（本展示无随机事件）',
    evidence: '4AKE 张开态 ⇄ 1AKE 抑制剂闭合态，A 链 214 残基。按 CORE 叠合，NMP 30–59、LID 122–159；域配色及中间形状为教学表达。Ap5A 为抑制剂参考，仅在闭合端显示。本播放器展示构象和反应讲解，不计算反应速率或 ADP 产量。',
  },
  functionalDescription: '蓝色 CORE、绿色 NMP（30–59）、橙色 LID（122–159）。各域使用残基坐标生成密度叶片，并向域中心收缩 1.5 Å 露出接缝；两态之间按残基位移插值。颜色和中间表面为教学表达。',
  metricsLegend: '（相对张开态 CORE；蓝 CORE、绿 NMP、橙 LID）',
  evidence: { citation: 'AdK 两态构象播放器', note: '域配色、中间构象和时间为示意；Ap5A 为实测抑制剂坐标，无催化动力学或产物计数。' },
});

const range = (value, field) => {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1]) || value[0] < 1 || value[1] < value[0]) {
    fail(`${field} 必须是 [起, 止] 残基编号（起 ≤ 止）。`);
  }
  return [value[0], value[1]];
};

/** Merge a (possibly partial) configuration over the 4AKE/1AKE template and validate it. Returns a validated object. */
export function normalizeAdkConfig(input) {
  if (input == null) return ADK_4AKE_TEMPLATE;
  if (!isObject(input)) fail('配置必须是对象。');
  const base = ADK_4AKE_TEMPLATE;
  const states = section(input, base, 'states');
  const protein = section(input, base, 'protein');
  const ligand = section(input, base, 'ligand');
  const navigation = section(input, base, 'navigation');
  const panel = section(input, base, 'panel');
  const evidence = section(input, base, 'evidence');
  const domains = list(input.domains ?? base.domains, 'domains', { min: 2, max: 8, item: (domain, name) => {
    if (!isObject(domain)) fail(`${name} 必须是对象。`);
    return { name: text(domain.name, `${name}.name`, 24), color: color(domain.color, `${name}.color`),
      ranges: list(domain.ranges, `${name}.ranges`, { max: 16, item: range }) };
  } });
  if (new Set(domains.map(({ name }) => name)).size !== domains.length) fail('domains 的名称不能重复。');
  const fitDomain = text(input.fitDomain ?? base.fitDomain, 'fitDomain', 24);
  if (!domains.some(({ name }) => name === fitDomain)) fail(`fitDomain "${fitDomain}" 不在 domains 中。`);
  const steps = list(input.steps ?? base.steps, 'steps', { min: 4, max: 4, item: (step, name) => {
    if (!isObject(step)) fail(`${name} 必须是对象。`);
    return { title: text(step.title, `${name}.title`, 80), caption: text(step.caption, `${name}.caption`) };
  } });
  const namePattern = text(protein.namePattern, 'protein.namePattern', 80);
  try { new RegExp(namePattern, 'i'); } catch { fail('protein.namePattern 不是有效的正则表达式。'); }
  return {
    id: text(input.id ?? base.id, 'id', 80),
    states: { open: text(states.open, 'states.open', 12), closed: text(states.closed, 'states.closed', 12) },
    protein: { organism: text(protein.organism, 'protein.organism', 40), chain: text(protein.chain, 'protein.chain', 8),
      residues: integer(protein.residues, 'protein.residues', 10, 5000, { nullable: true }), namePattern },
    domains, fitDomain,
    maxFitRmsd: number(input.maxFitRmsd ?? base.maxFitRmsd, 'maxFitRmsd', 0.01, 20),
    ligand: { residue: text(ligand.residue, 'ligand.residue', 8), chain: text(ligand.chain, 'ligand.chain', 8),
      name: text(ligand.name, 'ligand.name', 24), color: color(ligand.color, 'ligand.color') },
    steps,
    navigation: { idPrefix: text(navigation.idPrefix, 'navigation.idPrefix', 24), proteinTitle: text(navigation.proteinTitle, 'navigation.proteinTitle', 80),
      mechanismTitle: text(navigation.mechanismTitle, 'navigation.mechanismTitle', 80) },
    panel: { title: text(panel.title, 'panel.title', 60), parametersTitle: text(panel.parametersTitle, 'panel.parametersTitle', 60),
      speedLabel: text(panel.speedLabel, 'panel.speedLabel', 60), seedLabel: text(panel.seedLabel, 'panel.seedLabel', 80),
      evidence: text(panel.evidence, 'panel.evidence', 1000) },
    functionalDescription: text(input.functionalDescription ?? base.functionalDescription, 'functionalDescription', 1000),
    metricsLegend: text(input.metricsLegend ?? base.metricsLegend, 'metricsLegend', 200),
    evidence: { citation: text(evidence.citation, 'evidence.citation', 120), note: text(evidence.note, 'evidence.note', 500) },
  };
}
