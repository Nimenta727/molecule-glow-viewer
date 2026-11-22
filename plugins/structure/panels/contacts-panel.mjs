import { contactsBetween, expressionsFor, residueName, DEFAULT_CUTOFF, MAX_CUTOFF } from '../contacts.mjs';
import { interactionsBetween, TYPES as BOND_TYPES, CUTOFFS } from '../interactions.mjs';

/**
 * The "界面接触" panel (a Studio panel plugin, see packages/plugin-host/panels.mjs): choose two parts of the open structure with the selection language, and it lists which residues of one come within a
 * distance of the other. The author's current selection is offered as part A. Results can be written into the work through the panel doors: colour the interface residues (orange for A, blue for B),
 * and record it as DERIVED evidence with the method, the cutoff and the counts. A second step sorts the pairs into hydrogen bonds, salt bridges and hydrophobic contacts (interactions.mjs: distance
 * criteria on heavy atoms, no angles) and can draw the hydrogen bonds and salt bridges as typed lines. No buried surface area.
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

/** One residue as a selection-language expression (copies of a chain by their asym id). */
export const residueExpression = (r) => `${r.asym && r.asym.includes('_') ? 'asym ' + r.asym : 'chain ' + r.chain} and resi ${r.authSeq}${r.insertion || ''}`;

/** The typed lines to draw: salt bridges and hydrogen bonds (hydrophobic contacts are listed, not drawn: there are too many). */
export function bondLines(found, limit = 150) {
  return found.interactions.filter((i) => i.type !== 'hydrophobic').slice(0, limit).map((i) => ({ a: { expr: residueExpression(i.a), atom: i.atomA }, b: { expr: residueExpression(i.b), atom: i.atomB }, type: i.type }));
}

export function typedSummary(found) {
  const { counts } = found, nearest = found.interactions[0];
  const parts = Object.entries(BOND_TYPES).map(([type, [label]]) => `${label} ${counts[type]}`).join('、');
  return `分类（只用重原子距离，没有角度判据）：${parts}。${nearest ? `最近的是${BOND_TYPES[nearest.type][0]} ${residueName(nearest.a)} ${nearest.atomA} — ${residueName(nearest.b)} ${nearest.atomB}，${nearest.distance.toFixed(2)} Å。` : ''}`;
}

/** What is saved with the work (conclusions only): the two parts, the cutoff and the counts. */
export function resultData(result, exprA, exprB, typed) {
  return { a: exprA, b: exprB, cutoff: result.cutoff, pairs: result.pairs.length, interfaceA: result.residuesA.length, interfaceB: result.residuesB.length, nearest: result.pairs[0] ? +result.pairs[0].distance.toFixed(2) : null, ...(typed ? { salt: typed.counts.salt, hbond: typed.counts.hbond, hydrophobic: typed.counts.hydrophobic } : {}) };
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
    const run = el('button', { type: 'button', id: 'contacts-run', text: '计算界面' }), classify = el('button', { type: 'button', id: 'contacts-classify', text: '分类：氢键/盐桥/疏水', disabled: '' }), draw = el('button', { type: 'button', id: 'contacts-draw', text: '画出氢键和盐桥的线', disabled: '' }), paint = el('button', { type: 'button', id: 'contacts-paint', text: '涂色界面残基', disabled: '' }), record = el('button', { type: 'button', id: 'contacts-record', text: '记入作品', disabled: '' });
    const out = el('p', { class: 'tool-note', id: 'contacts-out', role: 'status', 'aria-live': 'polite' }), list = el('ul', { class: 'text-list', id: 'contacts-list', 'aria-label': '最近的接触' });
    container.replaceChildren(
      el('p', { class: 'tool-note', text: 'A 默认取“外观”页“选择”框里的内容；两部分用选择语言写。先“计算界面”看哪些残基接触；再“分类”把接触对分成氢键（供体—受体 2.4–3.5 Å）、盐桥（Asp/Glu 羧基氧到 Lys/Arg 氮 ≤ 4.0 Å）、疏水接触（侧链碳 ≤ 4.0 Å）。只用重原子距离，没有氢原子和角度判据；不算埋藏面积。' }),
      el('div', { class: 'button-row' }, a, b, cutoff), el('div', { class: 'button-row' }, run, classify, draw), el('div', { class: 'button-row' }, paint, record), out, list);
    const previous = api.data();
    if (previous?.a) { a.value = previous.a; b.value = previous.b; cutoff.value = previous.cutoff; out.textContent = `上次记入作品：${previous.pairs} 对接触（${previous.a} 对 ${previous.b}，≤ ${previous.cutoff} Å）。`; }
    let last = null, typed = null;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    run.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const exprA = a.value.trim() || api.selection().expression || '', exprB = b.value.trim();
      if (!exprA || !exprB) throw new Error('A、B 两部分都要写：例如 A 填 chain A，B 填 chain B。');
      a.value = exprA; last = { result: contactsBetween(api.model(), exprA, exprB, { cutoff: Number(cutoff.value) }), exprA, exprB };
      out.textContent = summarize(last.result); paint.disabled = record.disabled = classify.disabled = !last.result.pairs.length; typed = null; draw.disabled = true;
      list.replaceChildren(...last.result.pairs.slice(0, 10).map((p) => el('li', { text: `${residueName(p.a)} ${p.atomA} — ${residueName(p.b)} ${p.atomB}：${p.distance.toFixed(2)} Å` })));
      api.highlight([...last.result.residuesA, ...last.result.residuesB]);
    }));
    classify.addEventListener('click', () => guard(() => {
      if (!last) return; typed = interactionsBetween(api.model(), last.exprA, last.exprB); out.textContent = `${summarize(last.result)} ${typedSummary(typed)}`;
      list.replaceChildren(...typed.interactions.slice(0, 14).map((i) => el('li', { text: `${BOND_TYPES[i.type][0]}：${residueName(i.a)} ${i.atomA} — ${residueName(i.b)} ${i.atomB}，${i.distance.toFixed(2)} Å` }))); draw.disabled = !bondLines(typed).length;
    }));
    draw.addEventListener('click', () => guard(() => {
      if (!typed) return; const lines = bondLines(typed);
      api.annotate({ bonds: lines }, `界面接触：画出 ${lines.length} 条氢键和盐桥线。`); out.textContent = `${summarize(last.result)} ${typedSummary(typed)} 已画出 ${lines.length} 条线（蓝 = 氢键，粉 = 盐桥；指到线上看距离；在“外观”页的“标注与测量”里可一并删除）。`;
    }));
    paint.addEventListener('click', () => guard(() => { if (!last) return; api.applyLook({ colors: { residues: interfaceRules(last.result) } }, '界面接触：已涂色界面残基。'); out.textContent = `${summarize(last.result)} 已涂色（橙 = A 侧，蓝 = B 侧）。`; }));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { result, exprA, exprB } = last;
      api.addEvidence({ method: `界面接触：${exprA} 与 ${exprB} 之间重原子距离 ≤ ${result.cutoff} Å 的残基对共 ${result.pairs.length} 对${typed ? `；分类 盐桥 ${typed.counts.salt}、氢键 ${typed.counts.hbond}、疏水接触 ${typed.counts.hydrophobic}（距离判据，无氢原子与角度）` : ''}（只是几何事实，不代表亲和力）` });
      api.setData(resultData(result, exprA, exprB, typed), '界面接触：已保存结果。'); out.textContent = `${summarize(result)} 已作为“推导”证据记入作品。`;
    }));
    return { dispose() { api.highlight(null); } };
  },
});
