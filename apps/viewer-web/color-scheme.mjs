/**
 * Colouring for the Viewer command `color` (classic: glow.color). The structure plugin draws one layer set per chain (its "group"); this module decides the colour of each group:
 *   scheme  'entity' (the plugin's own palette, the default), 'chain' (one distinct colour per chain), 'rainbow' (blue to red along the chain order)
 *   chains  explicit colours of single chains ({ A: '#e05a4a' }), which win over the scheme
 *   residues  rules { expr, color } in the selection language ("chain A and resi 10-50", "within 5 of ligands"): the residues they select are drawn in that colour, later rules win, and they win over chain colours
 *   'confidence'  (a scheme) the per-residue confidence of a predicted structure in the AlphaFold bands; refused for a structure that is not marked as predicted
 * A colour is #rgb / #rrggbb or one of a few names. Residue colours are drawn by the blob representation (one sphere per residue); the other representations keep the chain colour. A target the
 * selection language cannot read, or that selects nothing, is refused with a clear message rather than silently colouring the wrong thing. The state is plain data (it can be saved and
 * restored); no executable content.
 */
export const CHAIN_PALETTE = Object.freeze(['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac']);
const NAMES = Object.freeze({ red: '#e05a4a', orange: '#f28e2b', yellow: '#edc948', green: '#59a14f', cyan: '#3fb4c8', blue: '#4e79a7', purple: '#8e6bbf', magenta: '#d9488a', pink: '#ff9da7', brown: '#9c755f', gray: '#9aa0a6', grey: '#9aa0a6', white: '#f4f4f4', black: '#222222' });
export const SCHEMES = Object.freeze(['entity', 'chain', 'rainbow', 'confidence']);
export const MAX_RULES = 64, MAX_EXPRESSION = 400;

export class ColorError extends Error { constructor(message) { super(message); this.name = 'ColorError'; } }

export function parseColor(value) {
  if (typeof value !== 'string') throw new ColorError('颜色应为 #rrggbb 或颜色名。');
  const text = value.trim().toLowerCase();
  if (NAMES[text]) return NAMES[text];
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (!match) throw new ColorError(`无法识别的颜色“${value}”：用 #rrggbb，或 ${Object.keys(NAMES).join('、')}。`);
  const hex = match[1];
  return '#' + (hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex);
}

export const createColorState = () => ({ scheme: 'entity', chains: {}, residues: [] });
export const isDefault = (state) => state.scheme === 'entity' && !Object.keys(state.chains).length && !(state.residues?.length);

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Apply a command to the state and return the new state plus a note. `args` is one of: 'reset', a scheme name, a colour (all chains), `"chain A"` / `"A"` with a colour, or an object
 * { target?, color?, scheme?, reset? }. `chainIds` are the chains of the open structure (used to check the target).
 * `context` (optional): `check(expression)` -> how many residues the selection language finds (it throws for an expression it cannot read), which is what allows residue targets;
 * `confidence` says whether the structure is a predicted one (the 'confidence' scheme needs it).
 */
export function applyColor(state, args, second, chainIds, context = {}) {
  let target = null, color = null, scheme = null, reset = false;
  if (args && typeof args === 'object') ({ target = null, color = null, scheme = null, reset = false } = args);
  else if (second !== undefined && second !== null) { target = args; color = second; }
  else if (args === 'reset' || args === 'default') reset = true;
  else if (SCHEMES.includes(args)) scheme = args;
  else { color = args; }
  if (scheme !== null && !SCHEMES.includes(scheme)) throw new ColorError(`配色方式应为 ${SCHEMES.join(' / ')}。`);
  if (reset) return { state: createColorState(), note: '已恢复默认配色。' };
  if (scheme === 'confidence' && !context.confidence) throw new ColorError('这个结构不是预测结构，没有逐残基的置信度可以上色（只有登记为预测结构的资源才有）。');
  if (scheme) return { state: { scheme, chains: {}, residues: [] }, note: `按${scheme === 'chain' ? '链' : scheme === 'rainbow' ? '链顺序（彩虹）' : scheme === 'confidence' ? '预测置信度（pLDDT 分四档）' : '默认（实体）'}上色。` };
  const hex = parseColor(color);
  const chains = new Set(chainIds);
  let picked;
  if (target == null || /^(all|everything|\*)$/i.test(String(target).trim())) picked = [...chains];
  else {
    const text = String(target).trim(), match = /^(?:chain\s+)?([A-Za-z0-9]+)$/i.exec(text);
    if (!match && context.check) {   // not a whole chain: a selection, coloured residue by residue
      if (text.length > MAX_EXPRESSION) throw new ColorError(`选择表达式太长（最多 ${MAX_EXPRESSION} 个字符）。`);
      let count; try { count = context.check(text); } catch (error) { throw new ColorError(`无法读取选择“${text}”：${error.message}`); }
      if (!count) throw new ColorError(`选择“${text}”没有选中任何残基，没有上色。`);
      const rules = [...(state.residues ?? []), { expr: text, color: hex }];
      if (rules.length > MAX_RULES) throw new ColorError(`最多 ${MAX_RULES} 条残基上色规则；先 color('reset') 再来。`);
      return { state: { scheme: state.scheme, chains: { ...state.chains }, residues: rules }, note: `${count} 个残基（${text}）染成 ${hex}；残基颜色由“团块”表示画出，其它表示仍显示链的颜色。` };
    }
    if (!match) throw new ColorError(`“${target}”不是一整条链。整条链或 all 可以直接上色（chain A、A、all）；残基范围上色需要打开了结构并用选择语言写（例如 chain A and resi 10-50）。`);
    const id = [...chains].find((c) => c === match[1]) ?? [...chains].find((c) => c.toLowerCase() === match[1].toLowerCase());
    if (!id) throw new ColorError(`结构里没有链 ${match[1]}（现有：${[...chains].join('、') || '无'}）。`);
    picked = [id];
  }
  const next = { scheme: state.scheme, chains: { ...state.chains }, residues: [...(state.residues ?? [])] };
  for (const id of picked) next.chains[id] = hex;
  return { state: next, note: `${picked.length === chains.size ? '全部' : picked.join('、')} 链染成 ${hex}。` };
}

/** The colour of a chain group, or undefined to keep the plugin's own. `index`/`count` are the group's place among the groups. */
export function resolveColor(state, chainId, index, count) {
  if (state.chains[chainId]) return state.chains[chainId];
  if (state.scheme === 'chain') return CHAIN_PALETTE[index % CHAIN_PALETTE.length];
  if (state.scheme === 'rainbow') return hsl(240 - 240 * (count <= 1 ? 0 : index / (count - 1)), 0.55, 0.55);
  return undefined;
}

export function validateColorState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ColorError('配色状态应为对象。');
  if (!SCHEMES.includes(value.scheme)) throw new ColorError('配色方式无效。');
  const chains = {};
  for (const [id, color] of Object.entries(value.chains ?? {})) { if (typeof id !== 'string' || id.length > 16) throw new ColorError('链号无效。'); chains[id] = parseColor(color); }
  const rules = [];
  if (value.residues !== undefined) {
    if (!Array.isArray(value.residues) || value.residues.length > MAX_RULES) throw new ColorError('残基上色规则应为不超过 64 条的列表。');
    for (const rule of value.residues) {
      if (!rule || typeof rule.expr !== 'string' || !rule.expr.trim() || rule.expr.length > MAX_EXPRESSION) throw new ColorError('残基上色规则的选择表达式无效。');
      rules.push({ expr: rule.expr, color: parseColor(rule.color) });
    }
  }
  return { scheme: value.scheme, chains, residues: rules };
}
