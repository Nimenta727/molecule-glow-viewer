import { selectCoordinateAtoms } from './representation.mjs';
import { selectionSpace, evaluateSelection } from './selection.mjs';
import { residueIdentity } from './confidence.mjs';

/**
 * Typed interactions between two parts of one structure, from the coordinates alone (hydrogens are usually absent, so there are no angle criteria):
 *   hydrogen bond   a donor–acceptor pair of heavy atoms (N/O/S side-chain and backbone atoms by name, see DONORS / ACCEPTORS) 2.4–3.5 Å apart
 *   salt bridge     a carboxylate oxygen of Asp/Glu and a cationic nitrogen of Lys (NZ) or Arg (NE, NH1, NH2) within 4.0 Å (His is not counted: its charge depends on pH and surroundings)
 *   hydrophobic     side-chain carbons of two residues within 4.0 Å (one entry per residue pair)
 * The cut-offs are the common rule-of-thumb values (the same as the ligand-site analysis of this project); mature programs such as ChimeraX use per-atom-type distance AND angle criteria with a
 * tolerance — the results here are a screening, not a replacement. Residues next to each other in the same chain are skipped (their backbone always "touches"). Asn/Gln amide and His ring flips
 * are not resolved: the donor/acceptor roles of those atoms are taken as listed.
 */
export class InteractionError extends Error { constructor(message) { super(message); this.name = 'InteractionError'; } }
export const CUTOFFS = Object.freeze({ hbond: 3.5, hbondMin: 2.4, salt: 4.0, hydrophobic: 4.0 });
export const TYPES = Object.freeze({ salt: ['盐桥', '#ff4fa3'], hbond: ['氢键', '#2f9bff'], hydrophobic: ['疏水接触', '#7bb661'] });
const BOTH = ['SER:OG', 'THR:OG1', 'TYR:OH', 'HIS:ND1', 'HIS:NE2'];
const DONORS = new Set([...BOTH, 'ARG:NE', 'ARG:NH1', 'ARG:NH2', 'ASN:ND2', 'GLN:NE2', 'LYS:NZ', 'TRP:NE1']);
const ACCEPTORS = new Set([...BOTH, 'ASP:OD1', 'ASP:OD2', 'GLU:OE1', 'GLU:OE2', 'ASN:OD1', 'GLN:OE1']);
const ANION = new Set(['ASP:OD1', 'ASP:OD2', 'GLU:OE1', 'GLU:OE2']), CATION = new Set(['LYS:NZ', 'ARG:NE', 'ARG:NH1', 'ARG:NH2']);
const key = (a) => `${String(a.residueName).toUpperCase()}:${a.name}`;
const isDonor = (a) => (a.name === 'N' && String(a.residueName).toUpperCase() !== 'PRO') || DONORS.has(key(a));
const isAcceptor = (a) => a.name === 'O' || a.name === 'OXT' || ACCEPTORS.has(key(a));
const hydrophobicCarbon = (a) => String(a.element).toUpperCase() === 'C' && !['C', 'CA'].includes(a.name) && ['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'TYR', 'CYS'].includes(String(a.residueName).toUpperCase());

/** `within: true` lets the two parts be the same part (the interactions inside one selection): residues in both are kept, and each pair of atoms is reported once. */
export function interactionsBetween(model, exprA, exprB, { within = false } = {}) {
  const space = selectionSpace(model);
  const part = (expr, name) => {
    let found; try { found = evaluateSelection(expr, space).residues; } catch (error) { throw new InteractionError(`${name}：${error.message}`); }
    if (!found.length) throw new InteractionError(`${name}“${expr}”没有选中任何残基。`);
    return found;
  };
  const A = part(exprA, 'A 部分'), B = part(exprB, 'B 部分'), idsA = new Set(A.map((r) => residueIdentity(r.atom))), idsB = new Set(B.map((r) => residueIdentity(r.atom)));
  const residueOf = new Map([...A, ...B].map((r) => [residueIdentity(r.atom), r]));
  const atomsOf = (ids) => { const out = []; for (const { atom, pos } of selectCoordinateAtoms(model)) { if (['H', 'D'].includes(String(atom.element).toUpperCase())) continue; const id = residueIdentity(atom); if (ids.has(id) && (within || !(idsA.has(id) && idsB.has(id)))) out.push({ atom, pos, id }); } return out; };
  const atomsA = atomsOf(idsA), atomsB = atomsOf(idsB), cell = 4.0, grid = new Map();
  for (const b of atomsB) { const k = b.pos.map((v) => Math.floor(v / cell)).join(','); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
  const adjacent = (p, q) => p.asym === q.asym && Math.abs(p.labelSeq - q.labelSeq) <= 1 && p.labelSeq !== 0;
  const best = new Map(), hydro = new Map();
  for (const a of atomsA) {
    const [cx, cy, cz] = a.pos.map((v) => Math.floor(v / cell));
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) for (const b of grid.get(`${x},${y},${z}`) ?? []) {
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]); if (d > CUTOFFS.salt) continue;
      const ra = residueOf.get(a.id), rb = residueOf.get(b.id); if (adjacent(ra, rb)) continue;
      if (within && `${a.id}|${a.atom.name}` >= `${b.id}|${b.atom.name}`) continue;   // inside one part every pair is seen from both ends: keep one
      let type = null;
      if (((ANION.has(key(a.atom)) && CATION.has(key(b.atom))) || (CATION.has(key(a.atom)) && ANION.has(key(b.atom)))) && d <= CUTOFFS.salt) type = 'salt';
      else if (d <= CUTOFFS.hbond && d >= CUTOFFS.hbondMin && ((isDonor(a.atom) && isAcceptor(b.atom)) || (isAcceptor(a.atom) && isDonor(b.atom)))) type = 'hbond';
      else if (d <= CUTOFFS.hydrophobic && hydrophobicCarbon(a.atom) && hydrophobicCarbon(b.atom)) {
        const k = `${a.id}\u0002${b.id}`, had = hydro.get(k); if (!had || d < had.distance) hydro.set(k, { type: 'hydrophobic', a: ra, b: rb, atomA: a.atom.name, atomB: b.atom.name, distance: d });
        continue;
      }
      if (!type) continue;
      const k = `${type}|${a.id}|${a.atom.name}|${b.id}|${b.atom.name}`, had = best.get(k);
      if (!had || d < had.distance) best.set(k, { type, a: ra, b: rb, atomA: a.atom.name, atomB: b.atom.name, distance: d });
    }
  }
  const order = { salt: 0, hbond: 1, hydrophobic: 2 };
  const interactions = [...best.values(), ...hydro.values()].sort((p, q) => order[p.type] - order[q.type] || p.distance - q.distance);
  const counts = { salt: 0, hbond: 0, hydrophobic: 0 }; for (const i of interactions) counts[i.type]++;
  return { interactions, counts, sizeA: A.length, sizeB: B.length };
}
