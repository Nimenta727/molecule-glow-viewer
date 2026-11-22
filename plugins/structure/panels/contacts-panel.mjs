import { contactsBetween, expressionsFor, residueName, DEFAULT_CUTOFF, MAX_CUTOFF } from '../contacts.mjs';

/**
 * The "界面接触" panel (a Studio panel plugin, see packages/plugin-host/panels.mjs): choose two parts of the open structure with the selection language, and it lists which residues of one come within a
 * distance of the other. The author's current selection is offered as part A. Results can be written into the work through the panel doors: colour the interface residues (orange for A, blue for B),
 * and record it as DERIVED evidence with the method, the cutoff and the counts. Geometry only: no hydrogen-bond / salt-bridge classification, no buried surface area.
 */
export const CONTACTS_PANEL_ID = 'org.glow.panel.contacts';
export const SIDE_COLORS = Object.freeze({ a: '#e1873a', b: '#3b9ae6' });

/** One line that says what was found. */
export function summarize(result) {
  const { pairs, residuesA, residuesB, sizeA, sizeB, cutoff } = result;
  if (!pairs.length) return `两部分之间没有 ≤ ${cutoff} Å 的重原子接触（A ${sizeA} 个残基，B ${sizeB} 个残基）。`;
  const nearest = pairs[0];
  return `A 部分 ${sizeA} 个残基中 ${residuesA.length} 个、B 部分 ${sizeB} 个残基中 ${residuesB.length} 个处在界面上，共 ${pairs.length} 对残基接触（重原子 ≤ ${cutoff} Å）；最近 ${nearest.distance.toFixed(2)} Å（${residueName(nearest.a)} ${nearest.atomA} — ${residueName(nearest.b)} ${nearest.atomB}）。`;
}

/** The colour rules that paint the interface: A side orange, B side blue (selection-language expressions, split to fit). */
export function interfaceRules(result) {
  return [...expressionsFor(result.residuesA).map((expr) => ({ expr, color: SIDE_COLORS.a })), ...expressionsFor(result.residuesB).map((expr) => ({ expr, color: SIDE_COLORS.b }))];
}

/** What is saved with the work (conclusions only): the two parts, the cutoff and the counts. */
export function resultData(result, exprA, exprB) {
  return { a: exprA, b: exprB, cutoff: result.cutoff, pairs: result.pairs.length, interfaceA: result.residuesA.length, interfaceB: result.residuesB.length, nearest: result.pairs[0] ? +result.pairs[0].distance.toFixed(2) : null };
}

export const contactsPanel = Object.freeze({
  id: CONTACTS_PANEL_ID, title: '界面接触', needs: ['structure', 'selection'],
  summary: '列出两部分之间互相接触的残基，并把界面涂色、记为推导证据。',
  mount(container, api) {
    const doc = container.ownerDocument;
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const a = el('input', { type: 'text', id: 'contacts-a', maxlength: '300', placeholder: 'A：chain A', 'aria-label': 'A 部分', autocomplete: 'off', spellcheck: 'false' });
    const b = el('input', { type: 'text', id: 'contacts-b', maxlength: '300', placeholder: 'B：chain B', 'aria-label': 'B 部分', autocomplete: 'off', spellcheck: 'false' });
    const cutoff = el('input', { type: 'number', id: 'contacts-cutoff', min: '1', max: String(MAX_CUTOFF), step: '0.1', value: String(DEFAULT_CUTOFF), 'aria-label': '距离（Å）' });
    const run = el('button', { type: 'button', id: 'contacts-run', text: '计算界面' }), paint = el('button', { type: 'button', id: 'contacts-paint', text: '涂色界面残基', disabled: '' }), record = el('button', { type: 'button', id: 'contacts-record', text: '记入作品', disabled: '' });
    const out = el('p', { class: 'tool-note', id: 'contacts-out', role: 'status', 'aria-live': 'polite' }), list = el('ul', { class: 'text-list', id: 'contacts-list', 'aria-label': '最近的接触' });
    container.replaceChildren(
      el('p', { class: 'tool-note', text: 'A 默认取“外观”页“选择”框里的内容；两部分用选择语言写。只看几何距离（重原子），不区分氢键、盐桥、疏水，也不算埋藏面积。' }),
      el('div', { class: 'button-row' }, a, b, cutoff), el('div', { class: 'button-row' }, run, paint, record), out, list);
    const previous = api.data();
    if (previous?.a) { a.value = previous.a; b.value = previous.b; cutoff.value = previous.cutoff; out.textContent = `上次记入作品：${previous.pairs} 对接触（${previous.a} 对 ${previous.b}，≤ ${previous.cutoff} Å）。`; }
    let last = null;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    run.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const exprA = a.value.trim() || api.selection().expression || '', exprB = b.value.trim();
      if (!exprA || !exprB) throw new Error('A、B 两部分都要写：例如 A 填 chain A，B 填 chain B。');
      a.value = exprA; last = { result: contactsBetween(api.model(), exprA, exprB, { cutoff: Number(cutoff.value) }), exprA, exprB };
      out.textContent = summarize(last.result); paint.disabled = record.disabled = !last.result.pairs.length;
      list.replaceChildren(...last.result.pairs.slice(0, 10).map((p) => el('li', { text: `${residueName(p.a)} ${p.atomA} — ${residueName(p.b)} ${p.atomB}：${p.distance.toFixed(2)} Å` })));
      api.highlight([...last.result.residuesA, ...last.result.residuesB]);
    }));
    paint.addEventListener('click', () => guard(() => { if (!last) return; api.applyLook({ colors: { residues: interfaceRules(last.result) } }, '界面接触：已涂色界面残基。'); out.textContent = `${summarize(last.result)} 已涂色（橙 = A 侧，蓝 = B 侧）。`; }));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { result, exprA, exprB } = last;
      api.addEvidence({ method: `界面接触：${exprA} 与 ${exprB} 之间重原子距离 ≤ ${result.cutoff} Å 的残基对共 ${result.pairs.length} 对（只是几何事实，不代表亲和力）` });
      api.setData(resultData(result, exprA, exprB), '界面接触：已保存结果。'); out.textContent = `${summarize(result)} 已作为“推导”证据记入作品。`;
    }));
    return { dispose() { api.highlight(null); } };
  },
});
