/* ----------------------------------------------------------------------------- selection set (iCn3D-style)
   Every way of choosing something - a click in 3D, a legend row, a part label, an energy step - writes ids into ONE set,
   and applySelection() does the same things for all of them: the rest is dimmed, selected residues get a marker, then
   (by the caller) the camera flies and the info card explains. ids: part:<group index> | residue:<asym>:<label seq>.
   Ligands are not selected here: clicking one opens its binding site (focusLigand). */
const sel = { ids: new Set(), source: null, soft: false, mats: [], hidden: [], markers: [] };
const MARK_GEO = new THREE.SphereGeometry(1, 16, 12);
const CHEM_NAME = { ASP: '酸性（带负电）', GLU: '酸性（带负电）', LYS: '碱性（带正电）', ARG: '碱性（带正电）', HIS: '组氨酸（可带正电）', SER: '极性', THR: '极性', ASN: '极性', GLN: '极性',
  CYS: '含硫', MET: '含硫', TYR: '芳香', PHE: '芳香', TRP: '芳香', GLY: '甘氨酸（主链最柔）', PRO: '脯氨酸（主链转折）' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function restoreSelVisuals() {
  for (const [m, o] of sel.mats) { m.transparent = o.t; m.opacity = o.o; m.depthWrite = o.d; m.needsUpdate = true; }
  for (const x of sel.hidden) x.visible = true;
  for (const mk of sel.markers) { mk.parent?.remove(mk); mk.material.dispose(); }
  sel.mats = []; sel.hidden = []; sel.markers = [];
  labels.forEach(l => l.el.classList.remove('on'));
}
function clearSelection() { restoreSelVisuals(); sel.ids.clear(); sel.source = null; sel.soft = false; }
function partSphere(g) {   // centre / radius of a part in its own frame (cached per loaded part)
  if (!g._bs) { const c = new THREE.Vector3(); g.atoms.forEach(a => c.add(a.p)); c.multiplyScalar(1 / Math.max(1, g.atoms.length));
    let r = 0; for (const a of g.atoms) r = Math.max(r, a.p.distanceTo(c), a.p2 ? a.p2.distanceTo(c) : 0); g._bs = { c, r }; }
  return g._bs;
}
const morphed = (a) => a.p2 ? a.p.clone().lerp(a.p2, U.uMorph.value) : a.p.clone();
function applySelection() {
  restoreSelVisuals();
  if (!sel.ids.size) return;
  const selG = new Set(), resBy = new Map();
  if (sel._for !== groups) { sel._for = groups; sel._res = new Map(); groups.forEach(g => g.atoms.forEach(a => sel._res.set(a.asym + ':' + a.seq, [g, a]))); }
  for (const id of sel.ids) {
    const [t, x, y] = id.split(':');
    if (t === 'part' && groups[+x]) selG.add(groups[+x]);
    if (t === 'residue') { const ga = sel._res.get(x + ':' + y); if (ga) { selG.add(ga[0]); if (!resBy.has(ga[0])) resBy.set(ga[0], []); resBy.get(ga[0]).push(ga[1]); } }
  }
  /* dim everything that is not selected (materials shared with a selected part stay as they are) */
  if (selG.size && selG.size < groups.filter(g => g.visible).length) {
    const keep = new Set(), seen = new Set();
    for (const g of selG) g.mesh?.traverse(x => { if (x.material) keep.add(x.material); });
    for (const g of groups) if (!selG.has(g) && g.mesh) g.mesh.traverse(x => {
      if (x.userData.outline === true) { if (x.visible) { x.visible = false; sel.hidden.push(x); } return; }
      const m = x.material; if (!x.isMesh || !m || Array.isArray(m) || keep.has(m) || seen.has(m)) return; seen.add(m);
      sel.mats.push([m, { t: m.transparent, o: m.opacity, d: m.depthWrite }]);
      m.transparent = true; m.opacity = Math.min(m.opacity, sel.soft ? 0.32 : 0.14); m.depthWrite = false; m.needsUpdate = true;
    });
  }
  /* residue markers: see-through gold spheres (drawn on top, so buried residues such as a channel filter still show) */
  for (const [g, list] of resBy) {
    if (!g.mesh) continue;
    const many = list.length > 30, mat = new THREE.MeshBasicMaterial({ color: illustrative() ? 0xe39b00 : 0xc99a1e, transparent: true, opacity: many ? 0.3 : 0.55, depthTest: false, depthWrite: false });
    const mk = new THREE.InstancedMesh(MARK_GEO, mat, list.length), m4 = new THREE.Matrix4(), sc = many ? 2.2 : 3.0;
    list.forEach((a, i) => mk.setMatrixAt(i, m4.makeScale(sc, sc, sc).setPosition(morphed(a))));
    mk.renderOrder = 7; mk.frustumCulled = false; mk.userData.selMarker = true; g.mesh.add(mk); sel.markers.push(mk);
  }
  labels.forEach(l => l.el.classList.toggle('on', selG.has(l.g)));
}
/* smooth camera moves (ease-out cubic); any drag by the user cancels the move */
let camFly = null;
function flyView(pos, target, ms = 650) { camFly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), s: performance.now(), ms }; }
function flyTo(target, dist, ms) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyView(target.clone().addScaledVector(dir, dist ?? camera.position.distanceTo(controls.target)), target, ms);
}
function updateFly() {
  if (!camFly) return;
  const k = Math.min(1, (performance.now() - camFly.s) / camFly.ms), e = 1 - (1 - k) ** 3;
  camera.position.lerpVectors(camFly.p0, camFly.p1, e); controls.target.lerpVectors(camFly.t0, camFly.t1, e); controls.update();
  if (k >= 1) camFly = null;
}
controls.addEventListener('start', () => { camFly = null; });
const safeAspect = () => (Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1) * viewFree.frac;   // hidden tab / zero-size canvas gives 0/0; fit into the free width
/* free screen area between the left panel and the simulation panel: the camera's view is shifted so the scene is centred there */
const viewFree = { frac: 1, dx: 0, key: '' };
function updateViewOffset(force) {
  const now = performance.now(); if (!force && now - (viewFree.t || 0) < 250) return; viewFree.t = now;   /* layout reads 4x a second, not every frame */
  const W = innerWidth, H = innerHeight; if (!(W > 0 && H > 0)) return;
  const vis = (e) => e && getComputedStyle(e).display !== 'none' && !e.classList.contains('hidden');
  let l = 0, r = W; const pn = $('panel'), hud = $('cellHud');
  if (vis(pn)) { const b = pn.getBoundingClientRect(); if (b.right > 0 && b.right < W * 0.6) l = b.right + 8; }
  const card = $('infoCard'), about = vis(card) && card.style.display === 'block' && $('autoFn');   /* the auto "about" card counts like the simulation panel */
  for (const e of [vis(hud) ? hud : null, about ? card : null]) if (e) { const b = e.getBoundingClientRect(); if (b.left > W * 0.4) r = Math.min(r, b.left - 8); }
  if (r - l < 320) { l = 0; r = W; }
  const dx = (l + r) / 2 - W / 2, frac = (r - l) / W, key = W + ',' + H + ',' + Math.round(dx) + ',' + frac.toFixed(3);
  if (key === viewFree.key) return; viewFree.key = key; viewFree.dx = dx; viewFree.frac = frac;
  if (Math.abs(dx) < 2) camera.clearViewOffset(); else camera.setViewOffset(W, H, -dx, 0, W, H);
  camera.updateProjectionMatrix();
}
const fitDist = (r) => { const vh = THREE.MathUtils.degToRad(camera.fov / 2), half = Math.min(vh, Math.atan(Math.tan(vh) * safeAspect())); return r / Math.sin(half); };
/* what the info card says about a part or one residue of it */
function showSelInfo(g, a) {
  const notes = current?.notes, nk = findKey(notes, g.name), note = nk != null ? notes[nk] : null;
  const nm = note ? note[0] : g.name.length > 34 ? g.name.slice(0, 32) + '…' : g.name;
  $('infoT').innerHTML = `<span class="sw" style="background:${g.fixed && $('palette').value === 'neon' ? g.fixed : g.color}"></span>`;
  $('infoT').append(a ? `${nm} · ${a.na ? a.resn : (AA1[a.resn] || a.resn)}${a.aseq !== '' && a.aseq != null ? a.aseq : a.seq}${a.ins || ''}` : nm);
  let h = '';
  if (a) {
    const core = (g.coreIdx || []).includes(g.atoms.indexOf(a));
    let near = '', bd = 1e9, bl = null;
    for (const l of model?.ligands || []) { if (LIPIDS.has(l.comp)) continue; for (const x of l.atoms) { const d = x.p.distanceTo(a.p); if (d < bd) { bd = d; bl = l; } } }
    if (bl && bd < 12) near = `；${a.na ? 'P' : 'Cα'} 离 ${esc(bl.comp)} 最近原子 ${bd.toFixed(1)} Å`;
    h += `<div>链 ${esc(a.ach || a.asym.split('_')[0])}${a.ach && a.ach !== a.asym.split('_')[0] ? `（label ${esc(a.asym.split('_')[0])}）` : ''} · ${a.na ? '核苷酸' : CHEM_NAME[a.resn] || '疏水'}${near}</div>`;
    h += `<div class="sec"><b>${core ? '① 功能核心' : g.faded ? '③ 支架' : g.simple ? '② 功能部件' : '原子细节'}</b>：${core ? '保留原子细节、按化学性质着色（小分子 8 Å 内或预设的关键残基）'
      : g.faded ? '不直接参与机制，画成半透明' : g.simple ? '画成由真实坐标算出的低分辨率形状，随构象一起运动' : '这个部件按原子细节显示'}</div>`;
  } else {
    const chains = new Set(g.atoms.map(x => x.asym)).size;
    h += `<div>${chains > 1 ? chains + ' 条链 · ' : ''}${g.atoms.length.toLocaleString()} 个残基${g.coreIdx?.length ? `，其中 ${g.coreIdx.length} 个属于功能核心（原子细节）` : ''}</div>`;
  }
  h += note ? `<div class="sec">${note[2]}</div>` : a ? '' : `<div class="sec" style="color:var(--dim)">${esc(g.name)}（预设里加 notes 可写讲解）</div>`;
  { const sid = (a?.src || g.atoms[0]?.src || current?.id || '').toUpperCase(), org = current?.local ? null : orgOf(sid), si = org && standIn(sid, org);
    if (org) h = `<div class="sec"${si ? ' style="color:#a14a00"' : ''}><b>物种：${esc(orgName(org))}</b>${si ? '<br>' + esc(si) : ''}</div>` + h; }
  /* evidence for this object (audit 10): what is measured, what is computed or placed */
  const ev = [current?.local ? (current.structure?.source?.pdb ? `坐标：包里声明来自 PDB ${esc(current.structure.source.pdb)}（未核对）` : '坐标：用户提供的模型') : `坐标：实验结构（${esc((a?.src || g.atoms[0]?.src || current?.id || '').toUpperCase())}）`];
  if (g.simple) ev.push('外形：由 Cα / P 推算的简化形状'); else ev.push('团块大小：示意');
  if ((current?.components || []).length) ev.push('和其他结构的相对位置：建模');
  if (g.atoms.some(x => x.p2)) ev.push('构象变化：两个实验结构之间插值');
  h += `<div class="sec" style="color:var(--dim)">证据：${ev.join('；')}</div>`;
  const lk = linkFor(g.name, a?.entName);
  if (lk) h += `<div class="sec"><button class="openLink" data-k="${esc(lk)}">打开这个机器：${esc(presetName(lk))} →</button></div>`;
  h += `<div class="sec" style="color:var(--dim)">点空白处或按 Esc 取消选择${(model?.ligands || []).some(l => !l.hidden) ? '；点小分子看结合位点' : ''}。</div>`;
  $('infoB').innerHTML = h; $('infoCard').style.display = 'block';
  $('infoB').querySelector('.openLink')?.addEventListener('click', (e) => openLinked(e.target.dataset.k));
}
/* cell -> system -> protein links (audit 13): which preset shows a part / molecule in detail */
/* source organism of a structure: known entries first (RCSB lists the antibody of 1K4C too), then the entry's metadata */
const KNOWN_ORG = { '4V6F': 'Thermus thermophilus', '1K4C': 'Streptomyces lividans', '6ZPO': 'Bos taurus', '5GUP': 'Sus scrofa', '1HRC': 'Equus caballus',
  '6OQR': 'Escherichia coli', '1EFT': 'Thermus aquaticus', '1GD1': 'Geobacillus stearothermophilus', '1PKN': 'Oryctolagus cuniculus', '1TIM': 'Gallus gallus',
  '4AKE': 'Escherichia coli', '1AON': 'Escherichia coli', '6ALH': 'Escherichia coli', '1IWG': 'Escherichia coli', '1PV6': 'Escherichia coli', '1RC2': 'Escherichia coli',
  '1U7G': 'Escherichia coli', '2OMF': 'Escherichia coli', '4HHB': 'Homo sapiens' };
const ORG_ZH = { 'Escherichia coli': '大肠杆菌', 'Thermus thermophilus': '嗜热栖热菌', 'Thermus aquaticus': '水生栖热菌', 'Streptomyces lividans': '变铅青链霉菌',
  'Bos taurus': '牛', 'Sus scrofa': '猪', 'Equus caballus': '马', 'Oryctolagus cuniculus': '兔', 'Gallus gallus': '鸡', 'Homo sapiens': '人',
  'Geobacillus stearothermophilus': '嗜热脂肪地芽孢杆菌', 'Spinacia oleracea': '菠菜', 'Salmonella': '沙门氏菌', 'Mus musculus': '小鼠' };
const orgOf = (id) => { id = String(id || '').toUpperCase(); return KNOWN_ORG[id] || (current?._prov || []).find(p => p.id === id)?.organisms?.[0] || null; };
const orgName = (o) => { if (!o) return '未知'; const k = Object.keys(ORG_ZH).find(k => o.startsWith(k)); return k ? `${ORG_ZH[k]}（${k}）` : o; };
/* scenes that show an E. coli cell: any structure from another organism is a stand-in and says so */
const cellHost = () => /^(cellCorner|wholeCell)$/.test(current?.process || '') ? 'Escherichia coli' : null;
const STAND_IN = { '4V6F': '代用结构：用嗜热栖热菌的 70S 核糖体代表大肠杆菌的核糖体（两者结构很相似）',
  '1K4C': '代用结构：大肠杆菌没有 KcsA，这里用链霉菌的 KcsA 代表一个钾通道',
  '1EFT': '代用结构：用水生栖热菌的 EF-Tu 代表大肠杆菌的 EF-Tu' };
function standIn(id, org = orgOf(id)) { const host = cellHost(); if (!host || !org || org.startsWith(host)) return null;
  return STAND_IN[String(id).toUpperCase()] || `代用结构：这是${orgName(org)}的结构，代表大肠杆菌里的同类分子`; }
/* the bovine ATP synthase preset has a c8 ring; E. coli has c10 (Escherichia coli 6OQR): 10 H⁺ : 3 ATP */
function linkNote(key, org) {
  if (key === 'atp-synthase' && org && !org.startsWith('Bos')) return `注意：要打开的是牛线粒体 ATP 合酶（6ZPO，c8 环：8 H⁺ : 3 ATP）。${orgName(org)}的 ATP 合酶${org.startsWith('Escherichia') ? '是 c10 环：10 H⁺ : 3 ATP' : '的 c 环大小可能不同'}。`;
  return null; }
const LINKS = [[/ATP synthase|ATP 合酶|subunit (alpha|beta|gamma|c\b)/i, 'atp-synthase'], [/KcsA|potassium channel|钾通道|钾离子通道/i, 'kcsa'],
  [/ribosom|16S|23S|5S|核糖体|30S|50S|70S/i, 'translation'], [/flagell|MotA|MotB|FliG|鞭毛/i, 'flagellar-motor'],
  [/NADH dehydrogenase|cytochrome (b|c1|c oxidase)|complex (I|III|IV)\b|复合体 (I|III|IV)|呼吸链/i, 'respiratory-chain']];
function linkFor(...names) {
  const here = PRESETS[current?.name]?.key;
  for (const n of names) { if (!n) continue; for (const [re, k] of LINKS) if (re.test(n) && k !== here && PRESET_BY_KEY[k]) return k; }
  return null;
}
