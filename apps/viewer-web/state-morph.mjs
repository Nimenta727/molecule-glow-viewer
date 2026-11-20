import { fitStates, stateTargets, stateAnchors, conformationLayers, displayCenter, pingPong, StatePairError } from '../../plugins/motion/state-pair.mjs';
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
    elements.panel.hidden = true;
    elements.auto.checked = false;
    elements.fraction.value = '0';
    show('');
  }

  function describe(fit, label) {
    const note = `${label}：匹配 ${fit.matched} 个残基${fit.unmatchedA || fit.unmatchedB ? `（第一构象未匹配 ${fit.unmatchedA}，第二构象未匹配 ${fit.unmatchedB}）` : ''}；叠合后 RMSD ${fit.rmsdAfter.toFixed(2)} Å（叠合前 ${fit.rmsdBefore.toFixed(2)} Å），最大位移 ${fit.maxShift.toFixed(1)} Å。`;
    return `${note} 画面是两个终点之间的线性插值（示意，不是真实路径）。`;
  }

  async function load(input, label) {
    const mine = ++token;
    if (!context.canMorph()) { show('这个作品有自己的构象播放器，不能再叠加通用构象变形。'); return; }
    show('正在读取第二个构象 …');
    try {
      const modelB = await context.loadModel(input);
      if (mine !== token) return;
      const fit = fitStates(context.model(), modelB);
      morph = { fit, targets: stateTargets(fit), modelB, label, fraction: 0 };
      elements.panel.hidden = false;
      elements.fraction.value = '0';
      context.rebuild();   // re-draws the structure with its second state (decorate is called on the way)
      apply(0);
      show(describe(fit, label));
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

  return { load, decorate, reapply: () => apply(morph?.fraction ?? 0), reset, get active() { return Boolean(morph); } };
}
