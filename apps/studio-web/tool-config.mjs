import { authorFields, editAuthorField, getPath } from '../../packages/plugin-host/tool-model.mjs';
import { renderControl, readControl } from '../../packages/plugin-host/tool-panel.mjs';

/**
 * The "tool configuration" section of Studio. It knows no tool: for every entry of scene.tools it asks the host for the
 * tool's descriptor and builds the editor from the descriptor's author fields, so a newly registered authoring tool
 * appears here without any change to this file. Edits go through the tool's own validator before they are applied.
 */
export function createToolConfigPanel(container, { getTool, getScene, apply, report }) {
  const doc = container.ownerDocument;
  const note = (text) => { const p = doc.createElement('p'); p.className = 'tool-note'; p.textContent = text; return p; };

  function render(scene = getScene()) {
    const entries = scene.tools ?? [];
    if (!entries.length) {
      container.replaceChildren(note('此场景没有工具配置。用“导入场景包”打开 Viewer 导出的 .glow（例如 ATP 合酶、KcsA、AdK 作品）即可编辑。'));
      return;
    }
    container.replaceChildren(...entries.map((entry) => {
      const section = doc.createElement('section');
      section.className = 'tool-entry';
      const tool = getTool(entry.tool.id);
      const title = doc.createElement('h3');
      title.textContent = `${tool?.title ?? entry.tool.id} · ${entry.tool.version}`;
      section.append(title);
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
