import { selectionSpace } from './selection.mjs';
import { rangeTypeFor } from './representation.mjs';

/**
 * The sequence bar's model (classic: src/ui/sequence-bar.js): one row per chain copy, one cell per residue in label_seq order,
 * gaps where the deposited model has no coordinates (a jump in label_seq_id), helix/strand from the deposited secondary structure.
 * Pure data; the Viewer draws it. A cell keeps the residue it came from, so a click maps back to exactly that residue and a selection
 * made anywhere maps onto the cells by identity.
 */
const ONE = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', SEC: 'U', PYL: 'O',
};
export const MAX_SEQUENCE_ROWS = 16;

export function sequenceRows(model, { maxRows = MAX_SEQUENCE_ROWS } = {}) {
  const ranges = Array.isArray(model?.secondaryStructure) ? model.secondaryStructure : [];
  const byAsym = new Map();
  for (const residue of selectionSpace(model).residues) {
    if (!byAsym.has(residue.asym)) byAsym.set(residue.asym, []);
    byAsym.get(residue.asym).push(residue);
  }
  const all = [...byAsym.entries()].map(([asym, residues]) => [asym, residues.slice().sort((a, b) => a.labelSeq - b.labelSeq || a.authSeq - b.authSeq)]);
  const rows = all.slice(0, maxRows).map(([asym, residues]) => {
    const chain = residues[0].chain;
    const cells = residues.map((residue, index) => {
      const previous = residues[index - 1], jump = previous && residue.labelSeq && previous.labelSeq ? residue.labelSeq - previous.labelSeq - 1 : 0;
      const type = rangeTypeFor(residue.atom, ranges);
      return {
        residue, code: residue.nucleic ? (residue.resn.slice(-1) || '?') : (ONE[residue.resn] ?? 'X'),
        structure: type === 'helix' ? 'helix' : type === 'sheet' ? 'sheet' : 'coil',
        gapBefore: jump > 0 ? { count: jump, from: previous.labelSeq + 1, to: residue.labelSeq - 1 } : null,
      };
    });
    return { asym, chain, label: chain, copy: asym.includes('_') ? asym.split('_')[1] : null, cells };
  });
  // symmetry copies of one chain are labelled A·1, A·2 ... like the classic bar
  for (const row of rows) {
    const same = rows.filter((other) => other.chain === row.chain);
    if (same.length > 1) row.label = `${row.chain}·${row.copy ?? 1}`;
  }
  return { rows, hidden: Math.max(0, all.length - rows.length) };
}

/** The selection expression for a drag from cell a to cell b inside one row (a different row collapses to a single cell). */
export function rangeExpression(row, from, to) {
  let a = row.cells[from]?.residue, b = row.cells[to]?.residue;
  if (!a) return null;
  if (!b) b = a;
  if (b.labelSeq < a.labelSeq) [a, b] = [b, a];
  return `asym ${row.asym} and label_seq ${a.labelSeq}-${b.labelSeq}`;
}

/** Which cells are in a selection result ({ residues }), by residue identity. */
export function selectedCells(rows, selection) {
  const chosen = new Set(selection?.residues ?? []);
  return rows.map((row) => row.cells.map((cell) => chosen.has(cell.residue)));
}

export function residueTitle(cell) {
  const r = cell.residue, number = `${r.authSeq}${r.insertion}`;
  return `${r.resn} ${r.chain}:${number}（label ${r.labelSeq}）`;
}
