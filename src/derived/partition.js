/* ----------------------------------------------------------------------------- functional partition
   (1) functional core = residues whose CA is within 8 A of a bound small molecule / ion (both conformations), plus preset
       `core` specs ({part, seqs:[[a,b]]} or {near:{part, seq}, r, with:[parts]}) -> atomic detail on top of the shape;
   (2) parts that move or change shape -> simplified shapes that still move (rigid domain blobs, ring segments);
   (3) parts with no core and no motion -> simplified and faded (scaffold). */
const LIPIDS = new Set(['CDL', 'PC1', 'PEE', 'LMT', 'PLC', 'POV', 'UNL', 'DMU', 'LDA', '3PE', 'PCW', 'PGT', 'CLR', 'LHG', 'PTY', 'DGA', '8PE', 'PEF', 'PGV', 'SQD', 'LMG', 'DGD', 'BOG', 'DDM', 'UND', 'OLA', 'OLC', 'PLM', 'STE', 'MYR', 'Y01', 'CHD']);
function computeCore(g) {
  const CL = current?.coreLigands, L = (model?.ligands || []).filter(l => CL ? CL.includes(l.comp) : !LIPIDS.has(l.comp) && l.atoms.length <= 120);
  const ions = L.filter(l => l.atoms.length === 1);
  const pts = L.filter(l => l.atoms.length > 1 || ions.length <= 20).flatMap(l => l.atoms.map(x => x.p));
  const set = new Set();
  if (pts.length) g.atoms.forEach((a, i) => { if (!a.na && pts.some(q => a.p.distanceToSquared(q) < 64 || a.p2 && a.p2.distanceToSquared(q) < 64)) set.add(i); });
  for (const c of current?.corePts || []) g.atoms.forEach((a, i) => { if (a.p.distanceToSquared(c.p) < c.r * c.r) set.add(i); });   /* e.g. the residues lining an auto-detected pore */
  for (const c of current?.core || []) {
    if (c.part && c.seqs && kwMatch(g.name, c.part)) g.atoms.forEach((a, i) => { if (c.seqs.some(([u, v]) => a.seq >= u && a.seq <= v)) set.add(i); });
    if (c.near) {
      const host = groups.find(h => kwMatch(h.name, c.near.part)); if (!host) continue;
      const ctr = host.atoms.filter(a => a.seq === c.near.seq).map(a => a.p); if (!ctr.length) continue;
      if (g === host || (c.with || []).some(k => kwMatch(g.name, k))) g.atoms.forEach((a, i) => { if (ctr.some(q => a.p.distanceToSquared(q) < c.r * c.r)) set.add(i); });
    }
  }
  return [...set].sort((x, y) => x - y);
}
/* functional-core residues are coloured by chemistry (journal convention for key residues) */
const RES_CHEM = { ASP: '#e5484d', GLU: '#e5484d', LYS: '#3b6fe0', ARG: '#3b6fe0', HIS: '#6f8ff0', SER: '#2fb39c', THR: '#2fb39c', ASN: '#2fb39c', GLN: '#2fb39c',
  CYS: '#e6c84a', MET: '#e6c84a', TYR: '#b58cf0', PHE: '#b58cf0', TRP: '#b58cf0', GLY: '#e8e8e8', PRO: '#e8e8e8' };
const chemColour = (a) => { const c = new THREE.Color(RES_CHEM[a.resn] || '#d8d1b8'); return illustrative() ? c : c.multiplyScalar(0.62); };   // other hydrophobic: sand; dimmed on black so pale beads don't bloom to white
const FADE_TO = () => new THREE.Color(illustrative() ? '#d6d9e0' : '#1c2030');
/* which parts are simplified by default ("推荐" = functional partition): preset keepDetail parts stay atomic; a scene with
   something to explain (ligands, two states, a process, several parts) is simplified, with atomic functional cores */
function defaultSimple(g) {
  const mode = $('simpDefault').value;
  if (mode === 'all') return true;
  if (mode === 'none') return false;
  if (current?.keepDetail?.some(k => kwMatch(g.name, k))) return false;
  return !!((model?.ligands || []).length || current?.states || current?.process || groups.length >= 2);
}

