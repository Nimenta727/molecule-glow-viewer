import { bondsByDistance } from '../structure/chemical-component.mjs';

/**
 * The atom-level close-ups of the translating ribosome (classic: `detail`, `buildDetail`, `drawDetail` of src/sim/processes/translation.js). The ribosome is drawn one bead per residue, so the two
 * sites where the chemistry happens are shown with real all-atom coordinates: the decoding centre (every residue within 6 Å of the A-site anticodon: codon, anticodon, A1492 / A1493, G530, protein S12)
 * and the peptidyl transferase centre (every residue within 7 Å of the 3' end of the A-site tRNA: both CCA ends, A2451, U2585, G2583 …). A1492 / A1493 are interpolated between their place in the
 * empty-A-site 30S (1J5E, stacked inside h44) and in 4V6F (flipped out, reading the codon-anticodon minor groove); the codon-anticodon hydrogen bonds are the N / O pairs 2.5-3.35 Å apart in the real atoms.
 * Pure: rows in, parts and bonds out; the Viewer fetches the atoms (RCSB ModelServer) and draws.
 *   rows: [{ p: [x, y, z], el, an (atom name), comp, asym, seq, aseq }]
 */
export const SITE_RADIUS = Object.freeze({ dc: 6, ptc: 7 });
export const KIND_COLOUR = Object.freeze({ A: '#ff7aa8', P: '#c58cff', m: '#ffb347', '16S': '#e9c46a', '23S': '#d4a373', prot: '#8fb3d9' });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const FLIPPERS = new Set([1492, 1493]);

/** Which molecule a residue belongs to: the A-site tRNA, the P-site tRNA, the mRNA, the 16S or 23S rRNA, or a protein. `ids` = { asymA, asymP, asymM }, `nameOf(asym)` the entity description. */
export function kindOf(row, ids, nameOf) {
  if (row.asym === ids.asymA) return 'A'; if (row.asym === ids.asymP) return 'P'; if (row.asym === ids.asymM) return 'm';
  const name = nameOf?.(row.asym) ?? ''; return /16S/i.test(name) ? '16S' : /23S/i.test(name) ? '23S' : 'prot';
}

/** One site: its residues as parts ({ key, kind, label, atoms: [{ p, element, name }], centre, flip? }), the middle of the site, and the hydrogen bonds. `apoRows`: the atoms of A1492 / A1493 in the empty-A-site structure. */
export function buildSite(rows, name, ids, nameOf, apoRows = []) {
  const groups = new Map(); for (const r of rows) { const key = `${r.asym}:${r.seq}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const parts = [];
  for (const [key, rs] of groups) {
    const r0 = rs[0], kind = kindOf(r0, ids, nameOf), aseq = Number(r0.aseq), flip = kind === '16S' && FLIPPERS.has(aseq);
    const atoms = rs.map((r) => ({ p: r.p.slice(), element: r.el, name: r.an, position: r.p.slice() }));
    const label = r0.comp === 'MG' ? 'Mg²⁺' : kind === 'A' ? `A 位 tRNA ${r0.comp}${r0.aseq}` : kind === 'P' ? `P 位 tRNA ${r0.comp}${r0.aseq}` : kind === 'm' ? `mRNA ${r0.comp}${r0.aseq}` : kind === 'prot' ? `${r0.comp}${r0.aseq}` : `${kind} rRNA ${r0.comp}${r0.aseq}`;
    const centre = atoms.reduce((s, a) => a.p.map((v, k) => s[k] + v / atoms.length), [0, 0, 0]);
    const part = { key, kind, label, atoms, centre, colour: KIND_COLOUR[kind], hot: flip || /^(G530|A2451|U2585|G2583)$/.test(`${r0.comp}${r0.aseq}`) };
    if (flip) { const apo = new Map(apoRows.filter((r) => Number(r.aseq) === aseq).map((r) => [r.an, r.p])); part.inPos = atoms.map((a) => apo.get(a.name) ?? a.p); part.outPos = atoms.map((a) => a.p.slice()); part.flip = true; }
    parts.push(part);
  }
  const all = rows.length ? rows.reduce((s, r) => r.p.map((v, k) => s[k] + v / rows.length), [0, 0, 0]) : [0, 0, 0];
  return { name, parts, centre: all, bonds: hydrogenBonds(parts) };
}

/** Codon-anticodon hydrogen bonds (A-site tRNA with the mRNA, 2.5-3.35 Å between N / O atoms) and the minor-groove contacts of the 16S residues (A1492, A1493, G530) with them (2.5-3.3 Å). */
export function hydrogenBonds(parts) {
  const NO = (p) => p.atoms.filter((a) => a.element === 'N' || a.element === 'O'), out = [];
  const pairs = (X, Y, lo, hi, kind) => { for (const x of X) for (const y of Y) for (const a of NO(x)) for (const b of NO(y)) { const d = dist(a.p, b.p); if (d > lo && d < hi) out.push({ a: a.p, b: b.p, kind, x: x.key, y: y.key }); } };
  const A = parts.filter((p) => p.kind === 'A'), M = parts.filter((p) => p.kind === 'm'), R = parts.filter((p) => p.kind === '16S');
  pairs(A, M, 2.5, 3.35, 'wc'); pairs(R, [...A, ...M], 2.5, 3.3, 'mon');
  return out;
}

/** Covalent bonds guessed from distances inside a part (the close-up draws ball and stick; bond orders would need the chemical component dictionary of every nucleotide). */
export const partBonds = (part) => bondsByDistance(part.atoms.map((a) => ({ element: a.element, position: a.p, name: a.name })));

/** The positions of a part's atoms now: a flipping base (A1492, A1493) is between its stacked place (w = 0) and its flipped-out place (w = 1). */
export const partPositions = (part, w) => (part.flip ? part.atoms.map((_, i) => part.inPos[i].map((v, k) => v + (part.outPos[i][k] - v) * ease(w))) : part.atoms.map((a) => a.p));

/**
 * What the close-ups show for a state of the process (the classic drawDetail): is a tRNA reading the A codon, how far A1492 / A1493 have flipped out (1 on a cognate match, 0.35 / 0.5 on a
 * near-cognate one, 0 with the A site empty), which parts are drawn, and the sentence for the corner of the view.
 */
export function closeupState({ st, cognate = true }) {
  const inA = ['cr', 'gtp', 'kir', 'rel', 'acc', 'pre'].includes(st), wTarget = st === 'cr' ? (cognate ? 1 : 0.35) : inA ? (cognate ? 1 : 0.5) : 0;
  const decoding = !inA ? 'A 位空着：A1492 / A1493 收在 h44 里（1J5E）' : cognate ? '同源：三对碱基配对，A1492 / A1493 翻出“咬住”小沟 → 激活 GTP 酶' : '近同源：有一个错配，A1492 / A1493 只翻出一部分，咬合不紧';
  const ptc = st === 'acc' ? 'A 位氨酰末端已摆进 PTC：α-NH₂ 对准 P 位肽酰酯键' : st === 'pre' ? '肽键已形成：肽链转到 A 位 tRNA 上（23S rRNA 是核酶）' : st === 'g' ? 'EF-G 推动移位' : 'P 位肽酰-tRNA 的酯键在 PTC 里等待';
  return { inA, wTarget, showA: { dc: inA, ptc: ['acc', 'pre', 'g'].includes(st) }, decoding, ptc };
}
/** Move the flip weight towards its target at `rate` per second. */
export const stepFlip = (w, target, dt, rate = 1.4) => w + Math.sign(target - w) * Math.min(Math.abs(target - w), dt * rate);
