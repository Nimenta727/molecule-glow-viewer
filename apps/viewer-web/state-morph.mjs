import { fitStates, domainMotions, stateTargets, stateAnchors, stateLigands, conformationLayers, displayCenter, pingPong, visibleState, StatePairError } from '../../plugins/motion/state-pair.mjs';
import { selectionSpace, evaluateSelection, SelectionError } from '../../plugins/structure/selection.mjs';
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
    elements.core.value = '';
    elements.domains.value = '';
    show('');
  }

  /** The settings text boxes -> { core: Set | null, domains: [{ name, residues }] } on the first conformation; a bad expression says so. */
  function readSettings(config) {
    const space = selectionSpace(context.model());
    const residues = (expression, what) => {
      try { return new Set(evaluateSelection(expression, space).residues); }
      catch (error) { throw new StatePairError(`${what}：${error instanceof SelectionError ? error.message : error.message}`); }
    };
    const core = config.core.trim() ? residues(config.core, '叠合范围') : null;
    const domains = config.domains.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = /^([^:：]+)[:：](.+)$/.exec(line);
      if (!match) throw new StatePairError(`结构域写成 “名称: 选择表达式”：${line}`);
      return { name: match[1].trim(), residues: residues(match[2].trim(), `结构域 ${match[1].trim()}`) };
    });
    return { core, domains };
  }

  function describe(fit, label, domains) {
    const range = fit.coreCount < fit.matched ? `在 ${fit.coreCount} 个残基的叠合范围内 RMSD ${fit.rmsdCore.toFixed(2)} Å，全部匹配残基 ${fit.rmsdAfter.toFixed(2)} Å` : `叠合后 RMSD ${fit.rmsdAfter.toFixed(2)} Å（叠合前 ${fit.rmsdBefore.toFixed(2)} Å）`;
    const note = `${label}：匹配 ${fit.matched} 个残基${fit.unmatchedA || fit.unmatchedB ? `（第一构象未匹配 ${fit.unmatchedA}，第二构象未匹配 ${fit.unmatchedB}）` : ''}；${range}，最大位移 ${fit.maxShift.toFixed(1)} Å。`;
    const motions = domains.length ? ` 结构域相对叠合范围的运动：${domains.map((d) => (d.angle == null ? `${d.name}（残基太少）` : `${d.name} 转 ${d.angle.toFixed(1)}°、位移 ${d.shift.toFixed(1)} Å`)).join('；')}。` : '';
    return `${note}${motions} 画面是两个终点之间的线性插值（示意，不是真实路径）。`;
  }

  /** Fits the loaded second conformation, draws it and its small molecules. `loaded` = { model, bytes, name, mediaType, source }. */
  async function start(loaded, label, fraction, mine = token, config = { core: '', domains: '' }) {
    const settings = readSettings(config);
    const fit = fitStates(context.model(), loaded.model, { core: settings.core });
    morph = { fit, targets: stateTargets(fit), loaded, label, fraction, ligands: [], config };
    elements.core.value = config.core;
    elements.domains.value = config.domains;
    elements.panel.hidden = false;
    context.rebuild();   // re-draws the structure with its second state (decorate is called on the way)
    apply(fraction);
    show(describe(fit, label, domainMotions(fit, settings.domains, 1)));
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

  elements.apply.addEventListener('click', async () => {
    if (!morph) return;
    const { loaded, label, fraction } = morph, config = { core: elements.core.value, domains: elements.domains.value };
    try { readSettings(config); } catch (error) { show(error.message); return; }   // a bad expression changes nothing
    const mine = ++token;
    try { await start(loaded, label, fraction, mine, config); } catch (error) { show(error.message); }
  });
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
    save: () => (morph ? { bytes: morph.loaded.bytes, name: morph.loaded.name, mediaType: morph.loaded.mediaType, source: morph.loaded.source, label: morph.label, fraction: morph.fraction, config: morph.config } : null),
    /** Reopening a saved work: `loaded` = { model, bytes, name, mediaType, source }. */
    async restore(loaded, label, fraction, config) {
      const mine = ++token;
      const clean = { core: typeof config?.core === 'string' ? config.core.slice(0, 500) : '', domains: typeof config?.domains === 'string' ? config.domains.slice(0, 2000) : '' };
      try { await start(loaded, label, Math.min(1, Math.max(0, fraction)), mine, clean); } catch (error) { show(`无法恢复第二构象：${error.message}`); }
    },
  };
}
