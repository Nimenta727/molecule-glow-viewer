import { compileMarkovModel, validateParameterSet, MARKOV_LIMITS } from './markov-model.mjs';

/**
 * The stochastic process tool (4.4.4b): the authored form of markov-model.mjs. Its configuration, stored in `scene.tools[].config`:
 *   { process: <Markov declaration>, schedule: [{ time: 0, ...parameters }, { time: 30, ...changed }], seed, display: [{ label, kind, name, unit?, digits?, ... }] }
 * Each schedule entry is a full set of parameters (a missing one keeps the value before it). `display` is the list of curves the Viewer draws (see observer.mjs
 * readDisplay for the kinds). The Viewer runs it on a display clock (`runtime: 'layer-v1'`) and plots counts, estimated current, open fraction, concentrations or
 * potentials as they grow; Studio edits the parameters, the schedule and the seed through the generated tool panel. Nothing here names a protein.
 */
export const PROCESS_TOOL = 'org.glow.tool.stochastic-process';
const KINDS = ['counter', 'observable', 'clock', 'rate', 'current'];
export const PROCESS_LIMITS = Object.freeze({ schedule: 8, display: 8 });

// A small two-state channel: a switch with a rate, so a newly added tool runs out of the box.
export const PROCESS_TEMPLATE = Object.freeze({
  process: Object.freeze({
    version: 1, title: '两态通道：开与关',
    parameters: [{ id: 'kOpen', label: '打开速率（次/秒）', min: 0.05, max: 20, step: 0.05, default: 1, unit: '/s' }, { id: 'kClose', label: '关闭速率（次/秒）', min: 0.05, max: 20, step: 0.05, default: 2, unit: '/s' }],
    variables: { gate: { values: ['closed', 'open'], init: 'closed' } }, counters: ['openings'],
    transitions: [{ id: 'open', label: '通道打开', when: 'gate_closed', rate: 'kOpen', set: { gate: 'open' }, count: { openings: 1 } }, { id: 'close', label: '通道关闭', when: 'gate_open', rate: 'kClose', set: { gate: 'closed' } }],
    clocks: [{ name: 'openTime', add: 'gate_open ? dt : 0' }, { name: 'time', add: 'dt' }],
    observables: [{ name: 'openFraction', label: '开放比例', expr: 'time > 0 ? openTime / time : 0' }],
  }),
  schedule: Object.freeze([Object.freeze({ time: 0 })]), seed: 7,
  display: Object.freeze([{ label: '打开次数', kind: 'counter', name: 'openings', digits: 0 }, { label: '开放比例', kind: 'observable', name: 'openFraction', digits: 2 }]),
});

/** The tool's own validator: the declaration must run, every schedule entry is a valid full parameter set, every display row names something that exists. */
export function normalizeProcessConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { model, errors } = compileMarkovModel(source.process);
  if (errors.length) throw new Error(`随机过程配置有误：${errors.join('；')}`);
  let json; try { json = JSON.stringify(source.process); } catch { throw new Error('随机过程必须是纯数据。'); }
  if (json.length > 200000) throw new Error('随机过程太大（最多 200 KB）。');
  const entries = (Array.isArray(source.schedule) && source.schedule.length ? source.schedule : [{ time: 0 }]).slice(0, PROCESS_LIMITS.schedule), schedule = [];
  entries.forEach((entry, i) => {
    const time = i === 0 ? 0 : Number(entry?.time);
    if (!Number.isFinite(time) || (i && !(time > schedule[i - 1].time))) throw new Error(`参数时间表第 ${i + 1} 项的时间必须大于前一项。`);
    const base = i ? schedule[i - 1] : {}, merged = {};
    for (const p of model.parameters) merged[p.id] = entry?.[p.id] ?? base[p.id] ?? p.default;
    schedule.push({ time, ...validateParameterSet(model, merged) });
  });
  const display = (Array.isArray(source.display) ? source.display : []).slice(0, PROCESS_LIMITS.display).map((row, i) => {
    const what = `第 ${i + 1} 条显示项`;
    if (!KINDS.includes(row?.kind)) throw new Error(`${what}的种类“${String(row?.kind)}”不对（${KINDS.join('、')}）。`);
    const need = (list, name) => { if (!list.includes(name)) throw new Error(`${what}引用了不存在的“${String(name)}”。`); return name; };
    const out = { label: typeof row.label === 'string' && row.label ? row.label.slice(0, 60) : row.name ?? row.kind, kind: row.kind, unit: typeof row.unit === 'string' ? row.unit.slice(0, 12) : '', digits: Math.max(0, Math.min(6, Math.round(Number.isFinite(row.digits) ? row.digits : 2))) };
    if (row.kind === 'counter' || row.kind === 'rate') out.name = need(model.counters, row.name);
    if (row.kind === 'observable') out.name = need(model.observables.map((o) => o.name), row.name);
    if (row.kind === 'clock') out.name = need(model.clocks.map((c) => c.name), row.name);
    if (row.kind === 'rate') out.window = Math.max(0.5, Math.min(60, Number.isFinite(row.window) ? row.window : 5));
    if (row.kind === 'current') { out.out = need(model.counters, row.out); out.inn = need(model.counters, row.inn); out.ns = need(model.clocks.map((c) => c.name), row.ns); out.unit ||= 'pA'; }
    return out;
  });
  return { process: JSON.parse(json), schedule, seed: Number.isSafeInteger(source.seed) && source.seed >= 0 ? source.seed : 7, display };
}

/** Editable fields: the seed, every parameter of every schedule entry (and its time), plus one blank slot to add a later change. */
export function processAuthorFields(config) {
  let cfg; try { cfg = normalizeProcessConfig(config); } catch { cfg = config; }
  const model = compileMarkovModel(cfg.process).model, fields = [{ path: 'seed', type: 'number', integer: true, min: 0, max: 4294967295, step: 1, label: '随机种子（同一种子重放同一段历史）', group: '设置' }];
  const entries = cfg.schedule ?? [{ time: 0 }], slots = entries.length < PROCESS_LIMITS.schedule ? [...entries, null] : entries;
  slots.forEach((entry, i) => {
    const group = i === 0 ? '起始参数' : `第 ${i} 次参数变化`;
    if (i > 0) fields.push({ path: `schedule.${i}.time`, type: 'number', min: (entries[i - 1]?.time ?? 0) + 0.1, max: 100000, step: 0.1, label: entry ? `第 ${i} 次变化发生的时间（示意秒）` : '再加一次参数变化：发生的时间（示意秒）', group });
    if (entry) for (const p of model.parameters) fields.push({ path: `schedule.${i}.${p.id}`, type: 'number', min: p.min, max: p.max, step: p.step, ...(p.integer ? { integer: true } : {}), label: `${p.label}${p.unit ? `（${p.unit}）` : ''}`, group });
  });
  return fields;
}

export function processToolDescriptor(version) {
  return {
    version, title: '随机状态过程（门控 / 渗透 / 阻断）', audience: ['view', 'author'], runtime: 'layer-v1', parameters: {},
    author: { template: PROCESS_TEMPLATE, fields: processAuthorFields, validate: normalizeProcessConfig },
    model: { kind: '连续时间马尔可夫链（精确 Gillespie 采样，种子化）', assumptions: [
      '转移的速率公式由作品声明，数值是示意设定或来自所引文献，不是对某个实验的拟合预测。', '这是随机状态过程，不是分子动力学轨迹；计数是随机事件，同一种子重放同一段历史。',
      '时间是示意秒，各个时钟（例如渗透纳秒、门控秒）按声明分别累计；画面插值不会阻塞或推进化学过程。', '从计数估算的电流是统计估计，样本少时波动大。'] },
  };
}
export { MARKOV_LIMITS };
