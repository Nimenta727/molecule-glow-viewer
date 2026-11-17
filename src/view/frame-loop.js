/* ----------------------------------------------------------------------------- frame loop */
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0, morphT = 0, labT = 0, slowT = 0, fastT = 0;
/* one simulation step (everything that moves with time); the frame loop calls it, __viewer.step(dt, n) runs it deterministically */
function simStep(dt) {
    U.uTime.value += dt; grade.uniforms.uT.value = U.uTime.value % 10;
    if (cellSim && !kit) updateCellSim(dt);
    if (kit) updateKit(dt);
    theta += +$('spin').value * dt * (cellSim ? cellSim.flux.rotor : 1) * (proc?.rotorRate ? proc.rotorRate() : 1);   /* respiratory chain: only while the proton ledger has protons */   // rotor speed follows the simulated ATP-synthesis flux
    for (const g of groups) if (g.spin && g.mesh) spinPose(g);
    if (current?.states && $('morphAuto').checked) {   // ease-in-out ping-pong with holds at both ends
      morphT += dt * 0.35; const c = (Math.sin(morphT) + 1) / 2; $('morph').value = ease((c - 0.1) / 0.8); syncOut($('morph'));
    }
    U.uMorph.value = +$('morph').value;
    for (const lg of ligGroups) if (current?.states) lg.obj.visible = lg.visible && $('ligOn').checked && (lg.state ? U.uMorph.value > 0.6 : U.uMorph.value < 0.4) && !focus;
    if (proc && $('procOn').checked) {
      proc.update(proc.ctx, dt); tickAnims(dt); updatePools(dt);
      const cnt = $('cnt'); if (cnt) cnt.textContent = Object.entries(proc.ctx.counters).map(([k, v]) => `${k}：${v}`).join('　');
    }
}
/* scale bar for every scene (at the rotation centre) + what the time axis means; the whole cell keeps its own µm bar */
let scaleT = 0;
/* one slow-motion label per running simulation (the cell corner runs two clocks) */
function timeLines() {
  const k = current?.process, c = cellSim?.ctrl || {}, L = [], inv = (x) => x > 0 ? Math.round(1 / x).toLocaleString() : '?';
  const tl = () => L.push(`翻译：慢放 ×1/${inv(+(c.speed ?? 0.02))}（真实每秒约 10–20 个氨基酸）`);
  const kc = () => { L.push(`K⁺ 通过：画面 1 秒 = ${+(c.ionSpeed ?? 10)} ns（慢约 ${(1e9 / +(c.ionSpeed ?? 10)).toExponential(0).replace('e+', '×10^')} 倍）`);
    L.push(`门控：慢放 ×1/${inv(+(c.gateSpeed ?? 0.05))}`); };
  const rot = (real) => { const rps = +$('spin').value / (2 * Math.PI); L.push(`转子：画面每秒约 ${rps.toFixed(2)} 转（真实${real}）`); };
  if (current?.states && U.uMorph.value > 0.03 && U.uMorph.value < 0.97) L.push(`构象变化：${current.states.join(' → ')} 之间的线性插值（示意，不是真实路径）`);
  if (k === 'translation') tl(); else if (k === 'kcsa') kc(); else if (k === 'cellCorner') { tl(); kc(); }
  else if (k === 'atpSynthase' || k === 'respiratoryChain') rot('每秒 100 多转'); else if (k === 'flagellarMotor') rot('每秒 100–300 转');
  return L.map(x => x.replace(/×10\^(\d+)/, (m, e) => '×10' + [...e].map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('')));
}
function updateScaleAll(dt) {
  if ((scaleT += dt) < 0.25) return; scaleT = 0;
  const el = $('scaleAll'), own = $('scaleBar'); if (!el) return;
  if (!model || (own && own.style.display !== 'none' && own.style.display !== '') || kit) { el.style.display = 'none'; return; }
  el.style.display = '';
  const d = camera.position.distanceTo(controls.target), pxPerA = innerHeight / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000], L = nice.find(x => x * pxPerA >= 60) || nice[nice.length - 1];
  el.querySelector('i').style.width = Math.round(L * pxPerA) + 'px';
  el.querySelector('.sl').textContent = (L >= 10000 ? `${L / 10000} µm` : L >= 10 ? `${L / 10} nm（${L} Å）` : `${L} Å`) + '（旋转中心处；透视下近大远小）';
  const tl = timeLines(), note = !proc ? '时间：静态结构（团块抖动只是示意）' : tl.length ? tl.join('\n') : proc.timeScaleNote || (timeScale === 'fast' ? '时间：快放 · 粒子流表示通量方向和相对大小（仍比真实慢得多）' : '时间：慢放 · 每个分子事件单独画出，比真实慢许多个数量级');
  el.querySelector('.ts').textContent = note + ($('pause').checked ? '（已暂停）' : '');
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!$('pause').checked) simStep(dt);
  updateViewOffset(); updateScaleAll(dt);
  U.uUpView.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  procRoot.position.copy(world.position); procRoot.quaternion.copy(world.quaternion); bulkRoot.visible = !!proc && $('procOn').checked && !(proc.level && proc.level !== 'machine');
  for (const g of groups) if (g.mesh) {
    if (g.mesh.userData.simple) g.mesh.children.forEach(x => {
      if (!x.userData.surface) return;
      let vis = true;
      if (g.ghost && $('cutWhat').value !== 'all') { x.updateMatrixWorld(); _v0.copy(x.userData.centre).applyMatrix4(x.matrixWorld); const A = U.uCutA.value, B = U.uCutB.value;
        vis = !(A.x * _v0.x + A.y * _v0.y + A.z * _v0.z + A.w > 0 && B.x * _v0.x + B.y * _v0.y + B.z * _v0.z + B.w > 0); }
      x.visible = vis;
    });
    if (g.simple && g.mesh.userData.pore) updatePore(g);
    if (g.blend) applyBlends(g);
    if (current?.states && (g._lastMorph !== U.uMorph.value || g._lastMesh !== g.mesh)) { g._lastMorph = U.uMorph.value; g._lastMesh = g.mesh; g.mesh.traverse(x => {
      if (x.userData.p2Index >= 0 && x.morphTargetInfluences) x.morphTargetInfluences[x.userData.p2Index] = U.uMorph.value;
      if (x.userData.lobe) { const w = U.uMorph.value; placeLobe(x, x.userData.lobe.map(a => a.p2 ? a.p.clone().lerp(a.p2, w) : a.p)); }
      else if (x.userData.surface && !x.userData.schem) { const w = Math.round(U.uMorph.value * 12) / 12; resurface(g, x, (a) => a.p2 ? a.p.clone().lerp(a.p2, w) : a.p, 'm' + w); }
    }); }
  }
  controls.update();
  const dist = camera.position.distanceTo(controls.target);
  bokeh.uniforms.focus.value = dist;
  bokeh.uniforms.aperture.value = illustrative() ? 0 : +$('dofAmt').value * 0.00003 * Math.min(1, dist / 600);   // weaker when close; journal style = sharp
  inkPass.enabled = illustrative() && !!model;
  if (current?.multiscale) { const n = dist / 300, fr = dist * 3 + 80000; if (Math.abs(camera.near - n) > n * 0.05 || camera.far !== fr) { camera.near = n; camera.far = fr; camera.updateProjectionMatrix(); } }   /* 1 nm to 2 um in one scene */
  if (inkPass.enabled) { const R = Math.max(20, model.focus.radius, current?.multiscale ? dist * 0.3 : 0), iu = inkPass.uniforms;
    iu.uLine.value = +$('inkAmt').value * (current?.multiscale ? THREE.MathUtils.clamp(1.1 - dist / 20000, 0.45, 1) : 1);   /* lighter ink when thousands of molecules are on screen */ iu.uFog.value = +$('fogAmt').value * 0.85; iu.uBg.value.copy(scene.background);
    iu.uFogN.value = dist - 0.25 * R; iu.uFogF.value = dist + 1.3 * R; }
  composer.render(); updateFly(); updateEnergy();
  labT += dt; if (labT >= 1 / 30 || camFly) { labT = 0; updateLabels(); updateFocusLabels(); updateTags(); }   /* DOM labels at 30 Hz */
  fpsT += dt; fpsN++;
  if (fpsT > 2) { window.__fps = fpsN / fpsT; $('fpsOut').textContent = '帧率：' + window.__fps.toFixed(1) + ' fps';
    /* automatic quality step-down: 4 s below 24 fps on a visible page -> one level lower, said in the status bar (not with ?q= / ?noauto=1) */
    const vis = document.visibilityState === 'visible' && model && !$('load').disabled, LV = ['low', 'medium', 'high'];
    slowT = window.__fps < 24 && vis ? slowT + fpsT : 0;
    fastT = window.__fps > 50 && vis && autoQ ? fastT + fpsT : 0;
    if (slowT >= 4 && !AUTO_Q_OFF && $('quality').value !== 'low') { slowT = 0; fastT = 0; autoQ = true;
      /* in the illustration style the first step only turns off depth of field / ambient occlusion (pixel ratio stays >= 1, ink lines stay sharp) */
      $('quality').value = $('quality').value === 'high' ? 'medium' : 'low'; applyQuality(true);
      status(`帧率偏低（${window.__fps.toFixed(0)} fps），画质自动降为“${$('quality').selectedOptions[0].text}”${$('bgMode').value === 'light' ? '（墨线保持清晰）' : ''}；可在 外观 → 画质 改回`); }
    /* last resort for computers without a graphics card (school PCs, VMs: software rendering): already "low" in the ink style and
       still below 8 fps -> pixel ratio 0.75 (ink lines slightly softer but still readable); back to 1 when it goes above 30 fps */
    else if (slowT >= 4 && !AUTO_Q_OFF && $('quality').value === 'low' && $('bgMode').value === 'light' && inkPR === 1 && window.__fps < 8) { slowT = 0; inkPR = 0.75; applyQuality(false);
      status(`帧率很低（${window.__fps.toFixed(0)} fps，可能没有独立显卡），分辨率降到 75%；可在 外观 → 画质 改回`); }
    else if (inkPR < 1 && window.__fps > 30 && vis) { inkPR = 1; applyQuality(false); }
    else if (fastT >= 6 && autoQ && !AUTO_Q_OFF && LV.indexOf($('quality').value) < LV.indexOf(userQuality)) { fastT = 0;
      $('quality').value = LV[LV.indexOf($('quality').value) + 1]; if ($('quality').value === userQuality) autoQ = false; applyQuality(true);
      status(`帧率回升，画质恢复为“${$('quality').selectedOptions[0].text}”`); }
    fpsT = 0; fpsN = 0; }
}
frame();

