/* =============================================================================
   TAKE-APART (拆装) MODE
   Every polymer chain of the visible parts becomes one piece (its own mesh + the small molecules bound to it).
   - contacts (instant, residue level): Calpha / P pairs of different chains closer than 8 / 10 A -> interface residues,
     partner list, "footprint" (interface residues painted in the partner's colour, like the socket of a puzzle piece)
   - explode: each piece moves out along (its centroid - complex centroid); one piece can be pulled out on its own
   - assembly order: preset `assembly: [keywords]`, else greedy (largest piece first, then always the piece with the
     largest interface to what is already built) -- an estimate, said so in the UI
   - full-atom interface (on demand): all atoms of the selected chain and its partners are downloaded from RCSB, fitted
     onto the scene chains by their Calpha, and classified: disulfide SG-SG <= 2.5, salt bridge (Lys NZ / Arg NE NH1 NH2 vs
     Asp OD / Glu OE / phosphate OP) <= 4.0, hydrogen bond N/O-N/O 2.5-3.5, hydrophobic side-chain C-C <= 4.0.
     The bonds are drawn as bands between the two pieces; they stretch when the pieces are pulled apart.
   ============================================================================= */
let kit = null;
const KTYPE = { ss: ['二硫键', '#e0a800'], salt: ['盐桥', '#ff4fa3'], hbond: ['氢键', '#2f9bff'], hydro: ['疏水接触', '#8d93a3'], contact: ['界面接触', '#aab3c5'] };
const HYDRO_RES = new Set(['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'TYR', 'CYS']);
const kitAtomCache = new LRU(60 * 1048576, (rows) => (rows?.length || 0) * 160);
function kitShort(s, n = 26) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function kitBuildPieces() {
  const by = new Map();
  groups.forEach((g, gi) => { if (!g.visible) return; for (const a of g.atoms) { const k = gi + '|' + (a.src || 'local') + '|' + a.asym; if (!by.has(k)) by.set(k, { key: k, g, atoms: [] }); by.get(k).atoms.push(a); } });
  const P = [...by.values()].filter(pc => pc.atoms.length >= 3).sort((x, y) => y.atoms.length - x.atoms.length).slice(0, 400);
  const notes = current?.notes || {};
  const entOrder = [];
  for (const pc of P) {
    const a0 = pc.atoms[0]; pc.asym = a0.asym; pc.asym0 = a0.asym.split('_')[0]; pc.src = a0.src; pc.ent = a0.entName || pc.g.name; pc.part = pc.g.name; pc.na = pc.atoms.some(a => a.na);
    pc.c = pc.atoms.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / pc.atoms.length);
    pc.r = Math.max(...pc.atoms.map(a => a.p.distanceTo(pc.c)));
    const nk = findKey(notes, pc.ent); pc.label = nk != null && notes[nk] ? notes[nk][0] : pc.ent;
    const pk = pc.part !== pc.ent ? findKey(notes, pc.part) : null; pc.partLabel = pk != null && notes[pk] ? notes[pk][0] : pc.part !== pc.ent ? pc.part : '';
    const ek = pc.g.name + '|' + pc.ent; if (!entOrder.includes(ek)) entOrder.push(ek); pc.ek = ek;
  }
  /* colour: one hue per subunit type (entity), copies slightly lighter / darker */
  const pal = PALETTES[$('palette').value], copies = new Map();
  for (const pc of P) {
    const k = copies.get(pc.ek) || 0; copies.set(pc.ek, k + 1); pc.copy = k;
    const c = pc.na ? new THREE.Color(illustrative() ? '#e3a35a' : '#ffb347') : new THREE.Color(pal[entOrder.indexOf(pc.ek) % pal.length]), hsl = {}; c.getHSL(hsl);
    if (illustrative()) c.setHSL(hsl.h, Math.min(Math.max(hsl.s, 0.2), 0.66), THREE.MathUtils.clamp(hsl.l, 0.46, 0.64));
    pc.col = c.offsetHSL(0, 0, ((k % 3) - 1) * 0.05);
  }
  for (const pc of P) pc.nCopies = copies.get(pc.ek);
  return P;
}
function kitContacts(P) {
  const cell = 10, grid = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
  P.forEach((pc, pi) => { pc.idx = pi; pc.near = new Array(pc.atoms.length).fill(null); pc.partners = new Map();
    pc.atoms.forEach((a, ai) => { const k = K(Math.floor(a.p.x / cell), Math.floor(a.p.y / cell), Math.floor(a.p.z / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(pi, ai); }); });
  for (const pc of P) pc.atoms.forEach((a, ai) => {
    const cx = Math.floor(a.p.x / cell), cy = Math.floor(a.p.y / cell), cz = Math.floor(a.p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const L = grid.get(K(cx + dx, cy + dy, cz + dz)); if (!L) continue;
      for (let t = 0; t < L.length; t += 2) { const pj = L[t]; if (pj === pc.idx) continue; const b = P[pj].atoms[L[t + 1]], d = a.p.distanceTo(b.p);
        if (d > (a.na || b.na ? 10 : 8)) continue;
        if (!pc.near[ai] || d < pc.near[ai].d) pc.near[ai] = { pj, bj: L[t + 1], d };
      }
    }
    const nr = pc.near[ai]; if (!nr) return;
    let e = pc.partners.get(nr.pj); if (!e) pc.partners.set(nr.pj, e = { n: 0, pairs: [] }); e.n++; e.pairs.push([ai, nr.bj, nr.d]);
  });
}
function kitOrder(P) {
  const kws = current?.assembly;
  if (Array.isArray(kws) && kws.length) {
    const rank = (pc) => { const i = kws.findIndex(k => kwMatch(pc.ent, k) || kwMatch(pc.part, k)); return i < 0 ? kws.length : i; };
    return { order: P.slice().sort((x, y) => rank(x) - rank(y) || y.atoms.length - x.atoms.length), est: false };
  }
  const done = new Set([P[0]]), order = [P[0]];
  while (order.length < P.length) {
    let best = null, bv = -1;
    for (const pc of P) { if (done.has(pc)) continue; let v = 0; for (const q of done) v += (pc.partners.get(q.idx)?.n || 0) + (q.partners.get(pc.idx)?.n || 0); v = v * 1e6 + pc.atoms.length; if (v > bv) { bv = v; best = pc; } }
    done.add(best); order.push(best);
  }
  return { order, est: true };
}
function kitColours(pc) {
  const fp = $('kitFp').checked, c = new THREE.Color();
  pc.atoms.forEach((a, i) => {
    c.copy(pc.col); const nr = pc.near[i];
    if (fp && nr && nr.d < (a.na ? 8.5 : 6.5)) { c.lerp(kit.P[nr.pj].col, 0.62); c.offsetHSL(0, 0.04, -0.07); }   // footprint: only the tight core of the interface
    c.offsetHSL(0, 0, (((a.rf ?? 1) - 1) / 0.3) * 0.06); pc.mesh.setColorAt(i, c);
  });
  pc.mesh.instanceColor.needsUpdate = true;
}
function enterKit() {
  if (!model || kit) return;
  clearFocus(false); clearSelection(); $('infoCard').style.display = 'none';
  const P = kitBuildPieces(); if (!P.length) { status('没有可拆的链'); return; }
  kit = { P, root: new THREE.Group(), e: 0, sel: null, links: [], play: null, saved: { groups: groups.map(g => g.mesh?.visible), ligs: ligGroups.map(l => l.obj.visible), mem: membraneObjs.map(o => o.visible), proc: procRoot.visible } };
  kitContacts(P);
  const all = P.flatMap(pc => pc.atoms); kit.C = all.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / all.length);
  kit.R = Math.max(...all.map(a => a.p.distanceTo(kit.C)));
  P.forEach((pc, i) => {
    pc.obj = new THREE.Group(); pc.e = 0; pc.eT = 0; pc.pull = 0; pc.pullT = 0;
    pc.mesh = blobInstances({ atoms: pc.atoms, color: '#' + pc.col.getHexString() }, () => pc.col, blobMaterial()); pc.obj.add(pc.mesh);
    const v = pc.c.clone().sub(kit.C); pc.dir = v.length() > 3 ? v.clone().normalize() : new THREE.Vector3(Math.cos(i * 2.4), 0.3, Math.sin(i * 2.4)).normalize(); pc.v = v;
    kitColours(pc); kit.root.add(pc.obj);
  });
  /* small molecules travel with the chain they sit on (nearest chain within 7 A) */
  const byPc = new Map();
  for (const L of model.ligands) {
    if (L.hidden || LIPIDS.has(L.comp) || (current?.ligOff || []).includes(L.comp) || (L.state || 0) !== 0) continue;
    let best = null, bd = 49;
    for (const pc of P) { if (pc.c.distanceTo(L.centre) > pc.r + 10) continue; for (const a of pc.atoms) { const d = a.p.distanceToSquared(L.centre); if (d < bd) { bd = d; best = pc; } } }
    if (best) { if (!byPc.has(best)) byPc.set(best, []); byPc.get(best).push(L); }
  }
  for (const [pc, mols] of byPc) { pc.ligs = mols; if ($('ligOn').checked) pc.obj.add(buildMolecules(mols, +$('ligScale').value)); }
  /* interface bands */
  kit.band = new THREE.InstancedMesh(CYL, new THREE.MeshBasicMaterial({ color: 0xffffff }), 800); kit.band.count = 0; kit.band.frustumCulled = false;
  kit.band.setColorAt(0, new THREE.Color()); kit.root.add(kit.band);
  world.add(kit.root);
  /* hide the normal scene */
  for (const g of groups) if (g.mesh) g.mesh.visible = false;
  for (const l of ligGroups) l.obj.visible = false;
  for (const o of membraneObjs) o.visible = false;
  procRoot.visible = false; procWorld.forEach(o => o.visible = false);
  if (cellSim) { cellSim.objs.forEach(o => o.visible = false); cellSim.labs.forEach(l => l.style.display = 'none'); $('cellHud').style.display = 'none'; }
  $('labels').style.display = 'none';
  /* HUD */
  kit.ord = kitOrder(P);
  $('kitN').textContent = `${P.length} 条链 · ${new Set(P.map(p => p.ek)).size} 种亚基`;
  $('kitE').value = 0; $('kitStep').textContent = '点一个亚基选中它；拖动“拆开程度”或点“全部拆开”。';
  const seen = new Map(); for (const pc of P) { if (!seen.has(pc.ek)) seen.set(pc.ek, []); seen.get(pc.ek).push(pc); }
  $('kitList').innerHTML = ''; for (const [, arr] of seen) {
    const pc = arr[0], el = document.createElement('span'); el.className = 'chip'; el.dataset.ek = pc.ek; el.title = pc.ent + (pc.partLabel ? ' · ' + pc.partLabel : '');
    el.innerHTML = `<i style="background:#${pc.col.getHexString()}"></i>`; el.append(kitShort(pc.label, 22) + (arr.length > 1 ? ` ×${arr.length}` : ''));
    el.onclick = () => { const cur = kit.sel && kit.sel.ek === pc.ek ? arr.indexOf(kit.sel) : -1; kitSelect(arr[(cur + 1) % arr.length]); };
    $('kitList').appendChild(el);
  }
  $('kitInfo').innerHTML = ''; $('kitHud').style.display = 'block'; $('kitBtn').classList.add('on');
  kit.labs = P.slice(0, 14).map(pc => { const el = document.createElement('div'); el.className = 'lab'; el.innerHTML = '<b></b><i></i>'; el.querySelector('b').textContent = kitShort(pc.label, 24);
    el.querySelector('i').textContent = `${pc.asym}${pc.partLabel ? ' · ' + kitShort(pc.partLabel, 16) : ''}`; el.onclick = () => kitSelect(pc); $('kitLabs').appendChild(el); return { el, pc }; });
  status(`拆装模式：${P.length} 条链`);
}
function exitKit() {
  if (!kit) return;
  world.remove(kit.root); disposeObj(kit.root);
  groups.forEach((g, i) => { if (g.mesh) g.mesh.visible = kit.saved.groups[i] ?? g.visible; });
  ligGroups.forEach((l, i) => l.obj.visible = kit.saved.ligs[i] ?? l.obj.visible);
  membraneObjs.forEach((o, i) => o.visible = kit.saved.mem[i] ?? true);
  procRoot.visible = kit.saved.proc; procWorld.forEach(o => o.visible = true);
  if (cellSim) { cellSim.objs.forEach(o => o.visible = true); cellSim.labs.forEach(l => l.style.display = ''); $('cellHud').style.display = 'block'; }
  $('labels').style.display = ''; $('kitLabs').innerHTML = ''; $('kitHud').style.display = 'none'; $('kitBtn').classList.remove('on');
  kit = null;
}
function kitSetAll(e) { if (!kit) return; kit.play = null; kit.e = e; $('kitE').value = e; for (const pc of kit.P) pc.eT = e;
  if (e > 0.5) { const dist = camera.position.distanceTo(controls.target), want = fitDist(kit.R * (1 + 1.1 * e)) * 0.8; if (dist < want) flyTo(controls.target.clone(), want, 700); } }
function kitSelect(pc) {
  if (!kit) return; kit.sel = pc;
  for (const q of kit.P) { const m = q.mesh.material, dim = pc && q !== pc && !pc.partners.has(q.idx) && !q.partners.has(pc.idx);
    m.transparent = dim; m.opacity = dim ? 0.22 : 1; m.depthWrite = !dim; m.needsUpdate = true; }
  document.querySelectorAll('#kitList .chip').forEach(c => c.classList.toggle('on', !!pc && c.dataset.ek === pc.ek));
  kitLinksResidue(); kitInfo();
}
/* partners of a piece, both directions (the nearest-neighbour bookkeeping is asymmetric) */
function kitPartnersOf(pc) {
  const m = new Map();
  for (const [pj, e] of pc.partners) m.set(pj, { n: e.n, nOther: 0 });
  for (const q of kit.P) { const e = q.partners.get(pc.idx); if (!e) continue; const o = m.get(q.idx) || { n: 0, nOther: 0 }; o.nOther = e.n; m.set(q.idx, o); }
  return [...m.entries()].map(([pj, o]) => ({ q: kit.P[pj], n: o.n, nOther: o.nOther })).sort((x, y) => (y.n + y.nOther) - (x.n + x.nOther));
}
function kitLinksResidue() {
  kit.links = []; const pc = kit.sel; if (!pc) return;
  if (pc.full) { kit.links = pc.full.links; return; }
  for (const { q } of kitPartnersOf(pc)) {
    const e = pc.partners.get(q.idx); if (!e) continue;
    for (const [ai, bj] of e.pairs.slice().sort((x, y) => x[2] - y[2]).slice(0, 24)) kit.links.push({ a: pc, b: q, A: pc.atoms[ai].p, B: q.atoms[bj].p, type: 'contact' });
  }
}
const kitRes = (pc, r) => (AA1[r.comp] || r.comp) + (r.aseq || r.seq);
function kitInfo() {
  const pc = kit.sel, box = $('kitInfo'); if (!pc) { box.innerHTML = ''; return; }
  const parts = kitPartnersOf(pc), nIf = pc.near.filter(Boolean).length;
  let h = `<div class="t"><span class="sw" style="background:#${pc.col.getHexString()}"></span>${esc(pc.label)}</div>`
    + `<div class="s">${esc(pc.ent)}${pc.partLabel ? ' · ' + esc(pc.partLabel) : ''}<br>链 ${esc(pc.asym)} · ${pc.atoms.length} 个${pc.na ? '核苷酸' : '残基'}${pc.nCopies > 1 ? ` · 同种亚基共 ${pc.nCopies} 份（第 ${pc.copy + 1} 份）` : ''}${pc.ligs ? ` · 带着 ${[...new Set(pc.ligs.map(l => l.comp))].join('、')}` : ''}</div>`
    + `<div class="ctl"><button id="kitPull">${pc.pullT ? '↩ 装回去' : '⇱ 取下来'}</button><button id="kitFull" ${pc.full || pc.loading ? 'disabled' : ''}>${pc.full ? '全原子界面 ✓' : pc.loading ? '下载中…' : '⚛ 计算全原子界面'}</button></div>`;
  if (!parts.length) h += `<div class="s" style="margin-top:6px">和其他链没有接触（单独存在的亚基）。</div>`;
  else {
    h += `<div style="margin-top:6px"><b>和 ${parts.length} 条链相连</b>（界面 ${nIf} 个${pc.na ? '核苷酸' : '残基'}${pc.full ? '' : '，残基级：Cα 间距 < 8 Å'}）：</div>`;
    for (const { q, n, nOther } of parts.slice(0, 12)) {
      const f = pc.full?.by.get(q.idx);
      h += `<div class="p" data-pj="${q.idx}"><span class="sw" style="background:#${q.col.getHexString()}"></span>${esc(kitShort(q.label, 22))} <span class="s">链 ${esc(q.asym)} · 界面 ${n}+${nOther}</span></div>`;
      if (f) {
        const seg = Object.keys(KTYPE).filter(t => t !== 'contact' && f[t].length).map(t => `<span class="ty" style="background:${KTYPE[t][1]}"></span>${KTYPE[t][0]} ${f[t].length}`).join('　');
        h += `<div class="ex">${seg || '只有范德华接触'}${f.clash.size ? `　<span title="N/O 原子距离 < 2.5 Å：沉积模型的几何误差，不是真实化学键">（另 ${f.clash.size} 对过近，未计）</span>` : ''}</div>`;
        const ex = [...f.ss, ...f.salt, ...f.hbond].slice(0, 4).map(x => `${kitRes(pc, x.ra)}–${kitRes(q, x.rb)} ${x.d.toFixed(1)} Å`).join('；'); if (ex) h += `<div class="ex">${ex}</div>`;
      }
    }
    if (parts.length > 12) h += `<div class="s">… 另 ${parts.length - 12} 条</div>`;
  }
  h += `<div class="s" style="margin-top:6px">${$('kitFp').checked ? '亚基表面染成伙伴颜色的区域＝界面印记（另一条链贴在这里）。' : ''}${pc.full ? '彩色带＝由全原子坐标判定的化学键：氢键 N/O 2.5–3.5 Å、盐桥 ≤ 4 Å、二硫键 SG–SG ≤ 2.5 Å、疏水 C–C ≤ 4 Å；拆开时被拉长。' : '灰色带＝最近的界面残基对；点“计算全原子界面”下载这几条链的全部原子，判定盐桥 / 氢键 / 二硫键。'}</div>`;
  box.innerHTML = h;
  $('kitPull').onclick = () => { pc.pullT = pc.pullT ? 0 : 1; kitInfo(); };
  const fb = $('kitFull'); if (fb && !fb.disabled) fb.onclick = () => kitFullAtom(pc);
  box.querySelectorAll('.p').forEach(el => el.onclick = () => kitSelect(kit.P[+el.dataset.pj]));
}
async function kitChainAtoms(pc) {
  if (!pc.src || pc.atoms.length > 2500) return null;
  const k = pc.src + '|' + pc.asym0; let rows = kitAtomCache.get(k);
  if (!rows) {
    const txt = await fetchText(`https://models.rcsb.org/v1/${pc.src}/atoms?label_asym_id=${encodeURIComponent(pc.asym0)}&encoding=cif&copy_all_categories=false`);
    rows = parseAtomSite(txt).filter(r => r.g === 'ATOM' && r.el !== 'H' && r.el !== 'D' && (!r.alt || r.alt === '.' || r.alt === '?' || r.alt === 'A'));
    kitAtomCache.set(k, rows);
  }
  /* file frame -> scene frame of THIS copy: fit the chain's own Calpha / P */
  const bySeq = new Map(pc.atoms.map(a => [a.seq, a])), A = [], B = [];
  for (const r of rows) if ((r.an === 'CA' && !pc.na) || (r.an === 'P' && pc.na)) { const a = bySeq.get(r.seq); if (a) { A.push(a.p); B.push(new THREE.Vector3(r.x, r.y, r.z)); } }
  if (A.length < 3) return null;
  const f = superpose(A, B);
  return rows.map(r => ({ ...r, p: f(new THREE.Vector3(r.x, r.y, r.z)) }));
}
async function kitFullAtom(pc) {
  const myKit = kit;   /* leaving and re-entering take-apart mode must not let an old request write into the new kit */
  pc.loading = true; kitInfo();
  try {
    const parts = kitPartnersOf(pc).slice(0, 8);
    const [mine, ...theirs] = await Promise.all([kitChainAtoms(pc), ...parts.map(({ q }) => kitChainAtoms(q).catch(() => null))]);
    if (!kit || kit !== myKit) return;
    if (!mine) throw new Error('这条链太大或没有来源条目');
    const isCat = (r) => (r.comp === 'LYS' && r.an === 'NZ') || (r.comp === 'ARG' && /^(NE|NH1|NH2)$/.test(r.an));
    const isAni = (r) => (r.comp === 'ASP' && /^OD[12]$/.test(r.an)) || (r.comp === 'GLU' && /^OE[12]$/.test(r.an)) || /^(OP1|OP2|O1P|O2P)$/.test(r.an);
    const side = (r) => !/^(N|CA|C|O)$/.test(r.an);
    const by = new Map(), links = [];
    parts.forEach(({ q }, k) => {
      const other = theirs[k], res = { ss: [], salt: [], hbond: [], hydro: [], clash: new Set() }; by.set(q.idx, res); if (!other) return;
      const cell = 4.5, grid = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
      for (const y of other) { const kk = K(Math.floor(y.p.x / cell), Math.floor(y.p.y / cell), Math.floor(y.p.z / cell)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(y); }
      const best = new Map();
      for (const x of mine) {
        const cx = Math.floor(x.p.x / cell), cy = Math.floor(x.p.y / cell), cz = Math.floor(x.p.z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const y of grid.get(K(cx + dx, cy + dy, cz + dz)) || []) {
          const d = x.p.distanceTo(y.p); if (d > 4.0) continue;
          let t = null;
          if (d < 2.5 && /^[NO]$/.test(x.el) && /^[NO]$/.test(y.el)) { res.clash.add(x.seq + '|' + y.seq); continue; }   // closer than any real H-bond: geometry error of the model
          if (x.comp === 'CYS' && y.comp === 'CYS' && x.an === 'SG' && y.an === 'SG' && d <= 2.5) t = 'ss';
          else if (((isCat(x) && isAni(y)) || (isAni(x) && isCat(y))) && d <= 4.0) t = 'salt';
          else if (/^[NO]$/.test(x.el) && /^[NO]$/.test(y.el) && d >= 2.5 && d <= 3.5) t = 'hbond';
          else if (x.el === 'C' && y.el === 'C' && side(x) && side(y) && HYDRO_RES.has(x.comp) && HYDRO_RES.has(y.comp)) t = 'hydro';
          if (!t) continue;
          const key = t + '|' + x.seq + '|' + y.seq, o = best.get(key);
          if (!o || d < o.d) best.set(key, { t, x, y, d, ra: { comp: x.comp, seq: x.seq, aseq: x.aseq }, rb: { comp: y.comp, seq: y.seq, aseq: y.aseq } });
        }
      }
      /* a salt bridge is also an H-bond pair: keep it once, as salt bridge */
      const saltRes = new Set([...best.values()].filter(v => v.t === 'salt').map(v => v.x.seq + '|' + v.y.seq));
      for (const v of [...best.values()].sort((u, w) => u.d - w.d)) {
        if (v.t === 'hbond' && saltRes.has(v.x.seq + '|' + v.y.seq)) continue;
        res[v.t].push(v);
        if (v.t !== 'hydro' || res.hydro.length <= 25) links.push({ a: pc, b: q, A: v.x.p, B: v.y.p, type: v.t });
      }
    });
    pc.full = { by, links };
    const tot = (t) => [...by.values()].reduce((s, r) => s + r[t].length, 0);
    status(`全原子界面：盐桥 ${tot('salt')}，氢键 ${tot('hbond')}，二硫键 ${tot('ss')}，疏水接触 ${tot('hydro')}`);
  } catch (e) { status('全原子界面计算失败：' + e.message); }
  pc.loading = false;
  if (kit && kit.sel === pc) { kitLinksResidue(); kitInfo(); }
}
function kitPlay() {
  if (!kit) return; kitSetAll(1); const { order, est } = kit.ord;
  kit.play = { order, i: 0, t: -1.2, step: Math.min(1.1, Math.max(0.12, 14 / order.length)), est };
  for (const pc of kit.P) pc.pullT = 0;
}
const _kq = new THREE.Quaternion(), _km = new THREE.Matrix4(), _ks = new THREE.Vector3(), _ka = new THREE.Vector3(), _kb = new THREE.Vector3(), _kup = new THREE.Vector3(0, 1, 0);
function updateKit(dt) {
  const k = 1 - Math.exp(-dt * 5);
  if (kit.play) {
    const pl = kit.play; pl.t += dt;
    if (pl.t >= 0 && pl.i < pl.order.length) {
      const pc = pl.order[pl.i]; pc.eT = 0; pl.i++; pl.t -= pl.step;
      const prev = pl.order.slice(0, pl.i - 1), n = prev.reduce((s, q) => s + (pc.partners.get(q.idx)?.n || 0) + (q.partners.get(pc.idx)?.n || 0), 0);
      $('kitStep').textContent = `第 ${pl.i} / ${pl.order.length} 步：装上 ${kitShort(pc.label, 24)}（链 ${pc.asym}${pl.i > 1 ? `，和已装好的部分有 ${n} 个界面残基` : '，最大的亚基先放'}）` + (pl.est ? ' · 顺序按界面大小推测，仅示意' : ' · 顺序来自预设（文献）');
      if (pl.i === pl.order.length) { kit.play = null; kit.e = 0; $('kitE').value = 0; }
    }
  }
  for (const pc of kit.P) {
    pc.e += (pc.eT - pc.e) * k; pc.pull += (pc.pullT - pc.pull) * k;
    pc.obj.position.copy(pc.v).multiplyScalar(pc.e * 1.25).addScaledVector(pc.dir, pc.e * (24 + 0.6 * pc.r) + pc.pull * (0.9 * pc.r + 30));
  }
  /* interface bands: from a point on one piece to a point on the other, wherever the pieces are now */
  const L = kit.links, band = kit.band, col = new THREE.Color(); let n = 0;
  for (const l of L) { if (n >= 800) break;
    _ka.copy(l.A).add(l.a.obj.position); _kb.copy(l.B).add(l.b.obj.position);
    const len = _ka.distanceTo(_kb); if (len < 0.05) continue;
    _kq.setFromUnitVectors(_kup, _ks.copy(_kb).sub(_ka).normalize());
    const r = l.type === 'contact' || l.type === 'hydro' ? 0.2 : 0.3;
    _km.compose(_ka.clone().add(_kb).multiplyScalar(0.5), _kq, _ks.set(r, len, r)); band.setMatrixAt(n, _km); band.setColorAt(n, col.set(KTYPE[l.type][1])); n++;
  }
  band.count = n; band.instanceMatrix.needsUpdate = true; if (band.instanceColor) band.instanceColor.needsUpdate = true;
  /* labels */
  const show = kit.P.some(pc => pc.e > 0.2 || pc.pull > 0.2), nb = kit.sel ? new Set(kitPartnersOf(kit.sel).map(x => x.q)) : null;
  for (const { el, pc } of kit.labs) {
    const on = (show || pc === kit.sel) && (!nb || pc === kit.sel || nb.has(pc));
    if (!on) { el.style.display = 'none'; continue; }
    _ka.copy(pc.c).add(pc.obj.position).addScaledVector(_kup, pc.r * 0.6).applyMatrix4(world.matrixWorld).project(camera);
    if (_ka.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.left = ((_ka.x * 0.5 + 0.5) * innerWidth) + 'px'; el.style.top = ((-_ka.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
}
function kitPick(cx, cy) {
  const rect = renderer.domElement.getBoundingClientRect();
  _rc.setFromCamera(_pv.set((cx - rect.left) / rect.width * 2 - 1, -(cy - rect.top) / rect.height * 2 + 1), camera);
  let best = null, bt = 1e9;
  for (const pc of kit.P) {
    if (pc.mesh.material.opacity < 0.5) continue;
    pc.obj.updateMatrixWorld(); _ray.copy(_rc.ray).applyMatrix4(_inv.copy(pc.obj.matrixWorld).invert());
    if (_ray.distanceSqToPoint(pc.c) > (pc.r + 4) ** 2) continue;
    for (const a of pc.atoms) { const t = _ray.origin.clone().sub(a.p).dot(_ray.direction) * -1; if (t <= 0 || t >= bt) continue; if (_ray.distanceSqToPoint(a.p) < 3.6 * 3.6) { bt = t; best = pc; } }
  }
  return best;
}
