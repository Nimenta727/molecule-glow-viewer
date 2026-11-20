import { superpose } from '../structure/alignment.mjs';
import { parseMmcif } from '../structure/parser.mjs';
import { kwMatch } from './structure-frame.mjs';

/**
 * Other PDB entries in the frame of a scene (classic: `alignEntry` in src/data/extra-entries.js). Only what is needed is fetched from RCSB's ModelServer: the reference chain's P (RNA) or CA atoms,
 * the requested chains (CA / P, optionally all atoms) and ligands; the entry is superposed onto the scene by the reference chain (for the 70S ribosome: the 23S or 16S rRNA of the same species),
 * residues matched by label sequence number or by author numbering, whichever fits better; pairs further than 6 Å (then 3 Å) after a fit are dropped and the fit repeated (local conformational
 * differences). Only chains of the first biological assembly are used (crystals of the 70S ribosome hold two copies).
 *   fitToReference(refAtoms, rows)   pure: refAtoms [{ p, seq, aseq }] (the scene's), rows [{ p, seq, aseq }] (the entry's) -> { f, rmsd, n, of, key } or null
 *   loadAlignedEntry(id, opts, { fetchJson, fetchText })   the whole thing, with the two fetchers supplied by the caller (fetchJson(query) asks RCSB's GraphQL, fetchText(url) a ModelServer URL)
 */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function fitToReference(refAtoms, rows) {
  const fit = (keyOf) => {
    const m = new Map(refAtoms.map((a) => [keyOf(a), a.p])), A = [], B = [];
    for (const r of rows) { const p = m.get(keyOf(r)); if (p) { A.push(p); B.push(r.p); } }
    if (A.length < 20) return null;
    let f = superpose(A, B), idx = A.map((_, i) => i);
    for (let it = 0; it < 3; it++) {
      const k = idx.filter((i) => dist(f(B[i]), A[i]) < (it ? 3 : 6));
      if (k.length < 20) break;
      idx = k; f = superpose(idx.map((i) => A[i]), idx.map((i) => B[i]));
    }
    const rmsd = Math.sqrt(idx.reduce((s, i) => s + dist(f(B[i]), A[i]) ** 2, 0) / idx.length);
    return { f, rmsd, n: idx.length, of: A.length };
  };
  const fs = fit((a) => String(a.seq)), fa = fit((a) => String(a.aseq || ''));
  if (fs) fs.key = 'seq'; if (fa) fa.key = 'aseq';
  return [fs, fa].filter((x) => x && x.n >= Math.max(20, 0.3 * x.of)).sort((x, y) => x.rmsd - y.rmsd)[0] || [fs, fa].filter(Boolean).sort((x, y) => x.rmsd - y.rmsd)[0] || null;
}

const MODEL_SERVER = (id, q) => `https://models.rcsb.org/v1/${id.toLowerCase()}/atoms?${q}&encoding=cif&copy_all_categories=false`;
const META = (id) => `{ entry(entry_id:"${id}"){ polymer_entities{ rcsb_polymer_entity{pdbx_description} rcsb_polymer_entity_container_identifiers{entity_id asym_ids} } assemblies{ rcsb_assembly_container_identifiers{assembly_id} pdbx_struct_assembly_gen{asym_id_list} } } }`;
const atomsOf = (text) => parseMmcif(text).atoms.filter((a) => a.element !== 'H' && a.element !== 'D' && (!a.altLoc || ['.', '?', 'A'].includes(a.altLoc)));
const rowOf = (a) => ({ p: [...a.position], seq: Number.parseInt(a.labelSeqId, 10), aseq: a.authSeqId, name: a.name, el: a.element, comp: a.residueName, asym: a.labelChainId, group: a.record });

/**
 * opts = { ref: part name of the reference chain in the entry, refAtoms: the scene's atoms of it, refNa (false: CA instead of P), chains: [[name, keyword, full?]...], ligands: [codes], near: { code | all: point } }.
 * Returns { id, rmsd, nFit, key, chains: { name: { asym, atoms: [{ p, seq, aseq, resn, na, asym }], all } }, ligands: { code: { comp, atoms: [{ p, el, name }], centre } }, f, refAsym }.
 */
export async function loadAlignedEntry(id, opts, { fetchJson, fetchText }) {
  const meta = (await fetchJson(META(id.toUpperCase()))).data?.entry;   // fetchJson(query): the GraphQL query text in, the parsed JSON response out
  if (!meta) throw new Error(`找不到 PDB 条目 ${id}`);
  const assembly = (meta.assemblies ?? []).find((x) => x.rcsb_assembly_container_identifiers?.assembly_id === '1') ?? meta.assemblies?.[0];
  const inAssembly = new Set((assembly?.pdbx_struct_assembly_gen ?? []).flatMap((g) => g.asym_id_list ?? [])), ok = (a) => !inAssembly.size || inAssembly.has(a);
  const asymOf = (keyword) => { for (const e of meta.polymer_entities ?? []) if (kwMatch(e.rcsb_polymer_entity.pdbx_description || '', keyword)) { const a = e.rcsb_polymer_entity_container_identifiers.asym_ids.find(ok); if (a) return a; } return null; };
  const refAsym = asymOf(opts.ref); if (!refAsym) throw new Error(`${id}: 找不到参考链 ${opts.ref}`);
  const refRows = atomsOf(await fetchText(MODEL_SERVER(id, `label_asym_id=${refAsym}&label_atom_id=${opts.refNa === false ? 'CA' : 'P'}`))).map(rowOf);
  const best = fitToReference(opts.refAtoms, refRows);
  if (!best) throw new Error(`${id}: 参考链残基对不上`);
  const { f } = best, out = { id, rmsd: best.rmsd, nFit: best.n, nOf: best.of, key: best.key, chains: {}, ligands: {}, f, refAsym };
  for (const [name, keyword, full] of opts.chains ?? []) {
    const asym = asymOf(keyword); if (!asym) continue;
    const rows = atomsOf(await fetchText(MODEL_SERVER(id, `label_asym_id=${asym}`))).map(rowOf);
    out.chains[name] = { asym, atoms: rows.filter((r) => r.group === 'ATOM' && ((r.name === 'CA' && r.el !== 'CA') || r.name === 'P')).map((r) => ({ p: f(r.p), seq: r.seq, aseq: r.aseq, resn: r.comp, na: r.name === 'P', asym })), all: full ? rows.map((r) => ({ ...r, p: f(r.p) })) : null };
  }
  for (const comp of opts.ligands ?? []) {
    const rows = atomsOf(await fetchText(MODEL_SERVER(id, `label_comp_id=${comp}`))).map(rowOf), byAsym = new Map();
    for (const r of rows) { if (!byAsym.has(r.asym)) byAsym.set(r.asym, []); byAsym.get(r.asym).push(r); }
    let candidates = [...byAsym.entries()].filter(([a]) => ok(a)); if (!candidates.length) candidates = [...byAsym.entries()];
    const centreOf = (rs) => rs.reduce((s, r) => s.map((v, k) => v + f(r.p)[k] / rs.length), [0, 0, 0]), near = opts.near?.[comp] ?? opts.near?.all;
    if (near) candidates.sort((x, y) => dist(centreOf(x[1]), near) - dist(centreOf(y[1]), near));
    const pick = candidates[0]; if (!pick) continue;
    const atoms = pick[1].map((r) => ({ p: f(r.p), el: r.el, name: r.name }));
    out.ligands[comp] = { comp, atoms, centre: centreOf(pick[1]) };
  }
  return out;
}
