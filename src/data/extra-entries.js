/* ----------------------------------------------------------------------------- other PDB entries in the scene frame
   alignEntry(id, opts): downloads only what is needed from RCSB ModelServer -- the reference chain's P (RNA) or CA atoms,
   the requested chains (CA / P, optionally all atoms) and ligands -- and superposes them onto the scene by the reference chain
   (e.g. 23S rRNA of the same species), residues matched by label_seq_id (or author numbering if that fits better);
   pairs further than 6 / 3 A after a fit are dropped and the fit repeated (local conformational differences).
   Only chains of the first biological assembly are used (crystals of the 70S ribosome hold two copies). */
const msAtoms = (id, q) => `https://models.rcsb.org/v1/${id.toLowerCase()}/atoms?${q}&encoding=cif&copy_all_categories=false`;
const alignCache = new Map();
async function alignEntry(id, opts) {
  const key = id + '|' + opts.ref + JSON.stringify(opts.chains || []) + JSON.stringify(opts.ligands || []);
  if (alignCache.has(key)) return alignCache.get(key);
  const meta = await fetchMeta(id.toUpperCase());
  const asm = new Set((asmOne(meta)?.pdbx_struct_assembly_gen || []).flatMap(g => g.asym_id_list || []));
  const inAsm = (a) => !asm.size || asm.has(a);
  const asymOf = (kw) => { for (const e of meta.polymer_entities || []) if (kwMatch(e.rcsb_polymer_entity.pdbx_description || '', kw)) { const a = e.rcsb_polymer_entity_container_identifiers.asym_ids.find(inAsm); if (a) return a; } return null; };
  const V = (r) => new THREE.Vector3(r.x, r.y, r.z);
  const refAsym = asymOf(opts.ref); if (!refAsym) throw new Error(`${id}: 找不到参考链 ${opts.ref}`);
  const refRows = parseAtomSite(await fetchText(msAtoms(id, `label_asym_id=${refAsym}&label_atom_id=${opts.refNa === false ? 'CA' : 'P'}`)));
  const fit = (keyOf) => {
    const m = new Map(opts.refAtoms.map(a => [keyOf(a), a.p])), A = [], B = [];
    for (const r of refRows) { const p = m.get(keyOf(r)); if (p) { A.push(p); B.push(V(r)); } }
    if (A.length < 20) return null;
    let f = superpose(A, B), idx = A.map((_, i) => i);
    for (let it = 0; it < 3; it++) { const k = idx.filter(i => f(B[i]).distanceTo(A[i]) < (it ? 3 : 6)); if (k.length < 20) break; idx = k; f = superpose(idx.map(i => A[i]), idx.map(i => B[i])); }
    const rmsd = Math.sqrt(idx.reduce((s, i) => s + f(B[i]).distanceToSquared(A[i]), 0) / idx.length);
    return { f, rmsd, n: idx.length, of: A.length };
  };
  const fs = fit((a) => String(a.seq)), fa = fit((a) => String(a.aseq || '')); if (fs) fs.key = 'seq'; if (fa) fa.key = 'aseq';
  const best = [fs, fa].filter(f => f && f.n >= Math.max(20, 0.3 * f.of)).sort((x, y) => x.rmsd - y.rmsd)[0] || [fs, fa].filter(Boolean).sort((x, y) => x.rmsd - y.rmsd)[0];
  if (!best) throw new Error(`${id}: 参考链残基对不上`);
  const { f } = best;
  const out = { id, rmsd: best.rmsd, nFit: best.n, key: best.key, chains: {}, ligands: {}, f, refAsym };
  for (const [name, kw, full] of opts.chains || []) {
    const asym = asymOf(kw); if (!asym) { console.warn(id, '缺少链', kw); continue; }
    const rows = parseAtomSite(await fetchText(msAtoms(id, `label_asym_id=${asym}`))).filter(r => r.el !== 'H' && (!r.alt || r.alt === '.' || r.alt === 'A'));
    const atoms = rows.filter(r => r.g === 'ATOM' && ((r.an === 'CA' && r.el !== 'CA') || r.an === 'P')).map(r => ({ p: f(V(r)), seq: r.seq, aseq: r.aseq, resn: r.comp, na: r.an === 'P', asym, ent: name }));
    out.chains[name] = { asym, atoms, all: full ? rows.map(r => ({ ...r, p: f(V(r)) })) : null };
  }
  for (const comp of opts.ligands || []) {
    const rows = parseAtomSite(await fetchText(msAtoms(id, `label_comp_id=${comp}`))).filter(r => r.el !== 'H' && r.el !== 'D' && (!r.alt || r.alt === '.' || r.alt === 'A'));
    const by = new Map(); for (const r of rows) { if (!by.has(r.asym)) by.set(r.asym, []); by.get(r.asym).push(r); }
    let cand = [...by.entries()].filter(([a]) => inAsm(a)); if (!cand.length) cand = [...by.entries()];
    const cOf = (rs) => rs.reduce((s, r) => s.add(f(V(r))), new THREE.Vector3()).multiplyScalar(1 / rs.length);
    const near = opts.near?.[comp] || opts.near?.all;   // several copies (secondary sites): take the one closest to this point
    if (near) cand.sort((x, y) => cOf(x[1]).distanceTo(near) - cOf(y[1]).distanceTo(near));
    const pick = cand[0]; if (!pick) { console.warn(id, '缺少小分子', comp); continue; }
    const atoms = pick[1].map(r => ({ p: f(V(r)), el: r.el, name: r.an }));
    out.ligands[comp] = { comp, atoms, centre: atoms.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / atoms.length) };
  }
  console.log(`alignEntry ${id}: ${best.n}/${best.of} 个参考残基，RMSD ${best.rmsd.toFixed(2)} Å`);
  alignCache.set(key, out); return out;
}

