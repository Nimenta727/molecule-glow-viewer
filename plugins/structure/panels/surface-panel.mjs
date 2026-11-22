import { buildSurface, SCHEMES, MAX_SURFACES, RANGE, OFFSET, DIELECTRIC } from '../molecular-surface.mjs';

/**
 * The "分子表面与静电" panel (a Studio panel plugin): a molecular surface of the chosen part drawn from all its atoms, coloured by electrostatic potential (simplified Coulomb, see
 * molecular-surface.mjs), by hydrophobicity, or in one colour. The surface is a RULE of the work (`surfaces` in the structure file's viewer state): it is rebuilt from the coordinates when the work
 * is opened, in the Studio and in the Viewer. The electrostatic colouring is NOT a Poisson–Boltzmann (APBS) calculation.
 */
export const SURFACE_PANEL_ID = 'org.glow.panel.surface';

export function describe(stats, scheme) {
  const size = `${stats.atoms} 个原子、${stats.triangles} 个三角形（网格 ${stats.resolution} Å）`;
  if (scheme !== 'electrostatic') return `表面已建立：${size}。`;
  const p = stats.potential;
  return `表面已建立：${size}。表面外 ${OFFSET} Å 处的静电势 ${p.min.toFixed(1)} … ${p.max.toFixed(1)} kcal/(mol·e)，平均 ${p.mean.toFixed(1)}（红 = 负，白 = 0，蓝 = 正，饱和在 ±${RANGE}）。`;
}

export function resultData(expression, scheme, stats) {
  return { part: expression, scheme, atoms: stats.atoms, triangles: stats.triangles, resolution: stats.resolution, ...(stats.potential ? { potentialMin: +stats.potential.min.toFixed(2), potentialMax: +stats.potential.max.toFixed(2), potentialMean: +stats.potential.mean.toFixed(2) } : {}) };
}

/** Writes the result into the work through the panel doors: the evidence entry (derived, with its method) and the panel's own data. Also used by the Studio command API. */
export function recordResult(api, expression, kind, stats) {
  const p = stats.potential;
  api.addEvidence({ method: `分子表面：${expression} 的高斯分子表面（${stats.atoms} 个原子，网格 ${stats.resolution} Å），按${SCHEMES[kind]}着色${p ? `；表面外 ${OFFSET} Å 处简化库仑静电势 ${p.min.toFixed(1)} … ${p.max.toFixed(1)} kcal/(mol·e)（ε = ${DIELECTRIC}r，形式电荷加通用主链部分电荷，不是 APBS）` : ''}`, citation: kind === 'electrostatic' ? 'Coulomb 势，与 ChimeraX coulombic 的默认介电设置一致' : undefined });
  api.setData(resultData(expression, kind, stats), '分子表面：已保存结果。');
}

export const surfacePanel = Object.freeze({
  id: SURFACE_PANEL_ID, title: '分子表面与静电', needs: ['structure', 'selection'],
  summary: '给选中的部分画逐原子的分子表面，按静电势、疏水性或单色着色；随作品保存，Viewer 里一样显示。',
  mount(container, api) {
    const doc = container.ownerDocument;
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const part = el('input', { type: 'text', id: 'surface-part', maxlength: '300', placeholder: 'chain A', 'aria-label': '要画表面的部分', autocomplete: 'off', spellcheck: 'false' });
    const scheme = el('select', { id: 'surface-scheme', 'aria-label': '表面着色' }, ...Object.entries(SCHEMES).map(([value, label]) => el('option', { value, text: label })));
    const show = el('button', { type: 'button', id: 'surface-show', text: '画出表面' }), record = el('button', { type: 'button', id: 'surface-record', text: '记入作品', disabled: '' });
    const out = el('p', { class: 'tool-note', id: 'surface-out', role: 'status', 'aria-live': 'polite' });
    container.replaceChildren(
      el('p', { class: 'tool-note', text: `表面是高斯分子表面（每个原子一个按范德华半径的高斯函数，接近 ChimeraX/PyMOL 的溶剂排除面，但网格不同）。静电着色是简化库仑：表面外 ${OFFSET} Å 处，整个结构的形式电荷加通用主链部分电荷，ε = ${DIELECTRIC}r，单位 kcal/(mol·e)；不是 APBS 的泊松–玻尔兹曼结果（没有溶剂、离子、配体电荷和 pH）。最多 ${MAX_SURFACES} 个表面；在“外观”页的规则列表里删除。移动过的链（结构叠合）上，表面不跟着走。` }),
      el('div', { class: 'button-row' }, part), el('div', { class: 'button-row' }, scheme, show, record), out);
    const previous = api.data(); if (previous?.part) { part.value = previous.part; scheme.value = previous.scheme; out.textContent = `上次记入作品：${previous.part}，${SCHEMES[previous.scheme]}，${previous.triangles} 个三角形。`; }
    let last = null;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    show.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const expression = part.value.trim() || api.selection().expression;
      if (!expression) throw new Error('先写出要画表面的部分，例如 chain A。');
      part.value = expression; out.textContent = '正在建立表面…';
      const built = buildSurface(api.model(), { expr: expression, scheme: scheme.value });   // checked here first, so a part that is empty or too big is explained before anything is written
      last = { expression, scheme: scheme.value, stats: built.stats }; record.disabled = false;
      api.applyLook({ surfaces: [{ expr: expression, scheme: scheme.value }] }, `分子表面：${expression} 画出表面（${SCHEMES[scheme.value]}）。`);
      out.textContent = describe(built.stats, scheme.value);
    }));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { expression, scheme: kind, stats } = last, p = stats.potential;
      recordResult(api, expression, kind, stats);
      out.textContent = `${describe(stats, kind)} 已作为“推导”证据记入作品。`;
    }));
    return { dispose() { /* the surface is part of the work: removed from the rule list, not by closing the panel */ } };
  },
});
