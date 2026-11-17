/* ----------------------------------------------------------------------------- schematic (cartoon) representation
   Only CA (and P) are downloaded, so secondary structure is assigned from CA geometry (P-SEA-like):
   helix  : d(i,i+3) ~ 5.1 A and d(i,i+4) ~ 6.2 A for >= 5 residues
   strand : extended (d(i-1,i+1) > 6.1, d(i-1,i+2) > 8.6) AND a non-local extended partner within 5.6 A, >= 3 residues
   Geometry: one continuous swept tube per chain fragment; the cross-section changes with SS:
   coil = thin round tube, helix = thick rod along the helix axis, strand = flat ribbon with arrow head.
   Extra coordinate sets (alternative conformations, morph state 2) become morph targets of the same mesh. */
function chainFragments(atoms) {
  const by = new Map(); atoms.forEach((a, i) => { if (!by.has(a.asym)) by.set(a.asym, []); by.get(a.asym).push(i); });
  const frags = [];
  for (const [asym, ids] of by) {
    ids.sort((i, j) => atoms[i].seq - atoms[j].seq);
    let cur = [ids[0]];
    for (let k = 1; k < ids.length; k++) {
      const a = atoms[ids[k - 1]], b = atoms[ids[k]];
      if (a.p.distanceTo(b.p) > (a.na ? 8.5 : 4.4)) { frags.push({ asym, idx: cur }); cur = []; }
      cur.push(ids[k]);
    }
    frags.push({ asym, idx: cur });
  }
  return frags;
}
function dropShortRuns(I, ss, v, minLen) {
  let st = -1;
  for (let k = 0; k <= I.length; k++) {
    const on = k < I.length && ss[I[k]] === v;
    if (on && st < 0) st = k;
    if (!on && st >= 0) { if (k - st < minLen) for (let j = st; j < k; j++) ss[I[j]] = 0; st = -1; }
  }
}
function assignSS(atoms, frags) {
  const ss = new Uint8Array(atoms.length), cand = [], P = (i) => atoms[i].p;
  /* chains with deposited annotation (a.ss from applyDepositedSS) use it; the CA-geometry rule only fills the rest */
  const annotated = new Set(atoms.filter(a => a.ss > 0).map(a => a.asym));
  const sheetKnown = new Set(atoms.filter(a => a.ssK === 2 && a.ss > 0).map(a => a.asym));
  if (annotated.size) atoms.forEach((a, i) => { if (annotated.has(a.asym)) ss[i] = a.ss; });
  const guess = (i) => !annotated.has(atoms[i].asym);
  for (const f of frags) {
    const I = f.idx, n = I.length; if (!n || atoms[I[0]].na) continue;
    if (guess(I[0])) for (let k = 0; k + 4 < n; k++) {
      const d3 = P(I[k]).distanceTo(P(I[k + 3])), d4 = P(I[k]).distanceTo(P(I[k + 4]));
      if (Math.abs(d3 - 5.1) < 0.7 && Math.abs(d4 - 6.2) < 0.9) for (let j = 0; j <= 4; j++) ss[I[k + j]] = 1;
    }
    if (guess(I[0])) dropShortRuns(I, ss, 1, 5);
    for (let k = 1; k + 1 < n; k++) {
      if (ss[I[k]] || sheetKnown.has(atoms[I[k]].asym)) continue;
      const d2 = P(I[k - 1]).distanceTo(P(I[k + 1])), d3 = k + 2 < n ? P(I[k - 1]).distanceTo(P(I[k + 2])) : 10;
      if (d2 > 6.1 && d3 > 8.6) cand.push(I[k]);
    }
  }
  const cell = 6, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  for (const i of cand) { const p = P(i), k = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  for (const i of cand) {
    if (sheetKnown.has(atoms[i].asym) || ss[i]) continue;   // helix-only annotation: strands may still be guessed
    const p = P(i), gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), gz = Math.floor(p.z / cell);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) for (let dz = -1; dz <= 1 && !found; dz++) {
      for (const j of grid.get(key(gx + dx, gy + dy, gz + dz)) || [])
        if (j !== i && (atoms[j].asym !== atoms[i].asym || Math.abs(atoms[j].seq - atoms[i].seq) > 3) && p.distanceTo(P(j)) < 5.6) { found = true; break; }
    }
    if (found) ss[i] = 2;
  }
  for (const f of frags) if (!sheetKnown.has(atoms[f.idx[0]].asym)) dropShortRuns(f.idx, ss, 2, 3);
  return ss;
}
/* sweep one fragment: X = positions (Vector3[]), ss codes, S samples per residue, M points per ring.
   Returns ring positions (Float32Array, N*M*3) and the residue index of every ring (for colours). */
function sweepFragment(X, ss, na, S, M) {
  const n = X.length;
  const Q = X.map((p, k) => {
    if (ss[k] === 1) { const c = new THREE.Vector3(); let m = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < n && ss[j] === 1) { c.add(X[j]); m++; } return c.multiplyScalar(1 / m); }
    if (ss[k] === 2 && k > 0 && k < n - 1) return X[k].clone().multiplyScalar(0.5).addScaledVector(X[k - 1], 0.25).addScaledVector(X[k + 1], 0.25);
    return X[k].clone();
  });
  const prof = (k) => na ? [1.5, 1.5] : ss[k] === 1 ? [2.1, 2.1] : ss[k] === 2 ? [1.7, 0.45] : [0.7, 0.7];
  const arrowEnd = (k) => ss[k] === 2 && (k === n - 1 || ss[k + 1] !== 2);
  const W = new Array(n).fill(null); let prevB = null;
  for (let k = 0; k < n; k++) {
    if (ss[k] !== 2) { prevB = null; continue; }
    const b = X[Math.max(0, k - 1)].clone().add(X[Math.min(n - 1, k + 1)]).sub(X[k].clone().multiplyScalar(2));
    if (b.lengthSq() < 1e-6) continue;
    if (prevB && b.dot(prevB) < 0) b.negate();
    prevB = b;
    const t = Q[Math.min(n - 1, k + 1)].clone().sub(Q[Math.max(0, k - 1)]).normalize();
    W[k] = new THREE.Vector3().crossVectors(t, b).normalize();
  }
  const curve = n > 2 ? new THREE.CatmullRomCurve3(Q, false, 'catmullrom', 0.5) : null;
  const N = (n - 1) * S + 1, pts = [], tans = [];
  for (let s = 0; s < N; s++) { const u = s / S; pts.push(curve ? curve.getPoint(u / (n - 1)) : Q[0].clone().lerp(Q[1], u)); }
  let lastT = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s < N; s++) {
    const t = pts[Math.min(N - 1, s + 1)].clone().sub(pts[Math.max(0, s - 1)]);
    if (t.lengthSq() < 1e-10) t.copy(lastT); else t.normalize();
    tans.push(t); lastT = t;
  }
  const nrm = new THREE.Vector3(0, 1, 0); if (Math.abs(tans[0].y) > 0.9) nrm.set(1, 0, 0);
  const pos = new Float32Array(N * M * 3), res = new Int32Array(N), ey = new THREE.Vector3();
  for (let s = 0; s < N; s++) {
    const u = s / S, r = Math.min(Math.floor(u), n - 2), f = u - r, t = tans[s];
    res[s] = f < 0.5 ? r : r + 1;
    nrm.addScaledVector(t, -nrm.dot(t)); if (nrm.lengthSq() < 1e-8) nrm.set(t.y, -t.x, 0); nrm.normalize();
    let A, B;
    if (ss[r] === 2 && arrowEnd(r + 1)) { A = 2.7 * (1 - f) + 0.25 * f; B = 0.45; }
    else { const p0 = prof(r), p1 = prof(r + 1), e = f * f * (3 - 2 * f); A = p0[0] + (p1[0] - p0[0]) * e; B = p0[1] + (p1[1] - p0[1]) * e; }
    const wa = W[r], wb = W[r + 1];
    if ((ss[r] === 2 || ss[r + 1] === 2) && (wa || wb)) {
      const w = (wa && wb) ? wa.clone().lerp(wb, f) : (wa || wb).clone();
      w.addScaledVector(t, -w.dot(t)); if (w.lengthSq() > 1e-8) nrm.copy(w.normalize());
    }
    ey.crossVectors(t, nrm).normalize();
    for (let j = 0; j < M; j++) {
      const ang = 2 * Math.PI * j / M, c = Math.cos(ang) * A, sn = Math.sin(ang) * B, o = (s * M + j) * 3;
      pos[o] = pts[s].x + nrm.x * c + ey.x * sn; pos[o + 1] = pts[s].y + nrm.y * c + ey.y * sn; pos[o + 2] = pts[s].z + nrm.z * c + ey.z * sn;
    }
  }
  return { pos, res };
}
function buildCartoon(g, colorOf) {
  const qual = $('quality').value, S = qual === 'low' ? 2 : qual === 'medium' ? 3 : 4, M = qual === 'low' ? 6 : qual === 'medium' ? 8 : 10;
  const atoms = g.atoms, frags = g.frags || (g.frags = chainFragments(atoms)), ss = g.ss || (g.ss = assignSS(atoms, frags));
  const keys = g.confKeys || [], hasP2 = atoms.some(a => a.p2);
  const sets = [(a) => a.p, ...keys.map(k => (a) => a.alts?.[k] || a.p), ...(hasP2 ? [(a) => a.p2 || a.p] : [])];
  const byChain = new Map();
  for (const f of frags) { if (f.idx.length < 2) continue; if (!byChain.has(f.asym)) byChain.set(f.asym, []); byChain.get(f.asym).push(f); }
  const grp = new THREE.Group(), mat = cartoonMaterial(), col = new THREE.Color();
  const cat = (arrs) => { const o = new Float32Array(arrs.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of arrs) { o.set(x, k); k += x.length; } return o; };
  for (const [asym, fl] of byChain) {
    const posArrs = sets.map(() => []), idx = [], colors = []; let base = 0;
    for (const f of fl) {
      const fss = f.idx.map(i => ss[i]), na = atoms[f.idx[0]].na; let res;
      sets.forEach((get, si) => { const o = sweepFragment(f.idx.map(i => get(atoms[i])), fss, na, S, M); posArrs[si].push(o.pos); if (!si) res = o.res; });
      const N = res.length;
      for (let s = 0; s < N; s++) { col.set(colorOf ? colorOf(atoms[f.idx[res[s]]]) : g.color); for (let j = 0; j < M; j++) colors.push(col.r, col.g, col.b); }
      for (let s = 0; s < N - 1; s++) for (let j = 0; j < M; j++) { const a = base + s * M + j, b = base + s * M + (j + 1) % M; idx.push(a, a + M, b, b, a + M, b + M); }
      base += N * M;
    }
    const geo = new THREE.BufferGeometry(), P0 = cat(posArrs[0]);
    geo.setAttribute('position', new THREE.BufferAttribute(P0, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    if (sets.length > 1) {
      geo.morphTargetsRelative = true; geo.morphAttributes.position = []; geo.morphAttributes.normal = [];
      const N0 = geo.attributes.normal.array;
      for (let si = 1; si < sets.length; si++) {
        const Pi = cat(posArrs[si]), tmp = new THREE.BufferGeometry();
        tmp.setAttribute('position', new THREE.BufferAttribute(Pi, 3)); tmp.setIndex(idx); tmp.computeVertexNormals();
        const N1 = tmp.attributes.normal.array;
        geo.morphAttributes.position.push(new THREE.BufferAttribute(Pi.map((v, k) => v - P0[k]), 3));
        geo.morphAttributes.normal.push(new THREE.BufferAttribute(N1.map((v, k) => v - N0[k]), 3));
        tmp.dispose();
      }
    }
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
    mesh.userData = { cartoon: true, asym, keys, p2Index: hasP2 ? sets.length - 2 : -1 };
    grp.add(mesh);
    if (illustrative()) { const o = outlineOf(mesh, { k: '0.0012' }); mesh.add(o); }   // thinner on ribbons
  }
  if ($('shellOn').checked && !illustrative()) for (const kind of ['depth', 'color']) {
    const m = blobMaterial({ cutaway: g.ghost, shell: kind });
    const sh = blobInstances(g, colorOf, m, 1.45, qual === 'high' ? 2 : 1);
    sh.userData.shell = true; sh.renderOrder = kind === 'depth' ? 1 : 2;
    grp.add(sh);
  }
  return grp;
}
