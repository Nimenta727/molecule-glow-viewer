import { selectionSpace, evaluateSelection } from './selection.mjs';
import { superposeFit, rotateVector } from './alignment.mjs';

/**
 * Superposition of one part of a structure onto another (Horn's quaternion fit on the alpha carbons, nucleotides: P): which residues pair up, the RMSD before and after the fit, the rotation and the
 * translation, and how far each pair still is from its partner. Residues are paired by author residue number AND residue name (`number`), or in order when both parts have the same number of residues
 * (`order`, for parts numbered differently). Pure geometry on the coordinates of ONE structure; nothing is moved here.
 */
export class SuperpositionError extends Error { constructor(message) { super(message); this.name = 'SuperpositionError'; } }
export const MODES = Object.freeze({ number: '按残基编号和名称配对', order: '按顺序配对（两部分残基数相同）' });
export const MIN_PAIRS = 3;

const rms = (pairs, move) => Math.sqrt(pairs.reduce((sum, { a, b }) => { const q = move(b); return sum + (a[0] - q[0]) ** 2 + (a[1] - q[1]) ** 2 + (a[2] - q[2]) ** 2; }, 0) / pairs.length);

export function superposeParts(model, mobileExpr, referenceExpr, { mode = 'number' } = {}) {
  if (!Object.hasOwn(MODES, mode)) throw new SuperpositionError(`配对方式应为 ${Object.keys(MODES).join(' 或 ')}。`);
  const space = selectionSpace(model);
  const part = (expr, name) => {
    let found; try { found = evaluateSelection(expr, space).residues; } catch (error) { throw new SuperpositionError(`${name}：${error.message}`); }
    if (!found.length) throw new SuperpositionError(`${name}“${expr}”没有选中任何残基。`);
    return found.slice().sort((p, q) => p.labelSeq - q.labelSeq || p.authSeq - q.authSeq);
  };
  const mobile = part(mobileExpr, '移动的部分'), reference = part(referenceExpr, '参考的部分');
  const chains = [...new Set(mobile.map((r) => r.asym))];
  if (chains.length !== 1) throw new SuperpositionError('移动的部分必须在同一条链里（叠合会移动整条链）。');
  if (reference.some((r) => r.asym === chains[0])) throw new SuperpositionError('参考的部分不能包含要移动的那条链。');
  let pairs;
  if (mode === 'order') {
    if (mobile.length !== reference.length) throw new SuperpositionError(`按顺序配对要求两部分残基数相同（现在是 ${mobile.length} 和 ${reference.length}）。`);
    pairs = mobile.map((r, i) => ({ mobile: r, reference: reference[i] }));
  } else {
    const byKey = new Map(reference.map((r) => [`${r.authSeq}${r.insertion ?? ''}|${r.resn}`, r]));
    pairs = mobile.flatMap((r) => { const other = byKey.get(`${r.authSeq}${r.insertion ?? ''}|${r.resn}`); return other ? [{ mobile: r, reference: other }] : []; });
  }
  if (pairs.length < MIN_PAIRS) throw new SuperpositionError(`能配上的残基只有 ${pairs.length} 对，至少要 ${MIN_PAIRS} 对（可以试试“按顺序配对”，或检查两部分的编号和残基名）。`);
  const coords = pairs.map(({ mobile: m, reference: r }) => ({ a: [...r.position], b: [...m.position], mobile: m, reference: r }));
  const fit = superposeFit(coords.map(({ a }) => a), coords.map(({ b }) => b));
  const moved = (p) => rotateVector(p.map((v, i) => v - fit.cb[i]), fit.quaternion).map((v, i) => v + fit.ca[i]);
  const deviations = coords.map(({ a, b, mobile: m, reference: r }) => { const q = moved(b); return { mobile: m, reference: r, distance: Math.hypot(a[0] - q[0], a[1] - q[1], a[2] - q[2]) }; });
  return { chain: chains[0], chainId: mobile[0].chain, pairs: pairs.length, mobileSize: mobile.length, referenceSize: reference.length, rmsdBefore: rms(coords, (p) => p), rmsd: rms(coords, moved), quaternion: fit.quaternion, from: fit.cb, to: fit.ca, deviations: deviations.sort((p, q) => q.distance - p.distance) };
}

/** The rotation in degrees (angle of the quaternion) and the length of the shift of the centre of the moved part, for the summary. */
export function motionOf({ quaternion, from, to }) {
  const w = Math.min(1, Math.abs(quaternion[3]));
  return { angle: 2 * Math.acos(w) * (180 / Math.PI), shift: Math.hypot(...to.map((v, i) => v - from[i])) };
}
