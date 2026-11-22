import { selectCoordinateAtoms } from './representation.mjs';
import { selectionSpace, evaluateSelection } from './selection.mjs';
import { residueIdentity } from './confidence.mjs';

/**
 * Interface contacts between two parts of one structure: which residues of part A come within `cutoff` Å (heavy atoms, default 4.5) of which residues of part B. A GEOMETRIC fact about the deposited or
 * modelled coordinates: it does not tell hydrogen bonds from salt bridges or hydrophobic contact, does not compute buried surface area, and says nothing about binding strength. Residues that belong to
 * both parts are left out of the pairing (a residue is never in contact with itself).
 */
export class ContactError extends Error { constructor(message) { super(message); this.name = 'ContactError'; } }
export const MAX_CUTOFF = 8, DEFAULT_CUTOFF = 4.5, MAX_PAIRS = 5000;

export function contactsBetween(model, exprA, exprB, { cutoff = DEFAULT_CUTOFF } = {}) {
  if (!(Number.isFinite(cutoff) && cutoff > 0 && cutoff <= MAX_CUTOFF)) throw new ContactError(`距离应在 0–${MAX_CUTOFF} Å 之间。`);
  const space = selectionSpace(model);
  const part = (expr, name) => {
    let found; try { found = evaluateSelection(expr, space).residues; } catch (error) { throw new ContactError(`${name}：${error.message}`); }
    if (!found.length) throw new ContactError(`${name}“${expr}”没有选中任何残基。`);
    return found;
  };
  const A = part(exprA, 'A 部分'), B = part(exprB, 'B 部分');
  const idsA = new Set(A.map((r) => residueIdentity(r.atom))), idsB = new Set(B.map((r) => residueIdentity(r.atom)));
  const heavy = new Map();   // residueIdentity -> [{ pos, name }]
  for (const { atom, pos } of selectCoordinateAtoms(model)) {
    if (['H', 'D'].includes(String(atom.element).toUpperCase())) continue;
    const id = residueIdentity(atom);
    if (!idsA.has(id) && !idsB.has(id)) continue;
    if (!heavy.has(id)) heavy.set(id, []);
    heavy.get(id).push({ pos, name: atom.name });
  }
  const cell = (p) => p.map((v) => Math.floor(v / cutoff)), grid = new Map();
  const byId = new Map(B.map((r) => [residueIdentity(r.atom), r]));
  for (const [id, atoms] of heavy) if (idsB.has(id) && !idsA.has(id)) for (const a of atoms) { const key = cell(a.pos).join(','); if (!grid.has(key)) grid.set(key, []); grid.get(key).push({ id, ...a }); }
  const pairs = new Map(), limit = cutoff * cutoff;
  const resA = new Map(A.map((r) => [residueIdentity(r.atom), r]));
  for (const [id, atoms] of heavy) {
    if (!idsA.has(id) || idsB.has(id)) continue;
    for (const a of atoms) {
      const [cx, cy, cz] = cell(a.pos);
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
        for (const b of grid.get(`${x},${y},${z}`) ?? []) {
          const d2 = (a.pos[0] - b.pos[0]) ** 2 + (a.pos[1] - b.pos[1]) ** 2 + (a.pos[2] - b.pos[2]) ** 2;
          if (d2 > limit) continue;
          const key = `${id}\u0002${b.id}`, had = pairs.get(key);
          if (!had) pairs.set(key, { a: resA.get(id), b: byId.get(b.id), distance: Math.sqrt(d2), atomA: a.name, atomB: b.name, atoms: 1 });
          else { had.atoms++; if (d2 < had.distance ** 2) Object.assign(had, { distance: Math.sqrt(d2), atomA: a.name, atomB: b.name }); }
        }
      }
    }
  }
  if (pairs.size > MAX_PAIRS) throw new ContactError(`接触对太多（超过 ${MAX_PAIRS}）：请缩小两部分的范围。`);
  const list = [...pairs.values()].sort((p, q) => p.distance - q.distance);
  const residuesOf = (side) => { const seen = new Map(); for (const p of list) seen.set(residueIdentity(p[side].atom), p[side]); return [...seen.values()]; };
  return { cutoff, pairs: list, residuesA: residuesOf('a'), residuesB: residuesOf('b'), sizeA: A.length, sizeB: B.length };
}

const label = (r) => `${r.resn} ${r.chain}:${r.authSeq}${r.insertion || ''}`;
export const residueName = label;

/**
 * Selection-language expressions (each at most 380 characters) that together pick exactly `residues`: per chain, residue numbers written as ranges. Used to colour the interface residues as rules of the work.
 * A residue with an insertion code is written on its own (`52A`).
 */
export function expressionsFor(residues, limit = 380) {
  const byChain = new Map();
  for (const r of residues) { if (!byChain.has(r.chain)) byChain.set(r.chain, []); byChain.get(r.chain).push(r); }
  const out = [];
  for (const [chain, list] of byChain) {
    const plain = [...new Set(list.filter((r) => !r.insertion).map((r) => r.authSeq))].sort((a, b) => a - b), tokens = list.filter((r) => r.insertion).map((r) => `${r.authSeq}${r.insertion}`);
    for (let i = 0; i < plain.length;) { let j = i; while (j + 1 < plain.length && plain[j + 1] === plain[j] + 1) j++; tokens.push(j > i ? `${plain[i]}-${plain[j]}` : String(plain[i])); i = j + 1; }
    let current = [];
    const flush = () => { if (current.length) out.push(`chain ${chain} and resi ${current.join(',')}`); current = []; };
    for (const token of tokens) { if (`chain ${chain} and resi ${[...current, token].join(',')}`.length > limit) flush(); current.push(token); }
    flush();
  }
  return out;
}
