/* ----------------------------------------------------------------------------- macromolecular crowding (cell-scale backdrop)
   buildCrowd(spec) fills a box of cytoplasm with pale, coarse copies of real structures, so a scene reads as the inside of a
   cell (Goodsell-style) instead of machines floating in empty space.
   spec = { box: {min: Vector3, max: Vector3}, keepSide: {n: Vector3, d} (only points with n.p > d, i.e. behind the cut plane),
            phi (target protein volume fraction), cellVol (A^3; E. coli cytoplasm ~7e11), types: [{id, label, perCell, col, fill}] }
   Copies of each type = perCell * boxVolume / cellVol (abundance per cell); `fill` types then top the box up to phi (they stand
   for the thousands of other cytoplasmic proteins). Each copy = one rigid body of coarse blobs (every k-th CA / P, radius grown
   so the volume is kept); placement avoids the scene's atoms and the copies already placed (8 A grid). Slow Brownian drift. */
async function buildCrowd(spec) {
  /* extra options (whole-cell region level): keepFn(p) = arbitrary volume (its size is estimated by Monte Carlo), cell = grid size,
     ptsPer / maxPts = coarser shapes (one blob per ~ptsPer residues), occPts = more points to avoid, maxFill */
  const V = THREE.Vector3, B = spec.box, size = B.max.clone().sub(B.min);
  const keep = (p) => (!spec.keepSide || spec.keepSide.n.dot(p) > spec.keepSide.d) && (!spec.keepFn || spec.keepFn(p));
  let boxVol = size.x * size.y * size.z * (spec.keepSide ? 0.5 : 1);   /* only the half behind the cut is filled */
  if (spec.keepFn) { let h = 0; const q = new V(); for (let i = 0; i < 6000; i++) if (keep(q.set(B.min.x + randVis() * size.x, B.min.y + randVis() * size.y, B.min.z + randVis() * size.z))) h++; boxVol = size.x * size.y * size.z * h / 6000; }
  const cell = spec.cell || 8, occ = new Set(), fl = Math.floor, K = (x, y, z) => ((fl(x / cell) + 2048) * 4096 + fl(y / cell) + 2048) * 4096 + fl(z / cell) + 2048;   /* numeric keys: fast */
  for (const a of model.allAtoms) occ.add(K(a.p.x, a.p.y, a.p.z));
  for (const p of spec.occPts || []) occ.add(K(p.x, p.y, p.z));
  const free = (p) => { const x = fl(p.x / cell) + 2048, y = fl(p.y / cell) + 2048, z = fl(p.z / cell) + 2048;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (occ.has(((x + dx) * 4096 + y + dy) * 4096 + z + dz)) return false; return true; };
  /* coarse shapes from the real structures (CA / P only, first biological assembly) */
  const shapes = await Promise.all(spec.types.map(async (t) => {
    try { const e = await loadEntry(t.id, true, false); const P = e.atoms.map(a => a.p), c = P.reduce((s, p) => s.add(p), new V()).multiplyScalar(1 / P.length);
      const np = spec.ptsPer ? THREE.MathUtils.clamp(Math.round(P.length / spec.ptsPer), 6, spec.maxPts || 40) : 300;
      const k = Math.max(1, Math.ceil(P.length / np)), pts = P.filter((_, i) => i % k === 0).map(p => p.clone().sub(c));
      return { ...t, pts, n: P.length, org: KNOWN_ORG[t.id] || e.prov?.organisms?.[0] || null, r: 3.3 * Math.cbrt(k) * 1.12, R: Math.max(...pts.map(p => p.length())), vol: P.length * 135 };
    } catch (e) { console.warn('crowd', t.id, e); return null; } }));
  const S = shapes.filter(Boolean); if (!S.length) return null;
  /* how many copies: abundance first, then fill types up to the target volume fraction */
  const want = S.map(s => Math.round((s.perCell || 0) * boxVol / (spec.cellVol || 7e11)));
  S.forEach((s, i) => { s.expect = want[i]; s.scale = boxVol / (spec.cellVol || 7e11); });
  let vol = S.reduce((a, s, i) => a + want[i] * s.vol, 0); const fillers = S.map((s, i) => i).filter(i => S[i].fill);
  for (let g = 0; vol < (spec.phi || 0.15) * boxVol && fillers.length && g < (spec.maxFill || 3000); g++) { const i = fillers[g % fillers.length]; want[i]++; vol += S[i].vol; }
  /* place: biggest first (ribosomes before small enzymes) */
  const order = S.map((s, i) => i).sort((a, b) => S[b].vol - S[a].vol), bodies = [], _q = new THREE.Quaternion(), _p = new V();
  for (const i of order) {
    const s = S[i]; let placed = 0;
    for (let tries = 0; placed < want[i] && tries < want[i] * 40; tries++) {
      const c = new V(B.min.x + randVis() * size.x, B.min.y + randVis() * size.y, B.min.z + randVis() * size.z);
      if (!keep(c) || (s.keep && !s.keep(c))) continue;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(randVis() * 6.3, randVis() * 6.3, randVis() * 6.3));
      let ok = true; for (const p of s.pts) { _p.copy(p).applyQuaternion(q).add(c); if (!free(_p) || _p.y > B.max.y + 10) { ok = false; break; } }
      if (!ok) continue;
      for (const p of s.pts) { _p.copy(p).applyQuaternion(q).add(c); occ.add(K(_p.x, _p.y, _p.z)); }
      bodies.push({ i, c, q, c0: c.clone(), ph: randVis() * 100 }); placed++;
    }
    s.placed = placed;
  }
  /* one InstancedMesh per type; pale flat colours (the ink pass draws the outlines) */
  const root = new THREE.Group(), geo = new THREE.IcosahedronGeometry(1, 0);   /* 20 faces: flat-coloured background, keeps the frame rate */
  const meshes = S.map((s) => { const n = bodies.filter(b => b.i === S.indexOf(s)).length * s.pts.length;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.col || '#d8d2c4').lerp(new THREE.Color('#f6f4ef'), 0.35) }); mat.clippingPlanes = [cutPlane];   /* flat and pale: background, the ink pass outlines it */
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.frustumCulled = false; root.add(m); return m; });
  const _m = new THREE.Matrix4(), _s = new V(), _qq = new THREE.Quaternion();
  const draw = (t) => { const cnt = S.map(() => 0);
    for (const b of bodies) { const s = S[b.i], m = meshes[b.i];
      _qq.copy(b.q); _p.set(Math.sin(t * 0.21 + b.ph), Math.sin(t * 0.17 + b.ph * 1.3), Math.sin(t * 0.19 + b.ph * 0.7)).multiplyScalar(1.6).add(b.c0);
      for (const p of s.pts) { _m.compose(_s.copy(p).applyQuaternion(_qq).add(_p), _q, new V(s.r, s.r, s.r)); m.setMatrixAt(cnt[b.i]++, _m); } }
    meshes.forEach(m => m.instanceMatrix.needsUpdate = true); };
  draw(0);
  world.add(root); procWorld.push(root);
  const summary = S.filter(s => s.placed).map(s => `${s.label} ×${s.placed}`).join('、');
  console.log(`crowd: ${bodies.length} 个分子，体积分数 ${(100 * Math.min(vol, S.reduce((a, s) => a + s.placed * s.vol, 0)) / boxVol).toFixed(0)}%：${summary}`);
  const C = { root, draw, bodies, types: S, summary, scale: boxVol / (spec.cellVol || 7e11), phi: S.reduce((a, s) => a + s.placed * s.vol, 0) / boxVol }; crowdSets.push(C);
  return C;
}
let crowdSets = [];   /* every crowd of the scene (picking); cleared with the scene */
/* one statement for crowd numbers everywhere (card, evidence): abundance per E. coli cell from the literature x the share of the cell drawn;
   "fill" molecules only top up the total protein fraction; positions, orientations and motion are illustrative */
const CROWD_RULE = '数量 = 每个大肠杆菌细胞的文献丰度 × 画出部分占细胞的体积（膜蛋白按面积）比例；标为“填充”的分子只用来补足总蛋白体积分数；位置、朝向和运动为示意';
function showCrowdInfo(t, C) {
  clearSelection();
  const col = new THREE.Color(typeof t.col === 'string' ? t.col : 0xd8d2c4).getHexString();   /* A13: never raw text into style */
  $('infoT').innerHTML = `<span class="sw" style="background:#${col}"></span>`; $('infoT').append(t.label || t.id);
  const org = t.org || orgOf(t.id), si = standIn(t.id, org);
  let h = `<div class="sec"${si ? ' style="color:#a14a00"' : ''}><b>物种：${esc(orgName(org))}</b>${si ? '<br>' + esc(si) : ''}</div>`;
  h += `<div>PDB ${esc(t.id)} · 第一个生物组装体的 Cα / P 粗粒化外形（${(t.n || 0).toLocaleString()} 个残基）</div>`;
  const placed = t.placed ?? null;
  h += `<div class="sec"><b>数量</b>：${t.perCell ? `每个大肠杆菌细胞约 ${t.perCell.toLocaleString()} 个（文献）；画出的这部分按比例应有约 ${(t.expect ?? 0).toLocaleString()} 个${placed != null ? `，画出 ${placed.toLocaleString()} 个` : ''}` : `填充分子：画出 ${placed ?? '?'} 个，只用来补足总蛋白体积分数，不是它的文献丰度`}。<b>位置、朝向和运动为示意</b>。</div>`;
  const lk = linkFor(t.label, t.id === '4V6F' || t.id === '4YBB' ? 'ribosome' : ''), ln = lk && linkNote(lk, org);
  if (lk) h += `<div class="sec">${ln ? `<span style="color:#a14a00">${esc(ln)}</span><br>` : ''}<button class="openLink" data-k="${esc(lk)}">打开这个机器：${esc(presetName(lk))} →</button></div>`;
  if (C?.types?.length > 1) h += `<div class="sec"><button class="crowdTab">真实数量 vs 画出数量 ▾</button><div class="crowdTbl" style="display:none"></div></div>`;
  $('infoB').innerHTML = h; $('infoCard').style.display = 'block';
  $('infoB').querySelector('.openLink')?.addEventListener('click', (e) => openLinked(e.target.dataset.k, ln));
  $('infoB').querySelector('.crowdTab')?.addEventListener('click', (e) => {   /* audit: real count (literature x scale) against what is drawn, for every type */
    const box = $('infoB').querySelector('.crowdTbl'), on = box.style.display === 'none'; box.style.display = on ? 'block' : 'none';
    e.target.textContent = on ? '真实数量 vs 画出数量 ▴' : '真实数量 vs 画出数量 ▾'; if (!on || box.innerHTML) return;
    const rows = C.types.map(s => ({ s, real: s.expect ?? null, drawn: s.placed ?? 0 })), mx = Math.max(1, ...rows.map(r => Math.max(r.real ?? 0, r.drawn)));
    const bar = (v, c) => `<span style="display:inline-block;height:6px;width:${Math.max(1, Math.round(70 * v / mx))}px;background:${c};vertical-align:middle"></span>`;
    box.innerHTML = '<div style="color:var(--dim);margin:4px 0">真实 = 文献每细胞数 × 画出部分的比例（灰条）；画出 = 场景里放下的（彩条）。填充分子没有真实数。</div>'
      + rows.map(r => `<div style="display:grid;grid-template-columns:7.5em 1fr;gap:2px 6px;font-size:12px${r.s === t ? ';font-weight:600' : ''}"><span>${esc(r.s.label || r.s.id)}</span><span>`
        + (r.real != null ? `${bar(r.real, '#b9b4a8')} ${Math.round(r.real).toLocaleString()}<br>` : '<span style="color:var(--dim)">填充</span><br>')
        + `${bar(r.drawn, '#' + new THREE.Color(typeof r.s.col === 'string' ? r.s.col : 0xd8d2c4).getHexString())} ${r.drawn.toLocaleString()}</span></div>`).join('');
  });
}

