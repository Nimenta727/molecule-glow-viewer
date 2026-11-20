import { normalizeDataAnimation, DATA_LIMITS } from './data-spec.mjs';
import { compileKineticModel } from './kinetic-model.mjs';

/**
 * The "data animation" tool (4.4.3b): the authored form of plugins/simulation/data-animation.mjs. Its configuration, stored in `scene.tools[].config`:
 *   { animation: <data v1 declaration>, axis: 'sym' | 'long' | 'short' | 'native', membranes: [{ at, offset }], seed, scale, kinetics?: <kinetic model v1> }
 * `kinetics` is an optional compartment model (concentrations, pH, membrane potential; plugins/simulation/kinetic-model.mjs) whose pools follow the animation's.
 * `axis` and `membranes` are the classic scene's orientation and membrane placement (the engine runs with the structure's axis vertical, see structure-frame.mjs).
 * The Viewer runs it (`runtime: 'layer-v1'`); Studio edits it through the generated tool panel. Nothing here names a protein or a pack.
 */
export const DATA_TOOL = 'org.glow.tool.data-animation';
export const AXES = ['sym', 'long', 'short', 'native'];
export const DATA_TEMPLATE = Object.freeze({
  animation: Object.freeze({ version: 1, compartments: Object.freeze({ 溶液: Object.freeze({}) }), pools: Object.freeze([Object.freeze({ species: 'ATP', in: '溶液', n: 6 })]), flows: Object.freeze([]), reactions: Object.freeze([]) }),
  axis: 'sym', membranes: Object.freeze([]), seed: 7, scale: 'slow',
});

/** The tool's own validator: the declaration must be one the engine can run (every error is reported by name); the rest is clamped. */
export function normalizeDataConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { spec, errors } = normalizeDataAnimation(source.animation);
  if (errors.length) throw new Error(`数据动画配置有误：${errors.join('；')}`);
  const membranes = (Array.isArray(source.membranes) ? source.membranes : []).slice(0, 2).map((m) => ({ at: typeof m?.at === 'string' ? m.at.slice(0, 80) : '', offset: Number.isFinite(Number(m?.offset)) ? Math.max(-500, Math.min(500, Number(m.offset))) : 0 }));
  let kinetics;
  if (source.kinetics !== undefined && source.kinetics !== null) {
    const { model, errors } = compileKineticModel(source.kinetics);
    for (const dot of model.dots) if (!(dot.comp in spec.compartments)) errors.push(`动力学粒子“${dot.label}”写了不存在的区室“${dot.comp}”（可用：${Object.keys(spec.compartments).join('、')}）。`);
    let json = ''; try { json = JSON.stringify(source.kinetics); } catch { errors.push('动力学模型必须是纯数据。'); }
    if (json.length > 200000) errors.push('动力学模型太大（最多 200 KB）。');
    if (errors.length) throw new Error(`动力学模型有误：${errors.join('；')}`);
    kinetics = JSON.parse(json);
  }
  return { animation: spec, ...(kinetics ? { kinetics } : {}), axis: AXES.includes(source.axis) ? source.axis : 'sym', membranes, seed: Number.isSafeInteger(source.seed) ? source.seed : 7, scale: source.scale === 'fast' ? 'fast' : 'slow' };
}

/** Editable fields: the run settings, then every pool, flow and reaction of the declaration (add or remove them in the declaration itself). */
export function dataAuthorFields(config) {
  const cfg = (() => { try { return normalizeDataConfig(config); } catch { return config; } })(), a = cfg.animation ?? {};
  const comps = Object.keys(a.compartments ?? {}), text = (path, label, group, maxLength = 80) => ({ path, type: 'text', label, group, maxLength });
  const fields = [
    { path: 'seed', type: 'number', integer: true, min: 0, max: 4294967295, step: 1, label: '随机种子（同一种子重放同一幅画面）', group: '设置' },
    { path: 'scale', type: 'select', label: '时间尺度', group: '设置', options: [{ value: 'slow', label: '慢：逐个分子' }, { value: 'fast', label: '快：粒子流' }] },
    { path: 'axis', type: 'select', label: '结构的竖直轴（上下区室按它判断）', group: '设置', options: [{ value: 'sym', label: '对称轴' }, { value: 'long', label: '长轴' }, { value: 'short', label: '短轴' }, { value: 'native', label: '保持原方向' }] },
  ];
  (cfg.membranes ?? []).forEach((m, i) => fields.push(text(`membranes.${i}.at`, `第 ${i + 1} 层膜：位于哪个部件（名称片段）`, '膜'), { path: `membranes.${i}.offset`, type: 'number', min: -500, max: 500, step: 1, label: `第 ${i + 1} 层膜的偏移（Å）`, group: '膜' }));
  (a.pools ?? []).forEach((p, i) => fields.push(text(`animation.pools.${i}.species`, `第 ${i + 1} 个池的分子`, '分子池', 40),
    { path: `animation.pools.${i}.in`, type: 'select', label: `第 ${i + 1} 个池所在区室`, group: '分子池', options: comps.map((c) => ({ value: c, label: c })) },
    { path: `animation.pools.${i}.n`, type: 'number', integer: true, min: 0, max: DATA_LIMITS.pool, step: 1, label: `第 ${i + 1} 个池的个数`, group: '分子池' }));
  (a.flows ?? []).forEach((f, i) => fields.push(text(`animation.flows.${i}.name`, `第 ${i + 1} 条流的名称`, '流', 60), text(`animation.flows.${i}.species`, `第 ${i + 1} 条流的分子`, '流', 40),
    { path: `animation.flows.${i}.rate`, type: 'number', min: 0, max: 20, step: 0.05, label: `第 ${i + 1} 条流的速率（次/秒）`, group: '流' }));
  const k = cfg.kinetics;
  for (const [name, value] of Object.entries(k?.constants ?? {})) fields.push({ path: `kinetics.constants.${name}`, type: 'number', min: -1e6, max: 1e6, step: 0.001, label: `动力学常量 ${name}`, group: '区室动力学', default: value });
  for (const [name, value] of Object.entries(k?.state ?? {})) fields.push({ path: `kinetics.state.${name}`, type: 'number', min: -1e6, max: 1e6, step: 0.001, label: `动力学初值 ${name}`, group: '区室动力学', default: value });
  (a.reactions ?? []).forEach((r, i) => fields.push(text(`animation.reactions.${i}.name`, `第 ${i + 1} 个反应的名称`, '反应', 60), text(`animation.reactions.${i}.text`, `第 ${i + 1} 个反应的事件文字`, '反应', DATA_LIMITS.text),
    { path: `animation.reactions.${i}.rate`, type: 'number', min: 0, max: 20, step: 0.05, label: `第 ${i + 1} 个反应的速率（次/秒）`, group: '反应' }));
  return fields;
}

export function dataToolDescriptor(version) {
  return {
    version, title: '数据反应动画', audience: ['view', 'author'], runtime: 'layer-v1', parameters: {},
    author: { template: DATA_TEMPLATE, fields: dataAuthorFields, validate: normalizeDataConfig },
    model: { kind: '数据声明的区室、池、流与反应动画（布朗扩散 + 避开蛋白的路径 + 声明的计量）', assumptions: [
      '区室、池、流和反应是作者声明的示意，速率和时间是示意值，不是测得的动力学。', '反应只按声明的计量转换分子，不模拟化学机理；声明了守恒量时，每个反应都会检查它。',
      '粒子的扩散是示意性的随机游走，不进入蛋白；结构的“上下”由所选的竖直轴决定。', '导入任意结构不意味着自动得到正确的生物机制。'] },
  };
}
