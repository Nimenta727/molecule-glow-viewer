import { normalizeSolutionSpec, LIMITS, SPECIES_NAMES } from './solution.mjs';

/**
 * The "solution particles" tool (4.4.2d): the authored form of plugins/motion/solution.mjs. Its configuration is stored in `scene.tools[].config`:
 *   { seed, scale: 'slow' | 'fast', pools: [{ species, n }], flows: [{ species, from, to, cps }] }
 * The Viewer runs it (its Particles panel is the player of this tool, `runtime: 'layer-v1'`: a layer drawn over the structure, no playback clock of its
 * own); Studio edits it through the generic tool panel from the descriptor's author fields. Nothing here names a protein: pools and flows refer to species
 * and to residue groups written in the selection language.
 */
export const SOLUTION_TOOL = 'org.glow.tool.solution-particles';
export const NONE = '__none__';
export const SOLUTION_TEMPLATE = Object.freeze({ seed: 7, scale: 'slow', pools: Object.freeze([Object.freeze({ species: 'H⁺', n: 20 })]), flows: Object.freeze([]) });

const clamp = (value, lo, hi, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Math.max(lo, Math.min(hi, Number(value))) : fallback);
const species = (value) => (typeof value === 'string' && value.trim() && value.trim().length <= 40 && value.trim() !== NONE ? value.trim() : null);
const group = (value) => (typeof value === 'string' ? value.trim().slice(0, LIMITS.expression) : '');

/**
 * The tool's own validator for an edited configuration. It keeps half-finished entries (a flow whose ends are not written yet) so the author can fill them
 * in; a pool or flow whose species is removed ('__none__') disappears. Running the tool uses `normalizeSolutionSpec`, which skips what is unfinished.
 */
export function normalizeSolutionConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pools = [], flows = [];
  for (const entry of Array.isArray(source.pools) ? source.pools : []) {
    const name = species(entry?.species);
    if (name && pools.length < LIMITS.pools) pools.push({ species: name, n: Math.round(clamp(entry.n, 1, LIMITS.pool, 20)) });
  }
  for (const entry of Array.isArray(source.flows) ? source.flows : []) {
    const name = species(entry?.species);
    if (name && flows.length < LIMITS.flows) flows.push({ species: name, from: group(entry.from), to: group(entry.to), cps: clamp(entry.cps, 0, LIMITS.cps, 1) });
  }
  return { seed: Number.isSafeInteger(source.seed) ? source.seed : 7, scale: source.scale === 'fast' ? 'fast' : 'slow', pools, flows };
}

/** What the Viewer runs: the finished pools and flows of a configuration. */
export const solutionSpec = (config) => normalizeSolutionSpec(config);

/** The editable fields for this configuration: every pool and flow, plus one blank slot of each kind while there is room (choosing a species fills it). */
export function solutionAuthorFields(config) {
  const cfg = normalizeSolutionConfig(config);
  const options = (current) => [{ value: NONE, label: '（不加 / 移除）' }, ...[...new Set([...SPECIES_NAMES, ...(current ? [current] : [])])].map((name) => ({ value: name, label: name }))];
  const fields = [
    { path: 'seed', type: 'number', integer: true, min: 0, max: 4294967295, step: 1, label: '随机种子（同一种子重放同一幅画面）', group: '设置' },
    { path: 'scale', type: 'select', label: '时间尺度', group: '设置', options: [{ value: 'slow', label: '慢：逐个分子' }, { value: 'fast', label: '快：粒子流' }] },
  ];
  const slots = (kind, list, limit) => (list.length < limit ? [...list, null] : list).map((entry, i) => ({ entry, i }));
  for (const { entry, i } of slots('pool', cfg.pools, LIMITS.pools)) {
    fields.push({ path: `pools.${i}.species`, type: 'select', label: entry ? `第 ${i + 1} 种分子` : '再加一种分子', group: '溶液中的分子池', options: options(entry?.species) });
    if (entry) fields.push({ path: `pools.${i}.n`, type: 'number', integer: true, min: 1, max: LIMITS.pool, step: 1, label: `第 ${i + 1} 种的个数`, group: '溶液中的分子池' });
  }
  for (const { entry, i } of slots('flow', cfg.flows, LIMITS.flows)) {
    fields.push({ path: `flows.${i}.species`, type: 'select', label: entry ? `第 ${i + 1} 条流的分子` : '再加一条流', group: '粒子流', options: options(entry?.species) });
    if (entry) fields.push(
      { path: `flows.${i}.from`, type: 'text', maxLength: LIMITS.expression, label: `第 ${i + 1} 条流的起点（残基组，如 chain A）`, group: '粒子流' },
      { path: `flows.${i}.to`, type: 'text', maxLength: LIMITS.expression, label: `第 ${i + 1} 条流的终点（残基组）`, group: '粒子流' },
      { path: `flows.${i}.cps`, type: 'number', min: 0, max: LIMITS.cps, step: 0.1, label: `第 ${i + 1} 条流的流速（周期/秒，0 = 暂停）`, group: '粒子流' });
  }
  return fields;
}

export function solutionToolDescriptor(version) {
  return {
    version, title: '溶液粒子与流', audience: ['view', 'author'], runtime: 'layer-v1',
    parameters: {},   // the Viewer's own panel holds the runtime controls (play, scale, add/remove)
    author: { template: SOLUTION_TEMPLATE, fields: solutionAuthorFields, validate: normalizeSolutionConfig },
    outputs: [{ key: 'crossings', label: '各路径的跨膜 / 区室流计数', kind: 'count' }],
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }],
    model: { kind: '溶液粒子与粒子流示意（布朗扩散 + 避开蛋白的路径）', assumptions: [
      '粒子的个数、速度和流速是示意设定，不是测得的浓度或通量。', '扩散是示意性的随机游走，不是分子动力学；粒子不进入蛋白，但不模拟与蛋白的相互作用。',
      '流的路径是在两组残基之间避开蛋白的随机路线，不是通过真实通道的路径。', '粒子的外观按物种统一设定（颜色和大小是示意）。'] },
  };
}
