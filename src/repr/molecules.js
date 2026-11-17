/* ----------------------------------------------------------------------------- small molecules */
const SPH = new THREE.IcosahedronGeometry(1, 2), CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
function bondsOf(atoms) {   // distance-based bonds for structure ligands
  const out = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const ri = elStyle(atoms[i].el)[2], rj = elStyle(atoms[j].el)[2];
    if (!ri || !rj) continue;
    if (atoms[i].p.distanceTo(atoms[j].p) < ri + rj + 0.45) out.push([i, j, 1]);
  }
  return out;
}
/* bonds with orders from the CCD template, matched by atom name (structure ligands and residues carry names) */
function bondsFromTemplate(atoms, tpl, nameKey = 'name') {
  if (!tpl || !tpl.atoms.length) return null;
  const at = new Map(); atoms.forEach((a, i) => { if (a[nameKey]) at.set(a[nameKey], i); });
  const out = [];
  for (const [i, j, o] of tpl.bonds) { const a = at.get(tpl.atoms[i].name), b = at.get(tpl.atoms[j].name); if (a != null && b != null) out.push([a, b, o]); }
  return out.length ? out : null;
}
const ligStyle = () => $('ligStyle')?.value || 'ball';
const VDW_R = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98, MG: 1.73, K: 2.75, NA: 2.27, CA: 2.31, ZN: 1.39, FE: 1.94, CU: 1.4, MN: 1.97 };
/* small molecules for many molecules at once. mols: [{atoms, bonds?, centre}] -> Group
   style 'ball'    : ball-and-stick (atom balls, double bonds slightly thicker)
   style 'valence' : 价键 / licorice with bond orders (CCD): single = one stick, double = two, triple = three,
                     aromatic = a stick plus a dashed inner line toward the ring centre; atoms are just joints
   style 'space'   : space-filling, van der Waals radii */
function buildMolecules(mols, scale, carbon, style = ligStyle()) {
  const balls = [], solid = [], dash = [];
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  for (const M of mols) {
    const c = M.centre, P = (p) => p.clone().sub(c).multiplyScalar(scale).add(c);
    const bonds = style === 'space' ? [] : (M.bonds || bondsOf(M.atoms));
    const nb = M.atoms.map(() => []); for (const [i, j] of bonds) { nb[i].push(j); nb[j].push(i); }
    M.atoms.forEach((a, i) => balls.push([P(a.p), a.el, nb[i].length]));
    for (const [i, j, o] of bonds) {
      const A = P(M.atoms[i].p), B = P(M.atoms[j].p), ea = M.atoms[i].el, eb = M.atoms[j].el;
      if (style !== 'valence') { solid.push([A, B, 0.24 * scale * (o > 1 ? 1.3 : 1), ea, eb]); continue; }
      /* offset direction in the plane of a neighbouring bond (inside the ring for aromatic bonds) */
      const d = B.clone().sub(A).normalize(), k = nb[i].find(x => x !== j) ?? nb[j].find(x => x !== i);
      let perp = null;
      if (k != null) { const ref = P(M.atoms[k].p).sub(nb[i].includes(k) ? A : B); perp = ref.sub(d.clone().multiplyScalar(ref.dot(d))); }
      if (!perp || perp.lengthSq() < 1e-6) perp = tmp.set(1, 0, 0).cross(d).lengthSq() > 1e-3 ? new THREE.Vector3(1, 0, 0).cross(d) : new THREE.Vector3(0, 0, 1).cross(d);
      perp.normalize();
      const r1 = 0.15 * scale, off = (f) => perp.clone().multiplyScalar(f * scale);
      if (o === 2) { solid.push([A.clone().add(off(0.13)), B.clone().add(off(0.13)), 0.09 * scale, ea, eb]); solid.push([A.clone().add(off(-0.13)), B.clone().add(off(-0.13)), 0.09 * scale, ea, eb]); }
      else if (o === 3) for (const f of [-0.19, 0, 0.19]) solid.push([A.clone().add(off(f)), B.clone().add(off(f)), 0.07 * scale, ea, eb]);
      else if (o === 4) {   // aromatic: full bond + dashed line inside the ring
        solid.push([A, B, r1 * 0.9, ea, eb]);
        const a2 = A.clone().add(off(0.3)).lerp(B, 0.18), b2 = B.clone().add(off(0.3)).lerp(A, 0.18), n = 3;
        for (let t = 0; t < n; t++) dash.push([a2.clone().lerp(b2, t / n + 0.04), a2.clone().lerp(b2, (t + 0.6) / n)]);
      } else solid.push([A, B, r1, ea, eb]);
    }
  }
  const grp = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color();
  const elCol = (el) => (carbon && el === 'C') ? carbon : elStyle(el)[0];
  const bm = new THREE.InstancedMesh(SPH, ligandMaterial(), Math.max(1, balls.length));
  balls.forEach(([p, el, deg], i) => {
    const r = style === 'space' ? (VDW_R[el] || 1.8) * scale * 0.42 : style === 'valence' && deg ? 0.15 * scale : elStyle(el)[1] * scale;   // space: x0.42 keeps enlarged display copies readable
    s.setScalar(r); m.compose(p, q.identity(), s); bm.setMatrixAt(i, m); bm.setColorAt(i, col.set(elCol(el)));
  });
  bm.count = balls.length; grp.add(bm);
  if (solid.length) {
    const sm = new THREE.InstancedMesh(CYL, ligandMaterial(), solid.length * 2);
    let k = 0;
    for (const [a, b, r, ea, eb] of solid) {   // two half-bonds, each in its atom's colour
      const mid = a.clone().add(b).multiplyScalar(0.5);
      for (const [from, el] of [[a, ea], [b, eb]]) {
        const d = mid.clone().sub(from), len = d.length();
        q.setFromUnitVectors(up, d.clone().normalize()); s.set(r, len, r);
        m.compose(from.clone().add(mid).multiplyScalar(0.5), q, s); sm.setMatrixAt(k, m); sm.setColorAt(k++, col.set(elCol(el)));
      }
    }
    grp.add(sm);
  }
  if (dash.length) {
    const dm = new THREE.InstancedMesh(CYL, ligandMaterial(), dash.length);
    dash.forEach(([a, b], i) => { const d = b.clone().sub(a); q.setFromUnitVectors(up, d.clone().normalize()); s.set(0.06 * scale, d.length(), 0.06 * scale);
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, s); dm.setMatrixAt(i, m); dm.setColorAt(i, col.set(illustrative() ? '#55607a' : '#c9d0de')); });
    grp.add(dm);
  }
  if (illustrative()) for (const o of [...grp.children]) grp.add(outlineOf(o));   // same ink line as the proteins (PDB-101 style)
  grp.traverse(o => { if (o.isInstancedMesh) { o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.frustumCulled = false; } });
  return grp;
}
/* one movable molecule from an ideal template (for animations) */
const MOL_CARBON = { ATP: '#ffb300', ADP: '#00c8ff', GTP: '#ffb300', GDP: '#00c8ff' };   // story colours for animated molecules
function makeMol(tpl, xray = true, carbon = MOL_CARBON[tpl.comp]) {
  const g = buildMolecules([{ atoms: tpl.atoms, bonds: tpl.bonds, centre: new THREE.Vector3() }], +$('ligScale').value, carbon);
  if (xray) g.traverse(o => { if (o.isMesh && !o.userData.outline) o.material = ligandMaterial(1.6); });   // brighter; lives in the overlay scene
  g.visible = false; procRoot.add(g); return g;
}
const PARTICLE_GEO = new THREE.IcosahedronGeometry(1, 2);
function makeParticle(color, radius, label, name) {   /* label: its name tag (H⁺, e⁻, ATP ...) follows it and goes with it; name: shown on hover / tap (crowded particles) */
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3, roughness: 0.3 });
  const p = new THREE.Mesh(PARTICLE_GEO, mat); p.scale.setScalar(radius); procRoot.add(p); if (label) labelObj(p, label, color); p.userData.name = name || label || null; return p;
}
/* every particle has a name (audit 4): hover shows it, a tap opens a small card */
function particleName(o) { return o.userData.name || o.userData.tag?.el?.textContent || null; }
const _pw2 = new THREE.Vector3();
function pickParticle(cx, cy) {
  const rect = renderer.domElement.getBoundingClientRect();
  _rc.setFromCamera(_pv.set((cx - rect.left) / rect.width * 2 - 1, -(cy - rect.top) / rect.height * 2 + 1), camera);
  let best = null;
  procRoot.traverseVisible((o) => {
    if (o.geometry !== PARTICLE_GEO || !o.isMesh) return; const nm = particleName(o); if (!nm) return;
    if (o.isInstancedMesh) { const h = o.count ? _rc.intersectObject(o, false)[0] : null; if (h && (!best || h.distance < best.t)) best = { t: h.distance, name: nm, o }; return; }
    o.getWorldPosition(_pw2); const r = Math.max(2.2, o.getWorldScale(_pv3).x * 1.4), t = _pw2.clone().sub(_rc.ray.origin).dot(_rc.ray.direction);
    if (t <= 0 || _rc.ray.distanceSqToPoint(_pw2) > r * r) return; if (!best || t < best.t) best = { t, name: nm, o };
  });
  return best;
}
const _pv3 = new THREE.Vector3();
function unnamedParticles() { let n = 0; procRoot.traverseVisible((o) => { if (o.isMesh && o.geometry === PARTICLE_GEO && !particleName(o)) n++; }); return n; }
function makeFlash(color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const f = new THREE.Mesh(PARTICLE_GEO, mat); f.visible = false; f.userData.name = '闪光：事件发生的位置'; procRoot.add(f); return f;
}

