/**
 * The rules of a plugin PANEL in the Studio (the manifest's `panel` entry): where a plugin's own interface sits and what it may do to a work. One rule, so every science plugin behaves the same way:
 *
 *   input   the panel reads the open structure (`api.model()`) and the author's current selection (`api.selection()`), nothing else of the Studio.
 *   output  what a panel writes into the work goes to exactly five places, each one a normal, undoable edit that the Viewer shows WITHOUT running the plugin:
 *             the look (colours and styles of parts: `api.applyLook`), annotations (measurements and labels: `api.annotate`), evidence (`api.addEvidence`), the PLACEMENT of a whole chain (`api.placePart`:
 *             a rigid move relative to its deposited coordinates, one undo step, never touching the structure file) and the panel's own data in a namespace
 *             of its own (`api.setData`, plain JSON up to 64 KB, readable again with `api.data`).
 *   honesty a result computed by a plugin is a DERIVED result: `addEvidence` accepts only the types "derived" and "modelled" and always names the plugin and the method, so a reader can tell it
 *           from the deposited coordinates.
 *   limits  no network, no files, no access to other plugins' data; a panel that throws is shown as failed and the rest of the Studio carries on.
 */
export const PANEL_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
export const PANEL_NEEDS = Object.freeze(['structure', 'selection']);
export const MAX_DATA_BYTES = 64 * 1024, MAX_EVIDENCE = 8, MAX_SHIFT = 2000;

export class PanelError extends Error { constructor(message) { super(message); this.name = 'PanelError'; } }

/** Checks a panel descriptor and returns a frozen copy: { id, title, summary?, needs, mount(container, api) -> { update?(), dispose?() } | void }. */
export function validatePanel(input) {
  if (!input || typeof input !== 'object') throw new PanelError('面板描述应为对象。');
  const { id, title, summary = '', needs = ['structure'], mount } = input;
  if (typeof id !== 'string' || !PANEL_ID.test(id) || id.length > 80) throw new PanelError(`面板编号“${String(id)}”不合法：小写点分名称，如 org.glow.panel.contacts。`);
  if (typeof title !== 'string' || !title.trim() || title.length > 24) throw new PanelError(`${id}：标题需要 1–24 个字符。`);
  if (typeof summary !== 'string' || summary.length > 200) throw new PanelError(`${id}：说明最多 200 个字符。`);
  if (!Array.isArray(needs) || needs.some((need) => !PANEL_NEEDS.includes(need))) throw new PanelError(`${id}：needs 只能是 ${PANEL_NEEDS.join('、')}。`);
  if (typeof mount !== 'function') throw new PanelError(`${id}：缺少 mount(container, api)。`);
  return Object.freeze({ id, title: title.trim(), summary: summary.trim(), needs: Object.freeze([...needs]), mount });
}

/** The panels of the registered plugins: unique ids, listed in the order they were added. */
export function createPanelRegistry() {
  const panels = new Map();
  return {
    register(descriptor) {
      const panel = validatePanel(descriptor);
      if (panels.has(panel.id)) throw new PanelError(`面板 ${panel.id} 已经注册过。`);
      panels.set(panel.id, panel);
      return () => { panels.delete(panel.id); };
    },
    list: () => [...panels.values()],
    get: (id) => panels.get(id),
  };
}

const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const plain = (value) => { try { return JSON.parse(JSON.stringify(value ?? null)); } catch { throw new PanelError('只能保存普通的 JSON 数据。'); } };

/**
 * The only thing a panel is given. `host` is what the Studio provides (it holds all the state); every method here checks its input before it reaches the host:
 *   host.model() / host.selection()                       what is open and chosen
 *   host.readData(id) / host.writeData(id, data, message) the panel's own namespace in the work (one undo step)
 *   host.applyLook(patch, message)                         { colors?: { residues: [{ expr, color | scheme }] }, styles?: [{ expr, style }] }: rules ADDED after the author's own (later rules win), checked like the Appearance tab
 *   host.annotate(patch, message)                          { measures?, labels?, bonds? }: entries ADDED to the work's own
 *   host.addEvidence(entry, message)                       one evidence entry of the work
 *   host.placePart(placement, message)                     { chain, quaternion, from, to }: rotate the chain about `from`, then carry `from` to `to` (structure coordinates, Å); null fit = back to the deposited place
 *   host.highlight(residues | null) / host.status(text)
 */
export function createPanelContext(panel, host) {
  const own = panel.id, evidenceCount = () => host.evidenceFrom?.(own) ?? 0;
  const api = {
    id: own,
    model: () => host.model(),
    selection: () => host.selection(),
    data: () => plain(host.readData(own) ?? null),
    setData(data, message = `${panel.title}：已保存结果。`) {
      const copy = plain(data);
      if (jsonBytes(copy) > MAX_DATA_BYTES) throw new PanelError(`面板数据太大（超过 ${MAX_DATA_BYTES / 1024} KB）：只存结论，不存原始数据。`);
      host.writeData(own, copy, message);
    },
    applyLook(patch, message = `${panel.title}：已设置外观。`) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['colors', 'styles'].includes(key))) throw new PanelError('applyLook 只接受 { colors?, styles? }。');
      host.applyLook(plain(patch), message);
    },
    annotate(patch, message = `${panel.title}：已添加标注。`) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['measures', 'labels', 'bonds'].includes(key))) throw new PanelError('annotate 只接受 { measures?, labels?, bonds? }。');
      host.annotate(plain(patch), message);
    },
    addEvidence({ type = 'derived', method, citation } = {}, message = `${panel.title}：已记录证据。`) {
      if (!['derived', 'modelled'].includes(type)) throw new PanelError('插件结果只能记为“推导”或“建模”，不能冒充实测数据。');
      if (typeof method !== 'string' || !method.trim() || method.length > 200) throw new PanelError('证据需要写明方法（1–200 个字符），读者要知道这是怎么算出来的。');
      if (citation !== undefined && (typeof citation !== 'string' || citation.length > 300)) throw new PanelError('引用最多 300 个字符。');
      if (evidenceCount() >= MAX_EVIDENCE) throw new PanelError(`一个面板最多记 ${MAX_EVIDENCE} 条证据。`);
      host.addEvidence({ type, citation: `${panel.title}（${own}）：${method.trim()}${citation ? `；${citation}` : ''}` , source: own }, message);
    },
    placePart(placement, message = `${panel.title}：已移动一条链。`) {
      const { chain, quaternion, from, to, reset, ...rest } = placement ?? {};
      if (Object.keys(rest).length || typeof chain !== 'string' || !chain || chain.length > 40) throw new PanelError('placePart 需要 { chain, quaternion, from, to }（或 { chain, reset: true } 还原）。');
      if (reset === true) { host.placePart({ chain, reset: true }, message); return; }
      const vec = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x));
      if (!vec(quaternion, 4) || !vec(from, 3) || !vec(to, 3)) throw new PanelError('placePart 的 quaternion 要 4 个数，from、to 各 3 个数。');
      if (Math.abs(Math.hypot(...quaternion) - 1) > 1e-6) throw new PanelError('placePart 的旋转（四元数）长度必须是 1。');
      if (Math.hypot(...to.map((v, i) => v - from[i])) > MAX_SHIFT || [...from, ...to].some((v) => Math.abs(v) > 1e5)) throw new PanelError(`移动太远（超过 ${MAX_SHIFT} Å）。`);
      host.placePart({ chain, quaternion: [...quaternion], from: [...from], to: [...to] }, message);
    },
    highlight: (residues) => host.highlight(residues ?? null),
    status: (text) => host.status(String(text ?? '')),
  };
  return Object.freeze(api);
}

/** Whether a panel can be used now: what it needs is open. Returns { ready, reason }. */
export function panelReadiness(panel, { hasStructure, hasSelection }) {
  if (panel.needs.includes('structure') && !hasStructure) return { ready: false, reason: '先导入或打开一个结构。' };
  if (panel.needs.includes('selection') && !hasSelection) return { ready: false, reason: '先在“外观”页用选择语言选出要分析的部分。' };
  return { ready: true, reason: '' };
}
