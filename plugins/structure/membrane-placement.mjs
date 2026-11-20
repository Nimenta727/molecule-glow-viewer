import { jacobi } from '../motion/rotation.mjs';
import { rotateVector } from './alignment.mjs';

/**
 * Where is the membrane? (classic: autoMembrane and hydroSlab in src/sim/processes/auto.js.) From a coarse structure (one point per residue) and what is known about it:
 *   1. transmembrane segments from OPM / PDBTM / MemProtMD (`info.segs`: [{ asym, b, e }], residue ranges per chain): the membrane normal is the principal direction of the segments
 *      (each segment end − start, sign-free, so helices and tilted barrel strands both work); the centre is the median height of their residues;
 *   2. no segments but a membrane annotation (`info.memAnn`): a hydrophobic-belt scan over 600 directions (surface residues only);
 *   3. otherwise (a soluble protein) nothing: the result is null, the structure is left as it is.
 * The side that is the cytoplasm is chosen by UniProt topological domains when available (`info.topo`), else by the positive-inside rule (more Lys / Arg in the loops next to the
 * segments, or just outside each face). The result is a rigid motion (`placement`) that puts the normal on +Y, the centre at y = 0 and the cytoplasm below; `applyPlacement` moves
 * points with it. Pure maths; the arithmetic and its order follow the classic code.
 *
 * atom = { position: [x, y, z], asym, seq, nucleic, resn, entity }.
 */
export const HYDROPHOBIC_RESIDUES = new Set(['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'TYR', 'CYS']);
const CHARGED = new Set(['ASP', 'GLU', 'LYS', 'ARG']);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s], len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));   // three.js normalize(): multiply by 1 / length
const mean = (list) => scale(list.reduce((q, p) => add(q, p), [0, 0, 0]), 1 / list.length);

/** three.js's Quaternion.setFromUnitVectors as [x, y, z, w]. */
function turnTo(from, to) {
  let r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1, x, y, z;
  if (r < Number.EPSILON) { r = 0; if (Math.abs(from[0]) > Math.abs(from[2])) { x = -from[1]; y = from[0]; z = 0; } else { x = 0; y = -from[2]; z = from[1]; } }
  else { x = from[1] * to[2] - from[2] * to[1]; y = from[2] * to[0] - from[0] * to[2]; z = from[0] * to[1] - from[1] * to[0]; }
  const l = Math.sqrt(x * x + y * y + z * z + r * r);
  if (l === 0) return [0, 0, 0, 1];
  const k = 1 / l; return [x * k, y * k, z * k, r * k];
}
const aboutAxis = (axis, angle) => { const h = angle / 2, s = Math.sin(h); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]; };

/** Moves points by a placement (a list of { centre, q } steps: subtract the centre, then rotate), returning new points. */
export function applyPlacement(points, placement) {
  return points.map((p) => placement.reduce((q, { centre, q: rot }) => rotateVector(sub(q, centre), rot), p));
}

/** The hydrophobic belt: the 30 Å slab, over 600 directions, whose surface residues are the most hydrophobic and the least charged. Returns { normal, atoms } or null. */
export function hydrophobicBelt(protein) {
  const cell = 10, grid = new Map(), K = (x, y, z) => x + ',' + y + ',' + z, floor = Math.floor;
  for (const a of protein) { const k = K(floor(a.position[0] / cell), floor(a.position[1] / cell), floor(a.position[2] / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a.position); }
  const d2 = (p, q) => { const x = p[0] - q[0], y = p[1] - q[1], z = p[2] - q[2]; return x * x + y * y + z * z; };
  const surface = protein.filter((a) => {
    let n = 0; const x = floor(a.position[0] / cell), y = floor(a.position[1] / cell), z = floor(a.position[2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const q of grid.get(K(x + dx, y + dy, z + dz)) || []) if (d2(q, a.position) < 100) n++;
    return n < 16;
  });
  if (surface.length < 40) return null;
  const hy = surface.map((a) => HYDROPHOBIC_RESIDUES.has(a.resn)), ch = surface.map((a) => CHARGED.has(a.resn));
  const c = scale(surface.reduce((s, a) => add(s, a.position), [0, 0, 0]), 1 / surface.length), P = surface.map((a) => sub(a.position, c));
  let best = null; const N = 600, pr = new Float32Array(P.length);
  for (let i = 0; i < N; i++) {
    const z = (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * 2.399963, nx = r * Math.cos(ph), nz = r * Math.sin(ph);
    let lo = 1e9, hi = -1e9; for (let k = 0; k < P.length; k++) { const v = P[k][0] * nx + P[k][1] * z + P[k][2] * nz; pr[k] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const nb = Math.ceil((hi - lo) / 2) + 1, H = new Float32Array(nb), C = new Float32Array(nb), T = new Float32Array(nb);
    for (let k = 0; k < P.length; k++) { const b = floor((pr[k] - lo) / 2); T[b]++; if (hy[k]) H[b]++; if (ch[k]) C[b]++; }
    for (let b0 = 0; b0 + 15 <= nb; b0++) {
      let h = 0, cc = 0, t = 0; for (let b = b0; b < b0 + 15; b++) { h += H[b]; cc += C[b]; t += T[b]; }
      if (t < 20) continue; const sc = h - 2 * cc; if (!best || sc > best.sc) best = { sc, n: [nx, z, nz], from: lo + b0 * 2, frac: h / t, h };
    }
  }
  if (!best || best.frac < 0.5 || best.h < 20) return null;
  return { normal: best.n, atoms: surface.filter((a, k) => { const v = P[k][0] * best.n[0] + P[k][1] * best.n[1] + P[k][2] * best.n[2]; return v >= best.from && v <= best.from + 30; }) };
}

/**
 * The membrane placement of a coarse structure. `info` = { segs: [{ asym, b, e }], segSrc, memAnn, topo: [{ entity, b, e, side }] (side −1 cytoplasmic, +1 extracellular) }.
 * Returns null (no membrane found) or { placement, y: 0, half (half thickness, Å), src ('OPM' | 'PDBTM' | 'MemProtMD' | 'scan'), nSeg, krIn, krOut, how ('uniprot' | 'flank' | 'near'),
 * axes ([x, z] of each subunit's transmembrane centre, in the placed frame: candidate pore axes), sideSure }.
 */
export function placeMembrane(atoms, info) {
  const work = atoms.map((a) => ({ ...a, position: [...a.position] })), protein = work.filter((a) => !a.nucleic);
  if (protein.length < 30) return null;
  const move = (centre, q) => { for (const a of work) a.position = rotateVector(sub(a.position, centre), q); placement.push({ centre, q }); }, placement = [];
  let tm = [], dirs = [], src = null; const flank = [];
  if (info?.segs?.length) {
    const byChain = new Map(); for (const a of protein) { if (!byChain.has(a.asym)) byChain.set(a.asym, []); byChain.get(a.asym).push(a); }
    const segsOf = new Map(); for (const s of info.segs) { if (!segsOf.has(s.asym)) segsOf.set(s.asym, []); segsOf.get(s.asym).push(s); }
    for (const [asym, arr] of byChain) for (const s of segsOf.get(asym.split('_')[0]) || []) {
      const r = arr.filter((a) => a.seq >= s.b && a.seq <= s.e).sort((x, y) => x.seq - y.seq); if (r.length < 5) continue;
      tm.push(...r); dirs.push(sub(mean(r.slice(-4).map((a) => a.position)), mean(r.slice(0, 4).map((a) => a.position))));
      for (const a of arr) if ((a.seq > s.e && a.seq <= s.e + 6) || (a.seq < s.b && a.seq >= s.b - 6)) flank.push(a);   // the loops right next to the segment
    }
    if (dirs.length) src = info.segSrc;
  }
  let normal;
  if (dirs.length) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const d of dirs) { const L = len(d); if (L < 1) continue; const u = [d[0] / L, d[1] / L, d[2] / L]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += u[i] * u[j] * L; }
    const { values, vectors } = jacobi(M), k = values.indexOf(Math.max(...values)); normal = unit([vectors[0][k], vectors[1][k], vectors[2][k]]);
  } else if (info?.memAnn) { const h = hydrophobicBelt(protein); if (!h) return null; normal = h.normal; tm = h.atoms; src = 'scan'; }
  else return null;
  if (tm.length < 8) return null;
  const c = scale(tm.reduce((s, a) => add(s, a.position), [0, 0, 0]), 1 / tm.length);
  move(c, turnTo(normal, [0, 1, 0]));
  const ys = tm.map((a) => a.position[1]).sort((a, b) => a - b), med = ys[ys.length >> 1];
  const half = Math.max(12, Math.min(20, (ys[Math.floor(ys.length * 0.9)] - ys[Math.floor(ys.length * 0.1)]) / 2));
  move([0, med, 0], [0, 0, 0, 1]);
  // positive-inside rule: Lys / Arg in the flanking loops, or without segments in the 15 Å just outside each face
  const KR = (a) => a.resn === 'LYS' || a.resn === 'ARG', fl = flank.filter(KR);
  let up, dn, how = fl.length >= 4 ? 'flank' : 'near';
  const tp = info?.topo || [], side = (s) => { let sum = 0, n = 0; for (const a of protein) if (Math.abs(a.position[1]) > 4 && tp.some((t) => t.side === s && t.entity === a.entity && a.seq >= t.b && a.seq <= t.e)) { sum += Math.sign(a.position[1]); n++; } return n ? sum / n : null; };
  const yIn = tp.length ? side(-1) : null, yOut = tp.length ? side(1) : null;
  if (yIn != null || yOut != null) { how = 'uniprot'; const sc = (yIn ?? 0) - (yOut ?? 0); up = sc > 0 ? 1 : 0; dn = sc > 0 ? 0 : 1; if (Math.abs(sc) < 0.3) how = 'flank'; }
  if (how === 'flank' && fl.length >= 4) { up = fl.filter((a) => a.position[1] > 0).length; dn = fl.length - up; }
  else if (how !== 'uniprot') { how = 'near'; const kr = (lo, hi) => protein.filter((a) => KR(a) && a.position[1] > lo && a.position[1] < hi).length; up = kr(half - 2, half + 15); dn = kr(-half - 15, -half + 2); }
  if (up > dn) { move([0, 0, 0], aboutAxis([1, 0, 0], Math.PI)); [up, dn] = [dn, up]; }
  // each subunit's own transmembrane centre in the final frame: candidate pore axes for porins and aquaporins (one pore per subunit)
  const byAsym = new Map(); for (const a of tm) { if (!byAsym.has(a.asym)) byAsym.set(a.asym, []); byAsym.get(a.asym).push(a.position); }
  const axes = []; for (const L of byAsym.values()) if (L.length >= 25) { const x = L.reduce((s, p) => s + p[0], 0) / L.length, z = L.reduce((s, p) => s + p[2], 0) / L.length;
    if (Math.hypot(x, z) > 6 && !axes.some(([u, w]) => Math.hypot(u - x, w - z) < 6)) axes.push([x, z]); }
  return { placement, y: 0, half, src, nSeg: dirs.length, krIn: dn, krOut: up, how, axes, sideSure: how === 'uniprot' || dn >= up * 1.3 + 2 };
}

/** The inverse of applyPlacement: from the placed frame back to the structure's own coordinates (for drawing the membrane planes in the original frame). */
export function undoPlacement(points, placement) {
  return points.map((p) => [...placement].reverse().reduce((q, { centre, q: [x, y, z, w] }) => add(rotateVector(q, [-x, -y, -z, w]), centre), p));
}

const MEMBRANE_SOURCES = ['OPM', 'PDBTM', 'MemProtMD'], ENTRY = /^[0-9][A-Za-z0-9]{3}$/;
export const MEMBRANE_QUERY = (entryId) => {
  if (!ENTRY.test(entryId ?? '')) throw new Error('只有 PDB 条目才能读取膜注释');
  return `{ entry(entry_id:"${entryId.toUpperCase()}"){ polymer_entities{ rcsb_polymer_entity_annotation{type name}
    polymer_entity_instances{ rcsb_polymer_entity_instance_container_identifiers{asym_id}
      rcsb_polymer_instance_feature{type provenance_source feature_positions{beg_seq_id end_seq_id}} } } } }`;
};
/**
 * What the RCSB GraphQL answer says about the membrane (classic fetchAutoInfo): the transmembrane segments per chain from the first of OPM, PDBTM, MemProtMD that has any, and
 * whether the entry carries a membrane annotation (mpstruc / OPM / PDBTM / MemProtMD, or a membrane GO term). Returns { segs, segSrc, memAnn } for placeMembrane, or null.
 */
export function membraneInfoFromRcsb(response) {
  const entry = response?.data?.entry;
  if (!entry) return null;
  const segs = { OPM: [], PDBTM: [], MemProtMD: [] };
  for (const pe of entry.polymer_entities || []) for (const inst of pe.polymer_entity_instances || []) {
    const asym = inst.rcsb_polymer_entity_instance_container_identifiers?.asym_id;
    for (const f of inst.rcsb_polymer_instance_feature || []) if (f.type === 'MEMBRANE_SEGMENT' && segs[f.provenance_source])
      for (const fp of f.feature_positions || []) if (fp.beg_seq_id != null) segs[f.provenance_source].push({ asym, b: fp.beg_seq_id, e: fp.end_seq_id ?? fp.beg_seq_id });
  }
  const segSrc = MEMBRANE_SOURCES.find((s) => segs[s].length) || null;
  const annotations = (entry.polymer_entities || []).flatMap((pe) => pe.rcsb_polymer_entity_annotation || []);
  const memAnn = annotations.some((a) => /^(mpstruc|OPM|PDBTM|MemProtMD)$/.test(a.type) || (a.type === 'GO' && /membrane/i.test(a.name) && !/membrane-(bounded|enclosed)/i.test(a.name)));
  return { segs: segSrc ? segs[segSrc] : [], segSrc, memAnn, topo: [] };
}
/** Reads the membrane annotation of a PDB entry; `fetchJson(url, init)` is injected. */
export async function loadMembraneInfo(entryId, { fetchJson, signal } = {}) {
  return membraneInfoFromRcsb(await fetchJson('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: MEMBRANE_QUERY(entryId) }), signal }));
}
