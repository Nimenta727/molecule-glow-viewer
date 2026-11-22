import { selectionSpace, evaluateSelection } from './selection.mjs';
import { KYTE_DOOLITTLE } from './look.mjs';

/**
 * The make-up of a chosen part of a protein, counted from its residues: how many of each kind, the mean Kyte–Doolittle hydropathy (GRAVY) and the net charge by COUNTING charged side chains
 * (Lys, Arg +1; Asp, Glu −1; His 0). The charge ignores pKa shifts, the environment, termini and ligands: it is a count, not a pH-dependent charge. Nucleotides and unknown residues are reported
 * but not counted in the protein figures.
 */
export class CompositionError extends Error { constructor(message) { super(message); this.name = 'CompositionError'; } }
export const CLASSES = Object.freeze({
  hydrophobic: { label: '疏水', members: ['ALA', 'VAL', 'ILE', 'LEU', 'MET', 'PHE', 'TRP', 'CYS'] },
  polar: { label: '极性（不带电）', members: ['SER', 'THR', 'ASN', 'GLN', 'TYR', 'HIS'] },
  positive: { label: '带正电', members: ['LYS', 'ARG'] },
  negative: { label: '带负电', members: ['ASP', 'GLU'] },
  special: { label: '甘氨酸、脯氨酸', members: ['GLY', 'PRO'] },
});

export function compositionOf(model, expression) {
  let found; try { found = evaluateSelection(expression, selectionSpace(model)).residues; } catch (error) { throw new CompositionError(error.message); }
  if (!found.length) throw new CompositionError(`“${expression}”没有选中任何残基。`);
  const classes = Object.fromEntries(Object.keys(CLASSES).map((key) => [key, 0])), byName = {};
  let protein = 0, other = 0, hydropathy = 0, charge = 0;
  const classOf = new Map(Object.entries(CLASSES).flatMap(([key, { members }]) => members.map((name) => [name, key])));
  for (const r of found) {
    const key = classOf.get(r.resn);
    if (!key || r.nucleic) { other++; continue; }
    protein++; classes[key]++; byName[r.resn] = (byName[r.resn] ?? 0) + 1; hydropathy += KYTE_DOOLITTLE[r.resn] ?? 0;
    if (key === 'positive') charge++; else if (key === 'negative') charge--;
  }
  return { selected: found.length, protein, other, classes, byName, gravy: protein ? hydropathy / protein : null, netCharge: protein ? charge : null };
}
