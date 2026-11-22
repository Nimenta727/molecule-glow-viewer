import { SELECTION_HELP, selectionSpace, evaluateSelection, describeSelection } from '../../plugins/structure/selection.mjs';
import { applyColor, createColorState, isDefault, PROPERTY_SCHEMES as COLOR_SCHEMES } from '../viewer-web/color-scheme.mjs';
import { applyStyle, LOOK_STYLES, STYLE_LABELS, PROPERTY_SCHEMES } from '../../plugins/structure/look.mjs';

/**
 * The Studio's appearance panel: the way structure work is done in PyMOL and ChimeraX. Choose a part with the selection language (the count and the part are shown, and the residues are lit in the
 * viewport), then give it a style (cartoon, backbone, blob, hidden) or a colour (a plain colour, or a scheme from a property: hydrophobicity, B-factor, charge, secondary structure, position along the
 * chain). Every action adds a RULE ("chain A and resi 10-50" -> hidden) that is kept with the work (the structure file's viewer state) and read back by the Viewer; later rules win, each rule can be
 * removed on its own, and every change is one undo step. The panel holds no state of its own: it reads and writes through `context`.
 *   context.hasStructure() / model() / chainIds()      what is open
 *   context.state()                                     { colors, styles } as saved in the work
 *   context.apply(patch, message)                       patch: { colors?, styles? }; one undoable edit
 *   context.highlight(residues | null)                  light the selected residues in the viewport
 */
const el = (doc, tag, props = {}, ...children) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
  node.append(...children); return node;
};

/** The rules shown in the list, in the order they act: the colour scheme, the colours of whole chains, the residue colour rules, then the style rules. */
export function describeRules({ colors, styles }) {
  const items = [];
  if (colors.scheme !== 'entity') items.push({ kind: 'scheme', text: `颜色 · 全部链 → ${{ chain: '按链', rainbow: '彩虹（链顺序）', confidence: '预测置信度' }[colors.scheme] ?? colors.scheme}` });
  for (const [chain, color] of Object.entries(colors.chains)) items.push({ kind: 'chain', chain, text: `颜色 · 链 ${chain} → ${color}`, color });
  colors.residues.forEach((rule, index) => items.push({ kind: 'color', index, text: `颜色 · ${rule.expr} → ${rule.scheme ? PROPERTY_LABELS[rule.scheme] ?? rule.scheme : rule.color}`, color: rule.color }));
  styles.forEach((rule, index) => items.push({ kind: 'style', index, text: `样式 · ${rule.expr} → ${STYLE_LABELS[rule.style]}` }));
  return items;
}
const PROPERTY_LABELS = { ...PROPERTY_SCHEMES, ...Object.fromEntries(COLOR_SCHEMES.map((id) => [id, PROPERTY_SCHEMES[id] ?? id])) };

/** The state without one listed rule. */
export function withoutRule({ colors, styles }, item) {
  if (item.kind === 'scheme') return { colors: { ...colors, scheme: 'entity' }, styles };
  if (item.kind === 'chain') { const chains = { ...colors.chains }; delete chains[item.chain]; return { colors: { ...colors, chains }, styles }; }
  if (item.kind === 'color') return { colors: { ...colors, residues: colors.residues.filter((_, i) => i !== item.index) }, styles };
  return { colors, styles: styles.filter((_, i) => i !== item.index) };
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
  const rules = make('ul', { class: 'text-list look-rules', id: 'look-rules', 'aria-label': '已应用的规则' });
  const section = (title, ...children) => make('section', { class: 'panel-section' }, make('h2', { text: title }), ...children);
  const body = make('div', { id: 'look-body' },
    section('选择', form, info, chips, help),
    section('表示（对当前选择）', make('div', { class: 'button-row look-row' }, ...styleButtons), make('p', { class: 'tool-note', text: '卡通、主链、团块对残基级别的所有表示都生效；“隐藏”的残基既不画，也不能被选中。没有选择时作用于全部。' })),
    section('着色（对当前选择）', make('div', { class: 'button-row look-row' }, color, applyColorButton), make('div', { class: 'button-row look-row' }, ...schemeButtons), make('div', { class: 'button-row look-row' }, chainScheme, resetColors, resetStyles), make('p', { class: 'tool-note', text: '按性质着色给每个残基一种颜色（B 因子：蓝低红高；疏水性：蓝亲水、橙疏水）。表面与功能分区表示保持链的颜色。' })),
    section('已应用的规则', rules));
  container.replaceChildren(hint, body);

  const model = () => context.model();
  const check = (expression) => evaluateSelection(expression, selectionSpace(model())).residues.length;
  const target = () => input.value.trim() || 'all';
  const say = (text, kind = '') => { info.textContent = text; info.dataset.kind = kind; };
  const run = (work) => { try { work(); } catch (error) { say(error.message, 'error'); } };
  function preview() {
    const expression = input.value.trim();
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
  input.addEventListener('input', () => { clearTimeout(input.timer); input.timer = setTimeout(preview, 250); });

  return {
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
      resetColors.disabled = isDefault(state.colors); resetStyles.disabled = !state.styles.length;
      if (input.value.trim()) preview();
    },
  };
}
