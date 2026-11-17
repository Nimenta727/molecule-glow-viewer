/* ============================================================================= WHOLE CELL: one scene from 2 um down to atoms
   The "cell corner" (atomic ribosome + KcsA in a lipid strip, pale crowd) is nested in a whole E. coli cell, drawn at three
   scales at the same time (everything is in A, one coordinate frame):
   - cell (~2 um): capsule envelope = inner and outer membrane, each two leaflet surfaces; nucleoid DNA (random-walk tubes,
     only ~3 % of the real length, drawn 5 nm thick so it is visible); one dot pair per ribosome (25 000 per cell, excluded from
     the nucleoid as observed); 5 flagella (cut to 3 um);
   - region (~300 nm around the corner): coarse copies of real structures - cytoplasm by abundance (buildCrowd with keepFn),
     inner-membrane proteins oriented by autoMembrane (ATP synthase, AcrB, LacY, AqpZ, AmtB), OmpF trimers in the outer
     membrane, peptidoglycan net (circumferential glycan strands + axial peptide cross-links), LPS;
   - machine / atoms: the cell-corner stations, unchanged.
   Only the half behind the cut plane is drawn. The camera flies between levels with the distance interpolated in log space;
   near / far planes and the ink fog follow the camera distance (frame loop, current.multiscale); a scale bar shows the scale. */
const ECOLI = { Rim: 4000, env: 240, L: 20000, uF: 3000, reg: 1500, regDepth: 1700 };   /* IM radius (bilayer centre), IM->OM, length tip to tip, corner position along the axis, region half size / depth (A) */
function shellMaterial(col, hole) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col), side: THREE.DoubleSide }); m.clippingPlanes = [cutPlane];
  if (hole) m.onBeforeCompile = (sh) => {   /* a rectangular hole where the atomic lipid strip of the cell corner is */
    Object.assign(sh.uniforms, { uHc: { value: hole.c }, uHd: { value: hole.d }, uHn: { value: hole.n }, uHs: { value: hole.s } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP; uniform vec3 uHc, uHd, uHn, uHs;')
      .replace('void main() {', 'void main() {\n  { vec3 q = vLP - uHc; if (abs(dot(q, uHd)) < uHs.x && abs(dot(q, uHn)) < uHs.y && abs(q.y) < uHs.z) discard; }');
  };
  return m;
}
/* capsule surface (cylinder + two hemispherical caps), axis F.e1 through F.o */
function capsuleGeo(F, R, H, nP = 160, nT = 128) {
  const S = Math.PI * R + 2 * H, prof = [];
  for (let i = 0; i <= nP; i++) { const a = S * i / nP; let u, r;
    if (a < Math.PI * R / 2) { const f = a / R; u = -H - R * Math.cos(f); r = R * Math.sin(f); }
    else if (a < Math.PI * R / 2 + 2 * H) { u = -H + a - Math.PI * R / 2; r = R; }
    else { const f = (S - a) / R; u = H + R * Math.cos(f); r = R * Math.sin(f); }
    prof.push([u, r]); }
  const pos = new Float32Array((nP + 1) * (nT + 1) * 3), idx = []; let k = 0;
  for (let i = 0; i <= nP; i++) for (let j = 0; j <= nT; j++) { const th = 2 * Math.PI * j / nT, [u, r] = prof[i];
    const p = F.at(u, th, r); pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z; }
  for (let i = 0; i < nP; i++) for (let j = 0; j < nT; j++) { const a = i * (nT + 1) + j, b = a + nT + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/* pale instanced blobs: list of {pts: [Vector3 world], r} -> one InstancedMesh */
function blobMesh(list, col, fade = 0.35) {
  const n = list.reduce((s, b) => s + b.pts.length, 0), mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).lerp(new THREE.Color('#f6f4ef'), fade) }); mat.clippingPlanes = [cutPlane];
  const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, Math.max(1, n)); m.count = n; m.frustumCulled = false;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); let i = 0;
  for (const b of list) for (const p of b.pts) { M.compose(p, q, sc.setScalar(b.r)); m.setMatrixAt(i++, M); }
  m.instanceMatrix.needsUpdate = true; return m;
}
/* a membrane protein's coarse shape, oriented by autoMembrane (membrane centre y = 0, normal +Y, cytoplasm / periplasm down) */
async function membraneShape(t) {
  const [e, info] = await Promise.all([loadEntry(t.id, true, false), fetchAutoInfo(t.id).catch(() => null)]);
  const M = autoMembrane(e, info); if (!M) return null;
  const P = e.atoms.filter(a => !a.na).map(a => a.p);
  if (t.outer) { const up = P.filter(p => p.y > M.half).length, dn = P.filter(p => p.y < -M.half).length;   /* outer membrane: the bigger loops face outward */
    if (dn > up) P.forEach(p => { p.y = -p.y; p.z = -p.z; }); }
  const np = THREE.MathUtils.clamp(Math.round(P.length / 45), 8, 70), k = Math.max(1, Math.ceil(P.length / np)), pts = P.filter((_, i) => i % k === 0).map(p => p.clone());
  const foot = Math.max(15, ...pts.filter(p => Math.abs(p.y) < 22).map(p => Math.hypot(p.x, p.z)));
  return { ...t, pts, r: 3.3 * Math.cbrt(k) * 1.12, foot, n: P.length, half: M.half, org: KNOWN_ORG[t.id] || e.prov?.organisms?.[0] || null };
}

PROCESSES.wholeCell = {
  lead: '大肠杆菌细胞（2 µm）：部分分子用其他物种的结构代表；数量按文献比例，位置为示意。',
  __proto__: PROCESSES.cellCorner,
  caption: '一个完整的大肠杆菌细胞（长 2 µm）：外膜、周质与肽聚糖、内膜，中间是拟核 DNA，周围是约 2.5 万个核糖体，外面是鞭毛。用右上角“镜头”一路放大：细胞 → 细胞一角（真实结构按丰度挤满的胞质、膜蛋白）→ 正在工作的核糖体和钾通道 → 原子。左下角是比例尺。',
  async setup(ctx) {
    await PROCESSES.cellCorner.setup.call(this, ctx);
    const V = THREE.Vector3, C = ECOLI, ym = this.ym, az = current?.camera?.az ?? 0;
    const e1 = new V(Math.cos(az), 0, -Math.sin(az)), ey = new V(0, 1, 0), e3 = new V(Math.sin(az), 0, Math.cos(az));
    const Fc = model.focus.centre.clone(), top = new V(Fc.x, ym, Fc.z), o = top.clone().addScaledVector(ey, -C.Rim).addScaledVector(e1, -C.uF);
    const Rom = C.Rim + C.env, H = C.L / 2 - Rom - 20;
    const F = { o, e1, ey, e3, at: (u, th, r) => o.clone().addScaledVector(e1, u).addScaledVector(ey, r * Math.cos(th)).addScaledVector(e3, r * Math.sin(th)),
      loc: (p) => { const q = p.clone().sub(o); return { u: q.dot(e1), y: q.dot(ey), w: q.dot(e3) }; } };
    this.F = F; this.H = H; this.Rom = Rom;
    const nBack = e3.clone().negate(), cutD = nBack.dot(Fc) + 6, behind = (p) => nBack.dot(p) > cutD, wCut = -(cutD - nBack.dot(o));   /* behind <=> w < wCut */
    const root = new THREE.Group(); world.add(root); procWorld.push(root); this.root = root;
    const add = (g, mat) => { const m = new THREE.Mesh(g, mat); m.frustumCulled = false; root.add(m); return m; };
    /* ---- hole in the inner membrane where the atomic lipid strip is (same rectangle as rebuildMembranes' strip) */
    const d = model.rowDir, nn = new V(-d.z, 0, d.x), c0 = model.focus.centre.clone().setY(0); let ulo = 1e9, uhi = -1e9, vlo = 1e9, vhi = -1e9;
    for (let i = 0; i < model.allAtoms.length; i += 3) { const p = model.allAtoms[i].p, q = new V(p.x - c0.x, 0, p.z - c0.z), u = q.dot(d), v = q.dot(nn); ulo = Math.min(ulo, u); uhi = Math.max(uhi, u); vlo = Math.min(vlo, v); vhi = Math.max(vhi, v); }
    ulo -= 25; uhi += 25; vlo -= 25; vhi += 25;
    const hole = { c: new V(c0.x + d.x * (ulo + uhi) / 2 + nn.x * (vlo + vhi) / 2, ym, c0.z + d.z * (ulo + uhi) / 2 + nn.z * (vlo + vhi) / 2), d, n: nn, s: new V((uhi - ulo) / 2 - 14, (vhi - vlo) / 2 - 14, 120) };
    const inHole = (p) => { const q = p.clone().sub(hole.c); return Math.abs(q.dot(d)) < hole.s.x + 30 && Math.abs(q.dot(nn)) < hole.s.y + 30 && Math.abs(q.y) < 300; };
    /* ---- envelope: inner membrane (two leaflets), outer membrane (two leaflets) */
    const imM = shellMaterial('#ecd3e4', hole), omM = shellMaterial('#eadcbf');
    for (const r of [C.Rim - 19, C.Rim + 19]) add(capsuleGeo(F, r, H), imM);
    for (const r of [Rom - 19, Rom + 19]) add(capsuleGeo(F, r, H), omM);
    /* ---- region box around the corner (local u, w, y) */
    const inRegion = (L) => Math.abs(L.u - C.uF) < C.reg && L.w > -C.reg && L.w < wCut && L.y > C.Rim - C.regDepth;
    this.region = { inRegion };
    /* ---- nucleoid: random-walk DNA in an ellipsoid around the axis (|u| < 0.72 H, r < 2300) */
    const nucU = H * 0.72, nucR = 2300, inNuc = (L) => (L.u / nucU) ** 2 + (L.y * L.y + L.w * L.w) / nucR ** 2 < 1;
    const dnaM = shellMaterial('#e9cf86'); let dnaLen = 0;
    for (let s = 0; s < 26; s++) {
      let p = new V((randVis() - 0.5) * nucU * 1.4, (randVis() - 0.5) * nucR, -randVis() * nucR * 0.9), dir = randDir(new V()); const pts = [];
      for (let i = 0; i < 70; i++) {
        pts.push(o.clone().addScaledVector(e1, p.x).addScaledVector(ey, p.y).addScaledVector(e3, p.z));
        dir.multiplyScalar(0.55).add(randDir(new V()).multiplyScalar(0.8)).normalize();
        const nx = p.clone().addScaledVector(dir, 300);
        if ((nx.x / nucU) ** 2 + (nx.y * nx.y + nx.z * nx.z) / nucR ** 2 > 1 || nx.z > -100) { dir = p.clone().multiplyScalar(-1).normalize().add(randDir(new V()).multiplyScalar(0.5)).normalize(); nx.copy(p).addScaledVector(dir, 300); }
        p = nx; dnaLen += 300;
      }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 420, 25, 5, false), dnaM);
    }
    /* ---- ribosomes of the whole cell: 25 000, uniform in the cytoplasm but ~90 % excluded from the nucleoid; drawn: behind the
       cut and outside the region box (the region has its own coarse ribosomes) */
    const Rr = C.Rim - 150, big = [], small = []; let nR = 0;
    while (nR < 25000) {
      const u = (randVis() * 2 - 1) * (H + Rr), cap = Math.abs(u) > H ? Math.sqrt(Math.max(0, Rr * Rr - (Math.abs(u) - H) ** 2)) : Rr;
      if (randVis() > (cap / Rr) ** 2) continue;
      const th = randVis() * 2 * Math.PI, r = cap * Math.sqrt(randVis()), L = { u, y: r * Math.cos(th), w: r * Math.sin(th) };
      if (inNuc(L) && randVis() < 0.9) continue;
      nR++; if (L.w > wCut - 120 || inRegion(L)) continue;
      const p = F.at(u, th, r); big.push(p); small.push(p.clone().addScaledVector(randDir(new V()), 95));
    }
    this.cellRib = [blobMesh([{ pts: big, r: 115 }], '#e6d6b8', 0.2), blobMesh([{ pts: small, r: 88 }], '#cfdbe9', 0.2)]; root.add(...this.cellRib);   /* shown at cell scale only: closer in, the region's own coarse structures take over */
    this.nRibDrawn = big.length;
    /* ---- flagella: 5, peritrichous, on the back half; normal filament = left-handed helix, pitch ~2.3 um, radius ~0.2 um (cut to 3 um) */
    const flM = shellMaterial('#a9cfb2'), motM = shellMaterial('#8fb0d6'); this.flTip = null;
    for (let f = 0, tries = 0; f < 5 && tries < 200; tries++) {
      const u = (randVis() * 2 - 1) * H * 0.9, th = Math.PI + (randVis() - 0.5) * 2.2;   /* back: sin(th) < 0 */
      if (Math.sin(th) > -0.4 || (Math.abs(u - C.uF) < C.reg + 400 && Math.cos(th) > 0)) continue;
      const B = F.at(u, th, Rom + 20), n = F.at(u, th, 1).sub(F.at(u, th, 0)).normalize();
      const D = e1.clone().multiplyScalar(-1).addScaledVector(n, 0.45).addScaledVector(e3, -0.2).normalize();
      const P1 = n.clone().addScaledVector(D, -n.dot(D)).normalize(), P2 = new V().crossVectors(D, P1), pts = [];
      for (let s = 0; s <= 30000; s += 150) { const a = 1900 * Math.min(1, s / 3000), ph = -2 * Math.PI * s / 23000;
        pts.push(B.clone().addScaledVector(n, Math.min(s, 400)).addScaledVector(D, Math.max(0, s - 400)).addScaledVector(P1, a * (Math.cos(ph) - 1)).addScaledVector(P2, a * Math.sin(ph))); }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 100, 6, false), flM);
      const mot = add(new THREE.CylinderGeometry(230, 230, C.env + 160, 16), motM); mot.position.copy(F.at(u, th, C.Rim + C.env / 2 - 40)); mot.quaternion.setFromUnitVectors(ey, n);
      if (!this.flTip) this.flTip = pts[60]; f++;
    }
    /* ---- region: envelope details (lines are cheap), membrane proteins, cytoplasm */
    status('整个细胞：下载膜蛋白与胞质蛋白结构…', true);
    const regU = (k) => C.uF + (randVis() * 2 - 1) * C.reg, regTh = (R) => { const w = -C.reg + randVis() * (wCut + C.reg); return Math.asin(THREE.MathUtils.clamp(w / R, -1, 1)); };
    { const Rpg = Rom - 110, seg = [], th0 = Math.asin(-C.reg / Rpg), th1 = Math.asin(Math.min(1, wCut / Rpg));
      for (let u = C.uF - C.reg; u <= C.uF + C.reg; u += 45) for (let th = th0; th < th1;) {   /* glycan strands: circumferential, 20-60 nm, with gaps */
        const len = (200 + randVis() * 400) / Rpg, end = Math.min(th1, th + len);
        for (let a = th; a < end; a += 30 / Rpg) { seg.push(F.at(u, a, Rpg), F.at(u, Math.min(end, a + 30 / Rpg), Rpg));
          if (randVis() < 0.35 && u + 45 <= C.uF + C.reg) seg.push(F.at(u, a, Rpg), F.at(u + 45, a, Rpg)); }   /* peptide cross-link to the next strand */
        th = end + (20 + randVis() * 40) / Rpg; }
      const lps = []; for (let i = 0; i < 7000; i++) { const u = regU(), th = regTh(Rom); lps.push(F.at(u, th, Rom + 19), F.at(u + (randVis() - 0.5) * 8, th + (randVis() - 0.5) * 0.002, Rom + 52)); }
      for (const [L, col] of [[seg, '#9cc283'], [lps, '#c9ae7e']]) { const g = new THREE.BufferGeometry().setFromPoints(L), m = new THREE.LineBasicMaterial({ color: col }); m.clippingPlanes = [cutPlane];
        const ls = new THREE.LineSegments(g, m); ls.frustumCulled = false; root.add(ls); } }
    const IMT = [
      { id: '6OQR', label: 'ATP 合酶', perCell: 3000, col: '#c9d7ee' },
      { id: '1IWG', label: 'AcrB 外排泵', perCell: 500, col: '#d9cbe8' },
      { id: '1PV6', label: 'LacY 乳糖通透酶', fill: 1, col: '#e6d0c8' },
      { id: '1RC2', label: 'AqpZ 水通道', fill: 1, col: '#c8e0e3' },
      { id: '1U7G', label: 'AmtB 氨通道', fill: 1, col: '#d6e4c8' } ];
    const OMT = [{ id: '2OMF', label: 'OmpF 孔蛋白', perCell: 33000, col: '#e3d6b4', outer: true }];
    const shapes = (await Promise.all([...IMT, ...OMT].map(t => membraneShape(t).catch(e => { console.warn('membrane shape', t.id, e); return null; })))).filter(Boolean);
    const occ2 = new Set(), key2 = (L, R) => Math.round(L.u / 22) * 100000 + Math.round(R * Math.atan2(L.w, L.y) / 22);
    const area = 2 * C.reg * (wCut + C.reg), imArea = 2 * Math.PI * C.Rim * 2 * H + 4 * Math.PI * C.Rim ** 2, omArea = 2 * Math.PI * Rom * 2 * H + 4 * Math.PI * Rom ** 2;
    const occPts = [], placedBy = new Map(), regionTags = [];
    const place = (list, R, cover, cellArea) => {
      const want = list.map(s => Math.round((s.perCell || 0) * area / cellArea)); list.forEach((s, i) => { s.expect = want[i]; }); let cov = list.reduce((a, s, i) => a + want[i] * Math.PI * s.foot ** 2, 0);
      const fill = list.map((s, i) => i).filter(i => list[i].fill); for (let g = 0; cov < cover * area && fill.length && g < 3000; g++) { const i = fill[g % fill.length]; want[i]++; cov += Math.PI * list[i].foot ** 2; }
      list.map((s, i) => i).sort((a, b) => list[b].n - list[a].n).forEach(i => { const s = list[i], bodies = []; placedBy.set(s, bodies);
        for (let tries = 0; bodies.length < want[i] && tries < want[i] * 30; tries++) {
          const u = regU(), th = regTh(R), nrm = F.at(u, th, 1).sub(F.at(u, th, 0)).normalize(), cen = F.at(u, th, R);
          if (!behind(cen)) continue;
          const q = new THREE.Quaternion().setFromUnitVectors(ey, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(ey, randVis() * 6.3));
          const pts = s.pts.map(p => p.clone().applyQuaternion(q).add(cen)), keys = pts.map(p => key2(F.loc(p), R));
          if (keys.some(k => occ2.has(k)) || pts.some(inHole)) continue;
          keys.forEach(k => occ2.add(k)); bodies.push({ pts, r: s.r, cen }); occPts.push(...pts);
        }
        s.placed = bodies.length;
        if (bodies.length) { root.add(blobMesh(bodies, s.col));
          const mid = bodies.reduce((a, b) => b.cen.distanceTo(top) < a.cen.distanceTo(top) ? b : a);
          regionTags.push(makeTag(`${s.label} ×${bodies.length}`, { p: mid.cen.clone().addScaledVector(F.at(C.uF, 0, 1).sub(F.at(C.uF, 0, 0)), s.outer ? 60 : -90), cls: 'small' })); }
      });
    };
    place(shapes.filter(s => !s.outer), C.Rim, 0.2, imArea);
    place(shapes.filter(s => s.outer), Rom, 0.6, omArea);
    { const T = shapes.filter(s => placedBy.get(s)?.length), B = T.flatMap((s, i) => placedBy.get(s).map(b => ({ i, c0: b.cen })));   /* pickable like the crowd */
      T.forEach(s => { s.R = Math.max(...placedBy.get(s)[0].pts.map(p => p.distanceTo(placedBy.get(s)[0].cen))); });
      if (B.length) crowdSets.push({ root, bodies: B, types: T, membrane: true }); }
    /* ---- region cytoplasm: same abundance list as the corner, coarser shapes, outside the corner's own crowd box */
    const cb = this.crowdBox, inCB = (p) => p.x > cb.min.x - 20 && p.x < cb.max.x + 20 && p.y > cb.min.y - 20 && p.y < cb.max.y + 40 && p.z > cb.min.z - 20 && p.z < cb.max.z + 20;
    const corners = []; for (const su of [-1, 1]) for (const sw of [-1, 1]) for (const yy of [C.Rim - C.regDepth, C.Rim + 40]) corners.push(o.clone().addScaledVector(e1, C.uF + su * C.reg).addScaledVector(e3, sw * C.reg).addScaledVector(ey, yy));
    const bmin = corners.reduce((a, p) => a.min(p), corners[0].clone()), bmax = corners.reduce((a, p) => a.max(p), corners[0].clone());
    const cyto = (p) => { const L = F.loc(p); return inRegion(L) && Math.hypot(L.y, L.w) < C.Rim - 45 && !inCB(p); };
    this.regCrowd = await buildCrowd({ box: { min: bmin, max: bmax }, keepFn: cyto, keepSide: { n: nBack, d: cutD }, phi: 0.12, cellVol: 7e11, cell: 14, ptsPer: 60, maxPts: 40, maxFill: 6000, occPts,
      types: [
        { id: '1EFT', label: 'EF-Tu', perCell: 60000, col: '#cdd9e8', fill: 2 },
        { id: '4V6F', label: '70S 核糖体', perCell: 25000, col: '#e6dccb', keep: (p) => !inNuc(F.loc(p)) },
        { id: '6ALH', label: 'RNA 聚合酶', perCell: 3000, col: '#d6e2d0' },
        { id: '1AON', label: 'GroEL/GroES', perCell: 1500, col: '#e2d5e6' },
        { id: '1GD1', label: '甘油醛-3-磷酸脱氢酶', perCell: 0, col: '#dcd6c8', fill: 1 },
        { id: '1PKN', label: '丙酮酸激酶', perCell: 0, col: '#d3dbd8', fill: 1 },
        { id: '1TIM', label: '磷酸丙糖异构酶', perCell: 0, col: '#e0d8d0', fill: 1 },
        { id: '4AKE', label: '腺苷酸激酶', perCell: 0, col: '#d8dce6', fill: 1 } ] }).catch(e => { console.warn('region crowd', e); return null; });
    this.memSummary = shapes.map(s => `${s.label} ×${placedBy.get(s)?.length || 0}`).join('、');
    /* ---- labels per zoom level */
    const T = (txt, p, cls = 'small') => makeTag(txt, { p, cls });
    const cellTags = [
      T('外膜（脂多糖在外层）', F.at(-H * 0.55, Math.PI * 0.62, Rom + 300)),
      T('内膜（细胞膜）', F.at(-H * 0.2, Math.PI * 0.7, C.Rim - 250)),
      T(`拟核：DNA（只画约 ${Math.round(100 * dnaLen / 1.6e7)}%，按比例 2 nm 粗看不见）`, F.at(-H * 0.3, Math.PI * 0.5, 600)),
      T('核糖体（一对小球 = 一个，约 2.5 万个）', F.at(H + 1200, Math.PI * 0.6, 1500)),
      T('细胞一角：从这里一直放大到原子', top.clone().addScaledVector(ey, 500), 'hl') ];
    if (this.flTip) cellTags.push(T('鞭毛（截到 3 µm；马达穿过整个包膜）', this.flTip));
    regionTags.push(T('外膜 · 脂多糖', F.at(C.uF + C.reg * 0.8, 0, Rom + 90)), T('周质 + 肽聚糖网', F.at(C.uF + C.reg * 0.8, 0, Rom - 110)),
      T('内膜', F.at(C.uF + C.reg * 0.8, 0, C.Rim - 60)), T('细胞质：真实结构按丰度挤满', F.at(C.uF - C.reg * 0.7, -0.15, C.Rim - 700)));
    const cellSet = new Set(cellTags), regSet = new Set(regionTags), kTag = this.kTag;
    tagFilter = (t) => this.level === 'cell' ? cellSet.has(t) : this.level === 'region' ? regSet.has(t) || t === kTag : !cellSet.has(t) && !regSet.has(t);
    this.level = 'machine'; this.startCell = !current?._restore;   /* coming back: keep the saved camera */
    this.pts = { cell: o.clone(), region: top.clone().addScaledVector(ey, -650) };
    console.log(`wholeCell：核糖体点 ${this.nRibDrawn}，膜蛋白 ${this.memSummary}，区域胞质 ${this.regCrowd?.bodies.length ?? 0} 个分子`);
  },
  dispose() { if (typeof this._zfL === 'function') controls.removeEventListener('start', this._zfL); this._zfL = null; },   /* clearScene: no listener (and no closure over 25 000 ribosome points) outlives the scene */
  update(ctx, dt) {
    PROCESSES.cellCorner.update.call(this, ctx, dt);
    const M = world.matrixWorld;
    if (this.startCell) { this.startCell = false; const t = this.pts.cell.clone().applyMatrix4(M), dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(t); camera.position.copy(t).addScaledVector(dir, fitDist(ECOLI.L / 2 + 1500)); controls.update(); }
    if (!this._zfL) { this._zfL = () => { this.zf = null; }; controls.addEventListener('start', this._zfL); }
    if (this.zf) { const z = this.zf, k = Math.min(1, (performance.now() - z.s) / z.ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      const t = z.t0.clone().lerp(z.t1, e), d = Math.exp(Math.log(z.d0) + (Math.log(z.d1) - Math.log(z.d0)) * e);
      controls.target.copy(t); camera.position.copy(t).addScaledVector(z.dir0.clone().lerp(z.dir1, e).normalize(), d); if (k >= 1) this.zf = null; }
    const dist = camera.position.distanceTo(controls.target), lv = dist > 14000 ? 'cell' : dist > 2600 ? 'region' : 'machine';
    if (lv !== this.level) { this.level = lv; this.cellRib.forEach(m => m.visible = lv === 'cell'); $('cellHd').firstChild.textContent = `整个细胞 · ${{ cell: '细胞（2 µm）', region: '细胞一角（约 300 nm）', machine: '分子机器（约 30 nm）' }[lv]} `; }
    /* scale bar */
    let sb = $('scaleBar'); if (!sb) { sb = document.createElement('div'); sb.id = 'scaleBar'; document.body.appendChild(sb); }
    const pxA = innerHeight / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    let len = 10; for (const L of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) if (L * pxA <= 150) len = L;
    sb.style.display = ''; sb.innerHTML = `<i style="width:${(len * pxA).toFixed(0)}px"></i>${len >= 10000 ? len / 10000 + ' µm' : len / 10 + ' nm'}`;
  },
  zoomTo(t1, d1, ms = 1900) { camFly = null;   /* the view also swings back to face the cut (el 0.12) */
    const dir1 = this.F.e3.clone().multiplyScalar(Math.cos(0.12)).addScaledVector(this.F.ey, Math.sin(0.12)).transformDirection(world.matrixWorld);
    this.zf = { t0: controls.target.clone(), t1, d0: camera.position.distanceTo(controls.target), d1, dir0: camera.position.clone().sub(controls.target).normalize(), dir1, s: performance.now(), ms }; },
  look(v) {
    const M = world.matrixWorld;
    if (v === 'cell') { this.view = 'all'; renderEnergy(); return this.zoomTo(this.pts.cell.clone().applyMatrix4(M), fitDist(ECOLI.L / 2 + 1500)); }
    if (v === 'region') { this.view = 'all'; renderEnergy(); return this.zoomTo(this.pts.region.clone().applyMatrix4(M), fitDist(1450)); }
    if (v === 'all') { this.view = 'all'; renderEnergy(); const c = current.camera, R = model.focus.radius + 6, vh = THREE.MathUtils.degToRad(camera.fov / 2), half = Math.min(vh, Math.atan(Math.tan(vh) * safeAspect()));
      const t = model.focus.centre.clone().applyMatrix4(M); t.y -= 0.16 * R * c.dist; return this.zoomTo(t, R / Math.sin(half) * c.dist); }
    return PROCESSES.cellCorner.look.call(this, v);
  },
  explain() {
    const r = this.regCrowd;
    return [`━━ 整个细胞（大肠杆菌）━━
长 2 µm、直径约 0.85 µm。包膜从外到内：外膜（外层是脂多糖）、周质（约 21 nm，中间一层肽聚糖网）、内膜。镜头按钮或滚轮都能在三个尺度之间缩放，比例尺在左下角。
· 核糖体：每个细胞约 2.5 万个，这里一对小球代表一个（只画剖面后方，约 ${this.nRibDrawn} 个）；约 90% 被拟核排斥，所以集中在拟核外和两极——这是荧光显微镜里看到的分布。
· 拟核 DNA：真实长度约 1.6 mm（4.6 Mb），只画了很少一部分，并且画成 5 nm 粗（按比例 2 nm 在这个尺度看不见）。
· 鞭毛：5 根，周生；丝直径 20 nm，正常形态是左手螺旋（螺距约 2.3 µm），这里截到 3 µm（真实 5–10 µm）。马达（基体）穿过整个包膜。
━━ 细胞一角（约 300 nm）━━
· 内膜蛋白（用自动定膜把每个结构按 OPM / PDBTM 跨膜片段放进膜里，胞质侧朝内）：${this.memSummary}。数量：ATP 合酶、AcrB 按每细胞拷贝数换算，其余几种补到约 20% 膜面积（真实内膜一半是蛋白，种类上千）。
· 胞质：${r ? r.summary : '—'}，体积分数约 ${r ? Math.round(r.phi * 100) : '—'}%（真实约 20–30%，略稀以便看清）。
· 肽聚糖：糖链沿圆周方向（每条 20–60 nm）、肽交联沿长轴，单层；脂多糖画成外膜外的短线。都是示意的网格，不是具体结构。
· 没有画：周质蛋白、MreB / FtsZ 骨架、mRNA 和多聚核糖体、小分子代谢物。`, '', PROCESSES.cellCorner.explain.call(this)].join('\n');
  },
  get cell() {
    if (this._wcell) return this._wcell;
    const base = Object.getOwnPropertyDescriptor(PROCESSES.cellCorner, 'cell').get.call(Object.create(PROCESSES.cellCorner));
    const rest = base.controls.filter((c, i) => !(i === 0 && c.type === 'section') && !(c.type === 'button' && ['全景', '看核糖体', '看钾通道'].includes(c.label)));
    return this._wcell = { ...base, title: '整个细胞', controls: [
      { type: 'section', label: '镜头（缩放尺度）' },
      { type: 'button', label: '整个细胞', run: () => proc?.look?.('cell') },
      { type: 'button', label: '细胞一角', run: () => proc?.look?.('region') },
      { type: 'button', label: '分子机器', run: () => proc?.look?.('all') },
      { type: 'button', label: '核糖体', run: () => proc?.look?.('rib') },
      { type: 'button', label: '钾通道', run: () => proc?.look?.('k') }, ...rest ] };
  },
};

