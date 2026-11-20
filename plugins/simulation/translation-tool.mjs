import { translationModel, translationTables, ORFS } from './translation.mjs';
import { compileMarkovModel } from './markov-model.mjs';
import { normalizeSchedule, PROCESS_LIMITS } from './process-tool.mjs';

/**
 * The translation tool (4.4.5b): one ribosome translating a template, kinetically (elongation, proofreading, termination, antibiotics; translation.mjs).
 * Its configuration, stored in `scene.tools[].config`:  { template: 'ubq' | 'ermcl' | 'polyu' | 'custom', sequence, schedule: [{ time: 0, ...concentrations }], seed }
 * The sequence is an amino-acid sequence (one-letter codes; the codons are the classic's preferred ones); for a preset it is the preset's own sequence, so
 * switching to "custom" starts from it. Concentrations are in µM and may change over time. The tool builds the Markov declaration from the sequence when it runs;
 * the Viewer runs it on the same panel as the stochastic process and adds a strip showing the peptide, the errors and the A site.
 */
export const TRANSLATION_TOOL = 'org.glow.tool.translation';
export const TEMPLATES = Object.freeze({
  ubq: { title: '泛素（76 aa）', ermcl: false },
  ermcl: { title: 'ErmCL 前导肽（19 aa；红霉素存在时停在 Ile9，是红霉素诱导耐药的开关）', ermcl: true },
  polyu: { title: 'poly(U) → 多聚苯丙氨酸', ermcl: false },
  custom: { title: '自定义（写下面的氨基酸序列）', ermcl: false },
});
export const SEQUENCE_LIMITS = Object.freeze({ min: 2, max: 400 });
const RESIDUES = /[^ACDEFGHIKLMNPQRSTVWY]/g;
export const TRANSLATION_TEMPLATE = Object.freeze({ template: 'ubq', sequence: ORFS.ubq, schedule: Object.freeze([Object.freeze({ time: 0 })]), seed: 7 });

/** The template's amino-acid sequence (cleaned, starting with M) and whether it is the ErmCL leader. */
export function resolveTemplate({ template, sequence }) {
  const aa = template === 'custom' ? String(sequence ?? '').toUpperCase().replace(RESIDUES, '') : ORFS[template];
  if (!aa || aa.length < SEQUENCE_LIMITS.min) throw new Error(`氨基酸序列至少要有 ${SEQUENCE_LIMITS.min} 个有效字母（ACDEFGHIKLMNPQRSTVWY）。`);
  if (aa.length > SEQUENCE_LIMITS.max) throw new Error(`氨基酸序列最长 ${SEQUENCE_LIMITS.max} 个。`);
  return { aa: aa[0] === 'M' ? aa : 'M' + aa, ermcl: TEMPLATES[template].ermcl };
}

/** The tool's own validator. */
export function normalizeTranslationConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const template = Object.hasOwn(TEMPLATES, source.template) ? source.template : 'ubq';
  const { aa } = resolveTemplate({ template, sequence: source.sequence });
  const sequence = template === 'custom' ? aa : ORFS[template], { model } = compileMarkovModel(translationModel('MK'));
  return { template, sequence, schedule: normalizeSchedule(model, source.schedule), seed: Number.isSafeInteger(source.seed) && source.seed >= 0 ? source.seed : 7 };
}

/** What the Viewer's process panel runs: the Markov declaration built from the sequence, the schedule, the curves to show, and the strip description. */
export function translationProcessConfig(raw) {
  const config = normalizeTranslationConfig(raw), { aa, ermcl } = resolveTemplate(config), process = translationModel(aa, { ermcl });
  return { process, schedule: config.schedule, seed: config.seed, strip: { sequence: aa, codonClass: translationTables(aa).codonClass },
    display: [
      { label: '已合成蛋白', kind: 'counter', name: 'prot', digits: 0, unit: '条' }, { label: '当前肽链长度', kind: 'number', name: 'L', digits: 0, unit: 'aa' },
      { label: '平均延伸速率', kind: 'observable', name: 'rate', digits: 1, unit: 'aa/s' }, { label: '错误率（累计）', kind: 'observable', name: 'errorRate', digits: 4 },
      { label: '红霉素造成的掉落', kind: 'counter', name: 'drop', digits: 0 }, { label: '非同源碰撞（累计）', kind: 'clock', name: 'nonCognate', digits: 0 }] };
}

const PARAM_LABELS = { TC: '三元复合物 EF-Tu·GTP·aa-tRNA', EFG: 'EF-G', RF1: 'RF1（释放因子）', TAC: '四环素（挡 A 位）', PAR: '巴龙霉素（读错）', CLM: '氯霉素（挡肽键形成）', ERY: '红霉素（堵出口通道）', KIR: '黄色霉素（卡住 EF-Tu）', FUA: '夫西地酸（卡住 EF-G）' };

/** Editable fields: the template, the sequence, the seed, every concentration of every schedule entry and its time, plus one blank slot for a later change. */
export function translationAuthorFields(config) {
  let cfg; try { cfg = normalizeTranslationConfig(config); } catch { cfg = config; }
  const { model } = compileMarkovModel(translationModel('MK'));
  const fields = [
    { path: 'template', type: 'select', label: 'mRNA 模板', group: '模板', options: Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.title })) },
    { path: 'sequence', type: 'text', maxLength: SEQUENCE_LIMITS.max + 100, label: '氨基酸序列（单字母；模板为“自定义”时使用）', group: '模板' },
    { path: 'seed', type: 'number', integer: true, min: 0, max: 4294967295, step: 1, label: '随机种子（同一种子重放同一段历史）', group: '设置' }];
  const entries = cfg.schedule ?? [{ time: 0 }], slots = entries.length < PROCESS_LIMITS.schedule ? [...entries, null] : entries;
  slots.forEach((entry, i) => {
    const group = i === 0 ? '起始浓度（μM）' : `第 ${i} 次浓度变化`;
    if (i > 0) fields.push({ path: `schedule.${i}.time`, type: 'number', min: (entries[i - 1]?.time ?? 0) + 0.1, max: 100000, step: 0.1, label: entry ? `第 ${i} 次变化发生的时间（分子时间，秒）` : '再加一次浓度变化：发生的时间（分子时间，秒）', group });
    if (entry) for (const p of model.parameters) fields.push({ path: `schedule.${i}.${p.id}`, type: 'number', min: p.min, max: p.max, step: p.step, label: `${PARAM_LABELS[p.id] ?? p.id}（μM）`, group });
  });
  return fields;
}

export function translationToolDescriptor(version) {
  return {
    version, title: '核糖体翻译（延伸、校对、终止、抗生素）', audience: ['view', 'author'], runtime: 'layer-v1', parameters: {},
    author: { template: TRANSLATION_TEMPLATE, fields: translationAuthorFields, validate: normalizeTranslationConfig },
    model: { kind: '核糖体翻译的随机动力学（连续时间马尔可夫链，精确 Gillespie 采样，种子化）', assumptions: [
      '速率常数是经典模型标定过的有效值（约 13 氨基酸/秒，读错约 5×10⁻⁴；有巴龙霉素时约 10⁻²），不是对某个细胞或实验的拟合预测。', '这是单个核糖体的随机事件序列，不是分子动力学；同一种子重放同一段历史，样本少时统计量波动大。',
      '密码子取各氨基酸的常用大肠杆菌密码子；近同源 tRNA 的具体氨基酸不记录，只记是否 Ala/Ser/Thr（氯霉素的背景依赖）。', '抗生素的结合与解离、黄色霉素/夫西地酸的锁定按文献量级的 kon、koff、Kd 近似；时间是分子时间（秒），不被动画冻结。'] },
  };
}
