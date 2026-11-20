import { chainKey, chainGroupKey } from './representation.mjs';
import { selectionSpace } from './selection.mjs';

/**
 * Take-apart model (classic: src/ui/take-apart.js). Every polymer chain of a structure is one *piece*; small molecules travel with the piece
 * they sit on. Interfaces are residue level: a residue point (C-alpha / P) of one piece and the nearest residue point of another piece closer
 * than 8 Å (10 Å when either is a nucleotide). Pure data and geometry, no rendering: the Viewer moves nodes by `pieceOffset`.
 */
export const INTERFACE_CUTOFF = 8;
export const NUCLEIC_INTERFACE_CUTOFF = 10;
export const LIGAND_ATTACH_DISTANCE = 7;
const MAX_PIECES = 400;
const MIN_RESIDUES = 3;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centroid = (points) => {
  const sum = [0, 0, 0];
  for (const p of points) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
  return sum.map((value) => value / points.length);
};

export function buildPieces(model) {
  const space = selectionSpace(model), byKey = new Map();
  for (const residue of space.residues) {
    const key = chainKey(residue.atom);
    if (!byKey.has(key)) byKey.set(key, { key, groupKey: chainGroupKey(residue.atom), residues: [] });
    byKey.get(key).residues.push(residue);
  }
  const pieces = [...byKey.values()].filter((piece) => piece.residues.length >= MIN_RESIDUES)
    .sort((a, b) => b.residues.length - a.residues.length).slice(0, MAX_PIECES);
  pieces.forEach((piece, index) => {
    const first = piece.residues[0];
    piece.index = index;
    piece.asym = first.asym;
    piece.chain = first.chain;
    piece.nucleic = piece.residues.some((r) => r.nucleic);
    piece.centre = centroid(piece.residues.map((r) => r.position));
    piece.radius = Math.max(...piece.residues.map((r) => distance(r.position, piece.centre)));
    piece.ligands = [];
  });
  // small molecules travel with the nearest piece within 7 Å of the ligand centre
  const limit2 = LIGAND_ATTACH_DISTANCE ** 2;
  for (const ligand of space.ligands) {
    const centre = centroid(ligand.atoms.map((a) => a.position));
    let best = null, bestD = limit2;
    for (const piece of pieces) {
      if (distance(piece.centre, centre) > piece.radius + 10) continue;
      for (const r of piece.residues) {
        const d = (r.position[0] - centre[0]) ** 2 + (r.position[1] - centre[1]) ** 2 + (r.position[2] - centre[2]) ** 2;
        if (d < bestD) { bestD = d; best = piece; }
      }
    }
    if (best) best.ligands.push(ligand);
  }
  const all = pieces.flatMap((p) => p.residues.map((r) => r.position));
  const centre = all.length ? centroid(all) : [0, 0, 0];
  return { pieces, centre, radius: all.length ? Math.max(...all.map((p) => distance(p, centre))) : 0 };
}

/** `piece.groupKey` (and `chainGroupKey(ligand.atom)`) is the key scene nodes carry as `chainKey`.
 * Residue-level interfaces. Fills piece.near[i] = { piece, residue, d } (nearest foreign point) and piece.partners: Map(pieceIndex -> { n, pairs }). */
export function computeInterfaces({ pieces }) {
  const cell = 10, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const piece of pieces) {
    piece.near = new Array(piece.residues.length).fill(null);
    piece.partners = new Map();
    piece.residues.forEach((r, ri) => {
      const k = key(Math.floor(r.position[0] / cell), Math.floor(r.position[1] / cell), Math.floor(r.position[2] / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([piece.index, ri]);
    });
  }
  for (const piece of pieces) {
    piece.residues.forEach((r, ri) => {
      const [x, y, z] = r.position, cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const [pj, rj] of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
          if (pj === piece.index) continue;
          const other = pieces[pj].residues[rj], d = distance(r.position, other.position);
          if (d > (r.nucleic || other.nucleic ? NUCLEIC_INTERFACE_CUTOFF : INTERFACE_CUTOFF)) continue;
          if (!piece.near[ri] || d < piece.near[ri].d) piece.near[ri] = { pj, rj, d };
        }
      }
      const nearest = piece.near[ri];
      if (!nearest) return;
      let entry = piece.partners.get(nearest.pj);
      if (!entry) piece.partners.set(nearest.pj, entry = { n: 0, pairs: [] });
      entry.n++;
      entry.pairs.push([ri, nearest.rj, nearest.d]);
    });
  }
  return pieces;
}

/** The pieces `piece` touches in either direction (the nearest-neighbour bookkeeping is asymmetric): [{ piece, n, nOther }], most contact first. */
export function partnersOf({ pieces }, piece) {
  const map = new Map();
  for (const [index, entry] of piece.partners) map.set(index, { n: entry.n, nOther: 0 });
  for (const other of pieces) {
    const entry = other.partners.get(piece.index);
    if (!entry) continue;
    const current = map.get(other.index) ?? { n: 0, nOther: 0 };
    current.nOther = entry.n;
    map.set(other.index, current);
  }
  return [...map].map(([index, { n, nOther }]) => ({ piece: pieces[index], n, nOther })).sort((a, b) => (b.n + b.nOther) - (a.n + a.nOther));
}

/** The residues of `piece` that touch `partner` more closely than `tight` (the "footprint" of the partner on this piece), as residue objects. */
export function interfaceResidues(piece, partner, { tight = 6.5, tightNucleic = 8.5 } = {}) {
  const found = [];
  piece.residues.forEach((r, i) => {
    const near = piece.near[i];
    if (near && near.pj === partner.index && near.d < (r.nucleic ? tightNucleic : tight)) found.push(r);
  });
  return found;
}

/**
 * A plausible assembly order: the preset's keywords if given (`match(piece, keyword)` decides), otherwise greedy — the biggest piece first, then
 * always the piece with the largest interface to what is already built. `estimated` is true for the greedy order: say so in the UI.
 */
export function assemblyOrder(model, { keywords, match } = {}) {
  const { pieces } = model;
  if (!pieces.length) return { order: [], estimated: true };
  if (Array.isArray(keywords) && keywords.length && match) {
    const rank = (piece) => { const i = keywords.findIndex((k) => match(piece, k)); return i < 0 ? keywords.length : i; };
    return { order: pieces.slice().sort((a, b) => rank(a) - rank(b) || b.residues.length - a.residues.length), estimated: false };
  }
  const done = new Set([pieces[0]]), order = [pieces[0]];
  while (order.length < pieces.length) {
    let best = null, bestValue = -1;
    for (const piece of pieces) {
      if (done.has(piece)) continue;
      let value = 0;
      for (const built of done) value += (piece.partners.get(built.index)?.n ?? 0) + (built.partners.get(piece.index)?.n ?? 0);
      value = value * 1e6 + piece.residues.length;
      if (value > bestValue) { bestValue = value; best = piece; }
    }
    done.add(best);
    order.push(best);
  }
  return { order, estimated: true };
}

/**
 * Where a piece sits when pulled apart, as an offset in Å (the identity at explode = 0, pull = 0, so restoring is exact).
 * `explode` 0..1 moves every piece away from the complex centre; `pull` 0..1 pulls one piece out further on its own.
 */
export function pieceOffset(model, piece, explode, pull = 0) {
  const v = piece.centre.map((value, axis) => value - model.centre[axis]);
  const length = Math.hypot(...v);
  const direction = length > 3 ? v.map((value) => value / length) : [Math.cos(piece.index * 2.4), 0.3, Math.sin(piece.index * 2.4)].map((value, _, a) => value / Math.hypot(...a));
  const along = explode * (24 + 0.6 * piece.radius) + pull * (0.9 * piece.radius + 30);
  return v.map((value, axis) => value * explode * 1.25 + direction[axis] * along + 0);   // + 0: never -0
}
