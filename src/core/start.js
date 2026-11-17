/* ----------------------------------------------------------------------------- start */
window.__viewer = { ink: inkPass, loadScene, PRESETS, PROCESSES, groups: () => groups, ligands: () => ligGroups, model: () => model, camera, controls, proc: () => proc, entryFromFile, kit: () => kit, updateKit, alignEntry, findChannel, cell: () => cellSim, current: () => current, auto: { fetchAutoInfo, autoMembrane, hydroSlab } };
const params = new URLSearchParams(location.search);
(() => {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  window.__gpu = gpu;
  const soft = /SwiftShader|Basic Render|llvmpipe|softpipe/i.test(gpu);
  const integrated = /Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(gpu);
  $('quality').value = soft ? 'low' : integrated ? 'medium' : 'high';
  console.log('GPU:', gpu, '-> quality', $('quality').value);
})();
if (params.get('q')) $('quality').value = params.get('q');
var AUTO_Q_OFF = !!params.get('q') || params.get('noauto') === '1';
applyQuality(false);
const startId = (params.get('pdb') || '').toUpperCase();
const presetKey = (q) => {   // exact, then normalised (full/half-width brackets, spaces), then partial match
  if (!q) return null; if (presetName(q)) return presetName(q);
  const n = (x) => x.normalize('NFKC').replace(/[\s()（）]/g, '').toLowerCase(), m = n(q);
  const keys = Object.keys(PRESETS);
  return keys.find(k => n(k) === m) || keys.find(k => n(k).includes(m)) || keys.find(k => m.includes(n(k))) || null;
};
const startPreset = presetKey(params.get('preset')) || (startId || params.get('ws') ? null : 'ATP 合酶（合成 ATP）');
renderSubs(); setTimeout(checkSubUpdates, 4000);
window.__viewer.packs = { sanitizePack, packFromCurrent, openPack, importPackText, shopIndex, PROCESSES };
/* diagnostics (regression baseline, docs/history/ROADMAP.md): load a scene, let it run, measure what it built and how fast it draws.
   Used by desktop/scripts/regress.mjs; also handy in the console: await __viewer.probe(3) */
window.__viewer.probe = async function probe(sec = 5) {
  const t0 = performance.now(); let frames = 0, worst = 0, last = t0;
  await new Promise(r => { let done = false; const end = () => { if (!done) { done = true; r(); } };   // a timer too: rAF stops in hidden windows
    setTimeout(end, sec * 1000 + 500); const f = (t) => { if (done) return; frames++; worst = Math.max(worst, t - last); last = t; if (t - t0 < sec * 1000) requestAnimationFrame(f); else end(); }; requestAnimationFrame(f); });
  const dt = (performance.now() - t0) / 1000, I = renderer.info; let objects = 0, overlayObjects = 0; scene.traverse(() => objects++); overlay.traverse(() => overlayObjects++);
  const domTags = $('procLabs').childElementCount + $('labels').childElementCount + $('kitLabs').childElementCount + document.querySelectorAll('.compLab').length + (focus?.labs?.length || 0);
  const LC = ligCount();
  const chains = new Set(); groups.forEach(g => g.atoms.forEach(a => chains.add(a.asym)));
  const rRNA = {}, per = {};   /* longest chain of each ribosomal RNA (audit C9: lengths must look like E. coli 16S / 23S / 5S) */
  for (const g of groups) for (const a of g.atoms) { const m = /\b(16S|23S|5S)\b/i.exec(a.entName || ''); if (m) { const k = m[1].toUpperCase() + '|' + a.asym; per[k] = (per[k] || 0) + 1; } }
  for (const [k, n] of Object.entries(per)) { const r = k.split('|')[0]; rRNA[r] = Math.max(rRNA[r] || 0, n); }
  return { scene: current?.name || current?.id || null, pdb: current?.id || null, entities: groups.length, chains: chains.size,
    residues: groups.reduce((n, g) => n + g.atoms.length, 0), ligands: ligGroups.length, process: proc ? (current?.process || 'data') : null,
    counters: proc ? { ...proc.ctx.counters } : {}, fps: Math.round(frames / dt * 10) / 10, worstFrameMs: Math.round(worst),
    geometries: I.memory.geometries, textures: I.memory.textures, drawCalls: I.render.calls, triangles: I.render.triangles, objects,
    overlayObjects, procRootChildren: procRoot.children.length, bulkRootChildren: bulkRoot.children.length, domTags, listeners: listenerCount.controls + listenerCount.window + listenerCount.document + listenerCount.canvas,
    anims: anims.length, pendingAnims: animPending, pendingAfterClear: rejectAnims.left ?? 0, pools: scenePools.size, focus: !!focus, selection: sel.ids.size, ligandTypes: LC.types, ligandCopies: LC.copies,
    errors: (loadScene.errors || []).slice(), visibility: document.visibilityState, rRNA, unnamedParticles: unnamedParticles(), procNoEvidence: Object.keys(PROCESSES).filter(k => !procEvidence(k)),
    jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, status: $('status')?.textContent || '' };
};
Object.defineProperty(window.__viewer, 'lastError', { get: () => loadScene.lastError || null });
/* deterministic stepping: pause the clock, then advance the simulation n times by dt seconds (with ?seed= / scene seed: repeatable) */
const macrotask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
window.__viewer.step = async function (dt = 1 / 60, n = 1) {   /* yields between steps so the processes' awaited moves continue in order */
  $('pause').checked = true; dt = Math.min(0.1, Math.max(1e-4, +dt || 1 / 60));
  for (let i = 0; i < Math.min(100000, n | 0); i++) { simStep(dt); await macrotask(); }
  return { t: +U.uTime.value.toFixed(4), seed: randSeed, counters: proc ? { ...proc.ctx.counters } : {}, events: eventLog.length };
};
window.__viewer.events = () => eventLog.slice();
window.__viewer.links = { linkFor, openLinked, goBack, depth: () => backStack.length };
/* A9 regression: cell corner (change a control, step, select) -> linked machine -> back; everything must be as it was */
window.__viewer.backTest = async function () {
  $('pause').checked = true; await loadScene({ ...PRESETS[presetName('cell-corner')], name: presetName('cell-corner'), seed: 11 }); $('pause').checked = true;
  if (!cellSim) return { error: 'no cell simulation' };
  cellSim.ctrl.TC = 40; await window.__viewer.step(1 / 30, 30); GLOW_CMDS.select.fn('chain AA and resi 10-20');
  const before = sceneState(); before.ctrl = { ...cellSim.ctrl }; before.counters = { ...proc.ctx.counters };
  await openLinked('kcsa'); const mid = { key: PRESETS[current?.name]?.key, back: backStack.length };
  await goBack();
  const after = sceneState(), diff = [];
  for (const k of ['seed', 'timeScale', 'sel', 'mode', 'paused']) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff.push(`${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
  if (before.ctrl?.TC !== cellSim?.ctrl?.TC) diff.push(`ctrl.TC: ${before.ctrl?.TC} → ${cellSim?.ctrl?.TC}`);
  for (const [k, v] of Object.entries(before.counters || {})) if ((proc?.ctx.counters[k] ?? -1) < v) diff.push(`counter ${k}: ${v} → ${proc?.ctx.counters[k]}`);
  for (const k of ['az', 'el', 'dist']) if (Math.abs((before.camera?.[k] ?? 0) - (after.camera?.[k] ?? 0)) > 0.02) diff.push(`camera.${k}: ${before.camera?.[k]} → ${after.camera?.[k]}`);
  if (PRESETS[current?.name]?.key !== 'cell-corner') diff.push('scene: ' + current?.name);
  return { mid, diff, title: current?.name };
};
window.__viewer.pickAt = (x, y) => { const h = pickAt(x, y); return h ? { part: h.g?.name || null, residue: h.a ? resLabel(h.a) : null, ligand: h.lig?.comp || null, crowd: h.crowd ? { label: h.crowd.label, id: h.crowd.id } : null } : null; };
window.__viewer.crowdScreen = () => { const C = crowdSets.find(c => c.root.parent); if (!C) return null; C.root.updateMatrixWorld(); const out = []; for (const b of C.bodies.slice(0, 400)) { const w = b.c0.clone().applyMatrix4(C.root.matrixWorld); if (inCut(w)) continue; const v = w.clone().project(camera); if (Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1) out.push({ x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, label: C.types[b.i].label }); } return out.slice(0, 30); };
/* determinism + activity check (regression): load paused with a seed, step a fixed number of times, return counters and the event texts */
window.__viewer.seededRun = async function (load, seed = 1, dt = 1 / 30, steps = 600) {
  const pn = typeof load === 'string' ? presetName(load) : null, cfg = typeof load === 'string' ? (pn ? { ...PRESETS[pn], name: pn } : null) : load;
  if (!cfg) return { error: '没有这个预设：' + load };
  $('pause').checked = true; await loadScene({ ...cfg, seed }); $('pause').checked = true;
  if (loadScene.lastError) return { error: loadScene.lastError };
  const t0 = performance.now(), r = await window.__viewer.step(dt, steps);
  return { seed: randSeed, t: r.t, counters: r.counters, events: eventLog.map(e => e.t + ' ' + e.text), ms: Math.round(performance.now() - t0) };
};
window.__viewer.seed = (v) => { setSeed(v); return randSeed; };
/* A11: waitable animations are counted; some run mid-scene, none survive clearScene */
window.__viewer.animTest = async function () {
  $('pause').checked = true; await loadScene({ ...PRESETS[presetName('atp-synthase')], name: presetName('atp-synthase'), seed: 3 }); $('pause').checked = true;
  let mid = 0; for (let i = 0; i < 40 && !mid; i++) { await window.__viewer.step(0.05, 2); mid = Math.max(mid, animPending); }
  await loadScene({ ...PRESETS[presetName('kcsa')], name: presetName('kcsa') });
  return { mid, afterClear: rejectAnims.left ?? 0, now: animPending };
};
/* A1: a page that is not on the list gets nothing back before consent, and never the unsafe commands */
window.__viewer.bridgeTest = async function () {
  const got = [], ev = (cmd, origin) => ({ origin, data: { glow: 'cmd', id: cmd, cmd, args: {} }, source: { postMessage: (m) => got.push(m) } });
  const o = 'https://example.org';
  await handleBridge(ev('snapshot', o)); await handleBridge(ev('exportPack', o));
  const unsafe = got.filter(m => m.ok).map(m => m.id);
  return { trustedOfficial: bridgeTrusted('https://nimenta727.github.io'), trustedOther: bridgeTrusted(o), trustedNull: bridgeTrusted('null'), unsafeAnswered: unsafe, replies: got.length };
};
/* regression "rapid switch": start several loads without waiting (each cancels the previous), then measure the last one */
window.__viewer.rapid = async function (list, settle = 2, sec = 3) {
  const cfgs = list.map(c => typeof c === 'string' ? { ...PRESETS[presetName(c)], name: presetName(c) } : c), t = performance.now();
  let last; for (const c of cfgs) last = loadScene(c);
  await Promise.race([last, new Promise(r => setTimeout(r, 180e3))]);
  const loadMs = Math.round(performance.now() - t);
  await new Promise(r => setTimeout(r, settle * 1000));
  return { loadMs, error: loadScene.fatal ? loadScene.lastError : null, ...(await window.__viewer.probe(sec)) };
};
window.__viewer.loadAndProbe = async function (cfg, settle = 2, sec = 5) {
  const t = performance.now(); let error = null;
  if (typeof cfg === 'string') { if (!presetName(cfg)) return { error: '没有这个预设：' + cfg }; cfg = presetName(cfg); }
  try { await Promise.race([loadScene(typeof cfg === 'string' ? { ...PRESETS[cfg], name: cfg } : cfg), new Promise((_, no) => setTimeout(() => no(new Error('载入超过 180 秒')), 180e3))]); } catch (e) { error = String(e?.message || e); }
  const loadMs = Math.round(performance.now() - t);
  await new Promise(r => setTimeout(r, settle * 1000));
  if (!error && loadScene.fatal) error = loadScene.lastError;
  return { loadMs, error, ...(await window.__viewer.probe(sec)) };
};
