import { selectCoordinateAtoms, chainKey } from './representation.mjs';

/**
 * Per-residue confidence of a predicted structure (docs/PLUGIN_ROADMAP.md, A1). Predicted structures (AlphaFold-style) keep their confidence, pLDDT on a 0-100 scale, in the B-factor column
 * of every atom; an experimental structure has a real B-factor there. So nothing here may be applied by guessing: the caller asks only for a structure whose resource says it is predicted.
 * The four bands and their colours are the ones the AlphaFold database uses, so a reader who knows them reads the picture the same way.
 */
export const CONFIDENCE_BANDS = Object.freeze([
  { id: 'very-high', label: '非常高（pLDDT > 90）', min: 90, color: '#0053d6' },
  { id: 'confident', label: '较高（70–90）', min: 70, color: '#65cbf3' },
  { id: 'low', label: '较低（50–70）', min: 50, color: '#ffdb13' },
  { id: 'very-low', label: '很低（< 50）', min: -Infinity, color: '#ff7d45' },
]);

/** The band of a pLDDT value: above 90, above 70, above 50, otherwise very low (the AlphaFold database's own boundaries); null for something that is not a number. */
export const confidenceBand = (value) => (Number.isFinite(value) ? (value > 90 ? CONFIDENCE_BANDS[0] : value > 70 ? CONFIDENCE_BANDS[1] : value > 50 ? CONFIDENCE_BANDS[2] : CONFIDENCE_BANDS[3]) : null);
export const confidenceColor = (value) => confidenceBand(value)?.color ?? '#b0b0b0';

const text = (value) => (value == null ? '' : String(value));
/** The key the representation uses for a residue (same fields, so a residue found here is the residue drawn there). */
export const residueIdentity = (atom) => [chainKey(atom), text(atom.authSeqId), text(atom.labelSeqId), text(atom.insertionCode), text(atom.residueName).toUpperCase()].join('\u0001');

/**
 * pLDDT of every residue: Map(residueIdentity -> value), from the alpha carbon (or the first atom with a B-factor when a residue has no alpha carbon), only for values on the 0-100 scale.
 * Returns { values, residues, missing } where `missing` counts residues with no usable value.
 */
export function residueConfidence(model) {
  const values = new Map(), best = new Map(); let missing = 0;
  for (const { atom } of selectCoordinateAtoms(model)) {
    if (atom.record !== 'ATOM') continue;
    const key = residueIdentity(atom), isCa = atom.name === 'CA' && atom.element !== 'CA', rank = isCa ? 0 : 1;
    if (!Number.isFinite(atom.bFactor) || atom.bFactor < 0 || atom.bFactor > 100) { if (!best.has(key)) best.set(key, { rank: 2, value: null }); continue; }
    const had = best.get(key);
    if (!had || rank < had.rank) best.set(key, { rank, value: atom.bFactor });
  }
  for (const [key, { value }] of best) { if (value === null) missing++; else values.set(key, value); }
  return { values, residues: best.size, missing };
}

/** How the residues spread over the bands: { residues, mean, counts: { bandId: n }, fractions: { bandId: 0-1 }, missing }. */
export function confidenceSummary(model) {
  const { values, residues, missing } = residueConfidence(model), counts = Object.fromEntries(CONFIDENCE_BANDS.map(({ id }) => [id, 0]));
  let sum = 0;
  for (const value of values.values()) { counts[confidenceBand(value).id]++; sum += value; }
  const n = values.size;
  return { residues, mean: n ? sum / n : null, counts, fractions: Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, n ? c / n : 0])), missing };
}
