import { compositionOf, CLASSES } from '../composition.mjs';

/**
 * The "组成与性质" panel (a Studio panel plugin): for the part chosen with the selection language it counts the residues by kind, gives the mean hydropathy (Kyte–Doolittle GRAVY) and the net charge by
 * counting charged side chains, and can colour that part by hydrophobicity or charge and record the numbers in the work as DERIVED evidence. The charge is a COUNT: no pKa, no environment, no termini.
 */
export const COMPOSITION_PANEL_ID = 'org.glow.panel.composition';
const bar = (n, total) => '█'.repeat(Math.round((12 * n) / Math.max(1, total))).padEnd(12, '·');

/** Lines of text for the result. */
export function describe(result) {
  if (!result.protein) return [`选中的 ${result.selected} 个部分里没有可统计的氨基酸残基（核酸和未知残基不计）。`];
  const lines = [`${result.protein} 个氨基酸残基${result.other ? `（另有 ${result.other} 个核酸或未知残基没有计入）` : ''}。`];
  for (const [key, { label }] of Object.entries(CLASSES)) lines.push(`${label}：${result.classes[key]}（${((100 * result.classes[key]) / result.protein).toFixed(0)}%） ${bar(result.classes[key], result.protein)}`);
  lines.push(`平均亲水性 GRAVY：${result.gravy.toFixed(2)}（正数偏疏水，负数偏亲水）；按个数数出的净电荷：${result.netCharge > 0 ? '+' : ''}${result.netCharge}（Lys、Arg 记 +1，Asp、Glu 记 −1，His 记 0）。`);
  return lines;
}

/** What is saved with the work: the part and the figures (conclusions only). */
export function resultData(result, expression) {
  return { part: expression, residues: result.protein, classes: result.classes, gravy: result.gravy === null ? null : +result.gravy.toFixed(3), netCharge: result.netCharge };
}

export const compositionPanel = Object.freeze({
  id: COMPOSITION_PANEL_ID, title: '组成与性质', needs: ['structure', 'selection'],
  summary: '数选中部分的残基组成、平均亲水性和净电荷，可涂色并记为推导证据。',
  mount(container, api) {
    const doc = container.ownerDocument;
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const part = el('input', { type: 'text', id: 'composition-part', maxlength: '300', placeholder: 'chain A and resi 10-50', 'aria-label': '要分析的部分', autocomplete: 'off', spellcheck: 'false' });
    const run = el('button', { type: 'button', id: 'composition-run', text: '分析' }), hydro = el('button', { type: 'button', id: 'composition-hydro', text: '按疏水性涂色', disabled: '' }), charge = el('button', { type: 'button', id: 'composition-charge', text: '按电荷涂色', disabled: '' }), record = el('button', { type: 'button', id: 'composition-record', text: '记入作品', disabled: '' });
    const out = el('div', { id: 'composition-out', role: 'status', 'aria-live': 'polite' });
    container.replaceChildren(el('p', { class: 'tool-note', text: '部分默认取“外观”页“选择”框里的内容。净电荷只是按个数数的，不含 pKa、环境、末端和配体的影响。' }), el('div', { class: 'button-row' }, part, run), el('div', { class: 'button-row' }, hydro, charge, record), out);
    const previous = api.data(); if (previous?.part) { part.value = previous.part; out.textContent = `上次记入作品：${previous.part}，${previous.residues} 个残基，GRAVY ${previous.gravy}，净电荷 ${previous.netCharge}。`; }
    let last = null;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    const show = (lines) => out.replaceChildren(...lines.map((text) => el('p', { class: 'tool-note', text })));
    run.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const expression = part.value.trim() || api.selection().expression;
      if (!expression) throw new Error('先写出要分析的部分，例如 chain A。');
      part.value = expression; last = { result: compositionOf(api.model(), expression), expression }; show(describe(last.result));
      hydro.disabled = charge.disabled = record.disabled = !last.result.protein; api.highlight(api.selection().residues);
    }));
    const paint = (scheme, name) => guard(() => { if (!last) return; api.applyLook({ colors: { residues: [{ expr: last.expression, scheme }] } }, `组成与性质：${last.expression} 按${name}涂色。`); show([...describe(last.result), `已按${name}涂色。`]); });
    hydro.addEventListener('click', () => paint('hydrophobicity', '疏水性')); charge.addEventListener('click', () => paint('charge', '电荷'));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { result, expression } = last;
      api.addEvidence({ method: `组成统计：${expression} 的 ${result.protein} 个残基，GRAVY ${result.gravy.toFixed(2)}（Kyte–Doolittle），按个数数出的净电荷 ${result.netCharge}（不含 pKa 与环境）`, citation: 'Kyte & Doolittle 1982' });
      api.setData(resultData(result, expression), '组成与性质：已保存结果。'); show([...describe(result), '已作为“推导”证据记入作品。']);
    }));
    return { dispose() { api.highlight(null); } };
  },
});
