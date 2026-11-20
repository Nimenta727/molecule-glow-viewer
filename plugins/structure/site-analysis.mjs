/**
 * Binding-site and pore analysis (classic: src/ui/ligand-focus.js, src/derived/pocket.js, src/derived/tunnel.js), as pure functions on plain arrays: no rendering, no
 * downloads, no workers. The arithmetic and the order of operations follow the classic code so the same coordinates give the same numbers.
 *
 *   siteInteractions({ ligand, residues, het, ligandComp })   hydrogen bonds, salt bridges, metal / ion coordination and hydrophobic contacts between a ligand and the
 *                                                              residues around it
 *   pocketSurface({ pos, rad, cls, centre, cut })              Gaussian molecular surface of the site residues, cropped around the ligand (surface nets, 0.5 Å grid)
 *   findChannel(points, start, options)                        path of maximal clearance through a coarse structure (pore / exit tunnel), with its radius along the way
 *   alongPath(path, s), pathLength(path)                       a point at arc length s on such a path, and its length
 *
 * Atoms are { el, an (atom name), comp, asym, position: [x, y, z] }; a residue is { asym, seq, comp, atoms }.
 *   siteAround(model, ligand, radius)                          the ligand, the residues within `radius` Å of it and the other hetero atoms, read from a loaded structure
 */
import { selectCoordinateAtoms, isPolymer } from './representation.mjs';
const METALS = new Set(['MG', 'K', 'NA', 'CA', 'ZN', 'MN', 'FE', 'CO', 'NI', 'CU', 'CD']);
export const INTERACTION_TYPES = Object.freeze({ hbond: ['氢键', '#2f9bff'], salt: ['盐桥', '#ff4fa3'], metal: ['金属 / 离子配位', '#a56bff'] });
/** Residue chemistry colours of the pocket surface (classic RES_CHEM): acids red, bases blue, polar teal, sulfur yellow, aromatic violet, Gly/Pro grey; other residues sand. */
export const RESIDUE_CHEMISTRY = Object.freeze({ ASP: '#e5484d', GLU: '#e5484d', LYS: '#3b6fe0', ARG: '#3b6fe0', HIS: '#6f8ff0', SER: '#2fb39c', THR: '#2fb39c', ASN: '#2fb39c', GLN: '#2fb39c',
  CYS: '#e6c84a', MET: '#e6c84a', TYR: '#b58cf0', PHE: '#b58cf0', TRP: '#b58cf0', GLY: '#e8e8e8', PRO: '#e8e8e8' });
export const POCKET_SAND = '#d8d1b8';
const VDW = { C: 1.7, N: 1.55, O: 1.52, S: 1.8 };
/** The classic job for the pocket surface of a site (all atoms of the site residues, no ligand): { pos, rad, cls, centre, cut } ready for pocketSurface; `cls` indexes Object.keys(RESIDUE_CHEMISTRY). */
export function pocketJob({ ligand, residues }) {
  const atoms = residues.flatMap((r) => r.atoms.map((a) => ({ a, r }))), names = Object.keys(RESIDUE_CHEMISTRY), n = Math.max(1, ligand.length);
  const centre = ligand.reduce((s, x) => [s[0] + x.position[0], s[1] + x.position[1], s[2] + x.position[2]], [0, 0, 0]).map((v) => v * (1 / n));
  return { pos: new Float32Array(atoms.flatMap(({ a }) => a.position)), rad: new Float32Array(atoms.map(({ a }) => VDW[a.el] || 1.8)),
    cls: new Uint8Array(atoms.map(({ r }) => { const k = names.indexOf(r.comp); return k < 0 ? 255 : k; })), centre, cut: Math.max(...ligand.map((x) => dist(x.position, centre)), 3) + 5 };
}
const dist = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };
const isON = (el) => el === 'O' || el === 'N';

/**
 * The surroundings of a ligand in a loaded structure (what the classic gets from the RCSB residueSurroundings call, here from the model itself): `ligand` is an entry of
 * selectionSpace(model).ligands. Returns { ligand: atoms, residues: [{ asym, seq, comp, atoms }] (every residue with an atom within `radius` Å of a ligand atom, all of its
 * atoms), het: other hetero atoms within `radius` Å (ions, cofactors, other ligand copies), centre, extent (largest atom distance from the centre) }. Hydrogens are left out.
 */
export function siteAround(model, ligand, radius = 5) {
  const atoms = selectCoordinateAtoms(model).filter(({ atom }) => !['H', 'D'].includes(String(atom.element).trim().toUpperCase()));
  const asymOf = (a) => (a.assemblyCopy ? `${a.labelChainId}_${a.assemblyCopy}` : a.labelChainId);
  const convert = ({ atom, pos }) => ({ el: String(atom.element).trim().toUpperCase(), an: atom.name, comp: String(atom.residueName).toUpperCase(), asym: asymOf(atom), position: pos });
  const same = (a) => asymOf(a) === ligand.asym && String(a.residueName).toUpperCase() === ligand.comp && String(a.authSeqId) === String(ligand.atom.authSeqId) && !isPolymer(a, model.format);
  const mine = atoms.filter(({ atom }) => same(atom)), lig = mine.map(convert);
  const centre = lig.reduce((sum, a) => [sum[0] + a.position[0] / lig.length, sum[1] + a.position[1] / lig.length, sum[2] + a.position[2] / lig.length], [0, 0, 0]);
  const cell = radius, hash = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const a of lig) { const k = key(Math.floor(a.position[0] / cell), Math.floor(a.position[1] / cell), Math.floor(a.position[2] / cell)); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(a); }
  const near = (p) => { const x = Math.floor(p[0] / cell), y = Math.floor(p[1] / cell), z = Math.floor(p[2] / cell);
    for (let i = x - 1; i <= x + 1; i++) for (let j = y - 1; j <= y + 1; j++) for (let k = z - 1; k <= z + 1; k++) for (const a of hash.get(key(i, j, k)) ?? []) if (dist(a.position, p) <= radius) return true; return false; };
  const groups = new Map(), het = [];
  for (const entry of atoms) {
    if (same(entry.atom)) continue;
    const poly = isPolymer(entry.atom, model.format), item = convert(entry);
    if (poly) { const k = `${item.asym}|${entry.atom.authSeqId}|${entry.atom.insertionCode ?? ''}|${item.comp}`; if (!groups.has(k)) groups.set(k, { asym: item.asym, seq: Number.parseInt(entry.atom.authSeqId, 10), comp: item.comp, atoms: [], touches: false }); const g = groups.get(k); g.atoms.push(item); if (!g.touches && near(item.position)) g.touches = true; }
    else if (near(item.position)) het.push(item);
  }
  const residues = [...groups.values()].filter((g) => g.touches).map(({ touches, ...rest }) => rest);
  return { ligand: lig, residues, het, centre, extent: Math.max(0, ...lig.map((a) => dist(a.position, centre))) };
}

/**
 * Interactions from the coordinates: H-bonds (N/O–N/O ≤ 3.5 Å), salt bridges (an anionic ligand O to Lys NZ / Arg NE,NH / His ND1,NE2 within 4.0 Å), metal and ion coordination
 * (to O/N within 2.8 Å, K⁺/Na⁺ 3.2 Å), hydrophobic contacts (C–C ≤ 4.0 Å, side-chain carbons). N/O pairs closer than 2.4 Å are not counted (alternate conformers or
 * errors in the model). `het` are the other hetero atoms of the site (metals, other copies of the ligand); returns the strongest interaction per partner, nearest first.
 */
export function siteInteractions({ ligand, residues, het = [], ligandComp }) {
  const lig = ligand, all = [...lig, ...het], inter = [], hydrophobic = new Set(), partners = [...lig, ...het.filter((h) => METALS.has(h.el) || h.comp === ligandComp)];
  const nearO = (x, el, d) => all.some((y) => y !== x && y.el === el && dist(y.position, x.position) < d);
  const isAnionO = (x) => x.el === 'O' && (nearO(x, 'P', 1.75) || all.some((c) => c.el === 'C' && dist(c.position, x.position) < 1.45 && all.filter((o) => o.el === 'O' && o !== x && dist(o.position, c.position) < 1.45).length === 1));
  const isCation = (r) => (r.comp === 'LYS' && r.an === 'NZ') || (r.comp === 'ARG' && /^(NE|NH1|NH2)$/.test(r.an)) || (r.comp === 'HIS' && /^(ND1|NE2)$/.test(r.an));
  let clashes = 0;
  for (const la of partners) for (const rr of residues) for (const ra of rr.atoms) {
    const d = dist(la.position, ra.position);
    if (d < 2.4 && !METALS.has(la.el) && isON(la.el) && isON(ra.el)) { clashes++; continue; }
    if (METALS.has(la.el) && isON(ra.el) && d <= (la.el === 'K' || la.el === 'NA' ? 3.2 : 2.8)) inter.push({ type: 'metal', a: la, b: ra, residue: rr, distance: d });
    else if (isCation(ra) && d <= 4.0 && isAnionO(la)) inter.push({ type: 'salt', a: la, b: ra, residue: rr, distance: d });
    else if (isON(la.el) && isON(ra.el) && d <= 3.5) inter.push({ type: 'hbond', a: la, b: ra, residue: rr, distance: d });
    else if (la.el === 'C' && ra.el === 'C' && d <= 4.0 && !/^(C|CA)$/.test(ra.an)) hydrophobic.add(rr);
  }
  for (const m of het.filter((h) => METALS.has(h.el))) for (const la of lig) if (isON(la.el) && dist(la.position, m.position) <= 2.8) inter.push({ type: 'metal', a: m, b: la, residue: null, distance: dist(la.position, m.position) });
  const best = new Map();
  for (const i of inter) { const k = `${i.type}|${i.a.an}${i.a.asym}|${i.residue ? i.residue.asym + i.residue.seq : i.b.an}`; const o = best.get(k); if (!o || i.distance < o.distance) best.set(k, i); }
  const interactions = [...best.values()].sort((x, y) => x.distance - y.distance);
  return { interactions, hydrophobic, clashes, shown: residues.filter((rr) => interactions.some((i) => i.residue === rr) || hydrophobic.has(rr)) };
}

/**
 * Gaussian molecular surface (the Mol* / NGL "gaussian surface" idea): each atom adds exp(-2 d² / R²), R = its van der Waals radius; the iso-level exp(-2) puts an
 * isolated atom's surface at its radius. Surface nets on a 0.5 Å grid; quads farther than `cut` from `centre` are dropped. `pos` is a flat xyz array, `rad` one radius
 * per atom, `cls` a class (0–254, 255 = none) per atom, copied to the nearest surface vertex. Returns { pos, idx, cls } typed arrays (empty if the grid would be too big).
 */
export function pocketSurface({ pos, rad, cls, centre, cut }) {
  const n = rad.length, h = 0.5, lvl = Math.exp(-2);
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < n; i++) { const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z; if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z; }
  mnx -= 4; mny -= 4; mnz -= 4; mxx += 4; mxy += 4; mxz += 4;
  const nx = Math.ceil((mxx - mnx) / h) + 1, ny = Math.ceil((mxy - mny) / h) + 1, nz = Math.ceil((mxz - mnz) / h) + 1;
  if (nx * ny * nz > 6e6) return { pos: new Float32Array(0), idx: new Uint32Array(0), cls: new Uint8Array(0) };
  const D = new Float32Array(nx * ny * nz), best = new Float32Array(nx * ny * nz), near = new Int32Array(nx * ny * nz).fill(-1);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let a = 0; a < n; a++) {
    const px = pos[3 * a], py = pos[3 * a + 1], pz = pos[3 * a + 2], R = rad[a], inv = 2 / (R * R), rc = Math.ceil(2 * R / h), cut2 = 4 * R * R;
    const ci = Math.round((px - mnx) / h), cj = Math.round((py - mny) / h), ck = Math.round((pz - mnz) / h);
    for (let k = Math.max(0, ck - rc); k <= Math.min(nz - 1, ck + rc); k++) { const dz = mnz + k * h - pz;
      for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) { const dy = mny + j * h - py;
        for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) { const dx = mnx + i * h - px, r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > cut2) continue; const v = Math.exp(-r2 * inv), q = id(i, j, k); D[q] += v; if (v > best[q]) { best[q] = v; near[q] = a; } } } }
  }
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k), vIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const P = [], C = [], keep = [], cv = new Float32Array(8), cx = centre[0], cy = centre[1], cz = centre[2], cut2 = cut * cut;
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0; for (let c = 0; c < 8; c++) { cv[c] = D[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])] - lvl; if (cv[c] > 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of edges) { if ((cv[a] > 0) === (cv[b] > 0)) continue; const t = cv[a] / (cv[a] - cv[b]);
      sx += corner[a][0] + t * (corner[b][0] - corner[a][0]); sy += corner[a][1] + t * (corner[b][1] - corner[a][1]); sz += corner[a][2] + t * (corner[b][2] - corner[a][2]); m++; }
    const x = mnx + (i + sx / m) * h, y = mny + (j + sy / m) * h, z = mnz + (k + sz / m) * h;
    vIdx[cid(i, j, k)] = P.length / 3; P.push(x, y, z);
    keep.push((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < cut2);
    let nb = -1, bv = -1; for (let c = 0; c < 8; c++) { const q = id(i + corner[c][0], j + corner[c][1], k + corner[c][2]); if (near[q] >= 0 && best[q] > bv) { bv = best[q]; nb = near[q]; } }
    C.push(nb >= 0 ? cls[nb] : 255);
  }
  const I = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0 || !(keep[a] && keep[b] && keep[c] && keep[d])) return; flip ? I.push(a, c, b, a, d, c) : I.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i + 1, j, k)] > lvl; if (a !== b) quad(vIdx[cid(i, j - 1, k - 1)], vIdx[cid(i, j, k - 1)], vIdx[cid(i, j, k)], vIdx[cid(i, j - 1, k)], b); }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i, j + 1, k)] > lvl; if (a !== b) quad(vIdx[cid(i - 1, j, k - 1)], vIdx[cid(i - 1, j, k)], vIdx[cid(i, j, k)], vIdx[cid(i, j, k - 1)], b); }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i, j, k + 1)] > lvl; if (a !== b) quad(vIdx[cid(i - 1, j - 1, k)], vIdx[cid(i, j - 1, k)], vIdx[cid(i, j, k)], vIdx[cid(i - 1, j, k)], b); }
  return { pos: new Float32Array(P), idx: new Uint32Array(I), cls: new Uint8Array(C) };
}

/**
 * Path of maximal clearance through a coarse-grained structure (one point per residue: CA, or P for RNA): clearance(cell) = distance to the nearest residue point
 * (capped at 16 Å); Dijkstra on an h-Å grid, step cost len · (1 + (12 / clearance)⁴); cells with clearance < minClear are walls; `allowed(p)` restricts the search; it
 * stops at the first cell at least minLen from the start whose clearance ≥ openClear (outside, in solvent), or where `goal(p, clearance)` says so. Returns
 * [{ p: [x, y, z], r: clearance }] (smoothed over 7 points), or null when no way out exists.
 */
export function findChannel(points, start, options = {}) {
  const opts = options, h = opts.h || 2, R = opts.radius || 120, minClear = opts.minClear ?? 4.5, openClear = opts.openClear ?? 14, minLen = opts.minLen ?? 60;
  const n = Math.ceil(2 * R / h), N = n * n * n, o = [start[0] - n * h / 2, start[1] - n * h / 2, start[2] - n * h / 2];
  const cell = 8, hash = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
  for (const p of points) { if (dist(p, start) > R * 1.8 + 30) continue; const k = K(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(p); }
  const clear = new Float32Array(N), q = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    q[0] = o[0] + i * h; q[1] = o[1] + j * h; q[2] = o[2] + k * h; let best = 16 * 16;
    const cx = Math.floor(q[0] / cell), cy = Math.floor(q[1] / cell), cz = Math.floor(q[2] / cell);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) { const L = hash.get(K(cx + dx, cy + dy, cz + dz)); if (L) for (const p of L) { const a = p[0] - q[0], b = p[1] - q[1], c = p[2] - q[2], d = a * a + b * b + c * c; if (d < best) best = d; } }
    clear[(i * n + j) * n + k] = Math.sqrt(best);
  }
  const idx = (i, j, k) => (i * n + j) * n + k, s0 = Math.floor(n / 2), si = idx(s0, s0, s0);
  const d2 = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1); d2[si] = 0;
  const heap = [];
  const push = (d, c) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  push(0, si);
  const nb = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) nb.push([dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz) * h]);
  let goal = -1;
  while (heap.length) {
    const [d, c] = pop(); if (d > d2[c]) continue;
    const i = Math.floor(c / (n * n)), j = Math.floor(c / n) % n, k = c % n;
    q[0] = o[0] + i * h; q[1] = o[1] + j * h; q[2] = o[2] + k * h;
    if (opts.goal ? opts.goal(q, clear[c]) : clear[c] >= openClear && dist(q, start) >= minLen) { goal = c; break; }
    for (const [dx, dy, dz, L] of nb) {
      const a = i + dx, b = j + dy, e = k + dz; if (a < 0 || b < 0 || e < 0 || a >= n || b >= n || e >= n) continue;
      const c2 = idx(a, b, e), cl = clear[c2]; if (cl < minClear) continue;
      if (opts.allowed) { q[0] = o[0] + a * h; q[1] = o[1] + b * h; q[2] = o[2] + e * h; if (!opts.allowed(q)) continue; }
      const nd = d + L * (1 + Math.pow(12 / Math.max(cl, 0.5), 4));
      if (nd < d2[c2]) { d2[c2] = nd; prev[c2] = c; push(nd, c2); }
    }
  }
  if (goal < 0) return null;
  const path = []; for (let c = goal; c >= 0; c = prev[c]) { const i = Math.floor(c / (n * n)), j = Math.floor(c / n) % n, k = c % n; path.push({ p: [o[0] + i * h, o[1] + j * h, o[2] + k * h], r: clear[c] }); }
  path.reverse();
  return path.map((x, i) => {
    if (i === 0 || i === path.length - 1) return x;
    const w = path.slice(Math.max(0, i - 3), i + 4), s = [0, 0, 0]; for (const y of w) { s[0] += y.p[0]; s[1] += y.p[1]; s[2] += y.p[2]; }
    const f = 1 / w.length; return { p: [s[0] * f, s[1] * f, s[2] * f], r: x.r };
  });
}

/** The point at arc length `s` along a polyline of { p } or [x, y, z] (before the start: the start; beyond the end it continues straight). */
export function alongPath(path, s) {
  const g = (i) => path[i].p || path[i];
  if (s <= 0) return [...g(0)];
  let acc = 0;
  for (let i = 1; i < path.length; i++) { const a = g(i - 1), b = g(i), L = dist(a, b); if (acc + L >= s) { const t = L ? (s - acc) / L : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; } acc += L; }
  const a = g(path.length - 2), b = g(path.length - 1), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], inv = 1 / (Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1), k = s - acc;   // three.js normalize(): multiply by 1 / length
  return [b[0] + d[0] * inv * k, b[1] + d[1] * inv * k, b[2] + d[2] * inv * k];
}
export const pathLength = (path) => { let s = 0; for (let i = 1; i < path.length; i++) s += dist(path[i].p || path[i], path[i - 1].p || path[i - 1]); return s; };

/**
 * What a channel path says: its length, the narrowest point (radius and place) and the residues lining that point. `path` is findChannel's result, `residues` selectionSpace(model).residues
 * (with `position`); the lining residues are the `count` nearest to the narrowest point.
 */
export function describeChannel(path, residues, { count = 4 } = {}) {
  if (!path?.length) return null;
  let narrow = path[0]; for (const x of path) if (x.r < narrow.r) narrow = x;
  const lining = residues.map((r) => ({ residue: r, distance: dist(r.position, narrow.p) })).sort((a, b) => a.distance - b.distance).slice(0, count);
  return { length: pathLength(path), points: path.length, narrowest: narrow.r, narrowestAt: narrow.p, lining };
}

/**
 * The electron-transfer chain through a set of cofactors (classic: the shortest path through the Fe–S clusters of respiratory complex I, in respiratory-chain.js): the path from the
 * cofactor farthest along `direction` to the one farthest against it that minimises the sum of squared hop lengths, hops at most `maxHop` Å (electron tunnelling is steep in distance, so
 * many short hops beat few long ones). `cofactors`: [{ position: [x, y, z], ...anything }]. Returns the cofactors on the path in order, or the two end cofactors when no path exists,
 * or null with fewer than two cofactors. `from` / `to` ([x, y, z]) pick the start and end cofactors as the nearest to those points. With `direction` [0, 1, 0] the points are the classic's (axis vertical, y from the matrix side down to the membrane).
 */
export function cofactorChain(cofactors, { direction = [0, 1, 0], maxHop = 20, from, to } = {}) {
  if (!cofactors || cofactors.length < 2) return null;
  const along = (c) => c.position[0] * direction[0] + c.position[1] * direction[1] + c.position[2] * direction[2];
  const n = cofactors.length, distance = Array(n).fill(Infinity), previous = Array(n).fill(-1), done = Array(n).fill(false);
  const nearest = (p) => cofactors.indexOf(cofactors.reduce((a, b) => (dist(b.position, p) < dist(a.position, p) ? b : a)));   // from / to: the cofactors nearest these points, instead of the two ends along `direction`
  const s0 = from ? nearest(from) : cofactors.indexOf(cofactors.reduce((a, b) => (along(b) > along(a) ? b : a))), t0 = to ? nearest(to) : cofactors.indexOf(cofactors.reduce((a, b) => (along(b) < along(a) ? b : a)));
  distance[s0] = 0;
  for (;;) {
    let u = -1; for (let i = 0; i < n; i++) if (!done[i] && distance[i] < Infinity && (u < 0 || distance[i] < distance[u])) u = i;
    if (u < 0 || u === t0) break; done[u] = true;
    for (let v = 0; v < n; v++) { const d = dist(cofactors[u].position, cofactors[v].position); if (v !== u && d < maxHop && distance[u] + d * d < distance[v]) { distance[v] = distance[u] + d * d; previous[v] = u; } }
  }
  const chain = []; for (let v = t0; v >= 0; v = previous[v]) chain.unshift(cofactors[v]);
  return chain.length < 2 ? [cofactors[s0], cofactors[t0]] : chain;
}
