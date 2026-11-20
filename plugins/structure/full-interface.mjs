import { selectCoordinateAtoms, chainKey } from './representation.mjs';

/**
 * All-atom interface between two chains (classic: kitFullAtom in src/ui/take-apart.js). Every atom of one chain is compared with the atoms of
 * the other within 4 Å and classified:
 *   disulfide    CYS SG–SG <= 2.5 Å
 *   salt bridge  Lys NZ / Arg NE NH1 NH2 against Asp OD / Glu OE / phosphate OP, <= 4.0 Å
 *   hydrogen bond  N/O–N/O 2.5–3.5 Å (a pair that is already a salt bridge is counted once, as the salt bridge)
 *   hydrophobic  side-chain C–C <= 4.0 Å between hydrophobic residues
 * N/O pairs closer than 2.5 Å are not chemistry but model geometry errors: they are counted separately (`clash`) and left out.
 * This reads the structure's own atoms; it needs side-chain coordinates (a Cα-only preview cannot be classified).
 */
export const INTERFACE_KINDS = Object.freeze({
  ss: '二硫键', salt: '盐桥', hbond: '氢键', hydro: '疏水接触',
});
const HYDROPHOBIC = new Set(['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'TYR', 'CYS']);
const NO = /^[NO]$/;
const BACKBONE = /^(N|CA|C|O)$/;
const isCation = (a) => (a.resn === 'LYS' && a.name === 'NZ') || (a.resn === 'ARG' && /^(NE|NH1|NH2)$/.test(a.name));
const isAnion = (a) => (a.resn === 'ASP' && /^OD[12]$/.test(a.name)) || (a.resn === 'GLU' && /^OE[12]$/.test(a.name)) || /^(OP1|OP2|O1P|O2P)$/.test(a.name);
const sideChain = (a) => !BACKBONE.test(a.name);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

const indexes = new WeakMap();

/** Polymer atoms (no hydrogens, no waters, no ligands) of every chain: Map(chainKey -> [{ position, element, name, resn, labelSeq, authSeq, insertion }]). */
export function chainAtoms(model) {
  if (indexes.has(model)) return indexes.get(model);
  const byChain = new Map();
  for (const { atom, pos } of selectCoordinateAtoms(model)) {
    if (atom.record !== 'ATOM') continue;
    const element = String(atom.element ?? '').toUpperCase();
    if (element === 'H' || element === 'D') continue;
    const key = chainKey(atom);
    if (!byChain.has(key)) byChain.set(key, []);
    byChain.get(key).push({
      position: pos, element, name: String(atom.name ?? ''), resn: String(atom.residueName ?? '').toUpperCase(),
      labelSeq: Number.parseInt(atom.labelSeqId, 10), authSeq: atom.authSeqId, insertion: atom.insertionCode || '',
    });
  }
  indexes.set(model, byChain);
  return byChain;
}

/** True when the chain has side-chain atoms; a Cα/P-only preview would produce no meaningful interface. */
export const hasSideChains = (atoms) => Boolean(atoms?.some((a) => a.name === 'CB' || a.name === 'N'));

/** Classifies the contacts of two atom lists. Returns { ss, salt, hbond, hydro, clash } (arrays of { type, a, b, d }, `clash` a Set of residue pairs). */
export function classifyContacts(mine, other) {
  const result = { ss: [], salt: [], hbond: [], hydro: [], clash: new Set() };
  const cell = 4.5, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const atom of other) {
    const k = key(Math.floor(atom.position[0] / cell), Math.floor(atom.position[1] / cell), Math.floor(atom.position[2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(atom);
  }
  const best = new Map();
  for (const x of mine) {
    const cx = Math.floor(x.position[0] / cell), cy = Math.floor(x.position[1] / cell), cz = Math.floor(x.position[2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const y of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        const d = dist(x.position, y.position);
        if (d > 4.0) continue;
        let type = null;
        if (d < 2.5 && NO.test(x.element) && NO.test(y.element)) { result.clash.add(`${x.labelSeq}|${y.labelSeq}`); continue; }
        if (x.resn === 'CYS' && y.resn === 'CYS' && x.name === 'SG' && y.name === 'SG' && d <= 2.5) type = 'ss';
        else if (((isCation(x) && isAnion(y)) || (isAnion(x) && isCation(y))) && d <= 4.0) type = 'salt';
        else if (NO.test(x.element) && NO.test(y.element) && d >= 2.5 && d <= 3.5) type = 'hbond';
        else if (x.element === 'C' && y.element === 'C' && sideChain(x) && sideChain(y) && HYDROPHOBIC.has(x.resn) && HYDROPHOBIC.has(y.resn)) type = 'hydro';
        if (!type) continue;
        const id = `${type}|${x.labelSeq}|${y.labelSeq}`, old = best.get(id);
        if (!old || d < old.d) best.set(id, { type, a: x, b: y, d });
      }
    }
  }
  // a salt bridge is also an H-bond pair: keep it once, as the salt bridge
  const salted = new Set([...best.values()].filter((v) => v.type === 'salt').map((v) => `${v.a.labelSeq}|${v.b.labelSeq}`));
  for (const v of [...best.values()].sort((u, w) => u.d - w.d)) {
    if (v.type === 'hbond' && salted.has(`${v.a.labelSeq}|${v.b.labelSeq}`)) continue;
    result[v.type].push(v);
  }
  return result;
}

/**
 * The all-atom interface of `piece` with each of `partners` (pieces from pieces.mjs). Returns { byPartner: Map(partnerIndex -> classification), unavailable }
 * where `unavailable` explains why nothing could be computed (no side-chain atoms).
 */
export function fullInterface(model, piece, partners) {
  const atoms = chainAtoms(model), mine = atoms.get(piece.key);
  if (!hasSideChains(mine)) return { byPartner: new Map(), unavailable: '这条链只有 Cα/P 预览坐标，没有侧链原子，需要完整结构才能判定化学键。' };
  const byPartner = new Map();
  for (const partner of partners) {
    const other = atoms.get(partner.key);
    byPartner.set(partner.index, hasSideChains(other) ? classifyContacts(mine, other) : { ss: [], salt: [], hbond: [], hydro: [], clash: new Set(), unavailable: true });
  }
  return { byPartner, unavailable: null };
}
