/* ----------------------------------------------------------------------------- membrane */
function rebuildMembranes() {
  for (const o of membraneObjs) { world.remove(o); o.geometry.dispose(); o.material.dispose(); }
  membraneObjs = [];
  if (!$('memOn').checked || !model) return;
  const ys = [+$('mem1').value * model.radius];
  if ($('mem2On').checked) ys.push(+$('mem2').value * model.radius);
  let R = +$('memR').value * model.mainR, spacing = 9.5, maxLipids = 120000;
  /* multi-machine rows: lipids fill a strip (u along the row, v across) around the whole scene */
  let strip = null;
  if (current?.frameAll && model.rowDir && model.allAtoms?.length) {
    const d = model.rowDir, n = new THREE.Vector3(-d.z, 0, d.x), c = model.focus.centre.clone().setY(0);
    let ulo = 1e9, uhi = -1e9, vlo = 1e9, vhi = -1e9;
    for (let i = 0; i < model.allAtoms.length; i += 3) { const p = model.allAtoms[i].p, q = new THREE.Vector3(p.x - c.x, 0, p.z - c.z), u = q.dot(d), v = q.dot(n);
      ulo = Math.min(ulo, u); uhi = Math.max(uhi, u); vlo = Math.min(vlo, v); vhi = Math.max(vhi, v); }
    strip = { d, n, c, ulo: ulo - 25, uhi: uhi + 25, vlo: vlo - 25, vhi: vhi + 25 };
    R = Math.max(strip.uhi - strip.ulo, strip.vhi - strip.vlo) / 2;
  }
  const perLeaf = strip ? (strip.uhi - strip.ulo) * (strip.vhi - strip.vlo) / (spacing * spacing * 0.866) : Math.PI * R * R / (spacing * spacing * 0.866);
  const sp = spacing * Math.max(1, Math.sqrt(perLeaf * 2 * ys.length / maxLipids)), cell = 6;
  for (const y0 of ys) {
    const occ = new Set();
    for (const g of groups) if (g.visible) for (const a of g.atoms) if (Math.abs(a.p.y - y0) < 26) {
      const gx = Math.round(a.p.x / cell), gz = Math.round(a.p.z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) occ.add((gx + dx) + ',' + (gz + dz));
    }
    const heads = [], tails = [];
    for (const leaf of [1, -1]) {
      let row = 0;
      const z0 = strip ? strip.vlo : -R, z1 = strip ? strip.vhi : R, x0 = strip ? strip.ulo : -R, x1 = strip ? strip.uhi : R;
      for (let z = z0; z <= z1; z += sp * 0.866, row++) for (let x = x0 + (row % 2) * sp / 2; x <= x1; x += sp) {
        let jx = x + (randVis() - 0.5) * sp * 0.35, jz = z + (randVis() - 0.5) * sp * 0.35, edge;
        if (strip) {   // (u, v) -> world x, z; soft edges on all four sides
          const m = Math.min(jx - x0, x1 - jx, jz - z0, z1 - jz); edge = Math.max(0, 1 - m / 30);
          const wx = strip.c.x + strip.d.x * jx + strip.n.x * jz, wz = strip.c.z + strip.d.z * jx + strip.n.z * jz; jx = wx; jz = wz;
        } else { const rr = Math.hypot(jx, jz); if (rr > R) continue; edge = Math.max(0, (rr - R * 0.82) / (R * 0.18)); }
        if (occ.has(Math.round(jx / cell) + ',' + Math.round(jz / cell))) continue;
        if (randVis() < edge * edge) continue;
        heads.push([jx, y0 + leaf * (19 + (randVis() - 0.5) * 2), jz]);
        tails.push([jx - 1.4, y0 + leaf * 9.5, jz], [jx + 1.4, y0 + leaf * 9.5, jz]);
      }
    }
    const hMesh = new THREE.InstancedMesh(withAttrs(new THREE.IcosahedronGeometry(1, 1), heads.length), blobMaterial({ roughness: 0.25, tag: true }), heads.length);
    const tMesh = new THREE.InstancedMesh(withAttrs(new THREE.CylinderGeometry(0.6, 0.4, 15, 5, 1), tails.length), blobMaterial({ roughness: 0.4, tag: true }), tails.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    heads.forEach((h, i) => { s.setScalar(2.5 + randVis() * 0.4); m.compose(v.set(...h), q.identity(), s); hMesh.setMatrixAt(i, m); hMesh.setColorAt(i, c.set(illustrative() ? '#d9a3c9' : '#e64fc8').offsetHSL((randVis() - .5) * .03, 0, (randVis() - .5) * .08)); });
    tails.forEach((t, i) => { e.set((randVis() - .5) * .35, 0, (randVis() - .5) * .35); q.setFromEuler(e); s.set(1, 1, 1); m.compose(v.set(...t), q, s); tMesh.setMatrixAt(i, m); tMesh.setColorAt(i, c.set(illustrative() ? '#a7afc0' : '#eef1f8').offsetHSL(0, 0, (randVis() - .5) * .1)); });
    for (const mesh of [hMesh, tMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false; mesh.material.clippingPlanes = [cutPlane]; world.add(mesh); membraneObjs.push(mesh); }
  }
}
function applyCut() {
  const v = +$('cut').value;
  cutPlane.normal.set(0, 0, -1); cutPlane.constant = v >= 1.04 ? 1e9 : v * (model ? model.radius : 1);
  if (current?.frameAll && model?.focus && v < 1.04) {   // keep what lies behind the vertical plane through the centre, facing the camera
    const c = model.focus.centre.clone().applyMatrix4(world.matrixWorld), d = camera.position.clone().sub(c).setY(0);
    if (d.lengthSq() > 1 && Number.isFinite(d.x + d.z + c.x + c.z)) { d.normalize(); cutPlane.normal.copy(d).negate(); cutPlane.constant = d.dot(c) + v * model.focus.radius; }
  }
  const all = $('cutWhat').value === 'all';
  for (const g of groups) if (g.mesh) g.mesh.traverse(x => {
    if (!x.material) return;
    if (x.userData.surface || x.userData.outline) { x.material.clippingPlanes = all ? [cutPlane] : noPlanes; return; }
    if (x.userData.cartoon) {   // cartoon: global cut, or the wedge (clipIntersection) for "剖" parts
      x.material.clippingPlanes = all ? [cutPlane] : g.ghost ? wedgePlanes : noPlanes;
      x.material.clipIntersection = !all && g.ghost;
    } else x.material.clippingPlanes = planesFor(g);
  });
  for (const o of membraneObjs) o.material.clippingPlanes = [cutPlane];
}

