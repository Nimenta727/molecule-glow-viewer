function setTimeScale(v, fromSlider) {
  timeScale = v; document.querySelectorAll('#tscale button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (!fromSlider) { const sp = $('spin'); sp.value = v === 'fast' ? Math.max(+sp.value, 2.2) : Math.min(+sp.value, 0.6); syncOut(sp); }
}
document.querySelectorAll('#tscale button').forEach(b => b.onclick = () => setTimeScale(b.dataset.v));
$('spin').addEventListener('input', () => { const v = +$('spin').value >= 1.5 ? 'fast' : 'slow'; if (v !== timeScale) setTimeScale(v, true); });
$('kitBtn').onclick = () => kit ? exitKit() : enterKit();
$('kitX').onclick = () => exitKit();
$('kitE').oninput = () => kitSetAll(+$('kitE').value);
$('kitAll').onclick = () => kitSetAll(1);
$('kitHome').onclick = () => { kitSetAll(0); for (const pc of kit?.P || []) pc.pullT = 0; if (kit?.sel) kitInfo(); };
$('kitPlay').onclick = () => kitPlay();
$('kitFp').onchange = () => { if (kit) kit.P.forEach(kitColours); };

function makeCtx() {
  const ctx = {
    get theta() { return theta; }, get speed() { return +$('spin').value; },
    get ligands() { return model.ligands; }, get allAtoms() { return model.allAtoms; }, get rowDir() { return model.rowDir; },
    membraneY: [], counters: {},
    atomsOf: (re) => model.allAtoms.filter(a => re.test(a.part)),
    template: getTemplate, makeMol, makeParticle, makeFlash, anim,
    hideLigand: (L) => { L.hidden = true; },
    partGroups: (re) => groups.filter(g => re.test(g.name)),
    /* alternative conformations: process sets a.alts = {key: Vector3} on the residues, then calls this (before meshes are built) */
    setConformations: (g, keys) => { g.confKeys = keys; g.blend = {}; },
    setChainBlend: (g, asym, from, to, w) => { g.blend[asym] = [from, to, w]; },
    get ligScale() { return +$('ligScale').value; },
    pace: () => Math.max(0.3, +$('spin').value / 0.6) * (cellSim ? THREE.MathUtils.clamp(cellSim.flux.rate, 0.5, 1.8) : 1),   // animation tempo follows the simulated flux
    get cell() { return cellSim; },
    markHot: (points, radius = 10) => { for (const a of model.allAtoms) if (points.some(p => a.p.distanceTo(p) < radius + 4)) a.hot = 1; },
  };
  if ($('memOn').checked) { ctx.membraneY.push(+$('mem1').value * model.radius); if ($('mem2On').checked) ctx.membraneY.push(+$('mem2').value * model.radius); }
  return ctx;
}

/* residues within ~8 A of a visible ligand pulse ("结合位点闪光") */
function markHotFromLigands() {
  const cell = 8, grid = new Map();
  const CL = current?.coreLigands;
  for (const L of model.ligands) if (!L.hidden && L.atoms.length < 400 && (!CL || CL.includes(L.comp))) for (const x of L.atoms) {
    const k = `${Math.floor(x.p.x / cell)},${Math.floor(x.p.y / cell)},${Math.floor(x.p.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []); grid.get(k).push(x.p);
  }
  for (const a of model.allAtoms) {
    if (a.hot) continue;
    const gx = Math.floor(a.p.x / cell), gy = Math.floor(a.p.y / cell), gz = Math.floor(a.p.z / cell);
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(`${gx + dx},${gy + dy},${gz + dz}`); if (!arr) continue;
      for (const p of arr) if (a.p.distanceTo(p) < 8) { a.hot = 1; break outer; }
    }
  }
}

