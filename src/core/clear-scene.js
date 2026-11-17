/* clearScene(): the scene on screen is replaced by an empty one (its session is disposed). The scene's content is released by
   clearSceneContent(), which every committed session registers first (so it runs last, after the scene's timers, listeners ...). */
function clearScene() { loads.clear(); }
function clearSceneContent() {
  crowdSets = []; seqCells = []; seqFt = null; if ($('seqRows')) $('seqRows').innerHTML = '';
  exitKit(); clearEvidence(); clearFocus(false); focusLigand._req = null; clearSelection(); camFly = null; energyKey = null;
  labels = []; $('labels').innerHTML = ''; $('infoCard').style.display = 'none';
  if (proc?.dispose) try { proc.dispose(proc.ctx); } catch (e) { console.warn('dispose', e); }   /* a process removes its own listeners / timers */
  sceneSpecies = {}; eventLog = []; U.uTime.value = 0; clearMeasure();   /* scene time starts at 0 (event log, deterministic stepping) */
  proc = null; stopCellSim(); clearTags(); clearPools(); tagFilter = null; if ($('scaleBar')) $('scaleBar').style.display = 'none';
  for (const o of procWorld) { o.parent?.remove(o); disposeObj(o); } procWorld = [];
  for (const g of groups) if (g.mesh) { world.remove(g.mesh); disposeObj(g.mesh); }
  groups = [];
  for (const lg of ligGroups) { world.remove(lg.obj); disposeObj(lg.obj); }
  ligGroups = [];
  for (const o of membraneObjs) { world.remove(o); o.geometry.dispose(); o.material.dispose(); }
  membraneObjs = [];
  rejectAnims();
  while (procRoot.children.length) { const o = procRoot.children[0]; procRoot.remove(o); o.traverse(x => { if (x.geometry && x.geometry !== PARTICLE_GEO) x.geometry.dispose(); if (x.material) x.material.dispose(); }); }
  theta = 0;
}

