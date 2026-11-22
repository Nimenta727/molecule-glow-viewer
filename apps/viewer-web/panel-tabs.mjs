/**
 * The Viewer's left panel as tabs. Every control block keeps its element and its id (all the panels' code finds them by id and toggles `hidden`); this only MOVES the blocks into task pages and gives each
 * group a title, so one 3400 px column becomes five short pages: 场景 (guided tour, notes, resources), 结构 (open, representation, parts), 选择 (selection, clipping, membrane, cell), 动画 (mechanism,
 * spin, particles, conformation, processes) and 分析 (measure, binding site). A group is visible while any of its blocks is; a page whose groups are all hidden disappears from the bar; the page in
 * view follows what happens (a mechanism work opens the 动画 page, a picked residue shows the 结构 page).
 */
export const VIEWER_PANEL_LAYOUT = Object.freeze([
  { id: 'scene', label: '场景', groups: [
    { nodes: ['#empty-hint'] },
    { nodes: ['#scene-navigation', '#mode-panel'] },
    { nodes: ['#presentation'] },
    { nodes: ['#resources'] },
  ] },
  { id: 'structure', label: '结构', groups: [
    { title: '打开结构', nodes: ['#structure-offer', 'label:has(#structure-enabled)', 'label:has(#atp-enabled)', '#rcsb-form', 'label:has(#structure-assembly)', '#template-note'] },
    { title: '表示', nodes: ['#representation-controls', '#functional-evidence', '#structure-summary'] },
    { title: '条目简介', nodes: ['#entry-intro-controls', '#entry-intro'] },
    { nodes: ['#legacy-components'] },
    { nodes: ['#structure-parts'] },
    { title: '拆装', nodes: ['#take-apart-controls', '#take-apart-panel'] },
    { title: '当前选取', nodes: ['#structure-pick', '#ligand-view-controls'] },
    { nodes: ['#structure-contacts'] },
  ] },
  { id: 'select', label: '选择', groups: [
    { title: '选择', nodes: ['#selection-form', '#selection-expression-form'] },
    { title: '剖切', nodes: ['#clip-controls'] },
    { title: '膜', nodes: ['#membrane-controls'] },
    { title: '细胞', nodes: ['#cell-controls'] },
  ] },
  { id: 'animate', label: '动画', groups: [
    { nodes: ['#mechanism-controls'] },
    { title: '部件旋转', nodes: ['#spin-controls'] },
    { title: '溶液粒子与流', nodes: ['#particle-controls'] },
    { title: '构象', nodes: ['#morph-controls'] },
    { title: '随机过程', nodes: ['#process-controls'] },
    { title: '数据动画', nodes: ['#data-controls'] },
    { nodes: ['#composition-controls'] },
  ] },
  { id: 'analysis', label: '分析', groups: [
    { nodes: ['#analysis-controls'] },
    { nodes: ['#site-analysis'] },
  ] },
]);

/** When one of these blocks becomes visible (or opens), the page it lives on comes to the front. */
export const VIEWER_PANEL_AUTOSHOW = Object.freeze([
  { selector: '#scene-navigation', tab: 'scene', attribute: 'hidden' },
  { selector: '#mechanism-controls', tab: 'animate', attribute: 'hidden' },
  { selector: '#structure-tools', tab: 'structure', attribute: 'open' },
  { selector: '#structure-offer', tab: 'structure', attribute: 'hidden' },
]);

export function createPanelTabs(panel, layout = VIEWER_PANEL_LAYOUT, { autoShow = VIEWER_PANEL_AUTOSHOW } = {}) {
  const doc = panel.ownerDocument, make = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
    node.append(...children); return node;
  };
  const bar = make('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': '面板分页' }), tabs = [];
  const insertAt = panel.firstChild;
  for (const spec of layout) {
    const button = make('button', { type: 'button', role: 'tab', id: `panel-tab-${spec.id}`, 'aria-controls': `panel-pane-${spec.id}`, 'aria-selected': 'false', tabindex: '-1', text: spec.label });
    const pane = make('div', { class: 'panel-pane', role: 'tabpanel', id: `panel-pane-${spec.id}`, 'aria-labelledby': button.id, hidden: '' }), groups = [];
    for (const group of spec.groups) {
      const nodes = group.nodes.flatMap((selector) => { const node = panel.querySelector(selector); return node ? [node] : []; });
      if (!nodes.length) continue;
      const wrapper = make('section', { class: 'panel-group' }, ...(group.title ? [make('h3', { class: 'group-title', text: group.title })] : []));
      wrapper.append(...nodes); pane.append(wrapper); groups.push({ wrapper, nodes });
    }
    if (!groups.length) continue;
    tabs.push({ id: spec.id, button, pane, groups }); bar.append(button);
  }
  panel.insertBefore(bar, insertAt); for (const tab of tabs) panel.insertBefore(tab.pane, insertAt);
  const legacy = panel.querySelector('#structure-tools');   // the old single accordion is empty now: only its open/closed state is still read
  if (legacy && ![...legacy.children].some((child) => child.tagName !== 'SUMMARY')) legacy.hidden = true;   // (before the observer exists)

  let active = null;
  // The observer below watches `hidden`, so writing it unchanged would wake the observer again, forever (a microtask loop that freezes the page): only ever write a value that differs.
  const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };
  const empty = (tab) => tab.groups.every((group) => group.wrapper.hidden);
  function select(id, { focus = false } = {}) {
    const tab = tabs.find((item) => item.id === id && !empty(item)); if (!tab) return false;
    active = tab.id;
    for (const item of tabs) { const on = item === tab; item.button.setAttribute('aria-selected', String(on)); item.button.tabIndex = on ? 0 : -1; setHidden(item.pane, !on); }
    if (focus) tab.button.focus(); return true;
  }
  function sync() {
    for (const tab of tabs) { for (const group of tab.groups) setHidden(group.wrapper, group.nodes.every((node) => node.hidden)); setHidden(tab.button, empty(tab)); }
    if (!active || !select(active)) { const first = tabs.find((tab) => !empty(tab)); if (first) select(first.id); }
  }
  for (const tab of tabs) {
    tab.button.addEventListener('click', () => select(tab.id));
    tab.button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const open = tabs.filter((item) => !empty(item)), at = open.indexOf(tab), next = open[(at + (event.key === 'ArrowRight' ? 1 : -1) + open.length) % open.length];
      if (next) { event.preventDefault(); select(next.id, { focus: true }); }
    });
  }
  const watched = autoShow.map((rule) => ({ ...rule, node: panel.querySelector(rule.selector) })).filter((rule) => rule.node);
  const was = new Map(watched.map((rule) => [rule, rule.attribute === 'hidden' ? !rule.node.hidden : rule.node.open]));
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return; queued = true;
    queueMicrotask(() => {
      queued = false; sync();
      for (const rule of watched) {
        const now = rule.attribute === 'hidden' ? !rule.node.hidden : rule.node.open;
        if (now && !was.get(rule)) select(rule.tab);
        was.set(rule, now);
      }
    });
  });
  observer.observe(panel, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
  sync();
  return { select, sync, active: () => active, tabs: () => tabs.map((tab) => ({ id: tab.id, label: tab.button.textContent, visible: !tab.button.hidden })), dispose: () => observer.disconnect() };
}
