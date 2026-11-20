import { createComposition } from './composition.mjs';
import { normalizeProcessConfig, PROCESS_TEMPLATE } from './process-tool.mjs';
import { normalizeTranslationConfig, translationProcessConfig, TEMPLATES } from './translation-tool.mjs';

/**
 * The multi-process tool (4.4.6b; classic: the cell corner, a translation station and a KcsA station running at once). Its configuration, in `scene.tools[].config`:
 *   { members: [{ id, label?, kind: 'translation' | 'process', timeScale?, ...the member's own configuration }],
 *     controls: [{ id, label?, targets: [{ member, param }] }] }
 * A member of kind 'translation' is a translation tool configuration (template, sequence, schedule, seed); a member of kind 'process' is a stochastic-process tool
 * configuration (declaration, schedule, seed, display). Every member keeps its own engine, seed, clock (`timeScale`: its seconds per scene second) and counters; a shared
 * control sets one parameter of each member it targets and nothing else. The Viewer runs the members side by side on one panel; Studio edits the members' settings.
 */
export const COMPOSITION_TOOL = 'org.glow.tool.multi-process';
export const COMPOSITION_TOOL_LIMITS = Object.freeze({ members: 4 });
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export const COMPOSITION_TEMPLATE = Object.freeze({
  members: Object.freeze([
    Object.freeze({ id: 'ribosome', label: '核糖体（细胞质）', kind: 'translation', timeScale: 1, template: 'ubq', sequence: '', schedule: Object.freeze([Object.freeze({ time: 0 })]), seed: 3 }),
    Object.freeze({ id: 'channel', label: '离子通道（细胞膜）', kind: 'process', timeScale: 1, process: PROCESS_TEMPLATE.process, schedule: Object.freeze([Object.freeze({ time: 0 })]), seed: 5, display: PROCESS_TEMPLATE.display })]),
  controls: Object.freeze([
    Object.freeze({ id: 'ery', label: '红霉素（μM）', targets: Object.freeze([Object.freeze({ member: 'ribosome', param: 'ERY' })]) }),
    Object.freeze({ id: 'kOpen', label: '通道打开速率（次/秒）', targets: Object.freeze([Object.freeze({ member: 'channel', param: 'kOpen' })]) })]),
});

function memberConfig(m, i) {
  const what = `第 ${i + 1} 个过程`;
  if (!KEY.test(m?.id ?? '')) throw new Error(`${what}的名称“${String(m?.id)}”不合法（字母开头，字母数字下划线）。`);
  const timeScale = m.timeScale === undefined ? 1 : Number(m.timeScale);
  if (!Number.isFinite(timeScale) || timeScale < 0.01 || timeScale > 100) throw new Error(`${what}的时间比例要在 0.01–100 之间。`);
  const base = { id: m.id, label: typeof m.label === 'string' && m.label ? m.label.slice(0, 60) : m.id, timeScale };
  if (m.kind === 'translation') return { ...base, kind: 'translation', ...normalizeTranslationConfig(m) };
  if (m.kind === 'process') return { ...base, kind: 'process', ...normalizeProcessConfig(m) };
  throw new Error(`${what}的种类“${String(m?.kind)}”不对（translation 或 process）。`);
}

/** What the composition runs: members with their Markov declaration, seed, clock, schedule, display rows and (translation) strip; and the controls. */
export function compositionBuild(config) {
  const members = config.members.map((m) => {
    const built = m.kind === 'translation' ? translationProcessConfig(m) : { process: m.process, schedule: m.schedule, seed: m.seed, display: m.display };
    return { id: m.id, label: m.label, kind: m.kind, timeScale: m.timeScale, ...built };
  });
  return { members, controls: config.controls };
}

/** The tool's own validator: members and controls must make a composition that can run. */
export function normalizeCompositionConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(source.members) || !source.members.length || source.members.length > COMPOSITION_TOOL_LIMITS.members) throw new Error(`多过程组合需要 1–${COMPOSITION_TOOL_LIMITS.members} 个过程。`);
  const members = source.members.map(memberConfig);
  const controls = (Array.isArray(source.controls) ? source.controls : []).slice(0, 24).map((c) => ({ id: c?.id, ...(typeof c?.label === 'string' && c.label ? { label: c.label.slice(0, 60) } : {}), targets: (Array.isArray(c?.targets) ? c.targets : []).map((t) => ({ member: t?.member, param: t?.param })) }));
  const config = { members, controls };
  const built = compositionBuild(config);
  createComposition({ members: built.members, controls }, 0);   // throws, by name, when ids repeat, a control points nowhere or a parameter does not exist
  return config;
}

/** Editable fields: for every member its label, clock and seed (translation members also the template and sequence), and the label of every shared control. */
export function compositionAuthorFields(config) {
  let cfg; try { cfg = normalizeCompositionConfig(config); } catch { cfg = config; }
  const fields = [];
  (cfg.members ?? []).forEach((m, i) => {
    const group = m.label ?? m.id;
    fields.push({ path: `members.${i}.label`, type: 'text', maxLength: 60, label: `过程 ${i + 1} 的名称`, group },
      { path: `members.${i}.timeScale`, type: 'number', min: 0.01, max: 100, step: 0.01, label: `过程 ${i + 1} 的时钟（它的秒 / 场景秒）`, group },
      { path: `members.${i}.seed`, type: 'number', integer: true, min: 0, max: 4294967295, step: 1, label: `过程 ${i + 1} 的随机种子`, group });
    if (m.kind === 'translation') fields.push({ path: `members.${i}.template`, type: 'select', label: `过程 ${i + 1} 的 mRNA 模板`, group, options: Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.title })) },
      { path: `members.${i}.sequence`, type: 'text', maxLength: 500, label: `过程 ${i + 1} 的氨基酸序列（模板为“自定义”时使用）`, group });
  });
  (cfg.controls ?? []).forEach((c, i) => fields.push({ path: `controls.${i}.label`, type: 'text', maxLength: 60, label: `共享控件 ${i + 1} 的名称`, group: '共享控件' }));
  return fields;
}

export function compositionToolDescriptor(version) {
  return {
    version, title: '多过程组合（同时运行，各有时钟）', audience: ['view', 'author'], runtime: 'layer-v1', parameters: {},
    author: { template: COMPOSITION_TEMPLATE, fields: compositionAuthorFields, validate: normalizeCompositionConfig },
    model: { kind: '若干随机过程同时运行，各有自己的引擎、种子、时钟与计数器', assumptions: [
      '每个过程是它自己的随机模型（见各过程的假设）；组合只是让它们同时运行、共用一块控制面板。', '过程之间没有相互作用：一个过程的参数改动不会改变另一个过程的历史（例如核糖体不感知通道所在膜的 pH）。',
      '时钟按每个过程各自的比例换算（例如翻译以毫秒到秒计，离子通过以纳秒计），不是同一个物理时间轴上的真实同步。', '共享控件只设置它指向的那些参数；同一个种子重放同一段历史。'] },
  };
}
export { createComposition };
