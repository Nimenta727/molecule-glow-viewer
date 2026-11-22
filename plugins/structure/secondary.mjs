import { selectionSpace, evaluateSelection } from './selection.mjs';
import { sequenceRows } from './sequence.mjs';
import { residueIdentity } from './confidence.mjs';

/**
 * Sequence and secondary structure of a chosen part, per chain: the one-letter sequence, a line of H (helix) / E (strand) / - (other) from the secondary structure DEPOSITED with the file (HELIX/SHEET records
 * or the mmCIF struct_conf / struct_sheet_range tables; nothing is predicted or recomputed here), the helix and strand segments with their residue numbers, and the share of each. Gaps (residues without
 * coordinates) are marked with `/` in the sequence and the structure line.
 */
export class SecondaryError extends Error { constructor(message) { super(message); this.name = 'SecondaryError'; } }
export const MAX_SHOWN = 2000, LETTER = Object.freeze({ helix: 'H', sheet: 'E', coil: '-' });

export function secondaryOf(model, expression) {
  let found; try { found = evaluateSelection(expression, selectionSpace(model)).residues; } catch (error) { throw new SecondaryError(error.message); }
  if (!found.length) throw new SecondaryError(`“${expression}”没有选中任何残基。`);
  const chosen = new Set(found.map((r) => residueIdentity(r.atom))), chains = [];
  let shown = 0, truncated = false;
  for (const row of sequenceRows(model, { maxRows: 1000 }).rows) {
    const cells = row.cells.filter((cell) => chosen.has(residueIdentity(cell.residue.atom)));
    if (!cells.length) continue;
    let sequence = '', structure = '';
    const segments = []; let open = null;
    for (const cell of cells) {
      if (shown >= MAX_SHOWN) { truncated = true; break; }
      shown++;
      if (cell.gapBefore) { sequence += '/'; structure += '/'; open = null; }
      sequence += cell.code; structure += LETTER[cell.structure];
      if (cell.structure === 'coil') { open = null; continue; }
      if (open && open.type === cell.structure) { open.to = cell.residue.authSeq; open.length++; open.last = cell.residue; }
      else { open = { type: cell.structure, from: cell.residue.authSeq, to: cell.residue.authSeq, length: 1, last: cell.residue }; segments.push(open); }
    }
    const count = (letter) => [...structure].filter((c) => c === letter).length, total = [...structure].filter((c) => c !== '/').length;
    chains.push({ label: row.label, chain: row.chain, residues: total, sequence, structure, helix: count('H'), sheet: count('E'), segments: segments.map(({ type, from, to, length }) => ({ type, from, to, length, expr: `chain ${row.chain} and resi ${from}-${to}` })) });
  }
  return { chains, truncated, selected: found.length };
}
