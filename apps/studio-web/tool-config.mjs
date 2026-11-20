import { authorFields, editAuthorField, getPath } from '../../packages/plugin-host/tool-model.mjs';
import { renderControl, readControl } from '../../packages/plugin-host/tool-panel.mjs';

/**
 * The "tool configuration" section of Studio. It knows no tool: for every entry of scene.tools it asks the host for the
 * tool's descriptor and builds the editor from the descriptor's author fields, so a newly registered authoring tool
 * appears here without any change to this file. Edits go through the tool's own validator before they are applied.
 */
export function createToolConfigPanel(container, { getTool, getScene, apply, report, listTools = () => [], addTool = () => {}, removeTool = () => {} }) {
  const doc = container.ownerDocument;
  const note = (text) => { const p = doc.createElement('p'); p.className = 'tool-note'; p.textContent = text; return p; };

  // "Add tool" lists every registered tool that offers authoring, so a new authoring plugin shows up here by itself.
  function addBar() {
    const bar = doc.createElement('div');
    bar.className = 'tool-add';
    const select = doc.createElement('select');
    select.id = 'tool-add-select';
    select.setAttribute('aria-label', '要添加的工具');
    const tools = listTools();
    for (const tool of tools) select.append(new doc.defaultView.Option(`${tool.title} · ${tool.version}`, tool.id));
    if (!tools.length) select.append(new doc.defaultView.Option('（正在加载工具插件…）', ''));
    const button = doc.createElement('button');
    button.id = 'tool-add-button';
    button.type = 'button';
    button.textContent = '添加工具';
    button.disabled = !tools.length;
    bar.append(select, button);
    return bar;
  }

  function render(scene = getScene()) {
    const entries = scene.tools ?? [];
    const bar = scene.schemaVersion === 3 ? [addBar()] : [];
    if (!entries.length) {
      container.replaceChildren(...bar, note('此场景还没有工具。可以在上面添加，或用“导入场景包”打开 Viewer 导出的 .glow（例如 ATP 合酶、KcsA、AdK 作品）。'));
      return;
    }
    container.replaceChildren(...bar, ...entries.map((entry) => {
      const section = doc.createElement('section');
      section.className = 'tool-entry';
      const tool = getTool(entry.tool.id);
      const head = doc.createElement('div');
      head.className = 'tool-entry-head';
      const title = doc.createElement('h3');
      title.textContent = `${tool?.title ?? entry.tool.id} · ${entry.tool.version}`;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.dataset.removeEntry = entry.id;
      head.append(title, remove);
      section.append(head);
      if (!tool) { section.append(note(`缺少工具 ${entry.tool.id}@${entry.tool.version}：配置已原样保留，启用该插件后即可编辑，不会降级为静态预览。`)); return section; }
      if (!tool.audience.includes('author')) { section.append(note('此工具没有提供制作配置。')); return section; }
      if (tool.version !== entry.tool.version) section.append(note(`作品使用 ${entry.tool.version}，当前插件为 ${tool.version}；编辑按当前插件的规则校验。`));
      const groups = new Map();
      for (const field of authorFields(tool, entry.config)) {
        const key = field.group ?? '其他';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(field);
      }
      for (const [name, fields] of groups) {
        const details = doc.createElement('details');
        details.className = 'tool-group';
        const summary = doc.createElement('summary');
        summary.textContent = name;
        details.append(summary);
        for (const field of fields) {
          const control = renderControl(doc, field, getPath(entry.config, field.path), { attribute: 'path' });
          control.querySelector('[data-path]').dataset.entry = entry.id;
          details.append(control);
        }
        section.append(details);
      }
      return section;
    }));
  }

  container.addEventListener('click', (event) => {
    const add = event.target.closest('#tool-add-button'), remove = event.target.closest('[data-remove-entry]');
    try {
      if (add) { const id = container.querySelector('#tool-add-select').value; if (id) addTool(id); }
      else if (remove) removeTool(remove.dataset.removeEntry);
    } catch (error) { report(error.message); }
  });

  container.addEventListener('change', (event) => {
    const input = event.target, { path, entry: entryId } = input.dataset ?? {};
    if (!path || !entryId) return;
    const scene = getScene(), entry = scene.tools.find(({ id }) => id === entryId), tool = entry && getTool(entry.tool.id);
    try {
      apply(entryId, editAuthorField(tool, entry.config, path, readControl(input)));
    } catch (error) {
      report(error.message);
      const open = [...container.querySelectorAll('details[open]')].map((details) => details.firstChild.textContent);
      render(scene);   // put the refused value back
      for (const details of container.querySelectorAll('details')) details.open = open.includes(details.firstChild.textContent);
    }
  });

  return { render };
}
