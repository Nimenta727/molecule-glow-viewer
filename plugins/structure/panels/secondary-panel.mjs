import { secondaryOf, MAX_SHOWN } from '../secondary.mjs';
import { selectionSpace, evaluateSelection } from '../selection.mjs';

/**
 * The "序列与二级结构" panel (a Studio panel plugin): shows the sequence of the chosen part, the secondary structure line (H helix, E strand, - other, / a gap without coordinates) and the helix / strand
 * segments; a segment can be lit in the viewport, the part coloured by secondary structure, and the figures recorded in the work as DERIVED evidence. The secondary structure is what the FILE says
 * (deposited annotation); it is not predicted or recomputed here.
 */
export const SECONDARY_PANEL_ID = 'org.glow.panel.secondary';
export const LINE = 50;
const NAMES = { helix: '螺旋', sheet: '折叠' };

/** Text blocks of the sequence and structure lines, LINE residues per block, each with the number of its first residue in the part. */
export function blocks(chain) {
  const out = [];
  for (let i = 0; i < chain.sequence.length; i += LINE) out.push({ start: i + 1, sequence: chain.sequence.slice(i, i + LINE), structure: chain.structure.slice(i, i + LINE) });
  return out;
}
export const share = (chain, key) => (chain.residues ? Math.round((100 * chain[key]) / chain.residues) : 0);

/** What is saved with the work: the part and, per chain, the figures (conclusions only). */
export function resultData(result, expression) {
  return { part: expression, chains: result.chains.map((c) => ({ chain: c.label, residues: c.residues, helix: c.helix, sheet: c.sheet, segments: c.segments.map(({ type, from, to }) => [type === 'helix' ? 'H' : 'E', from, to]).slice(0, 40) })).slice(0, 16) };
}

/** Writes the result into the work through the panel doors: the evidence entry (derived, with its method) and the panel's own data. Also used by the Studio command API. */
export function recordResult(api, result, expression) {
  const helix = result.chains.reduce((n, c) => n + c.helix, 0), sheet = result.chains.reduce((n, c) => n + c.sheet, 0), total = result.chains.reduce((n, c) => n + c.residues, 0);
  api.addEvidence({ method: `序列与二级结构：${expression} 共 ${total} 个残基，螺旋 ${helix}、折叠 ${sheet}（读取文件登记的二级结构，未重新计算）` });
  api.setData(resultData(result, expression), '序列与二级结构：已保存结果。');
}

export const secondaryPanel = Object.freeze({
  id: SECONDARY_PANEL_ID, title: '序列与二级结构', needs: ['structure', 'selection'],
  summary: '显示选中部分的序列、文件里登记的二级结构，可点螺旋/折叠段在画面里亮出来，并涂色、记入作品。',
  mount(container, api) {
    const doc = container.ownerDocument;
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const part = el('input', { type: 'text', id: 'secondary-part', maxlength: '300', placeholder: 'chain A', 'aria-label': '要显示的部分', autocomplete: 'off', spellcheck: 'false' });
    const run = el('button', { type: 'button', id: 'secondary-run', text: '显示' }), paint = el('button', { type: 'button', id: 'secondary-paint', text: '按二级结构涂色', disabled: '' }), record = el('button', { type: 'button', id: 'secondary-record', text: '记入作品', disabled: '' });
    const out = el('div', { id: 'secondary-out', role: 'status', 'aria-live': 'polite' });
    container.replaceChildren(el('p', { class: 'tool-note', text: '二级结构是文件里登记的（HELIX/SHEET 或 mmCIF 的 struct_conf、struct_sheet_range），这里不预测也不重新计算；H 螺旋、E 折叠、- 其他、/ 缺失（无坐标）。' }), el('div', { class: 'button-row' }, part, run), el('div', { class: 'button-row' }, paint, record), out);
    const previous = api.data(); if (previous?.part) { part.value = previous.part; out.textContent = `上次记入作品：${previous.part}，${previous.chains.length} 条链。`; }
    let last = null;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    const render = (extra) => {
      const nodes = [];
      for (const chain of last.result.chains) {
        nodes.push(el('p', { class: 'tool-note', text: `链 ${chain.label}：${chain.residues} 个残基，螺旋 ${share(chain, 'helix')}%，折叠 ${share(chain, 'sheet')}%（文件登记）。` }));
        nodes.push(el('pre', { class: 'sequence-lines' }, ...blocks(chain).map((b) => doc.createTextNode(`${String(b.start).padStart(5)}  ${b.sequence}\n       ${b.structure}\n`))));
        const buttons = chain.segments.slice(0, 40).map((seg) => { const b = el('button', { type: 'button', 'data-expr': seg.expr, text: `${NAMES[seg.type]} ${seg.from}–${seg.to}` }); b.title = `${seg.length} 个残基`; return b; });
        nodes.push(el('div', { class: 'button-row', 'aria-label': `链 ${chain.label} 的螺旋与折叠段` }, ...buttons));
      }
      if (last.result.truncated) nodes.push(el('p', { class: 'tool-note', text: `只显示前 ${MAX_SHOWN} 个残基；请缩小选择。` }));
      if (extra) nodes.push(el('p', { class: 'tool-note', text: extra }));
      out.replaceChildren(...nodes);
    };
    out.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-expr]'); if (!button) return;
      guard(() => api.highlight(evaluateSelection(button.dataset.expr, selectionSpace(api.model())).residues));
    });
    run.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const expression = part.value.trim() || api.selection().expression;
      if (!expression) throw new Error('先写出要显示的部分，例如 chain A。');
      part.value = expression; last = { result: secondaryOf(api.model(), expression), expression }; render();
      paint.disabled = record.disabled = false;
    }));
    paint.addEventListener('click', () => guard(() => { if (!last) return; api.applyLook({ colors: { residues: [{ expr: last.expression, scheme: 'secondary' }] } }, `序列与二级结构：${last.expression} 按二级结构涂色。`); render('已按二级结构涂色（螺旋红、折叠金、其他灰蓝）。'); }));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { result, expression } = last, helix = result.chains.reduce((n, c) => n + c.helix, 0), sheet = result.chains.reduce((n, c) => n + c.sheet, 0), total = result.chains.reduce((n, c) => n + c.residues, 0);
      recordResult(api, result, expression);
      render('已作为“推导”证据记入作品。');
    }));
    return { dispose() { api.highlight(null); } };
  },
});
