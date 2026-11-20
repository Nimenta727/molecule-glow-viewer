import { siteAround, siteInteractions, pocketJob, pocketSurface, INTERACTION_TYPES, RESIDUE_CHEMISTRY, POCKET_SAND } from '../../plugins/structure/site-analysis.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * The binding-site view of a selected small molecule (classic: the focus view of src/ui/ligand-focus.js): the interactions between the ligand and the residues around
 * it (hydrogen bonds, salt bridges, metal / ion coordination, hydrophobic contacts) from the coordinates, drawn as dashed lines in the structure and listed with their
 * distances, and the shape of the pocket as a translucent surface coloured by residue chemistry. The rules and numbers are in plugins/structure/site-analysis.mjs
 * (equal to the classic); this file wires them to the page.
 */
const LINES = 'site-lines', POCKET = 'site-pocket', RADIUS = 5;
const THREE_LETTER = (comp) => comp.charAt(0) + comp.slice(1).toLowerCase();

export function createSiteView({ viewport, elements, context }) {
  let result = null, selection = null, token = 0;

  const clear = () => { viewport.setOverlayLines(LINES, []); viewport.setOverlayMesh(POCKET, null); };
  function reset() {
    token++; result = null; clear();
    elements.list.replaceChildren(); elements.summary.textContent = '';
    elements.pocket.textContent = '显示口袋表面'; elements.pocket.disabled = true; elements.pocket.dataset.on = '';
    elements.lines.textContent = '隐藏相互作用线'; elements.lines.dataset.on = '1';
  }
  const toRoot = (model) => { const centre = displayCenter(model); return (p) => p.map((v, i) => (v - centre[i]) * PRESENTATION_METERS_PER_ANGSTROM); };

  function drawLines() {
    if (!result || elements.lines.dataset.on !== '1') { viewport.setOverlayLines(LINES, []); return; }
    const convert = toRoot(result.model);
    viewport.setOverlayLines(LINES, result.interactions.map((i) => ({ a: convert(i.a.position), b: convert(i.b.position), color: INTERACTION_TYPES[i.type][1] })));
  }

  function analyse() {
    const mine = ++token, model = context.model(selection), ligand = context.ligandOf(selection);
    if (!model || !ligand) { elements.summary.textContent = '找不到这个小分子的原子。'; return; }
    const around = siteAround(model, ligand, RADIUS), found = siteInteractions({ ligand: around.ligand, residues: around.residues, het: around.het, ligandComp: ligand.comp });
    if (mine !== token) return;
    result = { model, around, interactions: found.interactions };
    const counts = Object.entries(INTERACTION_TYPES).map(([type, [name]]) => `${name} ${found.interactions.filter((i) => i.type === type).length}`).join('、');
    elements.summary.textContent = `${ligand.comp}：${around.residues.length} 个残基在 ${RADIUS} Å 内；${counts}；${found.hydrophobic.size} 个残基与它有疏水接触${found.clashes ? `；${found.clashes} 对 N/O 靠得过近（<2.4 Å），多半是模型误差，不算相互作用` : ''}。`;
    elements.list.replaceChildren(...found.interactions.map((i) => {
      const li = document.createElement('li'), partner = i.residue ? `${THREE_LETTER(i.residue.comp)} ${i.residue.asym}:${i.residue.seq} ${i.b.an}` : `${i.b.an}`;
      li.textContent = `${INTERACTION_TYPES[i.type][0]} · ${i.a.an} — ${partner} · ${i.distance.toFixed(2)} Å`;
      li.style.borderLeft = `4px solid ${INTERACTION_TYPES[i.type][1]}`; li.style.paddingLeft = '6px';
      return li;
    }));
    if (!found.interactions.length) elements.list.textContent = `${RADIUS} Å 内没有符合规则的氢键、盐桥或配位。`;
    elements.pocket.disabled = false;
    drawLines();
  }

  function pocket(on) {
    if (!result) return;
    elements.pocket.dataset.on = on ? '1' : '';
    elements.pocket.textContent = on ? '隐藏口袋表面' : '显示口袋表面';
    if (!on) { viewport.setOverlayMesh(POCKET, null); return; }
    const surface = pocketSurface(pocketJob({ ligand: result.around.ligand, residues: result.around.residues }));
    if (!surface.idx.length) { elements.summary.textContent += ' 口袋表面太大或没有形成，未画出。'; return; }
    const convert = toRoot(result.model), names = Object.keys(RESIDUE_CHEMISTRY), position = new Float32Array(surface.pos.length), colors = new Float32Array(surface.cls.length * 3), shade = { set: (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; } };
    for (let i = 0; i < surface.pos.length; i += 3) position.set(convert([surface.pos[i], surface.pos[i + 1], surface.pos[i + 2]]), i);
    surface.cls.forEach((k, i) => colors.set(shade.set(k === 255 ? POCKET_SAND : RESIDUE_CHEMISTRY[names[k]]), i * 3));
    viewport.setOverlayMesh(POCKET, { pos: position, idx: surface.idx, colors }, { opacity: 0.3 });
  }

  elements.details.addEventListener('toggle', () => { if (elements.details.open && !result && selection) analyse(); else if (!elements.details.open) clear(); else drawLines(); if (elements.details.open && elements.pocket.dataset.on === '1') pocket(true); });
  elements.lines.addEventListener('click', () => { const on = elements.lines.dataset.on !== '1'; elements.lines.dataset.on = on ? '1' : ''; elements.lines.textContent = on ? '隐藏相互作用线' : '显示相互作用线'; drawLines(); });
  elements.pocket.addEventListener('click', () => pocket(elements.pocket.dataset.on !== '1'));

  return {
    onSelection(next) { selection = next?.kind === 'ligand' ? next : null; reset(); elements.details.open = false; elements.details.hidden = !selection; },
    reset() { selection = null; reset(); elements.details.open = false; elements.details.hidden = true; },
    get interactions() { return result?.interactions ?? []; },
  };
}
