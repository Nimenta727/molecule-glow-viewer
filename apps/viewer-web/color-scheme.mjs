/**
 * Colouring for the Viewer command `color` (classic: glow.color). The structure plugin draws one layer set per chain (its "group"); this module decides the colour of each group:
 *   scheme  'entity' (the plugin's own palette, the default), 'chain' (one distinct colour per chain), 'rainbow' (blue to red along the chain order)
 *   chains  explicit colours of single chains ({ A: '#e05a4a' }), which win over the scheme
 * A colour is #rgb / #rrggbb or one of a few names. Colouring works per chain; a target that is not a whole chain (a residue range, "within 5 of ligands") is refused with a clear message rather
 * than silently colouring the wrong thing. The state is plain data (it can be saved and restored); no executable content.
 */
export const CHAIN_PALETTE = Object.freeze(['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac']);
const NAMES = Object.freeze({ red: '#e05a4a', orange: '#f28e2b', yellow: '#edc948', green: '#59a14f', cyan: '#3fb4c8', blue: '#4e79a7', purple: '#8e6bbf', magenta: '#d9488a', pink: '#ff9da7', brown: '#9c755f', gray: '#9aa0a6', grey: '#9aa0a6', white: '#f4f4f4', black: '#222222' });
export const SCHEMES = Object.freeze(['entity', 'chain', 'rainbow']);

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

export const createColorState = () => ({ scheme: 'entity', chains: {} });
export const isDefault = (state) => state.scheme === 'entity' && !Object.keys(state.chains).length;

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Apply a command to the state and return the new state plus a note. `args` is one of: 'reset', a scheme name, a colour (all chains), `"chain A"` / `"A"` with a colour, or an object
 * { target?, color?, scheme?, reset? }. `chainIds` are the chains of the open structure (used to check the target).
 */
export function applyColor(state, args, second, chainIds) {
  let target = null, color = null, scheme = null, reset = false;
  if (args && typeof args === 'object') ({ target = null, color = null, scheme = null, reset = false } = args);
  else if (second !== undefined && second !== null) { target = args; color = second; }
  else if (args === 'reset' || args === 'default') reset = true;
  else if (SCHEMES.includes(args)) scheme = args;
  else { color = args; }
  if (scheme !== null && !SCHEMES.includes(scheme)) throw new ColorError(`配色方式应为 ${SCHEMES.join(' / ')}。`);
  if (reset) return { state: createColorState(), note: '已恢复默认配色。' };
  if (scheme) return { state: { scheme, chains: {} }, note: `按${scheme === 'chain' ? '链' : scheme === 'rainbow' ? '链顺序（彩虹）' : '默认（实体）'}上色。` };
  const hex = parseColor(color);
  const chains = new Set(chainIds);
  let picked;
  if (target == null || /^(all|everything|\*)$/i.test(String(target).trim())) picked = [...chains];
  else {
    const text = String(target).trim(), match = /^(?:chain\s+)?([A-Za-z0-9]+)$/i.exec(text);
    if (!match) throw new ColorError(`“${target}”不是一整条链。当前只支持整条链或 all 上色（chain A、A、all）；残基范围上色尚未迁移。`);
    const id = [...chains].find((c) => c === match[1]) ?? [...chains].find((c) => c.toLowerCase() === match[1].toLowerCase());
    if (!id) throw new ColorError(`结构里没有链 ${match[1]}（现有：${[...chains].join('、') || '无'}）。`);
    picked = [id];
  }
  const next = { scheme: state.scheme, chains: { ...state.chains } };
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
  return { scheme: value.scheme, chains };
}
