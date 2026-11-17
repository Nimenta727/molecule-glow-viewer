/* ----------------------------------------------------------------------------- mmCIF / PDB parsing */
const tokenize = (line) => line.match(/'[^']*'|"[^"]*"|\S+/g)?.map(t => (t[0] === "'" || t[0] === '"') ? t.slice(1, -1) : t) || [];

/* read every row of the _atom_site loop -> array of objects (only the columns we need) */
function parseAtomSite(text) {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex(l => l.startsWith('_atom_site.'));
  if (i < 0) return [];
  const cols = [];
  for (; i < lines.length && lines[i].startsWith('_atom_site.'); i++) cols.push(lines[i].trim().slice(11));
  const ix = (n) => cols.indexOf(n);
  const C = { alt: ix('label_alt_id'), g: ix('group_PDB'), el: ix('type_symbol'), an: ix('label_atom_id'), comp: ix('label_comp_id'), asym: ix('label_asym_id'),
    ent: ix('label_entity_id'), seq: ix('label_seq_id'), aseq: ix('auth_seq_id'), x: ix('Cartn_x'), y: ix('Cartn_y'), z: ix('Cartn_z'), m: ix('pdbx_PDB_model_num'),
    ach: ix('auth_asym_id'), ins: ix('pdbx_PDB_ins_code') };
  const tv = (t, k) => { const v = k >= 0 ? t[k] : undefined; return v == null || v === '?' || v === '.' ? '' : v; };
  const rows = []; let model0 = null;
  for (; i < lines.length; i++) {
    const L = lines[i];
    if (L.startsWith('#') || L.startsWith('loop_') || L.startsWith('_')) break;
    if (!L.trim()) continue;
    const t = tokenize(L);
    if (C.m >= 0) { if (model0 === null) model0 = t[C.m]; else if (t[C.m] !== model0) continue; }
    rows.push({ alt: C.alt >= 0 ? t[C.alt] : '.', g: t[C.g], el: (t[C.el] || '').toUpperCase(), an: t[C.an], comp: t[C.comp], asym: t[C.asym], ent: t[C.ent],
      seq: parseInt(t[C.seq]) || 0, poly: (parseInt(t[C.seq]) || 0) > 0, aseq: C.aseq >= 0 ? t[C.aseq] : '', ach: tv(t, C.ach) || t[C.asym], ins: tv(t, C.ins), x: +t[C.x], y: +t[C.y], z: +t[C.z] });
  }
  return rows;
}
function parsePDB(text) {
  const rows = [];
  for (const L of text.split(/\r?\n/)) {
    if (L.startsWith('ENDMDL')) break;
    const rec = L.slice(0, 6).trim();
    if (rec !== 'ATOM' && rec !== 'HETATM') continue;
    const an = L.slice(12, 16).trim(), comp = L.slice(17, 20).trim(), ch = L.slice(21, 22).trim() || 'A';
    let el = L.slice(76, 78).trim().toUpperCase(); if (!el) el = an.replace(/[^A-Z]/gi, '').slice(0, 1).toUpperCase();
    rows.push({ g: rec, el, an, comp, asym: ch, ent: ch, poly: rec === 'HETATM' && an === 'CA' && el === 'C', seq: parseInt(L.slice(22, 26)) || 0, aseq: L.slice(22, 26).trim(), ins: L.slice(26, 27).trim(), ach: ch,
      x: +L.slice(30, 38), y: +L.slice(38, 46), z: +L.slice(46, 54) });
  }
  return rows;
}
/* split atom rows into residue blobs (CA / P) and ligand molecules */
function rowsToEntry(rows, entities) {
  const atoms = [], ligMap = new Map();
  for (const r of rows) {
    if (r.alt && r.alt !== '.' && r.alt !== '?' && r.alt !== 'A') continue;   // alternate locations: keep the first
    if (r.g === 'ATOM') {
      if ((r.an === 'CA' && r.el !== 'CA') || r.an === 'P')
        atoms.push({ p: new THREE.Vector3(r.x, r.y, r.z), ent: r.ent, asym: r.asym, seq: r.seq || parseInt(r.aseq) || 0, na: r.an === 'P', resn: r.comp, aseq: r.aseq, ach: r.ach, ins: r.ins || '' });
    } else if (r.g === 'HETATM' && !IGNORE_LIGANDS.has(r.comp)) {
      if (r.el === 'H' || r.el === 'D') continue;
      if (r.poly) {   // modified residue inside a chain (MSE, M3L, SEP ...): one blob at its CA
        if (r.an === 'CA') atoms.push({ p: new THREE.Vector3(r.x, r.y, r.z), ent: r.ent, asym: r.asym, seq: r.seq, na: false, resn: r.comp, aseq: r.aseq, ach: r.ach, ins: r.ins || '' });
        continue;
      }
      const key = r.asym + '|' + r.comp + '|' + r.aseq;
      if (!ligMap.has(key)) ligMap.set(key, { comp: r.comp, asym: r.asym, ach: r.ach, aseq: r.aseq, atoms: [] });
      ligMap.get(key).atoms.push({ p: new THREE.Vector3(r.x, r.y, r.z), el: r.el, name: r.an });
    }
  }
  if (entities) for (const a of atoms) if (!entities[a.ent]) entities[a.ent] = { name: '实体 ' + a.ent };
  return { atoms, ligands: [...ligMap.values()] };
}

/* secondary structure as DEPOSITED by the authors (mmCIF header: _struct_conf HELX_*, _struct_sheet_range).
   Sets a.ss = 0 coil / 1 helix / 2 strand on every residue; the schematic mode uses it instead of guessing.
   Entries without annotation (cryo-EM models often lack sheets, local files, AlphaFold) fall back to assignSS(). */
function applyDepositedSS(atoms, text) {
  if (!text) return false;
  const ranges = [];
  for (const r of parseLoop(text, '_struct_conf')) if (/^HELX/.test(r.conf_type_id || '')) ranges.push([r.beg_label_asym_id, +r.beg_label_seq_id, +r.end_label_seq_id, 1]);
  for (const r of parseLoop(text, '_struct_sheet_range')) ranges.push([r.beg_label_asym_id, +r.beg_label_seq_id, +r.end_label_seq_id, 2]);
  if (!ranges.length) return false;
  const hasSheet = ranges.some(r => r[3] === 2);
  const by = new Map(); for (const g of ranges) { if (!by.has(g[0])) by.set(g[0], []); by.get(g[0]).push(g); }
  for (const a of atoms) {
    if (a.na) continue;
    a.ss = 0; a.ssK = hasSheet ? 2 : 1;   // ssK 1 = helices deposited but no sheet records -> strands still guessed
    for (const [, b, e, c] of by.get(a.asym) || []) if (a.seq >= b && a.seq <= e) { a.ss = c; break; }
  }
  return true;
}
