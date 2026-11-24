/* the first visible line of a caption: its first sentence, at most 60 characters */
function leadOf(cap) { const t = String(cap || '').replace(/<[^>]*>/g, ''); const m = /^[^。！？]*[。！？]/.exec(t); const f = (m ? m[0] : t);
  return f.length <= 60 ? f : f.slice(0, 58) + '…'; }
/* WP2: one SceneSession per load (src/core/session.js). Phase 1 only downloads (main entry, second state, components, auto
   annotations): the scene on screen keeps running, and if a download fails it stays. Phase 2 starts with loads.commit():
   the old scene is disposed and the new one is built. ?lowmem=1 commits before the downloads (the old behaviour). */
async function loadScene(cfg) {
  window.dispatchEvent(new Event('glow:scene-changing'));
  const S = loads.begin(cfg), live = () => S.assertLive();   // a newer loadScene makes this one stale
  $('load').disabled = true;
  if (!cfg._orig0) cfg._orig0 = { ...cfg };   /* what was asked for, before the load changes cfg (back navigation) */
  cfg._restore = S.restore = pendingRestore; pendingRestore = null;
  const commit = () => {
    if (S.committed) return;
    loads.commit(S); current = cfg;
    setSeed(loadSeedOverride ?? (cfg._restore ? cfg._restore.seed : null) ?? cfg.seed ?? URL_SEED); loadSeedOverride = null; S.seed = randSeed;
    restoreQuality();
    if (cfg.name && PRESETS[cfg.name]) setMode(presetCat(cfg.name)); else if (cfg.auto) setMode('single');   /* the tab follows what is shown */
  };
  try {
    if (loads.lowMemory) commit();
    // ---- phase 1: downloads only (the old scene stays on screen)
    const useAsm = cfg.assembly ?? $('assembly').checked;
    const infoP = cfg.auto ? fetchAutoInfo(cfg.id).catch(e => { console.warn('auto info', e); return null; }) : null;
    const main = cfg.local || await loadEntry(cfg.id, useAsm); live();
    const keepChains = (e) => { if (!cfg.chains) return e; const ok = (c) => cfg.chains.includes(c.split('_')[0]);
      e.atoms = e.atoms.filter(a => ok(a.asym)); e.ligands = e.ligands.filter(L => ok(L.asym) || L.atoms.some(x => e.atoms.some(a => a.p.distanceTo(x.p) < 6))); return e; };
    keepChains(main);
    if (!main.atoms.length) throw new Error('该结构没有可用的 CA/P 坐标');
    const entryB = cfg.states && cfg.states.length > 1 ? await loadEntry(cfg.states[1], useAsm) : null; live();
    /* L5: all component downloads start together (each retried once); they are placed one by one in the listed order */
    const compList = cfg.components || [];
    const fetchComp = async (id) => { try { return await loadEntry(id, true); } catch (e) { if (e.name === 'AbortError') throw e; console.warn('retry', id, e); await new Promise(r => setTimeout(r, 1200)); return loadEntry(id, true); } };
    const compP = compList.map(comp => fetchComp(comp.id)); compP.forEach(p => p.catch(() => {}));
    if (compList.length) status(`并行下载 ${compList.length} 个组件 …`, true);
    await Promise.allSettled(compP); live();
    const autoInfo = cfg.auto ? await infoP : null; live();
    // ---- phase 2: everything is here -> the old scene goes, the new one is built
    commit();
    // ---- conformational states (morph): superpose state B onto A by matched residues
    if (entryB) {
      const B = keepChains(entryB);
      const key = (a) => a.asym + '|' + a.seq, mapB = new Map(B.atoms.map(a => [key(a), a]));
      const pairs = main.atoms.filter(a => mapB.has(key(a)));
      if (pairs.length >= 3) {
        const f = superpose(pairs.map(a => a.p), pairs.map(a => mapB.get(key(a)).p));
        for (const a of pairs) a.p2 = f(mapB.get(key(a)).p);
        for (const L of B.ligands) { L.atoms.forEach(x => x.p = f(x.p)); L.state = 1; main.ligands.push(L); }
        main.ligands.forEach(L => L.state = L.state || 0);
        status(`构象 ${cfg.states[0]} ⇄ ${cfg.states[1]}：匹配 ${pairs.length} 个残基`);
      }
    }
    // ---- orientation
    const mode = cfg.axis || $('axisMode').value;
    const partAtoms = (kw) => main.atoms.filter(a => kwMatch(main.entities[a.ent]?.name || '', kw));
    const centroid = (arr) => arr.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / arr.length);
    const [fa, fb] = cfg.axisFrom ? [partAtoms(cfg.axisFrom[0]), partAtoms(cfg.axisFrom[1])] : [[], []];
    if (fa.length && fb.length) {   // spin axis passes through the centroid of part A and points to part B (e.g. c-ring -> F1 head)
      const cA = centroid(fa), dir = centroid(fb).sub(cA).normalize();
      applyTf(main, { centre: cA, q: new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, 1, 0)) });
      const ys = main.atoms.map(a => a.p.y);
      applyTf(main, { centre: new THREE.Vector3(0, (Math.min(...ys) + Math.max(...ys)) / 2, 0), q: new THREE.Quaternion() });
    } else if (cfg.axisFit) {   // membrane complexes: the flattest direction of the transmembrane subunits = membrane normal -> +Y
      const fit = main.atoms.filter(a => cfg.axisFit.some(k => kwMatch(main.entities[a.ent]?.name || '', k)));
      const P0 = (fit.length > 50 ? fit : main.atoms).map(a => a.p), pc = pca(P0);
      applyTf(main, { centre: centroid(main.atoms), q: new THREE.Quaternion().setFromUnitVectors(pc.axes[0], new THREE.Vector3(0, 1, 0)) });
    } else applyTf(main, orientTransform(main.atoms.map(a => a.p), mode));
    if ((cfg.up || cfg.down) && !cfg.axisFrom) {
      const ups = main.atoms.filter(a => kwMatch(main.entities[a.ent]?.name || '', cfg.up || cfg.down)), my = ups.length ? ups.reduce((s, a) => s + a.p.y, 0) / ups.length : 0;
      if (ups.length && (cfg.up ? my < 0 : my > 0))
        applyTf(main, { centre: new THREE.Vector3(), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI) });
    }
    if (cfg.auto) {   /* membrane protein? normal -> +Y, cytoplasm down (see autoMembrane) */
      cfg.autoInfo = autoInfo;
      try { cfg.autoMem = autoMembrane(main, cfg.autoInfo); } catch (e) { console.warn('autoMembrane', e); cfg.autoMem = null; }
      if (cfg.autoMem) { cfg.process = 'auto'; cfg.memY = cfg.autoMem.y; }
    }
    const pts = main.atoms.map(a => a.p), fc = new THREE.Vector3(); pts.forEach(p => fc.add(p)); fc.multiplyScalar(1 / pts.length);
    const focus = { centre: fc, radius: Math.max(...pts.map(p => p.distanceTo(fc))) };
    // ---- parts by entity
    const byEnt = new Map();
    const groupOf = (nm) => (cfg.groupParts || []).find(([, ...kws]) => kws.some(k => kwMatch(nm, k)))?.[0] || nm;   // e.g. 45 subunits -> '复合体 I'
    const rawEnt = new Map();
    for (const a of main.atoms) { const raw = main.entities[a.ent]?.name || ('entity ' + a.ent), nm = groupOf(raw); a.part = nm; a.entName = raw;
      if (!byEnt.has(nm)) byEnt.set(nm, []); byEnt.get(nm).push(a); if (!rawEnt.has(raw)) rawEnt.set(raw, []); rawEnt.get(raw).push(a); }
    model = S.model = { entityStats: {}, focus };
    const stat = (arr) => { const ys = arr.map(a => a.p.y); return { min: Math.min(...ys), max: Math.max(...ys), mean: ys.reduce((s, v) => s + v, 0) / ys.length }; };
    for (const [nm, arr] of rawEnt) model.entityStats[nm] = stat(arr);   // raw subunit names stay addressable (membranes, alignment)
    for (const [nm, arr] of byEnt) model.entityStats[nm] = stat(arr);
    const parts = [...byEnt.entries()].map(([nm, arr]) => ({ name: nm, atoms: arr }));
    let ligands = main.ligands.slice();
    /* row direction = long horizontal axis of the main structure (machines in one membrane laid out in a row) */
    { const P = main.atoms.filter((_, i) => i % 5 === 0).map(a => new THREE.Vector3(a.p.x, 0, a.p.z)); model.rowDir = P.length > 3 ? pca(P).axes[2].clone().setY(0).normalize() : new THREE.Vector3(1, 0, 0);
      if (cfg.rowFlip) model.rowDir.negate(); }
    const provList = [main.prov || { id: cfg.local ? (cfg.name || '本地文件') : main.id, local: !!cfg.local }];
    // ---- components (other PDB entries placed relative to the main one; downloaded in phase 1)
    for (const [ci, comp] of compList.entries()) {
      try {
        let c; try { c = await compP[ci]; } catch (e) { live(); if (e.name === 'AbortError') throw new Stale(); throw e; } live();
        status(`放置组件 ${comp.id}（${ci + 1}/${compList.length}）…`, true);
        if (comp.chains) { const ok = (x) => comp.chains.includes(x.split('_')[0]); c.atoms = c.atoms.filter(a => ok(a.asym));   // e.g. drop the Fab fragments of a crystal
          c.ligands = c.ligands.filter(L => ok(L.asym) || L.atoms.some(x => c.atoms.some(a => a.p.distanceTo(x.p) < 6))); }
        const en = (a) => c.entities?.[a.ent]?.name || '', ofC = (kw) => c.atoms.filter(a => kwMatch(en(a), kw));
        const shiftC = (v) => { for (const a of c.atoms) a.p.add(v); for (const L of c.ligands) for (const x of L.atoms) x.p.add(v); };
        if (comp.axisFrom && ofC(comp.axisFrom[0]).length && ofC(comp.axisFrom[1]).length) {   // e.g. ATP synthase: c-ring -> F1 head = rotor axis
          const cA = centroid(ofC(comp.axisFrom[0])), dir = centroid(ofC(comp.axisFrom[1])).sub(cA).normalize();
          applyTf(c, { centre: cA, q: new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, 1, 0)) });
        } else if (comp.axis === 'native') nativeZtoY(c); else applyTf(c, orientTransform(c.atoms.map(a => a.p), comp.axis || 'long'));
        if (comp.flip) applyTf(c, { centre: new THREE.Vector3(), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI) });
        if (comp.alignTo) {   // put one of its subunits at the height of one of the main entry's subunits (same membrane)
          const own = ofC(comp.alignTo.own), ak2 = Object.keys(model.entityStats).find(k => kwMatch(k, comp.alignTo.anchor));
          if (own.length && ak2) shiftC(new THREE.Vector3(0, model.entityStats[ak2].mean - centroid(own).y, 0));
        }
        if (comp.beside) {   // next to the main structure, on the side of one of its parts (or further along the row), without overlap
          const row = comp.beside.dir === 'row', side = row ? [] : main.atoms.filter(a => kwMatch(a.entName || a.part, comp.beside.part)), mc = centroid(main.atoms);
          const d = row ? model.rowDir.clone() : (side.length ? centroid(side) : new THREE.Vector3(1, 0, 0)).sub(mc).setY(0).normalize();
          const placedSoFar = row ? parts.flatMap(p => p.atoms) : main.atoms;
          const ext = Math.max(...placedSoFar.map(a => a.p.clone().sub(mc).dot(d))), cc = centroid(c.atoms).setY(0);
          const rC = Math.max(...c.atoms.map(a => Math.hypot(a.p.x - cc.x, a.p.z - cc.z)));
          shiftC(mc.setY(0).addScaledVector(d, ext + rC + (comp.beside.gap || 20)).sub(cc));
        }
        if (comp.at) {   // centroid at a part / subunit placed so far (+ dy up, + along the row)
          const tgt = parts.flatMap(p => p.atoms).filter(a => kwMatch(a.part, comp.at.part) || kwMatch(a.entName || '', comp.at.part));
          if (tgt.length) shiftC(centroid(tgt).add(new THREE.Vector3(0, comp.at.dy || 0, 0)).addScaledVector(model.rowDir, comp.at.along || 0).sub(centroid(c.atoms)));
        }
        if (c.prov) provList.push({ ...c.prov, label: comp.label || comp.id });
        const placed = placeComponent(comp, c.atoms, c.ligands);
        placed.ligands.forEach(L => L.compLabel = comp.label || comp.id); placed.atoms.forEach(a => a.entName = en(a));
        const pv = comp.pivot && placed.atoms.filter(a => kwMatch(en(a), comp.pivot)), pivot = pv?.length ? centroid(pv) : null;
        if (comp.split) {   // one part per subunit type, so rotor and stator can behave differently
          const by = new Map(); for (const a of placed.atoms) { const nm = `${comp.label || comp.id} · ${en(a) || a.ent}`; a.part = nm; if (!by.has(nm)) by.set(nm, []); by.get(nm).push(a); }
          for (const [nm, arr] of by) parts.push({ name: nm, atoms: arr, comp, pivot });
        } else { placed.atoms.forEach(a => a.part = comp.label || comp.id); parts.push({ name: comp.label || comp.id, atoms: placed.atoms, comp, pivot }); }
        ligands.push(...placed.ligands);
      } catch (e) { if (e instanceof Stale || !S.live) throw new Stale(); console.warn(e); loadFail(`组件 ${comp.id} 加载失败：${e.message}`); status(`组件 ${comp.id} 加载失败：${e.message}`); }
    }
    let rmax = 0, mainR = 0;
    for (const p of parts) for (const a of p.atoms) { rmax = Math.max(rmax, a.p.length()); mainR = Math.max(mainR, Math.hypot(a.p.x, a.p.z)); }
    Object.assign(model, { radius: rmax, mainR, allAtoms: parts.flatMap(p => p.atoms) });
    if (cfg.frameAll) { const A = model.allAtoms, c = A.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / A.length); model.focus = { centre: c, radius: Math.max(...A.map(a => a.p.distanceTo(c))) }; }
    world.rotation.set(0, 0, cfg.horizontal ? -Math.PI / 2 : 0); world.updateMatrixWorld(true);
    // ---- colours & groups
    parts.sort((a, b) => b.atoms.length - a.atoms.length);
    const nChains = new Set(parts.flatMap(p => p.atoms.map(a => a.asym))).size;
    $('colorMode').value = cfg.colorMode || (parts.length <= 2 && nChains > 6 ? 'chain' : 'entity');
    if (cfg.blob) { $('blob').value = cfg.blob; syncOut($('blob')); }
    const pal = PALETTES[$('palette').value];
    parts.forEach((part, i) => {
      const fk = findKey(cfg.colors, part.name);
      const spin = part.comp?.spin === false ? false : (cfg.spin || []).some(k => kwMatch(part.name, k));
      const ghost = (cfg.ghost || []).some(k => kwMatch(part.name, k));
      groups.push({ rep: cfg.reps && typeof cfg.reps[part.name] === 'string' ? cfg.reps[part.name] : undefined, name: part.name, color: pal[i % pal.length], fixed: fk ? cfg.colors[fk] : null, atoms: part.atoms, spin, ghost, visible: true, mesh: null, pivot: part.pivot ? new THREE.Vector2(part.pivot.x, part.pivot.z) : null });
    });
    // ---- small molecules
    for (const L of ligands) { L.centre = L.atoms.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / L.atoms.length); L.hidden = false; }
    model.ligands = ligands;
    // ---- membranes
    if (cfg.membranes) {
      $('memOn').checked = true;
      const pos = cfg.membranes.map(mb => { const k = Object.keys(model.entityStats).find(n => kwMatch(n, mb.at || '')); return ((k ? model.entityStats[k].mean : 0) + (mb.offset || 0)) / model.radius; });
      $('mem1').value = pos[0] ?? 0; $('mem2On').checked = pos.length > 1; $('mem2').value = pos[1] ?? 0.3;
    } else if (cfg.memY != null) { $('memOn').checked = true; $('mem1').value = cfg.memY / model.radius; $('mem2On').checked = false; }
    else { $('memOn').checked = false; $('mem2On').checked = false; }
    $('memR').value = cfg.memR || 1.6;
    $('cut').value = cfg.cut ?? 1.05; if (cfg.cutWhat) $('cutWhat').value = cfg.cutWhat;
    document.querySelectorAll('input[type=range]').forEach(syncOut);
    // ---- process (interaction animation)
    proc = null; $('caption').innerHTML = '';
    const P = cfg.process && PROCESSES[cfg.process];
    if (P) {
      const pr = Object.create(P); pr.ctx = makeCtx();   // activate only after async setup finished
      try { await pr.setup(pr.ctx); live(); proc = S.proc = pr; } catch (e) { if (e instanceof Stale || !S.live) throw new Stale(); console.warn(e); loadFail('过程动画初始化失败：' + e.message); status('过程动画初始化失败：' + e.message); }
    }
    $('morph').value = 0; U.uMorph.value = 0;
    markHotFromLigands();
    $('simpDefault').value = 'auto';   // before the build, so the menu and the meshes agree
    rebuildMeshes(); rebuildLigands(); rebuildMembranes(); applyCut();
    if (cfg.auto) cfg.caption = autoCaption(cfg);
    const cap = cfg.caption || (P && P.caption) || '', lead = cfg.lead || (P && P.lead) || leadOf(cap);
    $('caption').innerHTML = (cfg.linkNote ? `<span class="lnote">${esc(cfg.linkNote)}</span>` : '') + (cap ? `<span class="lead">${esc(lead)}</span>${cap !== lead ? `<span class="ct">${esc(cap)}</span><span class="more">展开说明 ▾</span>` : ''}<span class="cnt" id="cnt"></span>` : '');
    $('caption').classList.remove('open'); requestAnimationFrame(() => { const ct = $('caption').querySelector('.ct'); $('caption').classList.toggle('clamped', !!ct && ct.scrollHeight > ct.clientHeight + 2); });
    $('tId').textContent = (cfg.states ? cfg.states.join(' ⇄ ') : main.id) + ((cfg.components || []).length ? ' + ' + cfg.components.map(c => c.id).join(' + ') : '');
    $('tName').textContent = cfg.name || niceTitle(main.title); $('aboutBtn').style.display = cfg.auto ? '' : 'none';
    cfg._prov = provList; renderEvidence(cfg, main); renderSeqBar();
    if (!labelsTouched) $('labelsOn').checked = !!cfg.notes;   // V12: respect the user's own choice
    renderLegend(); rebuildLabels(); renderEnergy();
    resetCamera(cfg._restore?.camera || cfg.camera); aimCut(); if (cfg.frameAll) applyCut();   // the frameAll cut faces the camera: aim it after the camera is placed
    if (P?.cell && proc) startCellSim(P.cell, cfg._restore?.ctrl);
    const total = groups.reduce((s, g) => s + g.atoms.length, 0);
    const LC = ligCount(); status(`完成：${total.toLocaleString()} 个残基团块，${LC.types} 种 / ${LC.copies} 个小分子`);
    if (P?.cell && innerWidth < 1600 && innerWidth > 600) { $('panel').classList.add('hidden'); resetCamera(cfg._restore?.camera || cfg.camera); }
    applyRestore(cfg._restore);
    if (cfg.auto) { if (innerWidth < 1600 && innerWidth > 600) $('panel').classList.add('hidden'); showAutoCard(); }   /* room for the scene; ☰ / H brings the panel back */
  } catch (e) {
    if (e instanceof Stale || !S.live) { if (!S.committed) loads.fail(S); return; }
    S.fatal = true; loadFail(e.message);
    if (!S.committed) { console.warn('load failed, scene kept:', e); loads.fail(S); status('载入失败：' + e.message + '（保留当前场景）', true); }   /* phase 1: nothing was replaced */
    else { console.error(e); clearEvidence(); status('出错：' + e.message, true); }
  }
  finally { if (S.live) { $('load').disabled = false; loads.finish(S); } else if (!loads.pending) $('load').disabled = false; }   /* a superseded load leaves the button to the newer one */
}
/* errors inside a load (a component, the process setup, the scene itself) are recorded on the session of the latest attempt,
   not only shown in the status bar; loadScene.errors / lastError / fatal read them */
function loadFail(msg) { loads.last.fail(msg); }
Object.defineProperties(loadScene, {
  errors: { get: () => loads.last.errors }, lastError: { get: () => loads.last.lastError }, fatal: { get: () => loads.last.fatal } });

