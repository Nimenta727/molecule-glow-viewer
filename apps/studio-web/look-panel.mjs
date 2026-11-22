import { SELECTION_HELP, selectionSpace, evaluateSelection, describeSelection } from '../../plugins/structure/selection.mjs';
import { applyColor, createColorState, isDefault, PROPERTY_SCHEMES as COLOR_SCHEMES } from '../viewer-web/color-scheme.mjs';
import { computeAnnotations, validateMeasures, validateLabels, MAX_MEASURES, MAX_LABELS } from '../../plugins/structure/annotations.mjs';
import { applyStyle, LOOK_STYLES, STYLE_LABELS, PROPERTY_SCHEMES } from '../../plugins/structure/look.mjs';
import { SCHEMES as SURFACE_SCHEMES } from '../../plugins/structure/molecular-surface.mjs';

/**
 * The Studio's appearance panel: the way structure work is done in PyMOL and ChimeraX. Choose a part with the selection language (the count and the part are shown, and the residues are lit in the
 * viewport), then give it a style (cartoon, backbone, blob, hidden) or a colour (a plain colour, or a scheme from a property: hydrophobicity, B-factor, charge, secondary structure, position along the
 * chain). Every action adds a RULE ("chain A and resi 10-50" -> hidden) that is kept with the work (the structure file's viewer state) and read back by the Viewer; later rules win, each rule can be
 * removed on its own, and every change is one undo step. The panel holds no state of its own: it reads and writes through `context`.
 *   context.hasStructure() / model() / chainIds()      what is open
 *   context.state()                                     { colors, styles } as saved in the work
 *   context.apply(patch, message)                       patch: { colors?, styles? }; one undoable edit
 *   context.highlight(residues | null)                  light the selected residues in the viewport
 *   context.annotations() / applyAnnotations(patch, message)   { measures, labels } as saved in the work; patch: { measures?, labels? }; one undoable edit
 */
const el = (doc, tag, props = {}, ...children) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
  node.append(...children); return node;
};

/** The rules shown in the list, in the order they act: the colour scheme, the colours of whole chains, the residue colour rules, then the style rules. */
export function describeRules({ colors, styles, surfaces = [] }) {
  const items = [];
  if (colors.scheme !== 'entity') items.push({ kind: 'scheme', text: `颜色 · 全部链 → ${{ chain: '按链', rainbow: '彩虹（链顺序）', confidence: '预测置信度' }[colors.scheme] ?? colors.scheme}` });
  for (const [chain, color] of Object.entries(colors.chains)) items.push({ kind: 'chain', chain, text: `颜色 · 链 ${chain} → ${color}`, color });
  colors.residues.forEach((rule, index) => items.push({ kind: 'color', index, text: `颜色 · ${rule.expr} → ${rule.scheme ? PROPERTY_LABELS[rule.scheme] ?? rule.scheme : rule.color}`, color: rule.color }));
  styles.forEach((rule, index) => items.push({ kind: 'style', index, text: `样式 · ${rule.expr} → ${STYLE_LABELS[rule.style]}` }));
  surfaces.forEach((rule, index) => items.push({ kind: 'surface', index, text: `表面 · ${rule.expr} → ${SURFACE_SCHEMES[rule.scheme]}` }));
  return items;
}
const PROPERTY_LABELS = { ...PROPERTY_SCHEMES, ...Object.fromEntries(COLOR_SCHEMES.map((id) => [id, PROPERTY_SCHEMES[id] ?? id])) };

/** The state without one listed rule. */
export function withoutRule({ colors, styles, surfaces = [] }, item) {
  if (item.kind === 'scheme') return { colors: { ...colors, scheme: 'entity' }, styles, surfaces };
  if (item.kind === 'chain') { const chains = { ...colors.chains }; delete chains[item.chain]; return { colors: { ...colors, chains }, styles, surfaces }; }
  if (item.kind === 'color') return { colors: { ...colors, residues: colors.residues.filter((_, i) => i !== item.index) }, styles, surfaces };
  if (item.kind === 'surface') return { colors, styles, surfaces: surfaces.filter((_, i) => i !== item.index) };
  return { colors, styles: styles.filter((_, i) => i !== item.index), surfaces };
}

export function createLookPanel(container, context, { doc = container.ownerDocument } = {}) {
  const make = (...args) => el(doc, ...args);
  const hint = make('p', { class: 'tool-note', text: '导入结构（或用“导入结构为新场景”）后，在这里选择一部分并设置它的表示和颜色。' });
  const input = make('input', { type: 'text', id: 'look-expression', placeholder: 'chain A and resi 10-50', maxlength: '300', autocomplete: 'off', spellcheck: 'false', 'aria-label': '选择表达式' });
  const select = make('button', { type: 'submit', id: 'look-select', text: '选择' }), clear = make('button', { type: 'button', id: 'look-clear', text: '清除选择' });
  const form = make('form', { class: 'look-select-form' }, input, select, clear);
  const info = make('p', { class: 'tool-note', id: 'look-info', role: 'status', 'aria-live': 'polite' });
  const chips = make('div', { class: 'look-chips', 'aria-label': '快速选择' });
  const help = make('details', {}, make('summary', { text: '选择语法' }), make('p', { class: 'tool-note', text: SELECTION_HELP }));
  const styleButtons = LOOK_STYLES.map((style) => make('button', { type: 'button', 'data-style': style, text: STYLE_LABELS[style] }));
  const color = make('input', { type: 'color', id: 'look-color', value: '#e05a4a', 'aria-label': '颜色' }), applyColorButton = make('button', { type: 'button', id: 'look-apply-color', text: '应用颜色' });
  const schemeButtons = Object.entries(PROPERTY_SCHEMES).map(([id, label]) => make('button', { type: 'button', 'data-scheme': id, text: label }));
  const chainScheme = make('button', { type: 'button', id: 'look-by-chain', text: '按链着色' }), resetColors = make('button', { type: 'button', id: 'look-reset-colors', text: '清除颜色' }), resetStyles = make('button', { type: 'button', id: 'look-reset-styles', text: '清除样式' });
  const mA = make('input', { type: 'text', id: 'ann-a', placeholder: 'A：resi 10', maxlength: '300', 'aria-label': '测量点 A', autocomplete: 'off' }), mB = make('input', { type: 'text', id: 'ann-b', placeholder: 'B：resi 40', maxlength: '300', 'aria-label': '测量点 B', autocomplete: 'off' }), mC = make('input', { type: 'text', id: 'ann-c', placeholder: 'C（可选，量角度）', maxlength: '300', 'aria-label': '测量点 C', autocomplete: 'off' });
  const addMeasure = make('button', { type: 'button', id: 'ann-add-measure', text: '添加测量' }), labelText = make('input', { type: 'text', id: 'ann-text', placeholder: '标签文字（留空则写残基名）', maxlength: '60', 'aria-label': '标签文字', autocomplete: 'off' }), addLabel = make('button', { type: 'button', id: 'ann-add-label', text: '给当前选择加标签' });
  const annotationList = make('ul', { class: 'text-list look-rules', id: 'ann-list', 'aria-label': '测量与标签' }), annotationInfo = make('p', { class: 'tool-note', id: 'ann-info', role: 'status', 'aria-live': 'polite' });
  const rules = make('ul', { class: 'text-list look-rules', id: 'look-rules', 'aria-label': '已应用的规则' });
  const section = (title, ...children) => make('section', { class: 'panel-section' }, make('h2', { text: title }), ...children);
  const body = make('div', { id: 'look-body' },
    section('选择', form, info, chips, help),
    section('表示（对当前选择）', make('div', { class: 'button-row look-row' }, ...styleButtons), make('p', { class: 'tool-note', text: '卡通、主链、团块对残基级别的所有表示都生效；“隐藏”的残基既不画，也不能被选中。没有选择时作用于全部。' })),
    section('着色（对当前选择）', make('div', { class: 'button-row look-row' }, color, applyColorButton), make('div', { class: 'button-row look-row' }, ...schemeButtons), make('div', { class: 'button-row look-row' }, chainScheme, resetColors, resetStyles), make('p', { class: 'tool-note', text: '按性质着色给每个残基一种颜色（B 因子：蓝低红高；疏水性：蓝亲水、橙疏水）。表面与功能分区表示保持链的颜色。' })),
    section('标注与测量', make('p', { class: 'tool-note', text: '每个点是一个残基或一个小分子（用选择语言写）；两个点量距离（Å），三个点量角度（B 是顶点）。标签放在“选择”框选中的部分上。结果随作品保存，Viewer 里一样显示。' }), make('div', { class: 'button-row look-row' }, mA, mB, mC, addMeasure), make('div', { class: 'button-row look-row' }, labelText, addLabel), annotationInfo, annotationList),
    section('已应用的规则', rules));
  container.replaceChildren(hint, body);

  const model = () => context.model();
  const check = (expression) => evaluateSelection(expression, selectionSpace(model())).residues.length;
  const target = () => input.value.trim() || 'all';
  const say = (text, kind = '') => { info.textContent = text; info.dataset.kind = kind; };
  const run = (work) => { try { work(); } catch (error) { say(error.message, 'error'); } };
  function preview() {
    const expression = input.value.trim();
    queueMicrotask(() => context.selectionChanged?.());
    if (!expression || !context.hasStructure() || !model()) { context.highlight(null); if (!expression) say(''); return; }
    try {
      const found = evaluateSelection(expression, selectionSpace(model()));
      context.highlight(found.residues); say(found.residues.length || found.ligands.length ? `选中 ${describeSelection(found)}` : '没有选中任何残基。', found.residues.length ? '' : 'error');
    } catch (error) { context.highlight(null); say(error.message, 'error'); }
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); preview(); });
  clear.addEventListener('click', () => { input.value = ''; context.highlight(null); say(''); });
  for (const button of styleButtons) button.addEventListener('click', () => run(() => { const out = applyStyle(context.state().styles, target(), button.dataset.style, { check }); context.apply({ styles: out.styles }, out.note); }));
  applyColorButton.addEventListener('click', () => run(() => { const out = applyColor(context.state().colors, target(), color.value, context.chainIds(), { check }); context.apply({ colors: out.state }, out.note); }));
  for (const button of schemeButtons) button.addEventListener('click', () => run(() => { const out = applyColor(context.state().colors, target(), button.dataset.scheme, context.chainIds(), { check }); context.apply({ colors: out.state }, out.note); }));
  chainScheme.addEventListener('click', () => run(() => { const out = applyColor(context.state().colors, 'chain', undefined, context.chainIds(), { check }); context.apply({ colors: out.state }, out.note); }));
  resetColors.addEventListener('click', () => run(() => context.apply({ colors: createColorState() }, '已清除全部颜色设置。')));
  resetStyles.addEventListener('click', () => run(() => context.apply({ styles: [] }, '已清除全部样式规则。')));
  rules.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-rule]'); if (!button) return;
    const items = describeRules(context.state()), item = items[Number(button.dataset.rule)]; if (!item) return;
    const next = withoutRule(context.state(), item); context.apply(next, `已删除规则：${item.text}。`);
  });
  const sayAnnotation = (text, kind = '') => { annotationInfo.textContent = text; annotationInfo.dataset.kind = kind; };
  const tryAnnotation = (work) => { try { work(); } catch (error) { sayAnnotation(error.message, 'error'); } };
  addMeasure.addEventListener('click', () => tryAnnotation(() => {
    const points = [mA.value, mB.value, mC.value].map((v) => v.trim()).filter(Boolean), state = context.annotations();
    if (state.measures.length >= MAX_MEASURES) throw new Error(`最多 ${MAX_MEASURES} 条测量。`);
    const [item] = validateMeasures([{ points }]), probe = computeAnnotations(model(), { measures: [item] });   // refuse what cannot be drawn, with the reason
    if (probe.problems.length) throw new Error(probe.problems[0].message);
    context.applyAnnotations({ measures: [...state.measures, item] }, `已添加测量：${probe.texts[0].text}。`);
    mA.value = mB.value = mC.value = ''; sayAnnotation(`已添加：${probe.texts[0].text}`);
  }));
  addLabel.addEventListener('click', () => tryAnnotation(() => {
    const state = context.annotations(), expr = input.value.trim();
    if (!expr) throw new Error('先在“选择”框里写出要加标签的部分（例如 resi 57 或 ligands）。');
    if (state.labels.length >= MAX_LABELS) throw new Error(`最多 ${MAX_LABELS} 个标签。`);
    const [item] = validateLabels([{ expr, text: labelText.value }]), probe = computeAnnotations(model(), { labels: [item] });
    if (probe.problems.length) throw new Error(probe.problems[0].message);
    context.applyAnnotations({ labels: [...state.labels, item] }, `已添加标签：${probe.texts[0].text}。`);
    labelText.value = ''; sayAnnotation(`已添加：${probe.texts[0].text}`);
  }));
  annotationList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-ann]'); if (!button) return;
    const [kind, index] = button.dataset.ann.split(':'), state = context.annotations(), key = { measure: 'measures', label: 'labels', bonds: 'bonds' }[kind];
    context.applyAnnotations({ [key]: key === 'bonds' ? [] : state[key].filter((_, i) => i !== Number(index)) }, `已删除${{ measure: '一条测量', label: '一个标签', bonds: '全部相互作用线' }[kind]}。`);
  });
  input.addEventListener('input', () => { clearTimeout(input.timer); input.timer = setTimeout(preview, 250); });

  return {
    /** The author's current selection: the text in the selection box and the residues it picks (empty when there is none or it cannot be read). */
    selection() {
      const expression = input.value.trim();
      if (!expression || !context.hasStructure() || !model()) return { expression, residues: [] };
      try { return { expression, residues: evaluateSelection(expression, selectionSpace(model())).residues }; } catch { return { expression, residues: [] }; }
    },
    /** Redraw what depends on the work (chains, rules, whether a structure is open); the typed selection stays. */
    render() {
      const has = context.hasStructure() && Boolean(model());
      hint.hidden = has; body.hidden = !has;
      if (!has) { context.highlight(null); return; }
      const state = context.state(), chains = context.chainIds() ?? [];
      chips.replaceChildren(...[['all', '全部'], ['protein', '蛋白'], ['nucleic', '核酸'], ['ligands', '配体'], ...chains.map((id) => [`chain ${id}`, `链 ${id}`])].map(([expression, label]) => {
        const chip = make('button', { type: 'button', text: label, title: expression }); chip.addEventListener('click', () => { input.value = expression; preview(); }); return chip;
      }));
      const items = describeRules(state);
      rules.replaceChildren(...(items.length ? items.map((item, index) => make('li', { class: 'look-rule' }, make('span', { text: item.text }), make('button', { type: 'button', 'data-rule': String(index), title: '删除这条规则', 'aria-label': `删除规则：${item.text}`, text: '×' })))
        : [make('li', { text: '还没有规则：结构按作品默认的样子画。' })]));
      const notes = context.annotations(), drawn = computeAnnotations(model(), notes);
      const entries = [...notes.measures.map((m, i) => ({ kind: 'measure', i, text: `测量 · ${m.points.join(' — ')}${drawn.texts.find((t) => t.kind === 'measure' && t.index === i) ? `：${drawn.texts.find((t) => t.kind === 'measure' && t.index === i).text}` : '（这个文件里画不出）'}` })),
        ...(notes.bonds?.length ? [{ kind: 'bonds', i: 0, text: `相互作用线 · ${notes.bonds.length} 条（${['salt', 'hbond', 'hydrophobic'].map((t) => [t, notes.bonds.filter((b) => b.type === t).length]).filter(([, n]) => n).map(([t, n]) => `${{ salt: '盐桥', hbond: '氢键', hydrophobic: '疏水' }[t]} ${n}`).join('、')}）${drawn.problems.some((p) => p.kind === 'bond') ? `，其中 ${drawn.problems.filter((p) => p.kind === 'bond').length} 条在这个文件里画不出` : ''}` }] : []),
        ...notes.labels.map((l, i) => ({ kind: 'label', i, text: `标签 · ${l.expr}${l.text ? ` → ${l.text}` : ''}${drawn.problems.some((p) => p.kind === 'label' && p.index === i) ? '（这个文件里画不出）' : ''}` }))];
      annotationList.replaceChildren(...(entries.length ? entries.map((e) => make('li', { class: 'look-rule' }, make('span', { text: e.text }), make('button', { type: 'button', 'data-ann': `${e.kind}:${e.i}`, title: '删除', 'aria-label': `删除：${e.text}`, text: '×' })))
        : [make('li', { text: '还没有测量或标签。' })]));
      resetColors.disabled = isDefault(state.colors); resetStyles.disabled = !state.styles.length;
      if (input.value.trim()) preview();
    },
  };
}
