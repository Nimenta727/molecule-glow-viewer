import { ligandGeometry } from './ligand-geometry.mjs';

/**
 * The valence view of a selected small molecule: ball-and-stick with bond orders (single / double / triple / aromatic) from the RCSB chemical
 * component dictionary, matched to the ligand's atoms by name. When the dictionary cannot be read the bonds are guessed from distances (all single)
 * and the note says so. Geometry in molecule-geometry.mjs, bonds in chemical-component.mjs; this file only wires them to the page.
 */
const ORDER_NAMES = { 1: '单键', 2: '双键', 3: '三键', 4: '芳香键' };

export function createLigandView({ viewport, button, note, wrapper, context }) {
  let shown = null, token = 0, savedCamera = null;

  function hide() {
    token++;
    if (shown && savedCamera) viewport.setCamera(savedCamera);   // back to where the camera was
    shown = null;
    savedCamera = null;
    viewport.setMolecules([]);
    button.textContent = '显示价键结构';
    note.textContent = '';
  }

  function onSelection(selection) {
    hide();
    wrapper.hidden = selection?.kind !== 'ligand';
    wrapper.dataset.ready = wrapper.hidden ? '' : '1';
  }

  async function show(selection) {
    const mine = ++token;
    const ligand = context.ligandOf(selection);
    if (!ligand) { note.textContent = '找不到这个小分子的原子。'; return; }
    note.textContent = `正在读取化学组件 ${ligand.comp} …`;
    let template = null, failure = null;
    try { template = await context.template(ligand.comp); } catch (error) { failure = error; }
    if (mine !== token) return;
    const atoms = ligand.atoms.map((a) => ({ name: a.name, element: a.element, position: a.position }));
    const { geometry, bonds, source } = ligandGeometry(atoms, template);
    const drawn = viewport.setMolecules([{ target: selection, geometry }]);
    if (!drawn) { note.textContent = '这个小分子在当前表示里没有可放置的点。'; return; }
    savedCamera = viewport.getCamera({ destination: true });
    viewport.focusPoint(selection, 2 * Math.max(...geometry.balls.map((b) => Math.hypot(...b.position))) + 0.2);
    shown = selection;
    button.textContent = '隐藏价键结构';
    const counts = {};
    for (const [, , order] of bonds) counts[order] = (counts[order] ?? 0) + 1;
    const list = Object.entries(counts).map(([order, n]) => `${ORDER_NAMES[order]} ${n}`).join('、') || '没有键（单个离子）';
    note.textContent = source === 'CCD'
      ? `${ligand.comp}：${atoms.length} 个原子；键级来自 RCSB 化学组件字典（${list}）。`
      : `${ligand.comp}：${atoms.length} 个原子；${failure ? `未能读取化学组件字典（${failure.message}），` : '字典里的原子名与结构不匹配，'}键由原子间距离推断，全部画成单键（${list}）。`;
  }

  button.addEventListener('click', () => {
    const selection = context.selection();
    if (shown) hide();
    else if (selection?.kind === 'ligand') show(selection);
  });

  return { onSelection, hide };
}
