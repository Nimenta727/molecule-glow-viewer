/* ---- sequence bar (audit 11): one row per chain (label numbering underneath, author numbers in the tooltips), gaps = residues
   missing from the model (jump in label_seq_id), click / drag selects through glow.select, a selection made elsewhere is highlighted */
let seqCells = [];
function seqChains() {
  const by = new Map(); for (const g of groups) for (const a of g.atoms) { const k = a.asym; if (!by.has(k)) by.set(k, []); by.get(k).push(a); }
  return [...by.entries()].map(([k, A]) => [k, A.sort((x, y) => x.seq - y.seq)]);
}
function renderSeqBar() {
  const box = $('seqRows'); if (!box || $('seqBar').hidden) return;
  const C = seqChains(), MAXC = 16, shown = C.slice(0, MAXC); seqCells = [];
  let h = '';
  for (const [k, A] of shown) {
    const base = A[0]?.ach || k.split('_')[0], nCopies = shown.filter(([k2, A2]) => (A2[0]?.ach || k2.split('_')[0]) === base).length;
    const lab = nCopies > 1 ? `${base}·${k.includes('_') ? k.split('_')[1] : 1}` : base;   /* symmetry copies: A·1, A·2 … */
    h += `<div class="row" data-asym="${esc(k)}"><b title="作者链名 ${esc(base)}（label ${esc(k)}）${nCopies > 1 ? '，对称拷贝 ' + esc(lab) : ''} · ${A.length} 个残基">${esc(lab)}</b>`;
    A.forEach((a, i) => { if (i && a.seq - A[i - 1].seq > 1) { const n = a.seq - A[i - 1].seq - 1; h += `<span class="gap" title="缺失 ${n} 个残基（label_seq ${A[i - 1].seq + 1}–${a.seq - 1}）：结构里没有坐标"></span>`; }
      h += `<span class="r${a.ss === 1 ? ' h' : a.ss === 2 ? ' e' : ''}" data-i="${seqCells.length}" title="${esc(resLabel(a))}（label ${a.seq}）">${a.na ? esc(String(a.resn || '?').slice(-1)) : esc(AA1[a.resn] || 'X')}</span>`;
      seqCells.push(a); });
    h += '</div>';
  }
  if (C.length > MAXC) h += `<div class="muted" style="color:#5a6275">另有 ${C.length - MAXC} 条链没有列出（用 glow.select('chain …') 选择）</div>`;
  box.innerHTML = h; seqHighlight(); markSeqFeatures();
}
function seqHighlight() {
  if (!$('seqRows') || $('seqBar').hidden) return; const on = new Set(glowSel.r || []);
  $('seqRows').querySelectorAll('.r').forEach(el => el.classList.toggle('on', on.has(seqCells[+el.dataset.i])));
}
{ let d0 = null;
  $('seqRows').addEventListener('pointerdown', (e) => { const el = e.target.closest('.r'); d0 = el ? +el.dataset.i : null; });
  $('seqRows').addEventListener('pointerup', async (e) => { const el = e.target.closest('.r'); if (d0 == null || !el) { d0 = null; return; }
    let a = seqCells[d0], b = seqCells[+el.dataset.i]; d0 = null; if (!a || !b || a.asym !== b.asym) b = a; if (b.seq < a.seq) [a, b] = [b, a];
    const ex = `asym ${a.asym} and label_seq ${a.seq}-${b.seq}`;   /* exactly this copy */
    try { const r = await glow.select(ex); $('seqInfo').textContent = `已选 ${r.residues} 个残基：${resLabel(a)}${a !== b ? ' – ' + resLabel(b) : ''}　（glow.select('${ex}')）`; } catch (err) { $('seqInfo').textContent = err.message; } });
  $('seqX').onclick = () => { $('seqBar').hidden = true; };
}
const FT_CAT = { 'Active site': ['活性位点', '#d0342c'], 'Binding site': ['结合位点', '#2a6fdb'], 'Site': ['重要位点', '#8a3fd1'],
  'Transmembrane': ['跨膜段', '#2e9d57'], 'Intramembrane': ['膜内片段', '#5bbf7d'], 'Motif': ['基序', '#c77d00'], 'Disulfide bond': ['二硫键', '#b58900'] };
let seqFt = null;   /* {cat: [{asymBase, from, to, text}]} for the current scene, label_seq numbering */
async function loadSeqFeatures() {
  if (!current?.id || current.local) throw new Error('只有 PDB 条目才能读取 UniProt 注释');
  const id = current.id.toUpperCase();
  const q = `{ entry(entry_id:"${id}"){ polymer_entities{ rcsb_polymer_entity_container_identifiers{entity_id asym_ids}
    rcsb_polymer_entity_align{ reference_database_name reference_database_accession aligned_regions{ entity_beg_seq_id ref_beg_seq_id length } } } } }`;
  const j = JSON.parse(await fetchText('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) }));
  const out = {}, jobs = [];
  for (const pe of j.data?.entry?.polymer_entities || []) {
    const asyms = pe.rcsb_polymer_entity_container_identifiers?.asym_ids || [];
    for (const al of (pe.rcsb_polymer_entity_align || []).filter(a => a.reference_database_name === 'UniProt').slice(0, 1)) jobs.push((async () => {
      const u = JSON.parse(await fetchText(`https://rest.uniprot.org/uniprotkb/${al.reference_database_accession}.json?fields=ft_act_site,ft_binding,ft_site,ft_transmem,ft_intramem,ft_motif,ft_disulfid`));
      const map = (pos) => { for (const r of al.aligned_regions || []) if (pos >= r.ref_beg_seq_id && pos < r.ref_beg_seq_id + r.length) return r.entity_beg_seq_id + pos - r.ref_beg_seq_id; return null; };
      for (const f of u.features || []) { const c = FT_CAT[f.type]; if (!c) continue;
        const a = map(f.location?.start?.value), b = map(f.location?.end?.value ?? f.location?.start?.value); if (a == null || b == null) continue;
        const text = [f.description, f.ligand?.name].filter(Boolean).join(' · ');
        (out[f.type] ||= []).push({ asyms, from: Math.min(a, b), to: f.type === 'Disulfide bond' ? Math.min(a, b) : Math.max(a, b), to2: f.type === 'Disulfide bond' ? Math.max(a, b) : null, text, acc: al.reference_database_accession }); }
    })().catch(e => console.warn('uniprot features', e)));
  }
  await Promise.all(jobs); return out;
}
function markSeqFeatures() {
  if (!seqFt) { $('seqFtChips').innerHTML = ''; return; }
  const inF = (a, f) => f.asyms.includes(a.asym.split('_')[0]) && (a.seq >= f.from && a.seq <= f.to || a.seq === f.to2);
  $('seqRows').querySelectorAll('.r').forEach(el => { const a = seqCells[+el.dataset.i]; let col = null, tip = [];
    for (const [t, L] of Object.entries(seqFt)) for (const f of L) if (inF(a, f)) { col ||= FT_CAT[t][1]; tip.push(FT_CAT[t][0] + (f.text ? '：' + f.text : '')); }
    el.style.boxShadow = col ? `inset 0 3px 0 ${col}` : ''; if (tip.length) el.title = el.title.split('\n')[0] + '\n' + tip.join('\n'); });
  $('seqFtChips').innerHTML = Object.entries(seqFt).map(([t, L]) => `<button class="ftc" data-t="${esc(t)}" style="border-color:${FT_CAT[t][1]};color:${FT_CAT[t][1]}">${FT_CAT[t][0]} ${L.length}</button>`).join(' ') || '<span>这个条目在 UniProt 里没有这些注释</span>';
}
$('seqFt').onclick = async () => { $('seqInfo').textContent = '正在读取 UniProt 注释…';
  try { seqFt = await loadSeqFeatures(); markSeqFeatures(); $('seqInfo').textContent = '点一个类别：在 3D 中选中这些残基（UniProt 注释，按 RCSB 的序列比对换算到结构编号）'; } catch (e) { $('seqInfo').textContent = e.message; } };
$('seqFtChips').onclick = async (e) => { const t = e.target.closest('.ftc')?.dataset.t; if (!t || !seqFt?.[t]) return;
  const parts = seqFt[t].map(f => `(label_asym ${f.asyms.join(',')} and label_seq ${f.from}-${f.to}${f.to2 ? ` or label_asym ${f.asyms.join(',')} and label_seq ${f.to2}` : ''})`);
  try { const r = await glow.select(parts.join(' or ')); $('seqInfo').textContent = `${FT_CAT[t][0]}：${r.residues} 个残基已选中。${[...new Set(seqFt[t].map(f => f.text).filter(Boolean))].slice(0, 3).join('；')}`; } catch (err) { $('seqInfo').textContent = err.message; } };
function toggleSeqBar(on) { $('seqBar').hidden = on == null ? !$('seqBar').hidden : !on; renderSeqBar(); return !$('seqBar').hidden; }
const backStack = [];
/* A9: going back restores the whole state: the scene the same way it was entered (pack -> openPack, so the mode tab follows),
   simulation controls, counters, seed, selection, time scale, pause, camera (no intro flight) */
let pendingRestore = null;
function sceneSource(cfg) {
  if (cfg._packObj) return { pack: cfg._packObj, src: cfg._pack?.src || 'local' };
  if (cfg.name && PRESETS[cfg.name]) return { preset: cfg.name };
  const o = { ...(cfg._orig0 || cfg) }; for (const k of ['_orig0', '_restore', 'linkNote']) delete o[k];
  if (o.structure?.text) delete o.local;   /* rebuilt from the text: the parsed entry was transformed in place */
  return { cfg: o };
}
function sceneState() {
  const mode = document.querySelector('#modeTabs button.on')?.dataset.cat || null;
  return { src: sceneSource(current), camera: cameraNow(), timeScale, seed: randSeed, ctrl: cellSim ? { ...cellSim.ctrl } : null,
    counters: proc ? { ...proc.ctx.counters } : null, sel: glowSel.expr || null, mode, paused: $('pause').checked, title: current?.name || current?.id };
}
async function enterSource(src, restore = null) {
  pendingRestore = restore;
  if (src.pack) return openPack(src.pack, src.src);
  if (src.preset) { $('pdb').value = PRESETS[src.preset].id; return loadScene({ ...PRESETS[src.preset], name: src.preset }); }
  const c = { ...src.cfg }; if (c.structure?.text && !c.local) c.local = entryFromFile(c.structure.name, c.structure.text);
  $('pdb').value = c.id || ''; return loadScene(c);
}
function applyRestore(r) {   /* after the scene is built */
  if (!r) return;
  if (r.counters && proc) Object.assign(proc.ctx.counters, r.counters);
  if (r.timeScale && r.timeScale !== timeScale) setTimeScale(r.timeScale);
  $('pause').checked = !!r.paused;
  if (r.mode) setMode(r.mode);
  if (r.sel) try { GLOW_CMDS.select.fn(r.sel); } catch (e) {}
}
async function openLinked(key, note = null) {
  const name = presetName(key); if (!name || !current) return;
  backStack.push(sceneState()); if (backStack.length > 8) backStack.shift();
  pendingRestore = null; $('pdb').value = PRESETS[name].id; await loadScene({ ...PRESETS[name], name, ...(note ? { linkNote: note } : {}) }); updateBack();
}
async function goBack() {
  const b = backStack.pop(); if (!b) return; updateBack();
  await enterSource(b.src, b); updateBack();
}
function updateBack() { const el = $('backBtn'); if (el) { el.style.display = backStack.length ? '' : 'none'; el.title = backStack.length ? '回到：' + (backStack[backStack.length - 1].title || '') : ''; } }
function selectPart(g, fly = true) {
  if (focus) clearFocus();
  clearSelection(); sel.ids.add('part:' + groups.indexOf(g)); sel.source = 'part'; applySelection(); showSelInfo(g);
  if (fly && g.mesh) { const b = partSphere(g); g.mesh.updateMatrixWorld(); flyTo(g.mesh.localToWorld(b.c.clone()), fitDist(b.r + 10) * 1.05); }
}
function selectResidue(g, a) {
  clearSelection(); sel.ids.add(`residue:${a.asym}:${a.seq}`); sel.source = 'click'; applySelection(); showSelInfo(g, a);
  g.mesh.updateMatrixWorld();
  const cur = camera.position.distanceTo(controls.target);
  flyTo(g.mesh.localToWorld(morphed(a)), Math.min(cur, Math.max(fitDist(38), cur * 0.7)));
}
/* picking: ray against residue spheres (all representations are built from the same residues, so one test serves blobs,
   cartoon, schematic shapes and surfaces; ~150k residues take a few ms). Ghosted scaffold is picked only if nothing else is
   on the ray; residues inside the cut-away wedge are skipped; ligands win over the protein surface around them. */
const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _rc = new THREE.Raycaster(), _pw = new THREE.Vector3(), _pv = new THREE.Vector2();
const inCut = (w) => { const A = U.uCutA.value, B = U.uCutB.value; return A.x * w.x + A.y * w.y + A.z * w.z + A.w > 0 && B.x * w.x + B.y * w.y + B.z * w.z + B.w > 0; };
function pickAt(cx, cy) {
  const rect = renderer.domElement.getBoundingClientRect();
  _rc.setFromCamera(_pv.set((cx - rect.left) / rect.width * 2 - 1, -(cy - rect.top) / rect.height * 2 + 1), camera);
  const mo = U.uMorph.value, R = 3.6, R2 = R * R; let best = null;
  const scan = (P, rad, bias, mw, cutOn, mk) => {   // P: [x,y,z] getter list in the frame of mw
    const o = _ray.origin, d = _ray.direction;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], x = p[0], y = p[1], z = p[2], vx = x - o.x, vy = y - o.y, vz = z - o.z, t = vx * d.x + vy * d.y + vz * d.z;
      if (t <= 0) continue; const q = vx * vx + vy * vy + vz * vz - t * t, rr = rad[i] ?? rad; if (q > rr * rr) continue;
      const th = t - Math.sqrt(rr * rr - q) + bias; if (best && th >= best.t) continue;
      if (cutOn && inCut(_pw.set(x, y, z).applyMatrix4(mw))) continue;
      best = { t: th, ...mk(i) };
    }
  };
  for (const g of groups) {
    if (!g.visible || !g.mesh?.visible || !g.atoms.length) continue;
    g.mesh.updateMatrixWorld(); _ray.copy(_rc.ray).applyMatrix4(_inv.copy(g.mesh.matrixWorld).invert());
    const b = partSphere(g); if (_ray.distanceSqToPoint(b.c) > (b.r + R) ** 2) continue;
    if (!g._pickP || g._pickM !== mo) { g._pickM = mo; g._pickP = g.atoms.map(a => a.p2 && mo ? [a.p.x + (a.p2.x - a.p.x) * mo, a.p.y + (a.p2.y - a.p.y) * mo, a.p.z + (a.p2.z - a.p.z) * mo] : [a.p.x, a.p.y, a.p.z]); }
    scan(g._pickP, R, g.faded ? 30 : 0, g.mesh.matrixWorld, !!g.ghost, (i) => ({ g, a: g.atoms[i] }));
  }
  if ($('ligOn').checked && !focus) for (const lg of ligGroups) {
    if (!lg.visible || !lg.obj.visible) continue;
    const s = +$('ligScale').value, mols = (model?.ligands || []).filter(l => !l.hidden && l.comp === lg.comp && (l.state || 0) === lg.state);
    lg.obj.updateMatrixWorld(); _ray.copy(_rc.ray).applyMatrix4(_inv.copy(lg.obj.matrixWorld).invert());
    for (const L of mols) { const c = L.centre; scan(L.atoms.map(x => [c.x + (x.p.x - c.x) * s, c.y + (x.p.y - c.y) * s, c.z + (x.p.z - c.z) * s]), 1.1 * s, -6, lg.obj.matrixWorld, false, () => ({ lig: L, list: mols })); }
  }
  /* background crowd: one sphere per molecule (its own radius), behind the real structures (bias) */
  for (const C of crowdSets) {
    if (!C.root.visible || !C.root.parent) continue;
    C.root.updateMatrixWorld(); _ray.copy(_rc.ray).applyMatrix4(_inv.copy(C.root.matrixWorld).invert());
    if (!C._P) { C._P = C.bodies.map(b => [b.c0.x, b.c0.y, b.c0.z]); C._R = C.bodies.map(b => C.types[b.i].R * 0.8); }
    scan(C._P, C._R, 25, C.root.matrixWorld, true, (i) => ({ crowd: C.types[C.bodies[i].i], body: C.bodies[i], set: C }));
  }
  return best;
}
let _pd = null, _hovT = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons || performance.now() - _hovT < 90) return; _hovT = performance.now();
  let tip = $('ptip'); const h = model && !kit ? pickParticle(e.clientX, e.clientY) : null;
  if (!h) { if (tip) tip.style.display = 'none'; return; }
  if (!tip) { tip = document.createElement('div'); tip.id = 'ptip'; tip.style.cssText = 'position:fixed;z-index:30;pointer-events:none;background:rgba(255,255,255,.95);color:#1c2233;border:1px solid rgba(0,0,0,.15);border-radius:7px;padding:2px 8px;font-size:12px'; document.body.appendChild(tip); }
  tip.textContent = h.name; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 10 + 'px'; tip.style.display = 'block';
});
renderer.domElement.addEventListener('pointerdown', (e) => { _pd = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = _pd; _pd = null;
  if (!d || !model || focus || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;   // a drag rotates, only a tap selects
  if (kit) { kitSelect(kitPick(e.clientX, e.clientY)); return; }
  const ph = pickParticle(e.clientX, e.clientY);
  if (ph) { clearSelection(); $('infoT').textContent = ph.name; $('infoB').innerHTML = '<div class="sec" style="color:var(--dim)">动画里的粒子：种类按化学计量，数量、路径和速度为示意。</div>'; $('infoCard').style.display = 'block'; return; }
  const hit = pickAt(e.clientX, e.clientY);
  if (!hit) { if (sel.ids.size) { clearSelection(); $('infoCard').style.display = 'none'; } return; }
  if (hit.lig) { clearSelection(); focusLigand(hit.lig, hit.list.indexOf(hit.lig), hit.list.length); return; }
  if (hit.crowd) { showCrowdInfo(hit.crowd, hit.set); return; }
  selectResidue(hit.g, hit.a);
});
/* energy steps -> selection: `energyHL[i]` lists what step i involves: part keys ('subunit beta', '/re/') or
   { part?: key, aseqs: [[from, to], ...] } residue ranges in author (literature) numbering */
let energyFollow = false;
const energyHLList = () => proc?.energyHL || current?.energyHL || null;
function selectSpecs(specs, soft) {
  clearSelection(); if (!specs || !specs.length) return;
  for (const sp of specs) {
    if (typeof sp === 'string') groups.forEach((g, i) => { if (kwMatch(g.name, sp)) sel.ids.add('part:' + i); });
    else groups.forEach(g => { if (sp.part && !kwMatch(g.name, sp.part)) return;
      for (const a of g.atoms) { const n = parseInt(a.aseq) || a.seq; if (sp.aseqs.some(([u, v]) => n >= u && n <= v)) sel.ids.add(`residue:${a.asym}:${a.seq}`); } });
  }
  sel.source = 'step'; sel.soft = !!soft; applySelection();
}
function rebuildLabels() {
  const box = $('labels'); box.innerHTML = ''; labels = []; $('infoCard').style.display = 'none';
  if (!$('labelsOn').checked || !groups.length) return;
  const notes = current?.notes || {}, total = groups.reduce((s, g) => s + g.atoms.length, 0);
  const cands = groups.filter(g => g.visible && g.atoms.length).map(g => ({ g, nk: findKey(notes, g.name) }))
    .filter(x => current?.notes ? x.nk != null : x.g.atoms.length / total > 0.01)   // preset with notes: label only explained parts
    .sort((a, b) => b.g.atoms.length - a.g.atoms.length)
    .filter((x, i, arr) => x.nk == null || x.nk === '' || arr.findIndex(y => y.nk === x.nk) === i)   // one label per explained part type
    .slice(0, 16);
  const all = groups.flatMap(g => g.atoms), mc = all.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, all.length));
  cands.forEach(({ g, nk }, li) => {
    const c = g.atoms.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / g.atoms.length);
    /* point the label away from the molecule's centre; parts sitting on the axis (nucleosome histones) get spread directions */
    let dir = new THREE.Vector3(c.x, 0, c.z); if (dir.length() < 8) dir.copy(c).sub(mc).setY(0);
    if (dir.length() < 4) { const t = li * 2.39996; dir.set(Math.cos(t), 0, Math.sin(t)); } dir.normalize();
    let best = g.atoms[0], bv = -1e9; for (const a of g.atoms) { const v = a.p.clone().sub(c).dot(dir) + 0.25 * (a.p.y - c.y); if (v > bv) { bv = v; best = a; } }
    const note = nk != null ? notes[nk] : null;
    const chains = new Set(g.atoms.map(a => a.asym)).size;
    const nm = note ? note[0] : g.name.length > 34 ? g.name.slice(0, 32) + '…' : g.name;
    const sub = note ? note[1] : `${chains > 1 ? chains + ' 条链 · ' : ''}${g.atoms.length.toLocaleString()} 个残基`;
    const el = document.createElement('div'); el.className = 'lab'; el.innerHTML = `<b></b><i></i>`;
    el.querySelector('b').textContent = nm; el.querySelector('i').textContent = sub;
    el.onclick = () => selectPart(g);
    box.appendChild(el); labels.push({ el, g, anchor: best.p.clone().addScaledVector(dir, 6) });
  });
}
const _lv = new THREE.Vector3();
function updateLabels() {
  if (!labels.length) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const L of labels) {
    if (!L.g.mesh || !L.g.visible) { L.el.style.display = 'none'; continue; }
    L.g.mesh.updateMatrixWorld(); _lv.copy(L.anchor).applyMatrix4(L.g.mesh.matrixWorld).project(camera);
    if (_lv.z > 1 || Math.abs(_lv.x) > 1.1 || Math.abs(_lv.y) > 1.1) { L.el.style.display = 'none'; continue; }
    L.el.style.display = ''; L.sx = (_lv.x + 1) / 2 * w; L.sy = (1 - _lv.y) / 2 * h - 16;
  }
  /* declutter: labels are anchored at their bottom-centre; push overlapping ones upward (greedy, top to bottom) */
  const shown = labels.filter(L => L.el.style.display !== 'none').sort((a, b) => a.sy - b.sy), placed = [];
  for (const id of ['panel', 'title', 'caption', 'infoCard']) {   // UI boxes are obstacles too
    const e = $(id); if (!e || getComputedStyle(e).display === 'none' || id === 'panel' && e.classList.contains('hidden') || !e.textContent.trim()) continue;
    const r = e.getBoundingClientRect(); if (r.width && r.height) placed.push({ x: r.left + r.width / 2, y: r.bottom, w: r.width, h: r.height });
  }
  for (const L of shown) {
    const bw = L.bw ||= L.el.offsetWidth, bh = L.bh ||= L.el.offsetHeight;
    L.sx = THREE.MathUtils.clamp(L.sx, bw / 2 + 8, w - bw / 2 - 8); L.sy = Math.max(L.sy, bh + 8);   // stay on screen
    const free = (y) => !placed.some(o => Math.abs(o.x - L.sx) < (o.w + bw) / 2 + 4 && Math.abs(o.y - y) < (o.h + bh) / 2 + 3);
    // a label may move at most ~1.5 label heights from its part; if there is no room it fades instead of lying about where it points
    let y = null; for (const dy of [0, -bh - 3, bh + 3, -1.6 * bh, 1.6 * bh]) if (free(L.sy + dy)) { y = L.sy + dy; break; }
    if (y === null) { L.el.style.opacity = '0.28'; y = L.sy; } else { L.el.style.opacity = ''; placed.push({ x: L.sx, y, w: bw, h: bh }); }
    L.el.style.left = L.sx + 'px'; L.el.style.top = y + 'px';
  }
}

/* per-chain conformational blending (set by processes via ctx.setChainBlend): blob instances are moved on the CPU,
   cartoon chains use morph-target weights */
const _m4 = new THREE.Matrix4(), _q0 = new THREE.Quaternion(), _v0 = new THREE.Vector3(), _s0 = new THREE.Vector3();
function applyBlends(g) {
  const keys = g.confKeys || [];
  g.mesh.traverse(x => {
    if (x.isInstancedMesh && x.userData.scaleOf) {
      (x.userData.subset || g.atoms.map((_, i) => i)).forEach((ai, i) => {
        const a = g.atoms[ai], b = a.alts && g.blend[a.asym]; if (!b) return;
        _v0.copy(a.alts[b[0]] || a.p).lerp(a.alts[b[1]] || a.p, b[2]);
        x.setMatrixAt(i, _m4.compose(_v0, _q0, _s0.setScalar(x.userData.scaleOf(a))));
      });
      x.instanceMatrix.needsUpdate = true;
    } else if (x.userData.lobe) {
      const b = g.blend[x.userData.asym]; if (!b) return;
      placeLobe(x, x.userData.lobe.map(a => a.alts ? (a.alts[b[0]] || a.p).clone().lerp(a.alts[b[1]] || a.p, b[2]) : a.p));
    } else if (x.userData.surface && !x.userData.schem) {
      const b = g.blend[x.userData.asym]; if (!b) return;
      resurface(g, x, (a) => a.alts ? (a.alts[b[0]] || a.p).clone().lerp(a.alts[b[1]] || a.p, b[2]) : a.p, b[0] + b[1] + Math.round(b[2] * 12));
    } else if (x.userData.cartoon && x.morphTargetInfluences) {
      const b = g.blend[x.userData.asym]; if (!b) return;
      const infl = x.morphTargetInfluences; for (let i = 0; i < keys.length; i++) infl[i] = 0;
      const i0 = keys.indexOf(b[0]), i1 = keys.indexOf(b[1]);
      if (i0 >= 0) infl[i0] += 1 - b[2]; if (i1 >= 0) infl[i1] += b[2];
    }
  });
}

