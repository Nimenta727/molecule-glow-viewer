/* ----------------------------------------------------------------------------- small-molecule focus
   Downloads the FULL-ATOM residues within 5 A of one ligand copy (RCSB ModelServer residueSurroundings), maps them into
   the scene frame (Kabsch on matched CA + ligand atoms), draws them as sticks with residue labels, and computes the
   interactions from the coordinates: H-bonds (N/O-N/O <= 3.5 A), salt bridges (ligand O to Lys NZ / Arg NE,NH / His
   within 4.0 A), metal / ion coordination (to O/N within 2.8 A, K+/Na+ 3.2 A), hydrophobic contacts (C-C <= 4.0 A). */
const METALS = new Set(['MG', 'K', 'NA', 'CA', 'ZN', 'MN', 'FE', 'CO', 'NI', 'CU', 'CD']);
const AA1 = { ALA: 'Ala', ARG: 'Arg', ASN: 'Asn', ASP: 'Asp', CYS: 'Cys', GLN: 'Gln', GLU: 'Glu', GLY: 'Gly', HIS: 'His', ILE: 'Ile', LEU: 'Leu', LYS: 'Lys',
  MET: 'Met', PHE: 'Phe', PRO: 'Pro', SER: 'Ser', THR: 'Thr', TRP: 'Trp', TYR: 'Tyr', VAL: 'Val' };
const ITYPE = { hbond: ['氢键', '#2f9bff'], salt: ['盐桥', '#ff4fa3'], metal: ['金属 / 离子配位', '#a56bff'] };
let focus = null;
function clearFocus(restoreCam = true) {
  if (!focus) return;
  focus.token = null;
  procRoot.remove(focus.obj); world.remove(focus.obj); disposeObj(focus.obj);
  focus.labs.forEach(l => l.el.remove());
  for (const g2 of ligGroups) g2.obj.visible = g2.visible && $('ligOn').checked;
  procRoot.visible = focus.procVis !== false;
  for (const g of groups) g.mesh?.traverse(x => { if (x.userData.focusHidden) { x.visible = true; x.userData.focusHidden = false; }
    const m = x.material; if (m?.userData?.focusSaved) { const f = m.userData.focusSaved; m.transparent = f.t; m.opacity = f.o; m.depthWrite = f.d; m.needsUpdate = true; delete m.userData.focusSaved; } });
  if (restoreCam) focusLigand._cam = null;
  if (focus.cam && restoreCam) flyView(focus.cam[0], focus.cam[1]);   // back to the view before focusing
  focus = null;
}
function dashes(pairs, color, r = 0.16) {   // dashed cylinders between atom pairs
  const segs = [];
  for (const [a, b] of pairs) { const d = b.clone().sub(a), L = d.length(), n = Math.max(2, Math.round(L / 0.55)); for (let i = 0; i < n; i += 2) segs.push([a.clone().addScaledVector(d, i / n), a.clone().addScaledVector(d, Math.min(1, (i + 1) / n))]); }
  const mesh = new THREE.InstancedMesh(CYL, new THREE.MeshBasicMaterial({ color }), Math.max(1, segs.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  segs.forEach(([a, b], i) => { const d = b.clone().sub(a); q.setFromUnitVectors(up, d.clone().normalize()); m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, d.length(), r)); mesh.setMatrixAt(i, m); });
  mesh.count = segs.length; mesh.frustumCulled = false; mesh.renderOrder = 5; return mesh;
}
function domainTurns(g, at, pFrom, pTo, names) {   // rigid rotation of each domain relative to the first, between two coordinate sets
  const doms = names ? names.map(([nm, rs]) => [nm, at.filter(a => rs.some(([u, v]) => a.seq >= u && a.seq <= v))]).filter(d => d[1].length >= 8)
    : domainSplit(at.filter(a => !a.na), pFrom, 150).map(d => d.sort((x, y) => x.seq - y.seq)).sort((x, y) => x[0].seq - y[0].seq).map((d, i, all) => [all.length === 3 ? ['N 端区', '中间区', 'C 端区'][i] : `第 ${i + 1} 区（${d[0].seq}–${d[d.length - 1].seq}）`, d]);
  if (doms.length < 2) return [];
  const ref = doms[0][1], F = superpose(ref.map(pFrom), ref.map(pTo));   // maps 'to' coordinates into the 'from' frame of the reference domain
  return doms.slice(1).map(([nm, d]) => {
    const A = d.map(pFrom), B = d.map(a => F(pTo(a))), f = superpose(A, B);
    const ang = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(f.q.w))));
    const shift = A.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / A.length).distanceTo(B.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / B.length));
    return { name: nm, ref: doms[0][0], ang, shift };
  });
}
async function focusLigand(L, idx = 0, n = 1) {
  clearFocus(false); clearSelection();
  const myReq = focusLigand._req = {};
  if (!L.src) { status('这个小分子没有来源条目，无法下载结合位点'); return; }
  status(`下载 ${L.comp} 结合位点的全原子坐标 …`, true);
  let txt;
  try { txt = await fetchText(`https://models.rcsb.org/v1/${L.src}/residueSurroundings?label_asym_id=${encodeURIComponent(L.asym0)}&label_comp_id=${encodeURIComponent(L.comp)}&radius=5&encoding=cif&copy_all_categories=false`); }
  catch (e) { status('结合位点下载失败：' + e.message); return; }
  const rows = parseAtomSite(txt).filter(r => r.el !== 'H' && r.el !== 'D' && !IGNORE_LIGANDS.has(r.comp) && (!r.alt || r.alt === '.' || r.alt === '?' || r.alt === 'A'));   // first alternate location only
  const V = (r) => new THREE.Vector3(r.x, r.y, r.z);
  /* file frame -> scene frame: match CA of the surrounding residues to scene residues (copy nearest the ligand) + ligand atoms */
  const all = groups.flatMap(g => g.atoms.map(a => ({ a, g }))), Lc = L.centre, posOf = (a) => L.state ? (a.p2 || a.p) : a.p;
  const A = [], B = [];
  for (const r of rows) if (r.g === 'ATOM' && r.an === 'CA') {
    let best = null, bd = 900; for (const { a } of all) { if (a.seq !== r.seq || !(a.asym === r.asym || a.asym.startsWith(r.asym + '_'))) continue; const d = posOf(a).distanceToSquared(Lc); if (d < bd) { bd = d; best = a; } }
    if (best) { A.push(posOf(best)); B.push(V(r)); }
  }
  const self = rows.filter(r => r.asym === L.asym0 && r.comp === L.comp);
  for (const x of L.atoms) { const r = self.find(y => y.an === x.name); if (r) { A.push(x.p); B.push(V(r)); } }
  if (A.length < 3) { status('结合位点坐标无法对齐到场景'); return; }
  const tf = superpose(A, B);
  /* residues and partners */
  const res = new Map(), het = [];
  for (const r of rows) {
    if (r.g === 'ATOM') { const k = r.asym + '|' + r.seq; if (!res.has(k)) res.set(k, { asym: r.asym, seq: r.seq, aseq: r.aseq, comp: r.comp, atoms: [] }); res.get(k).atoms.push({ ...r, p: tf(V(r)), q: V(r) }); }
    else if (!(r.asym === L.asym0 && r.comp === L.comp)) het.push({ ...r, p: tf(V(r)), q: V(r) });
  }
  const lig = self.map(r => ({ ...r, p: tf(V(r)), q: V(r) }));
  const partOf = (asym) => { const hit = all.find(({ a }) => a.asym === asym || a.asym.startsWith(asym + '_')); return hit ? hit.g : null; };
  const nameOf = (rr) => { const g = partOf(rr.asym), nk = g && groups.length > 1 && findKey(current?.notes, g.name); const pre = nk != null && nk !== false && current.notes[nk][0] ? current.notes[nk][0].replace(/\s*[×x]\s*\d+$/, '').replace(/亚基|\s/g, '') + ' ' : '';
    return pre + (AA1[rr.comp] || rr.comp) + (rr.aseq || rr.seq); };
  /* interactions (file coordinates; distances are frame independent) */
  const inter = [], hydro = new Set(), partners = [...lig, ...het.filter(h => METALS.has(h.el) || h.comp === L.comp)];
  const nearO = (x, el, d) => [...lig, ...het].some(y => y !== x && y.el === el && y.q.distanceTo(x.q) < d);
  const isAnionO = (x) => x.el === 'O' && (nearO(x, 'P', 1.75) || [...lig, ...het].some(c => c.el === 'C' && c.q.distanceTo(x.q) < 1.45 && [...lig, ...het].filter(o => o.el === 'O' && o !== x && o.q.distanceTo(c.q) < 1.45).length === 1));
  const isCation = (r) => r.comp === 'LYS' && r.an === 'NZ' || r.comp === 'ARG' && /^(NE|NH1|NH2)$/.test(r.an) || r.comp === 'HIS' && /^(ND1|NE2)$/.test(r.an);
  let clash = 0;   // N/O pairs closer than 2.4 A are not real contacts (alternate conformers / errors in the deposited model)
  for (const la of partners) for (const rr of res.values()) for (const ra of rr.atoms) {
    const d = la.q.distanceTo(ra.q);
    if (d < 2.4 && !METALS.has(la.el) && /^[ON]$/.test(la.el) && /^[ON]$/.test(ra.el)) { clash++; continue; }
    if (METALS.has(la.el) && /^[ON]$/.test(ra.el) && d <= (la.el === 'K' || la.el === 'NA' ? 3.2 : 2.8)) inter.push({ type: 'metal', a: la, b: ra, rr, d });
    else if (isCation(ra) && d <= 4.0 && isAnionO(la)) inter.push({ type: 'salt', a: la, b: ra, rr, d });
    else if (/^[ON]$/.test(la.el) && /^[ON]$/.test(ra.el) && d <= 3.5) inter.push({ type: 'hbond', a: la, b: ra, rr, d });
    else if (la.el === 'C' && ra.el === 'C' && d <= 4.0 && !/^(C|CA)$/.test(ra.an)) hydro.add(rr);
  }
  for (const m of het.filter(h => METALS.has(h.el))) for (const la of lig) if (/^[ON]$/.test(la.el) && la.q.distanceTo(m.q) <= 2.8) inter.push({ type: 'metal', a: m, b: la, rr: null, d: la.q.distanceTo(m.q) });
  { const best = new Map(); for (const i of inter) { const k = i.type + '|' + i.a.an + i.a.asym + '|' + (i.rr ? i.rr.asym + i.rr.seq : i.b.an); const o = best.get(k); if (!o || i.d < o.d) best.set(k, i); }
    inter.length = 0; inter.push(...[...best.values()].sort((x, y) => x.d - y.d)); }
  /* geometry */
  const obj = new THREE.Group(); obj.renderOrder = 5;
  const shown = [...res.values()].filter(rr => inter.some(i => i.rr === rr) || hydro.has(rr));   // only residues that make a contact
  /* bonds (with orders) from the CCD templates of the ligand and of each residue type; peptide bonds between shown neighbours */
  const tplOf = {}; await Promise.all([L.comp, ...new Set(shown.map(rr => rr.comp))].map(async (c) => { try { tplOf[c] = await getTemplate(c); } catch (e) { tplOf[c] = null; } }));
  if (focusLigand._req !== myReq) return;
  const resAtoms = [], resBonds = [];
  for (const rr of shown) {
    const base = resAtoms.length, b = bondsFromTemplate(rr.atoms, tplOf[rr.comp], 'an') || bondsOf(rr.atoms);
    rr.atoms.forEach(x => resAtoms.push({ p: x.p, el: x.el, an: x.an, rr })); for (const [i, j, o] of b) resBonds.push([base + i, base + j, o]);
  }
  resAtoms.forEach((x, i) => { if (x.an !== 'C') return; const n = resAtoms.findIndex(y => y.an === 'N' && y.rr.asym === x.rr.asym && y.rr.seq === x.rr.seq + 1); if (n >= 0 && x.p.distanceTo(resAtoms[n].p) < 1.6) resBonds.push([i, n, 1]); });
  if (resAtoms.length) obj.add(buildMolecules([{ atoms: resAtoms, bonds: resBonds, centre: new THREE.Vector3() }], 1, illustrative() ? '#a9b1c2' : '#c9d0de'));
  const ligC = lig.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, lig.length));
  if (lig.length) obj.add(buildMolecules([{ atoms: lig, bonds: bondsFromTemplate(lig, tplOf[L.comp], 'an') || bondsOf(lig), centre: ligC }], 1, '#ffb300'));
  if (het.length) obj.add(buildMolecules([{ atoms: het.map(x => ({ p: x.p, el: x.el })), centre: ligC }], 1, '#ffb300'));
  for (const t of Object.keys(ITYPE)) { const pr = inter.filter(i => i.type === t).map(i => [i.a.p, i.b.p]); if (pr.length) obj.add(dashes(pr, ITYPE[t][1])); }
  const lg = ligGroups.find(l => l.comp === L.comp && l.state === (L.state || 0));
  for (const g2 of ligGroups) g2.obj.visible = false;   // enlarged display copies would bury the site; the focused one is drawn at true size
  const mats = new Set();
  for (const g of groups) g.mesh?.traverse(x => { if ((x.userData.core || x.userData.outline === true) && x.visible) { x.visible = false; x.userData.focusHidden = true; return; }   // core beads + outlines off: the site is redrawn at full detail
    if (x.isMesh && x.material && !Array.isArray(x.material) && !x.material.userData.focusSaved) mats.add(x.material); });
  for (const m of mats) { m.userData.focusSaved = { t: m.transparent, o: m.opacity, d: m.depthWrite }; m.transparent = true; m.opacity = Math.min(m.opacity, 0.18); m.depthWrite = false; m.needsUpdate = true; }
  world.add(obj);
  /* pocket surface: Gaussian molecular surface of the site residues (no ligand), computed in a Web Worker, coloured by
     residue chemistry, cropped to the region around the ligand -> the shape of the pocket the ligand sits in */
  const token = {};
  {
    const sAt = [...res.values()].flatMap(rr => rr.atoms.map(x => ({ x, rr })));
    const VDW = { C: 1.7, N: 1.55, O: 1.52, S: 1.8 }, CL = Object.keys(RES_CHEM);
    const lc = lig.reduce((t, x) => t.add(x.p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, lig.length));
    const job = { pos: new Float32Array(sAt.flatMap(({ x }) => [x.p.x, x.p.y, x.p.z])), rad: new Float32Array(sAt.map(({ x }) => VDW[x.el] || 1.8)),
      cls: new Uint8Array(sAt.map(({ rr }) => { const k = CL.indexOf(rr.comp); return k < 0 ? 255 : k; })),
      centre: [lc.x, lc.y, lc.z], cut: Math.max(...lig.map(x => x.p.distanceTo(lc)), 3) + 5 };
    runPocketJob(job).then((out) => {
      if (!focus || focus.token !== token || !out.idx.length) return;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(out.pos, 3)); geo.setIndex(new THREE.BufferAttribute(out.idx, 1)); geo.computeVertexNormals();
      const cols = new Float32Array(out.cls.length * 3), cc = new THREE.Color();
      out.cls.forEach((k, i) => { cc.set(k === 255 ? '#d8d1b8' : RES_CHEM[CL[k]]); cols.set([cc.r, cc.g, cc.b], i * 3); });
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55 }));
      mesh.renderOrder = 4; mesh.userData.pocket = true; mesh.visible = !!focusLigand._pocketOn; obj.add(mesh);   // off by default: it hides the ligand; one click shows the pocket shape
      const b = $('pocketBtn'); if (b) { b.disabled = false; b.textContent = '口袋表面：' + (mesh.visible ? '开' : '关'); }
    });
  }
  /* residue labels (only residues that make an interaction, plus the closest others up to 14) */
  const box = $('labels'), labs = [];
  const key = new Set(inter.filter(i => i.rr).map(i => i.rr));
  const near = shown.sort((x, y) => (key.has(y) - key.has(x)) || 0).slice(0, 16);
  for (const rr of near) {
    const sc = rr.atoms.filter(x => !/^(N|CA|C|O)$/.test(x.an)), pts = (sc.length ? sc : rr.atoms).map(x => x.p);
    const el = document.createElement('div'); el.className = 'rlab'; el.textContent = nameOf(rr); box.appendChild(el);
    labs.push({ el, p: pts.reduce((s, x) => s.add(x.clone()), new THREE.Vector3()).multiplyScalar(1 / pts.length) });
  }
  focus = { token, L, idx, n, obj, labs, lg, procVis: procRoot.visible, cam: focusLigand._cam || [camera.position.clone(), controls.target.clone()] }; focusLigand._cam = focus.cam; procRoot.visible = false;   // animated particles would bury the site
  /* camera: centre the ligand, keep the viewing direction */
  world.updateMatrixWorld(); const c = Lc.clone().applyMatrix4(world.matrixWorld), dir = camera.position.clone().sub(controls.target).normalize();
  const r = Math.max(14, ...L.atoms.map(x => x.p.distanceTo(Lc))) + 16;
  flyTo(c, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9, 800);
  /* info card */
  const fmt = (i) => `${i.rr ? nameOf(i.rr) : i.b.comp} ${i.b.an}…${i.a.comp === L.comp ? '' : i.a.comp + ' '}${i.a.an} ${i.d.toFixed(1)} Å`;
  const sec = (t) => { const l = inter.filter(i => i.type === t); return l.length ? `<div class="sec"><span class="k" style="background:${ITYPE[t][1]}"></span><b>${ITYPE[t][0]}（${l.length}）</b>：${l.slice(0, 10).map(fmt).join('；')}${l.length > 10 ? ' …' : ''}</div>` : ''; };
  const hostG = (() => { const cnt = new Map(); for (const rr of res.values()) { const g = partOf(rr.asym); if (g) cnt.set(g, (cnt.get(g) || 0) + rr.atoms.length); } return [...cnt].sort((a, b) => b[1] - a[1]).map(x => x[0]); })();
  let conf = '';
  for (const g of hostG.slice(0, 2)) {   // conformational change of the host part(s), computed from the two coordinate sets
    const asym = [...res.values()].map(rr => rr.asym).find(k => g.atoms.some(a => a.asym === k || a.asym.startsWith(k + '_')));
    const at = g.atoms.filter(a => a.asym === asym || a.asym.startsWith(asym + '_'));
    const names = Array.isArray(current?.domains) ? current.domains : null;
    if (at.some(a => a.p2)) {
      const t = domainTurns(g, at, (a) => a.p, (a) => a.p2 || a.p, names);
      if (t.length) conf += `<div class="sec"><b>构象变化</b>（${(current.states || []).join(' → ')}，由两套坐标计算，相对 ${t[0].ref} 刚体叠合）：${t.map(x => `${x.name} 转动约 ${x.ang.toFixed(0)}°、质心移动 ${x.shift.toFixed(1)} Å`).join('；')}。</div>`;
    } else if (at.some(a => a.alts) && proc?.role) {
      const keys = Object.keys(at.find(a => a.alts).alts), open = keys.find(k => proc.role[k] === 'open'), tight = keys.find(k => proc.role[k] === 'tight');
      if (open && tight) {
        const t = domainTurns(g, at, (a) => a.alts[open] || a.p, (a) => a.alts[tight] || a.p, null);
        if (t.length) conf += `<div class="sec"><b>构象变化</b>（${g.name.includes('beta') ? 'β' : g.name}：开放 βE → 紧密 βTP，由 6ZPO 三条链的坐标计算，按空间聚类分区，相对 ${t[0].ref} 叠合）：${t.map(x => `${x.name} 转动约 ${x.ang.toFixed(0)}°、移动 ${x.shift.toFixed(1)} Å`).join('；')}。这就是 γ 转动时“推开 / 合拢”催化位点的运动。</div>`;
      }
    }
  }
  const note = current?.siteNotes && current.siteNotes[L.comp];
  const hostName = hostG[0] ? (findKey(current?.notes, hostG[0].name) != null ? current.notes[findKey(current.notes, hostG[0].name)][0] : hostG[0].name) : '';
  $('infoT').textContent = `${L.fullName || L.comp} 结合位点${n > 1 ? `（${idx + 1}/${n}）` : ''}`;
  $('infoB').innerHTML = `<div>位于 <b>${hostName}</b>；5 Å 内 ${res.size} 个残基，其中 ${shown.length} 个与它直接接触（画成棍棒；全原子坐标来自 ${L.src.toUpperCase()}）。虚线由坐标计算：</div>`
    + sec('hbond') + sec('salt') + sec('metal')
    + (hydro.size ? `<div class="sec"><b>疏水接触</b>：${[...hydro].slice(0, 10).map(nameOf).join('、')}</div>` : '')
    + (clash ? `<div class="sec" style="color:var(--dim)">另有 ${clash} 对 N/O 原子距离 < 2.4 Å（沉积模型里的交替构象或几何冲突，不是真实接触），未计入。</div>` : '')
    + conf + (note ? `<div class="sec"><b>机制</b>：${note}</div>` : '')
    + `<div class="sec"><button class="fbtn wide" id="pocketBtn" disabled>口袋表面计算中…</button> 半透明表面＝结合口袋的形状（位点残基的分子表面，不含小分子），颜色＝残基化学性质：红 酸性、蓝 碱性、青绿 极性、紫 芳香、黄 含硫、沙色 疏水。</div>`
    + `<div class="sec">画法：<button class="fbtn wide" data-st="ball">球棍</button> <button class="fbtn wide" data-st="valence">价键</button> <button class="fbtn wide" data-st="space">空间填充</button>　价键模型：一根＝单键，两根＝双键，三根＝三键，实线加内侧虚线＝芳香环（键级来自 RCSB 化学组分字典）。</div>`
    + `<div class="sec" style="color:var(--dim)">金色碳＝小分子（真实大小）；灰色碳＝蛋白残基。点 × 或按 Esc 退出聚焦。</div>`;
  $('infoCard').style.display = 'block';
  $('infoB').querySelectorAll('[data-st]').forEach(b => { b.classList.toggle('on', b.dataset.st === ligStyle()); b.onclick = () => { $('ligStyle').value = b.dataset.st; $('ligStyle').onchange(); }; });
  $('pocketBtn').onclick = () => { const m = focus?.obj.children.find(x => x.userData.pocket); if (!m) return; m.visible = focusLigand._pocketOn = !m.visible; $('pocketBtn').textContent = '口袋表面：' + (m.visible ? '开' : '关'); };
  status(`聚焦 ${L.comp}：${inter.length} 个极性相互作用`);
}

