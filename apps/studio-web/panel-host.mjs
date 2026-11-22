import { createPanelContext, panelReadiness, PanelError } from '../../packages/plugin-host/panels.mjs';

/**
 * The Studio's analysis tab: every registered plugin panel gets a section of its own, mounted when what it needs is open (a structure, a selection). The host owns all state: a panel only receives the
 * checked `api` (packages/plugin-host/panels.mjs). A panel that fails to mount, or throws, is shown as failed in its own section; the others carry on. `render()` is cheap and is called after every
 * change of the work: a panel is mounted again only when its readiness or the structure it works on changes (what was typed into its boxes is kept).
 *   env.hasStructure() / hasSelection()   what is open and chosen
 *   env.key()                             anything that changes when the panel must start fresh (the scene and its structure)
 *   env.hostFor(panel)                    the host object `createPanelContext` wraps (see panels.mjs)
 */
export function createPanelHost(container, { registry, env, doc = container.ownerDocument }) {
  const sections = new Map();   // panel id -> { details, body, state: { key, ready }, handle }
  const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
  const empty = el('p', { class: 'tool-note', text: '还没有安装分析插件。' });
  function unmount(entry) { try { entry.handle?.dispose?.(); } catch { /* a panel's cleanup must not break the host */ } entry.handle = undefined; }
  return {
    render() {
      const panels = registry.list();
      container.replaceChildren(...(panels.length ? [] : [empty]));
      for (const panel of panels) {
        let entry = sections.get(panel.id);
        if (!entry) {
          const body = el('div', { class: 'panel-body' }), details = el('details', { class: 'panel-section', open: '', 'data-panel': panel.id }, el('summary', { text: panel.title }), el('p', { class: 'tool-note', text: panel.summary }), body);
          entry = { details, body, state: null, handle: undefined }; sections.set(panel.id, entry);
        }
        container.append(entry.details);
        const { ready, reason } = panelReadiness(panel, { hasStructure: env.hasStructure(), hasSelection: env.hasSelection() });
        const state = { key: env.key(), ready };
        if (entry.state && entry.state.key === state.key && entry.state.ready === state.ready) continue;
        // a panel that starts again (the model finished building, the scene changed) keeps what the author had typed into its boxes
        const typed = new Map([...entry.body.querySelectorAll('input[id]')].filter((input) => input.value.trim()).map((input) => [input.id, input.value]));
        unmount(entry); entry.state = state;
        if (!ready) { entry.body.replaceChildren(el('p', { class: 'tool-note', text: reason })); continue; }
        try {
          entry.body.replaceChildren();
          entry.handle = panel.mount(entry.body, createPanelContext(panel, env.hostFor(panel))) ?? undefined;
          for (const [id, value] of typed) { const input = entry.body.querySelector('input[id=' + JSON.stringify(id) + ']'); if (input && !input.value.trim()) input.value = value; }
        } catch (error) {
          unmount(entry);
          entry.body.replaceChildren(el('p', { class: 'tool-note', 'data-kind': 'error', text: `这个面板出错了：${error instanceof PanelError ? error.message : error?.message ?? error}` }));
        }
      }
    },
    sectionFor: (id) => sections.get(id)?.details,
  };
}
