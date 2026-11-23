import { selectionSpace, evaluateSelection } from './selection.mjs';
import { residueIdentity } from './confidence.mjs';
import { rangeTypeFor } from './representation.mjs';

/**
 * How parts of a structure look, as the authoring tools set it: rules written in the selection language ("chain A and resi 10-50", "within 5 of ligands") that give the residues they select a colour,
 * a colour scheme computed from a property (B-factor, hydrophobicity, charge, secondary structure, position along the chain) or a style (cartoon, backbone, blob, hidden). Later rules win. Plain data
 * (it is saved with the work, in the structure file's viewer state, and read back by both the Studio and the Viewer); no executable content. `lookFor` turns the rules into the two
 * per-residue questions the representation asks (`colorOf(atom)`, `styleOf(atom)`); the representation does the drawing (representation.mjs, `look`).
 */
export const LOOK_STYLES = Object.freeze(['cartoon', 'backbone', 'blob', 'sticks', 'ballstick', 'hidden']);
export const STYLE_LABELS = Object.freeze({ cartoon: '卡通', backbone: '主链', blob: '团块', sticks: '棍状（原子，叠在卡通上）', ballstick: '球棍（原子球加键线，叠在卡通上）', hidden: '隐藏' });
export const MAX_STICK_RESIDUES = 300;   // atom-level drawing is heavy: only a pocket or a few segments, not a whole protein
export const PROPERTY_SCHEMES = Object.freeze({ bfactor: 'B 因子（柔性）', hydrophobicity: '疏水性', charge: '电荷', secondary: '二级结构', rainbow: '彩虹（N→C）' });
export const MAX_STYLE_RULES = 64, MAX_EXPRESSION = 400, BANDS = 12;

export class LookError extends Error { constructor(message) { super(message); this.name = 'LookError'; } }

// Kyte & Doolittle (1982) hydropathy of the twenty amino acids; nucleotides and unknown residues have no value and keep the neutral colour.
export const KYTE_DOOLITTLE = Object.freeze({ ILE: 4.5, VAL: 4.2, LEU: 3.8, PHE: 2.8, CYS: 2.5, MET: 1.9, ALA: 1.8, GLY: -0.4, THR: -0.7, SER: -0.8, TRP: -0.9, TYR: -1.3, PRO: -1.6, HIS: -3.2, GLU: -3.5, GLN: -3.5, ASP: -3.5, ASN: -3.5, LYS: -3.9, ARG: -4.5 });
const NEUTRAL = '#d9dbe0';
const CHARGE = Object.freeze({ ASP: '#d6453d', GLU: '#d6453d', LYS: '#4e79a7', ARG: '#4e79a7', HIS: '#9fc3df' });
const SECONDARY = Object.freeze({ helix: '#d47770', sheet: '#d6a94f', default: '#607f91' });

const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (a, b, t) => { const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return '#' + x.map((v, k) => hex(v + (y[k] - v) * t)).join(''); };
const band = (t) => (Math.min(BANDS - 1, Math.floor(Math.max(0, Math.min(1, t)) * BANDS)) + 0.5) / BANDS;   // a gradient is cut into a few bands: every band is one layer of geometry
function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return '#' + [f(0), f(8), f(4)].map((v) => hex(v * 255)).join(''); }
const spectrum = (t) => hsl(240 - 240 * band(t), 0.55, 0.55);   // blue (0) to red (1), as the Viewer's rainbow

/** The hydropathy colour of one residue name (blue hydrophilic, white, orange hydrophobic; the neutral colour for residues without a value): the scale of the `hydrophobicity` scheme. */
export function hydropathyColor(resn) {
  const v = KYTE_DOOLITTLE[resn]; if (v === undefined) return NEUTRAL;
  const t = band((v + 4.5) / 9); return t < 0.5 ? mix('#4e79a7', '#f2f2ee', t * 2) : mix('#f2f2ee', '#e1873a', (t - 0.5) * 2);
}

/** The colour of every residue of `residues` (selection-space entries) under `scheme`: Map(residueIdentity -> colour). Residues without the property are left out (they keep the layer's colour). */
export function propertyColors(model, residues, scheme) {
  if (!Object.hasOwn(PROPERTY_SCHEMES, scheme)) throw new LookError(`配色方案应为 ${Object.keys(PROPERTY_SCHEMES).join(' / ')}。`);
  const out = new Map(), key = (r) => residueIdentity(r.atom);
  if (scheme === 'hydrophobicity') {
    for (const r of residues) { const v = KYTE_DOOLITTLE[r.resn]; if (v === undefined) continue; const t = band((v + 4.5) / 9); out.set(key(r), t < 0.5 ? mix('#4e79a7', '#f2f2ee', t * 2) : mix('#f2f2ee', '#e1873a', (t - 0.5) * 2)); }
  } else if (scheme === 'charge') {
    for (const r of residues) out.set(key(r), r.nucleic ? NEUTRAL : CHARGE[r.resn] ?? NEUTRAL);
  } else if (scheme === 'secondary') {
    const ranges = Array.isArray(model?.secondaryStructure) ? model.secondaryStructure : [];
    for (const r of residues) { if (r.nucleic) continue; out.set(key(r), SECONDARY[rangeTypeFor(r.atom, ranges)] ?? SECONDARY.default); }
  } else if (scheme === 'bfactor') {
    const values = residues.map((r) => [r, r.atom.bFactor]).filter(([, b]) => Number.isFinite(b) && b >= 0);
    if (values.length) { const lo = Math.min(...values.map(([, b]) => b)), hi = Math.max(...values.map(([, b]) => b)); for (const [r, b] of values) out.set(key(r), spectrum(hi > lo ? (b - lo) / (hi - lo) : 0)); }
  } else {   // rainbow: position along each chain, N to C
    const byChain = new Map(); for (const r of residues) { if (!byChain.has(r.asym)) byChain.set(r.asym, []); byChain.get(r.asym).push(r); }
    for (const chain of byChain.values()) { chain.sort((a, b) => a.labelSeq - b.labelSeq || a.authSeq - b.authSeq); chain.forEach((r, i) => out.set(key(r), spectrum(chain.length > 1 ? i / (chain.length - 1) : 0))); }
  }
  return out;
}

const parseHex = (value) => { const m = /^#([0-9a-f]{6})$/i.exec(String(value)); if (!m) throw new LookError('颜色应为 #rrggbb。'); return `#${m[1].toLowerCase()}`; };

/** Checks and cleans the list of style rules ([{ expr, style }], at most 64). */
export function validateStyles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STYLE_RULES) throw new LookError(`样式规则应为不超过 ${MAX_STYLE_RULES} 条的列表。`);
  return value.map((rule) => {
    if (!rule || typeof rule.expr !== 'string' || !rule.expr.trim() || rule.expr.length > MAX_EXPRESSION) throw new LookError('样式规则的选择表达式无效。');
    if (!LOOK_STYLES.includes(rule.style)) throw new LookError(`样式应为 ${LOOK_STYLES.join(' / ')}。`);
    return { expr: rule.expr, style: rule.style };
  });
}

/** Adds a style rule for the selection `target` (a selection-language expression; 'all' for everything). `check(expr)` returns how many residues it finds (it throws for text it cannot read). */
export function applyStyle(styles, target, style, { check } = {}) {
  if (!LOOK_STYLES.includes(style)) throw new LookError(`样式应为 ${LOOK_STYLES.join(' / ')}。`);
  const expr = String(target ?? 'all').trim() || 'all';
  if (expr.length > MAX_EXPRESSION) throw new LookError(`选择表达式太长（最多 ${MAX_EXPRESSION} 个字符）。`);
  let found; try { found = check ? check(expr) : undefined; } catch (error) { throw new LookError(`无法读取选择“${expr}”：${error.message}`); }
  if (found === 0) throw new LookError(`选择“${expr}”没有选中任何残基。`);
  if ((style === 'sticks' || style === 'ballstick') && found > MAX_STICK_RESIDUES) throw new LookError(`棍状是逐原子绘制，一次最多 ${MAX_STICK_RESIDUES} 个残基（这次选中 ${found} 个）：请缩小选择，例如 within 5 of ligands。`);
  if (styles.length >= MAX_STYLE_RULES) throw new LookError(`最多 ${MAX_STYLE_RULES} 条样式规则：先清除一些再来。`);
  return { styles: [...styles, { expr, style }], note: `${found ?? '所选'} 个残基（${expr}）画成“${STYLE_LABELS[style]}”。` };
}

/**
 * The per-residue questions for one parsed model: { colorOf(atom), styleOf(atom) }, or null when nothing is set. `colors` is the colour state ({ residues: [{ expr, color } | { expr, scheme }] });
 * `base` is an optional Map(residueIdentity -> colour) laid under the rules (the confidence bands of a predicted structure); `styles` the style rules.
 */
export function lookFor(model, { colors, styles } = {}, { base, sourceId, primaryId } = {}) {
  // With several structures in a scene a rule is for one of them: a colour rule names it (`structure`), everything else is for the first. Without `sourceId` every rule applies.
  const mine = (rule) => sourceId === undefined || (rule.structure ?? primaryId ?? sourceId) === sourceId;
  const colorRules = (colors?.residues ?? []).filter(mine), styleRules = (sourceId === undefined || primaryId === undefined || sourceId === primaryId) ? (styles ?? []) : [];
  if (!colorRules.length && !styleRules.length && !(base && base.size)) return null;
  const space = selectionSpace(model), colorMap = new Map(base ?? []), styleMap = new Map();
  for (const rule of colorRules) {
    const picked = evaluateSelection(rule.expr, space).residues;
    if (rule.scheme) for (const [id, color] of propertyColors(model, picked, rule.scheme)) colorMap.set(id, color);
    else for (const r of picked) colorMap.set(residueIdentity(r.atom), rule.color);
  }
  for (const rule of styleRules) for (const r of evaluateSelection(rule.expr, space).residues) styleMap.set(residueIdentity(r.atom), rule.style);
  return { colorOf: colorMap.size ? (atom) => colorMap.get(residueIdentity(atom)) : undefined, styleOf: styleMap.size ? (atom) => styleMap.get(residueIdentity(atom)) : undefined };
}
