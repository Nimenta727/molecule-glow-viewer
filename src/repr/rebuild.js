/* user colours set through the command API (glow.color): a whole part (g.userColor) or single residues (g.resColors: 'asym:seq' -> Color) */
function colourFn(g, gi) {
  const f = colourFnStyled(g, gi), ov = g.resColors;
  if (g.userColor) { const c = new THREE.Color(g.userColor); return ov?.size ? (a) => ov.get(a.asym + ':' + a.seq) || c : () => c; }
  if (!ov?.size) return f;
  const base = f || (() => new THREE.Color(g.color)); return (a) => ov.get(a.asym + ':' + a.seq) || base(a);
}
function colourFnStyled(g, gi) {
  const f = colourFnRaw(g, gi); if (!f || !illustrative()) return f;
  const hsl = {}; return (a) => { const c = f(a).clone(); c.getHSL(hsl); return c.setHSL(hsl.h, Math.min(hsl.s, 0.66), THREE.MathUtils.clamp(hsl.l, 0.46, 0.64)); };   // muted illustration palette
}
function colourFnRaw(g, gi) {
  const mode = $('colorMode').value, pal = PALETTES[$('palette').value];
  if (mode === 'entity') return null;
  if (mode === 'chain') {
    const ids = [...new Set(g.atoms.map(a => a.asym))];
    const map = new Map(ids.map((id, i) => [id, new THREE.Color(pal[(i + gi) % pal.length])]));
    return (a) => map.get(a.asym);
  }
  const range = new Map();
  for (const a of g.atoms) { const r = range.get(a.asym) || [1e9, -1e9]; r[0] = Math.min(r[0], a.seq); r[1] = Math.max(r[1], a.seq); range.set(a.asym, r); }
  return (a) => { const r = range.get(a.asym); const t = (a.seq - r[0]) / Math.max(1, r[1] - r[0]); return new THREE.Color().setHSL(0.83 - 0.75 * t, 0.8, 0.58); };
}
function disposeObj(o) { o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); }
/* rotor pose: rotate about the world Y axis, or about a vertical axis through g.pivot (x, z) */
function spinPose(g) {
  if (!g.mesh) return; const th = g.spin ? theta : 0; g.mesh.rotation.y = th;
  if (g.pivot) { const c = Math.cos(th), s = Math.sin(th), x = g.pivot.x, z = g.pivot.y; g.mesh.position.x = x - (x * c + z * s); g.mesh.position.z = z - (-x * s + z * c); }
}
const REPS = ['blob', 'cartoon', 'simplified', 'surface', 'hidden'];
function rebuildMeshes() {
  clearSelection();
  const pal = PALETTES[$('palette').value], rep = $('repMode').value;
  groups.forEach((g, i) => {
    if (g.mesh) { world.remove(g.mesh); disposeObj(g.mesh); }
    g.color = ($('palette').value === 'neon' && g.fixed) ? g.fixed : pal[i % pal.length];
    if (!g.fixed && g.atoms[0]?.na) g.color = illustrative() ? '#e3a35a' : '#ffb347';   // nucleic acids in the warm sector (Goodsell convention)
    if (illustrative()) { const c = new THREE.Color(g.color), hsl = {}; c.getHSL(hsl);   // illustration palette: muted, mid-light (PDB-101 / Goodsell), white parts get contrast
      g.color = '#' + c.setHSL(hsl.h, hsl.l > 0.78 ? Math.max(hsl.s, 0.18) : Math.min(hsl.s, 0.66), hsl.l > 0.78 ? 0.62 : THREE.MathUtils.clamp(hsl.l, 0.46, 0.64)).getHexString(); }
    if (g.userColor) g.color = g.userColor;
    /* per-part representation (glow.represent(selection, mode); saved in the pack as scene.reps) */
    const gr = REPS.includes(g.rep) ? g.rep : null;
    if (gr === 'simplified' || gr === 'surface') g.simple = true; else if (gr === 'blob' || gr === 'cartoon') g.simple = false;
    if (g.simple === undefined) g.simple = defaultSimple(g);
    const cf = g._colorOf = colourFn(g, i);
    g.coreIdx = computeCore(g);
    g.faded = g.simple && groups.length > 2 && !g.atoms[0]?.na && !g.spin && !g.confKeys && !g.atoms.some(a => a.p2) && !g.coreIdx.length && !(current?.solid || []).some(k => kwMatch(g.name, k));   // preset `solid`: moving shuttles etc. never ghosted
    const gm = gr === 'blob' || gr === 'cartoon' ? gr : rep;
    g.mesh = g.simple ? (gr !== 'surface' && $('simpStyle').value === 'schem' ? buildSchematic(g, cf) : buildSurfaces(g, cf)) : gm === 'cartoon' ? buildCartoon(g, cf) : buildGroup(g, cf);
    if (gr === 'hidden') g.visible = false;
    if (g.simple && g.coreIdx.length) {   // (1) functional core: atomic blobs on top of the simplified shape
      const pore = !!g.mesh.userData.pore, sets = pore ? [...new Set(g.coreIdx.map(k => g.atoms[k].asym))].map(k => [k, g.coreIdx.filter(j => g.atoms[j].asym === k)]) : [[null, g.coreIdx]];
      for (const [asym, idx] of sets) {   // per chain when a pore subunit can be ghosted
        const sub = { ...g, atoms: idx.map(k => g.atoms[k]) }, mat = blobMaterial({ cutaway: g.ghost }); mat.clippingPlanes = planesFor(g);
        const dm = blobInstances(sub, chemColour, mat, 1.12); dm.userData.subset = idx; dm.userData.core = true; dm.userData.asym = asym;
        if (illustrative()) dm.add(outlineOf(dm, { blob: true, cutaway: g.ghost }));
        g.mesh.add(dm);
      }
    }
    g.mesh.visible = g.visible; spinPose(g);
    world.add(g.mesh);
  });
}
function rebuildLigands() {
  clearFocus();
  for (const lg of ligGroups) { world.remove(lg.obj); disposeObj(lg.obj); }
  const prevVis = new Map(ligGroups.map(l => [l.key, l.visible]));
  ligGroups = [];
  const by = new Map();
  for (const L of model.ligands) if (!L.hidden) { const key = L.comp + '|' + (L.state || 0); if (!by.has(key)) by.set(key, []); by.get(key).push(L); }
  for (const [key, mols] of by) {
    const obj = buildMolecules(mols, +$('ligScale').value);
    world.add(obj);
    const visible = prevVis.get(key) ?? (!LIPIDS.has(mols[0].comp) && !(current?.ligOff || []).includes(mols[0].comp));   // bound lipids / detergents start hidden (tick them in the legend)
    obj.visible = visible && $('ligOn').checked;
    ligGroups.push({ key, comp: mols[0].comp, name: mols[0].fullName, n: mols.length, obj, visible, state: mols[0].state || 0, mols });
  }
  upgradeLigandBonds();
}
function rebuildLigGroupObj(lg) {   // redraw one ligand group in place (new bonds / style), keeping its visibility
  world.remove(lg.obj); disposeObj(lg.obj);
  lg.obj = buildMolecules(lg.mols, +$('ligScale').value); lg.obj.visible = lg.visible && $('ligOn').checked && !focus; world.add(lg.obj);
}
/* distance-guessed bonds -> real bonds with orders from the CCD (by atom name); one template per compound */
async function upgradeLigandBonds() {
  const mine = model;
  for (const lg of ligGroups.slice()) {
    if (lg.mols.every(L => L.bonds || L.atoms.length < 2)) continue;
    let tpl = null; try { tpl = await getTemplate(lg.comp); } catch (e) { continue; }
    if (model !== mine || !ligGroups.includes(lg)) return;
    let changed = false;
    for (const L of lg.mols) if (!L.bonds && L.atoms.length > 1) { const b = bondsFromTemplate(L.atoms, tpl); if (b) { L.bonds = b; changed = true; } }
    if (changed) rebuildLigGroupObj(lg);
  }
}

