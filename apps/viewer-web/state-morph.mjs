import { fitStates, stateTargets, stateAnchors, stateLigands, conformationLayers, displayCenter, pingPong, visibleState, StatePairError } from '../../plugins/motion/state-pair.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { ligandGeometry } from './ligand-geometry.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';

/**
 * Conformation morph: load a second conformation of the structure on screen (an RCSB entry or a file), fit it onto the first over all matched residues
 * and move between the two with a slider or an automatic back-and-forth. The maths is in plugins/motion/state-pair.mjs; this file loads the second
 * structure, hands the display its second state, and runs the little panel. It is an illustration of the two end states, not a pathway, and says so.
 */
export function createStateMorph({ viewport, elements, context }) {
  let morph = null, frame = null, last = 0, phase = -Math.PI / 2, token = 0;

  const show = (text) => { elements.info.textContent = text; };

  function reset() {
    token++;
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
    morph = null;
    viewport.setMolecules([], { tag: 'state-b' });
    elements.panel.hidden = true;
    elements.auto.checked = false;
    elements.fraction.value = '0';
    show('');
  }

  function describe(fit, label) {
    const note = `${label}：匹配 ${fit.matched} 个残基${fit.unmatchedA || fit.unmatchedB ? `（第一构象未匹配 ${fit.unmatchedA}，第二构象未匹配 ${fit.unmatchedB}）` : ''}；叠合后 RMSD ${fit.rmsdAfter.toFixed(2)} Å（叠合前 ${fit.rmsdBefore.toFixed(2)} Å），最大位移 ${fit.maxShift.toFixed(1)} Å。`;
    return `${note} 画面是两个终点之间的线性插值（示意，不是真实路径）。`;
  }

  /** Fits the loaded second conformation, draws it and its small molecules. `loaded` = { model, bytes, name, mediaType, source }. */
  async function start(loaded, label, fraction, mine = token) {
    const fit = fitStates(context.model(), loaded.model);
    morph = { fit, targets: stateTargets(fit), loaded, label, fraction, ligands: [] };
    elements.panel.hidden = false;
    context.rebuild();   // re-draws the structure with its second state (decorate is called on the way)
    apply(fraction);
    show(describe(fit, label));
    await prepareLigands(mine);
  }

  /** The small molecules of state B, in A's frame, each riding on the node of the nearest residue of A; drawn only near state B. */
  async function prepareLigands(mine) {
    const m = morph, space = selectionSpace(context.model()), center = displayCenter(context.model());
    const items = [];
    for (const ligand of stateLigands(m.loaded.model, m.fit)) {
      let template = null;
      try { template = await context.template(ligand.comp); } catch { /* distance-based bonds */ }
      if (mine !== token || morph !== m) return;
      const atoms = ligand.atoms.map((a) => ({ name: a.name, element: a.element, position: a.position }));
      const { geometry, centre } = ligandGeometry(atoms, template);
      let nearest = null, best = Infinity;
      for (const residue of space.residues) {
        const d = (residue.position[0] - centre[0]) ** 2 + (residue.position[1] - centre[1]) ** 2 + (residue.position[2] - centre[2]) ** 2;
        if (d < best) { best = d; nearest = residue; }
      }
      const nodeId = nearest && context.nodeForResidue(nearest);
      if (nodeId) items.push({ nodeId, position: centre.map((v, i) => (v - center[i]) * PRESENTATION_METERS_PER_ANGSTROM), geometry });
    }
    m.ligands = items;
    drawLigands();
    if (items.length) show(`${elements.info.textContent} 第二构象的 ${items.length} 个小分子在进度超过 0.6 时显示。`);
  }

  function drawLigands() {
    if (!morph?.ligands.length) { viewport.setMolecules([], { tag: 'state-b' }); return; }
    viewport.setMolecules(morph.ligands, { tag: 'state-b' });
    viewport.showMolecules('state-b', visibleState(morph.fraction) === 'B');
  }

  async function load(input, label) {
    const mine = ++token;
    if (!context.canMorph()) { show('这个作品有自己的构象播放器，不能再叠加通用构象变形。'); return; }
    show('正在读取第二个构象 …');
    try {
      const loaded = await context.loadModel(input);
      if (mine !== token) return;
      await start(loaded, label, 0, mine);
    } catch (error) {
      if (mine !== token) return;
      show(error instanceof StatePairError ? error.message : `无法载入第二个构象：${error.message}`);
    }
  }

  /** Called by the viewer while it builds the layers: every layer of the structure gets its second state. */
  function decorate(layers, assetIds) {
    if (!morph) return layers;
    const model = context.model(), center = displayCenter(model);
    const anchors = stateAnchors(morph.fit, center, PRESENTATION_METERS_PER_ANGSTROM);
    for (const id of assetIds) if (layers.has(id)) layers.set(id, conformationLayers(layers.get(id), anchors, morph.targets, PRESENTATION_METERS_PER_ANGSTROM));
    return layers;
  }

  function apply(fraction) {
    if (!morph) return;
    morph.fraction = fraction;
    elements.fraction.value = String(fraction);
    viewport.setConformation(fraction);
    viewport.showMolecules('state-b', visibleState(fraction) === 'B');
  }

  const tick = (now) => {
    if (!morph || !elements.auto.checked) { frame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now;
    phase += dt * 0.35;
    apply(pingPong(phase));
    frame = requestAnimationFrame(tick);
  };

  elements.fraction.addEventListener('input', () => { elements.auto.checked = false; apply(+elements.fraction.value); });
  elements.auto.addEventListener('change', () => {
    if (!elements.auto.checked) return;
    phase = Math.asin(Math.min(1, Math.max(-1, 2 * (morph?.fraction ?? 0) - 1))) || -Math.PI / 2;   // continue from the slider
    last = 0;
    if (frame == null) frame = requestAnimationFrame(tick);
  });
  elements.remove.addEventListener('click', () => { reset(); context.rebuild(); });

  return {
    load, decorate, reset, get active() { return Boolean(morph); },
    /** After the viewport was rebuilt: put the second state, the fraction and the molecules back. */
    reapply() { if (!morph) return; drawLigands(); apply(morph.fraction); },
    /** What a saved work needs: the second structure's file and the current fraction (null when there is none). */
    save: () => (morph ? { bytes: morph.loaded.bytes, name: morph.loaded.name, mediaType: morph.loaded.mediaType, source: morph.loaded.source, label: morph.label, fraction: morph.fraction } : null),
    /** Reopening a saved work: `loaded` = { model, bytes, name, mediaType, source }. */
    async restore(loaded, label, fraction) {
      const mine = ++token;
      try { await start(loaded, label, Math.min(1, Math.max(0, fraction)), mine); } catch (error) { show(`无法恢复第二构象：${error.message}`); }
    },
  };
}
