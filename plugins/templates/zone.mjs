import { LICENSES, TemplateError } from './library.mjs';

/**
 * The "我的模板" zone of the workshop dialog: the protein templates on this machine (originals from the PDB or from the person's own disk), with the scientific basics read from each file,
 * a form to add one (a file with a stated licence, a template package, or a PDB code), and per-template actions. The dialog owns the tabs and the note line; this owns what is inside the zone.
 *   library      createTemplateLibrary(...)
 *   actions      [{ label, title?, run(entry, library) }]   what the app does with a template (open it, make a work from it); a failing action's message shows in the note, a finished one closes the dialog (`close`)
 *   loadRcsb     (accession) -> Promise<{ bytes }>           how the app fetches a PDB entry (RCSB source)
 */
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const ORIGINS = { rcsb: '来自 PDB', local: '本机文件', package: '来自模板包' };

export function createTemplateZone(doc, { library, actions = [], loadRcsb, setNote = () => {}, changed = () => {}, close = () => {} }) {
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
    node.append(...children); return node;
  };
  const run = async (label, work) => { setNote(`${label}…`); try { const done = await work(); setNote(done ?? ''); changed(); } catch (error) { setNote(error instanceof TemplateError || error instanceof Error ? error.message : String(error), 'error'); } };

  // ---- the form ---------------------------------------------------------------------------------------------------------------------------------------------
  const file = el('input', { type: 'file', accept: '.cif,.mmcif,.pdb,.ent,.glowtpl', 'aria-label': '选择结构文件或模板包' });
  const license = el('select', { 'aria-label': '授权方式' }, el('option', { value: '', text: '请选择授权方式（必选）' }), ...Object.entries(LICENSES).map(([id, { name }]) => el('option', { value: id, text: name })));
  const credit = el('input', { type: 'text', placeholder: '作者 / 来源（CC BY 必填）', 'aria-label': '署名', maxlength: '200' });
  const title = el('input', { type: 'text', placeholder: '名称（可留空，用文件里的标题）', 'aria-label': '名称', maxlength: '120' });
  const species = el('input', { type: 'text', placeholder: '物种（可留空，用文件里写的）', 'aria-label': '物种', maxlength: '120' });
  const notes = el('textarea', { placeholder: '备注（来源、用途、你知道而文件里没有的信息）', 'aria-label': '备注', rows: '2', maxlength: '2000' });
  const importButton = el('button', { type: 'button', text: '导入' });
  const code = el('input', { type: 'text', placeholder: 'PDB 编号，如 4AKE', 'aria-label': 'PDB 编号', maxlength: '4', size: '8' });
  const rcsbButton = el('button', { type: 'button', text: '从 PDB 添加', title: '从 RCSB 取回、核对并记录哈希；授权为 CC0' });
  const form = el('details', { class: 'workshop-template-form' }, el('summary', { text: '添加模板' }),
    el('p', { class: 'workshop-meta', text: '模板是原文件：不会被修改，也不带动画。授权必须由你选择——不清楚就选“不清楚”，它不会被放进任何发布的包。导入 .glowtpl 模板包时，授权以包里声明的为准（作为对方的说法，不是核实过的）。' }),
    el('div', { class: 'workshop-form-row' }, file, license, credit), el('div', { class: 'workshop-form-row' }, title, species), notes, el('div', { class: 'workshop-form-row' }, importButton),
    el('div', { class: 'workshop-form-row' }, code, rcsbButton));

  importButton.addEventListener('click', () => run('正在导入', async () => {
    const chosen = file.files?.[0]; if (!chosen) throw new TemplateError('file', '请先选择一个文件。');
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    const result = /\.glowtpl$/i.test(chosen.name) ? await library.importPackage(bytes)
      : await library.importFile({ name: chosen.name, bytes, license: license.value, credit: credit.value, title: title.value, species: species.value, notes: notes.value });
    file.value = ''; return result.added ? `已添加模板：${result.template.title}。` : `这个文件已经在模板库里了：${result.template.title}。`;
  }));
  rcsbButton.addEventListener('click', () => run('正在从 PDB 取回', async () => {
    if (!loadRcsb) throw new TemplateError('download', '这个应用不能直接从 PDB 取回。');
    const result = await library.addFromRcsb({ accession: code.value, load: loadRcsb, title: title.value, notes: notes.value });
    code.value = ''; return result.added ? `已添加模板：${result.template.title}。` : `${result.template.id} 已经在模板库里了。`;
  }));

  // ---- the cards --------------------------------------------------------------------------------------------------------------------------------------------
  const row = (rows, label, value, href) => { if (!value) return; rows.append(el('dt', { text: label }), el('dd', {}, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: value }) : doc.createTextNode(value))); };
  function card(entry) {
    const { info, record } = entry, item = el('li', { class: 'workshop-card workshop-template', 'data-entry': entry.id });
    const titleNode = el('h3', { text: entry.title });
    item.append(el('div', { class: 'workshop-card-head' }, titleNode, el('span', { class: 'workshop-badge', text: [ORIGINS[entry.origin] ?? entry.origin, info.id && info.id !== entry.title ? info.id : ''].filter(Boolean).join(' · ') })));
    if (entry.title !== info.title && info.title) item.append(el('p', { class: 'workshop-desc', text: info.title }));
    const rows = el('dl', { class: 'workshop-plugin-rows' });
    row(rows, '实验方法', [info.method, info.resolution != null ? `${info.resolution} Å` : ''].filter(Boolean).join('，'));
    row(rows, '物种', record.card?.species ?? info.organisms.join('；'));
    row(rows, '组成', info.entities.filter((e) => e.type === 'polymer').map((e) => `${e.name || '（未命名）'}${e.length ? ` ${e.length} aa` : ''} ×${e.copies}`).join('；'));
    row(rows, '配体', info.ligands.map((l) => `${l.comp || l.name} ×${l.count}`).join('、'));
    row(rows, '突变', info.mutations.map((m) => m.mutation).join('；'));
    row(rows, '文献', info.citation.title ? `${info.citation.title}${info.citation.year ? `（${info.citation.year}）` : ''}` : '', info.citation.doi ? `https://doi.org/${info.citation.doi}` : undefined);
    row(rows, '授权', `${LICENSES[record.attribution.license]?.name ?? record.attribution.license}${record.attribution.credit ? `；署名：${record.attribution.credit}` : ''}${record.attribution.embedAllowed ? '；可嵌入作品' : '；不嵌入作品'}`);
    row(rows, '来源声明', record.card?.claimedSource);
    row(rows, '文件', `${entry.name} · ${formatSize(entry.bytes)} · ${info.format === 'mmcif' ? 'mmCIF' : 'PDB 格式'} · sha256 ${entry.sha256.slice(0, 12)}…`);
    item.append(rows);
    if (entry.notes) item.append(el('p', { class: 'workshop-deps', text: `备注：${entry.notes}` }));
    const buttons = el('div', { class: 'workshop-actions' });
    for (const action of actions) {
      const button = el('button', { type: 'button', text: action.label, ...(action.title ? { title: action.title } : {}) });
      button.addEventListener('click', () => run(`${action.label}：${entry.title}`, async () => { const result = await action.run(entry, library); if (result !== false) close(); return ''; }));   // like the other zones: a finished action closes the dialog; false keeps it open
      buttons.append(button);
    }
    const rename = el('button', { type: 'button', text: '改名' });
    rename.addEventListener('click', () => { const next = doc.defaultView.prompt('新的名称', entry.title); if (next != null) run('正在保存', async () => { await library.update(entry.id, { title: next }); return ''; }); });
    const notesButton = el('button', { type: 'button', text: '改备注' });
    notesButton.addEventListener('click', () => { const next = doc.defaultView.prompt('备注', entry.notes ?? ''); if (next != null) run('正在保存', async () => { await library.update(entry.id, { notes: next }); return ''; }); });
    const exportButton = el('button', { type: 'button', text: '导出模板包', title: '一个 .glowtpl：原文件加记录，可以交给别人或备份' });
    exportButton.addEventListener('click', () => run('正在打包', async () => {
      const bytes = await library.exportPackage(entry.id), url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), a = el('a', { href: url, download: `${entry.name.replace(/\.[^.]+$/, '')}.glowtpl` });
      doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); return `已导出 ${entry.name.replace(/\.[^.]+$/, '')}.glowtpl。`;
    }));
    const remove = el('button', { type: 'button', class: 'workshop-danger', text: '删除' });
    remove.addEventListener('click', () => { if (remove.dataset.armed !== 'yes') { remove.dataset.armed = 'yes'; remove.textContent = '再点一次确认删除'; setTimeout(() => { remove.dataset.armed = ''; remove.textContent = '删除'; }, 4000); return; }
      run('正在删除', async () => { await library.remove(entry.id); return `已删除：${entry.title}。（已经在作品里用到的副本不受影响。）`; }); });
    buttons.append(rename, notesButton, exportButton, remove); item.append(buttons);
    return item;
  }

  return {
    form,
    /** The cards of the templates matching `query` (title, file name, species, entry id, DOI, notes). */
    async render(query = '') {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean), all = await library.list();
      const shown = all.filter((e) => { const hay = [e.title, e.name, e.id, e.info.id, e.info.title, e.info.organisms.join(' '), e.info.citation.doi, e.notes, e.info.entities.map((x) => x.name).join(' ')].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); });
      const nodes = shown.map(card);
      if (!nodes.length) nodes.push(el('li', { class: 'workshop-empty', text: all.length ? '没有符合条件的模板。' : '这里还没有模板。用上面的“添加模板”导入你自己的结构文件，或输入 PDB 编号从官网取回。' }));
      return nodes;
    },
  };
}
