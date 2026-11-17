/* ----------------------------------------------------------------------------- RCSB download */
async function fetchMeta(id) {
  const q = `{ entry(entry_id:"${id}"){ struct{title} exptl{method} rcsb_entry_info{resolution_combined} rcsb_primary_citation{pdbx_database_id_DOI year journal_abbrev rcsb_authors}
    polymer_entities{ rcsb_entity_source_organism{scientific_name} rcsb_polymer_entity{pdbx_description} rcsb_polymer_entity_container_identifiers{entity_id asym_ids} entity_poly{type} }
    nonpolymer_entities{ nonpolymer_comp{chem_comp{id name}} rcsb_nonpolymer_entity_container_identifiers{entity_id asym_ids} }
    assemblies{ rcsb_assembly_container_identifiers{assembly_id} pdbx_struct_assembly_gen{asym_id_list oper_expression}
      pdbx_struct_oper_list{id matrix_1_1 matrix_1_2 matrix_1_3 matrix_2_1 matrix_2_2 matrix_2_3 matrix_3_1 matrix_3_2 matrix_3_3 vector_1 vector_2 vector_3} } } }`;
  const t = await fetchText('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
  const j = JSON.parse(t);
  if (!j.data || !j.data.entry) throw new Error(`找不到 PDB 条目 ${id}`);
  return j.data.entry;
}
/* assembly 1 by its id: the GraphQL list order is not stable (4V6F came back as 2,1 or 1,2 -> different scenes on different runs) */
const asmOne = (meta) => meta.assemblies && (meta.assemblies.find(x => x.rcsb_assembly_container_identifiers?.assembly_id === '1') || meta.assemblies[0]);
function parseOperExpr(expr) {
  const groups = expr.includes('(') ? expr.match(/\(([^)]+)\)/g).map(g => g.slice(1, -1)) : [expr];
  const expand = (g) => g.split(',').flatMap(p => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) { const a = []; for (let k = +m[1]; k <= +m[2]; k++) a.push(String(k)); return a; }
    return [p.trim()];
  });
  let combos = [[]];
  for (const g of groups) { const ids = expand(g); combos = combos.flatMap(c => ids.map(id => [...c, id])); }
  return combos;
}
const operMatrix = (o) => new THREE.Matrix4().set(o.matrix_1_1, o.matrix_1_2, o.matrix_1_3, o.vector_1, o.matrix_2_1, o.matrix_2_2, o.matrix_2_3, o.vector_2,
  o.matrix_3_1, o.matrix_3_2, o.matrix_3_3, o.vector_3, 0, 0, 0, 1);

/* Load one PDB entry -> {id, title, entities, atoms (residue blobs), ligands (molecules)} */
async function loadEntry(id, useAssembly, withLigands = true) {
  const lid = id.toLowerCase();
  status(`下载 ${id} …`, true);
  const ms = (q) => `https://models.rcsb.org/v1/${lid}/atoms?${q}&encoding=cif&copy_all_categories=false`;
  const meta = await fetchMeta(id.toUpperCase());
  /* at most 24 ligand types per entry; the scene's functional cofactors first, unticked pigments / lipids last */
  const prio = (n) => { const c = n.nonpolymer_comp.chem_comp.id; return current?.coreLigands?.includes(c) ? 0 : (current?.ligOff?.includes(c) || LIPIDS.has(c)) ? 2 : 1; };
  const ligEnts = withLigands ? (meta.nonpolymer_entities || []).filter(n => !IGNORE_LIGANDS.has(n.nonpolymer_comp.chem_comp.id)).sort((x, y) => prio(x) - prio(y)) : [];
  const header = fetchText(`https://files.rcsb.org/header/${id.toUpperCase()}.cif`).catch(() => '');   // struct_conf / struct_sheet_range
  const texts = await Promise.all([
    fetchText(ms('label_atom_id=CA')), fetchText(ms('label_atom_id=P')).catch(() => ''),
    ...ligEnts.slice(0, 24).map(n => fetchText(ms('label_entity_id=' + n.rcsb_nonpolymer_entity_container_identifiers.entity_id)).catch(() => '')),
  ]);
  const entities = {};
  for (const e of meta.polymer_entities || []) {
    const ci = e.rcsb_polymer_entity_container_identifiers;
    entities[ci.entity_id] = { name: e.rcsb_polymer_entity.pdbx_description || ('entity ' + ci.entity_id), type: e.entity_poly?.type || '' };
  }
  const rows = texts.flatMap(t => t ? parseAtomSite(t) : []).filter(r => r.g === 'ATOM' || r.poly ? (r.an === 'CA' && r.el !== 'CA') || r.an === 'P' : true);
  let { atoms, ligands } = rowsToEntry(rows, entities);
  for (const L of ligands) { L.src = lid; L.asym0 = L.asym; }   // for the full-atom binding-site download (focus)
  for (const a of atoms) a.src = lid;   // for the full-atom subunit-interface download (take-apart mode)
  applyDepositedSS(atoms, await header);
  /* assembly 1 by its id: the GraphQL list order is not stable (4V6F came back as 2,1 or 1,2 -> different scenes on different runs) */
  const asm = asmOne(meta);
  if (useAssembly && asm && asm.pdbx_struct_assembly_gen) {
    const opers = {}; for (const o of asm.pdbx_struct_oper_list) opers[o.id] = operMatrix(o);
    const outA = [], outL = [];
    for (const g of asm.pdbx_struct_assembly_gen) {
      const asyms = new Set(g.asym_id_list), combos = parseOperExpr(g.oper_expression), ident = combos.length === 1;
      combos.forEach((combo, ci) => {
        const M = new THREE.Matrix4(); for (const oid of combo) M.multiply(opers[oid] || new THREE.Matrix4());
        const tf = (p) => ident ? p.clone() : p.clone().applyMatrix4(M), suf = ident ? '' : '_' + ci;
        for (const a of atoms) if (asyms.has(a.asym)) outA.push({ ...a, p: tf(a.p), asym: a.asym + suf });
        for (const L of ligands) if (asyms.has(L.asym)) outL.push({ ...L, asym: L.asym + suf, atoms: L.atoms.map(x => ({ ...x, p: tf(x.p) })) });
      });
    }
    if (outA.length) { atoms = outA; ligands = outL; }
  }
  const names = {}; for (const n of meta.nonpolymer_entities || []) names[n.nonpolymer_comp.chem_comp.id] = n.nonpolymer_comp.chem_comp.name;
  for (const L of ligands) L.fullName = names[L.comp] || L.comp;
  /* provenance (method, resolution, organism, citation) for the 来源 panel */
  const cit = meta.rcsb_primary_citation, orgs = [...new Set((meta.polymer_entities || []).flatMap(e => (e.rcsb_entity_source_organism || []).map(o => o.scientific_name)).filter(Boolean))];
  const prov = { id: id.toUpperCase(), method: (meta.exptl || []).map(x => x.method).join(' + ') || null, resolution: meta.rcsb_entry_info?.resolution_combined?.[0] ?? null,
    organisms: orgs.slice(0, 4), doi: cit?.pdbx_database_id_DOI || null, citation: cit ? `${(cit.rcsb_authors || [])[0] || ''}${(cit.rcsb_authors || []).length > 1 ? ' 等' : ''} (${cit.year || '?'}) ${cit.journal_abbrev || ''}`.trim() : null };
  return { id: id.toUpperCase(), title: meta.struct?.title || '', entities, atoms, ligands, prov };
}

/* local file (.cif / .pdb) -> same shape as loadEntry */
function entryFromFile(name, text) {
  const isCif = /_atom_site\./.test(text);
  const rows = isCif ? parseAtomSite(text) : parsePDB(text);
  const entities = {};
  if (isCif) {   // entity names from the _entity loop when present
    const lines = text.split(/\r?\n/); let i = lines.findIndex(l => l.startsWith('_entity.')); const cols = [];
    for (; i >= 0 && i < lines.length && lines[i].startsWith('_entity.'); i++) cols.push(lines[i].trim().slice(8));
    const iid = cols.indexOf('id'), idesc = cols.indexOf('pdbx_description');
    if (iid >= 0 && idesc >= 0 && cols.length > 1) for (; i < lines.length && !lines[i].startsWith('#'); i++) { const t = tokenize(lines[i]); if (t.length >= cols.length) entities[t[iid]] = { name: t[idesc] }; }
  } else for (const r of rows) entities[r.ent] = { name: '链 ' + r.ent };
  const { atoms, ligands } = rowsToEntry(rows, entities);
  for (const L of ligands) L.fullName = L.comp;
  return { id: name.replace(/\.[^.]+$/, ''), title: '本地文件 ' + name, entities, atoms, ligands };
}

/* generic mmCIF category reader (loop_ or key-value form) -> array of {column: value} */
function parseLoop(text, prefix) {
  const lines = text.split(/\r?\n/), out = [];
  let i = lines.findIndex(l => l.startsWith(prefix + '.'));
  if (i < 0) return out;
  if (!(i > 0 && lines[i - 1].trim() === 'loop_')) {
    const o = {}; for (; i < lines.length && lines[i].startsWith(prefix + '.'); i++) { const t = tokenize(lines[i]); o[t[0].slice(prefix.length + 1)] = t[1]; }
    return [o];
  }
  const cols = []; for (; i < lines.length && lines[i].startsWith(prefix + '.'); i++) cols.push(lines[i].trim().slice(prefix.length + 1));
  let buf = [];
  for (; i < lines.length; i++) {
    const L = lines[i]; if (L.startsWith('#') || L.startsWith('loop_') || L.startsWith('_')) break;
    buf.push(...tokenize(L));
    while (buf.length >= cols.length) { const o = {}; cols.forEach((c, k) => o[c] = buf[k]); out.push(o); buf = buf.slice(cols.length); }
  }
  return out;
}
/* small-molecule template from the RCSB Chemical Component Dictionary: ideal coordinates + ATOM NAMES + bonds.
   Atom names let us fit the template exactly onto a ligand in a crystal structure (fitPose). Falls back to the ideal SDF. */
const templates = {};
async function getTemplate(comp) {
  if (templates[comp]) return templates[comp];
  let atoms = [], bonds = [];
  try {
    const t = await fetchText(`https://files.rcsb.org/ligands/view/${comp}.cif`);
    const num = (v, w) => (v && v !== '?' && v !== '.') ? +v : +w;
    atoms = parseLoop(t, '_chem_comp_atom').filter(r => (r.type_symbol || '').toUpperCase() !== 'H').map(r => ({ name: r.atom_id, el: r.type_symbol.toUpperCase(),
      p: new THREE.Vector3(num(r.pdbx_model_Cartn_x_ideal, r.model_Cartn_x), num(r.pdbx_model_Cartn_y_ideal, r.model_Cartn_y), num(r.pdbx_model_Cartn_z_ideal, r.model_Cartn_z)) }));
    if (!atoms.length || atoms.some(a => !isFinite(a.p.x))) throw new Error('no ideal coordinates');
    const idx = new Map(atoms.map((a, i) => [a.name, i])), ord = { SING: 1, DOUB: 2, TRIP: 3, AROM: 1 };
    bonds = parseLoop(t, '_chem_comp_bond').filter(b => idx.has(b.atom_id_1) && idx.has(b.atom_id_2)).map(b => [idx.get(b.atom_id_1), idx.get(b.atom_id_2), b.pdbx_aromatic_flag === 'Y' ? 4 : ord[b.value_order] || 1]);
  } catch (e) {
    /* a superseded scene cancelled the download: no fallback. The SDF has no atom names, and caching it here would break
       every later pose fit by name (ATP synthase: "核苷酸原子名匹配失败" after switching scenes during a load). */
    if (e?.name === 'AbortError') throw e;
    console.warn('CCD cif failed, using SDF', comp, e);
    const t = await fetchText(`https://files.rcsb.org/ligands/view/${comp}_ideal.sdf`);
    const L = t.split(/\r?\n/), na = parseInt(L[3].slice(0, 3)), nb = parseInt(L[3].slice(3, 6)), all = [];
    for (let i = 0; i < na; i++) { const r = L[4 + i]; all.push({ p: new THREE.Vector3(+r.slice(0, 10), +r.slice(10, 20), +r.slice(20, 30)), el: r.slice(31, 34).trim().toUpperCase(), name: '' }); }
    const keep = all.map(a => a.el !== 'H'), idx = []; let k = 0; for (const f of keep) idx.push(f ? k++ : -1);
    atoms = all.filter((a, i) => keep[i]);
    for (let i = 0; i < nb; i++) { const r = L[4 + na + i]; const a = +r.slice(0, 3) - 1, b = +r.slice(3, 6) - 1, o = +r.slice(6, 9); if (keep[a] && keep[b]) bonds.push([idx[a], idx[b], o]); }
  }
  const c = new THREE.Vector3(); atoms.forEach(a => c.add(a.p)); c.multiplyScalar(1 / atoms.length); atoms.forEach(a => a.p.sub(c));
  const byName = Object.fromEntries(atoms.map(a => [a.name, a.p]));
  return (templates[comp] = { comp, atoms, bonds, byName });
}
/* rigid pose {q, t} that puts template atoms onto same-named target atoms: world = q * p + t (null if < 3 names match) */
function fitPose(tpl, target) {
  const m = new Map(target.map(x => [x.name, x.p])), A = [], B = [];
  for (const a of tpl.atoms) if (a.name && m.has(a.name)) { A.push(m.get(a.name)); B.push(a.p); }
  if (A.length < 3) return null;
  const f = superpose(A, B);
  return { q: f.q.clone(), t: f.ca.clone().sub(f.cb.clone().applyQuaternion(f.q)) };
}

