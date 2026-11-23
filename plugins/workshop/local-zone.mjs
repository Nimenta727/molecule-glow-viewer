import { LocalWorkError, fileNameFor, sizeText } from './local-works.mjs';

/**
 * The "本地" zone of the workshop dialog: the works opened or imported on this machine, each shown with its NAME (the title of the work), its file name, size and when it was added, and buttons
 * to open it, export it (a download under its own name), rename it or remove it. The dialog owns the tabs and the note line; this owns what is inside the zone.
 *   library      createLocalWorks(...)
 *   open         async (entry, bytes) -> void | string    what the app does with a work (a failing open's message shows in the note; a finished one closes the dialog)
 *   importFile   () -> void                                asks the app to pick a file from disk (the app's own import, which also remembers the work)
 */
export function createLocalZone(doc, { library, open, importFile, setNote = () => {}, changed = () => {}, close = () => {}, download }) {
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
    node.append(...children); return node;
  };
  const save = download ?? ((name, bytes) => {   // the browser's own download, named after the work
    const url = doc.defaultView.URL.createObjectURL(new doc.defaultView.Blob([bytes], { type: 'application/zip' })), link = el('a', { href: url, download: name });
    link.click(); doc.defaultView.setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 1000);
  });
  const say = (error) => setNote(error instanceof LocalWorkError ? error.message : `失败：${error?.message ?? error}`, 'error');

  const pick = el('button', { type: 'button', text: '导入 .glow 文件…', title: '从硬盘选一个作品；导入后它会出现在这里' });
  pick.addEventListener('click', () => importFile?.());
  const form = el('div', { class: 'workshop-local-form' }, pick,
    el('span', { class: 'workshop-meta', text: '打开或导入过的 .glow 作品会记在这里（只在这台电脑上）。' }));

  async function render(text = '') {
    const needle = String(text ?? '').trim().toLowerCase();
    let entries; try { entries = await library.list(); } catch (error) { say(error); entries = []; }
    const shown = entries.filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.fileName.toLowerCase().includes(needle));
    if (!shown.length) return [el('li', { class: 'workshop-empty', text: entries.length ? '没有符合搜索的本地作品。' : '还没有本地作品：用上面的“导入 .glow 文件…”，或在 Viewer 里“打开”一个 .glow 文件，它就会出现在这里。' })];
    return shown.map((entry) => {
      const item = el('li', { class: 'workshop-card workshop-local-item', 'data-entry': entry.id });
      const buttons = el('div', { class: 'workshop-actions' });
      const act = (label, title, work) => { const button = el('button', { type: 'button', text: label, title }); button.addEventListener('click', async () => { button.disabled = true; try { await work(); } catch (error) { say(error); } finally { button.disabled = false; } }); buttons.append(button); };
      act('打开', '在这里打开这个作品', async () => { setNote('正在读取…'); const bytes = await library.bytes(entry.id); const done = await open(entry, bytes); setNote(done ?? ''); close(); });
      act('导出', `另存为 ${fileNameFor(entry.title)}`, async () => { const bytes = await library.bytes(entry.id); save(fileNameFor(entry.title), bytes); setNote(`已导出 ${fileNameFor(entry.title)}（${sizeText(bytes.byteLength)}）。`); });
      act('改名', '改这个作品在工坊里显示的名称（文件本身不变）', async () => { const next = doc.defaultView.prompt('作品名称', entry.title); if (next == null) return; await library.rename(entry.id, next); setNote('名称已改。'); changed(); });
      act('删除', '只从本机的“本地”里删掉记录和副本，不影响你硬盘上的原文件', async () => { if (!doc.defaultView.confirm(`从“本地”里删除“${entry.title}”？（硬盘上的原文件不受影响）`)) return; await library.remove(entry.id); setNote(`已删除“${entry.title}”。`); changed(); });
      item.append(el('div', { class: 'workshop-card-head' }, el('h3', { text: entry.title })),
        el('p', { class: 'workshop-meta', text: `${entry.fileName} · ${sizeText(entry.bytes)} · ${new Date(entry.addedAt).toLocaleString('zh-CN')}` }), buttons);
      return item;
    });
  }
  return { form, render };
}
