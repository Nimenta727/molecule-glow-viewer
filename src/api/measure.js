let measureObjs = [], measureTags = [];
function clearMeasure() { for (const o of measureObjs) { o.parent?.remove(o); o.geometry.dispose(); o.material.dispose(); } for (const t of measureTags) t.remove(); measureObjs = []; measureTags = []; }
function measurePoint(expr) {   /* one residue (Cα / P) or one ligand (its centre), in model coordinates */
  const S = evalSel(parseSel(String(expr)));
  if (S.r.length + S.l.length !== 1) throw new CmdError(`“${expr}” 选中了 ${S.r.length + S.l.length} 个，测量要正好一个残基或一个小分子（如 chain A and resi 87）`);
  return S.r.length ? { p: morphed(S.r[0]), name: resLabel(S.r[0]) + ' Cα' } : { p: S.l[0].centre.clone(), name: S.l[0].comp + ' 中心' };
}
GLOW_CMDS.measure = { doc: '测量：两个选择 → 距离（Å），三个 → 角度（°，中间那个是顶点）；按 Cα（核酸 P）或小分子中心；3D 里画虚线和数值。不带参数 = 清除',
  params: [{ name: 'a', type: 'string' }, { name: 'b', type: 'string' }, { name: 'c', type: 'string?' }], ex: "glow.measure('chain A and resi 87', 'ligand HEM')",
  fn: (o) => {
    clearMeasure(); if (!o || (!o.a && !o.b)) return { cleared: true };
    needModel(); if (!o.a || !o.b) throw new CmdError('measure 需要两个或三个选择');
    const P = [o.a, o.b, o.c].filter(x => x != null && x !== '').map(measurePoint);
    const mat = new THREE.LineDashedMaterial({ color: illustrative() ? 0x1c2233 : 0xffe680, dashSize: 1.2, gapSize: 0.8, depthTest: false, transparent: true });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(P.map(x => x.p)), mat); line.computeLineDistances(); line.renderOrder = 8; line.frustumCulled = false;
    world.add(line); measureObjs.push(line);
    let out;
    if (P.length === 2) { const d = P[0].p.distanceTo(P[1].p); out = { distance: +d.toFixed(3), unit: 'Å' }; measureTags.push(makeTag(`${d.toFixed(2)} Å`, { p: P[0].p.clone().lerp(P[1].p, 0.5), cls: 'hl' })); }
    else { const u = P[0].p.clone().sub(P[1].p), v = P[2].p.clone().sub(P[1].p), ang = THREE.MathUtils.radToDeg(u.angleTo(v)); out = { angle: +ang.toFixed(2), unit: '°' }; measureTags.push(makeTag(`${ang.toFixed(1)}°`, { p: P[1].p, cls: 'hl' })); }
    return { ...out, points: P.map(x => x.name), basis: '按 Cα / P 或小分子中心；构象滑块的当前位置' };
  } };
