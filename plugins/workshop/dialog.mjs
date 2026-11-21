import { queryCatalog, relatedResources, worksUsing, allTags, TOPICS } from './catalog.mjs';
import { describeEntry, diagnose } from './diagnose.mjs';

/**
 * The workshop dialog shared by Viewer and Studio: three zones (模板区 templates: static, for looking and reading; 作品区 works: animated, for how it works; 资源区 resources), a subject filter (机理 / 蛋白质 / 局部系统 / 细胞), a source filter, a text search, and for
 * every entry what it is built from and what it needs. What a button does is up to the app: `actions[zone]` ('templates', 'works' or 'resources') lists
 * { label, title?, run(entry, catalog) }. A failing action shows its message in the dialog and leaves it open.
 *   load()       -> Promise<catalog>   (called when the dialog opens, and again by "重新加载")
 *   toolTitle(id) -> text              (the name of a tool for display; falls back to the id)
 *   toolAvailable(id) -> boolean       (whether this application has the tool; a work that needs a missing one is flagged in its details)
 */
const SOURCE_NAMES = { official: '官方', community: '社区' };
const formatSize = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function createWorkshopDialog(doc, { load, actions = {}, toolTitle = (id) => id, toolAvailable = () => true }) {
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
    node.append(...children);
    return node;
  };
  const dialog = el('dialog', { class: 'workshop', 'aria-labelledby': 'workshop-title' });
  const close = el('button', { type: 'button', class: 'workshop-close', 'aria-label': '关闭工坊', text: '×' });
  const tabs = el('div', { class: 'workshop-tabs', role: 'tablist', 'aria-label': '工坊分区' });
  const zoneTabs = { templates: el('button', { type: 'button', role: 'tab', id: 'workshop-tab-templates', text: '模板区' }), works: el('button', { type: 'button', role: 'tab', id: 'workshop-tab-works', text: '作品区' }), resources: el('button', { type: 'button', role: 'tab', id: 'workshop-tab-resources', text: '资源区' }) };
  tabs.append(zoneTabs.templates, zoneTabs.works, zoneTabs.resources);
  const source = el('select', { 'aria-label': '来源' });
  const search = el('input', { type: 'search', placeholder: '搜索标题、标签、结构编号…', 'aria-label': '搜索' });
  const topic = el('select', { 'aria-label': '主题' });
  const tag = el('select', { 'aria-label': '标签' });
  const reload = el('button', { type: 'button', text: '重新加载' });
  const note = el('p', { class: 'workshop-note', role: 'status', 'aria-live': 'polite' });
  const list = el('ul', { class: 'workshop-list', id: 'workshop-list', role: 'tabpanel' });
  dialog.append(el('header', {}, el('h2', { id: 'workshop-title', text: '工坊' }), close),
    el('div', { class: 'workshop-controls' }, tabs, topic, source, tag, search, reload), note, list);
  doc.body.append(dialog);

  let catalog, zone = 'templates', busy = false;

  function setNote(message, kind = '') { note.textContent = message; note.dataset.kind = kind; }

  const LEVELS = { error: '问题', warning: '注意', info: '说明' };
  /** The details of an entry: attribution, licence, revision, lineage, and the diagnosis of what it depends on. Built from the same functions the validators use (diagnose.mjs). */
  function detailsOf(entry) {
    const info = describeEntry(catalog, entry, { toolTitle }), items = diagnose(catalog, entry, { toolAvailable });
    const rows = [];
    const row = (label, value, href) => { if (value) rows.push([label, value, href]); };
    if (info.kind === 'work') {
      row('作者', info.author.name || '未署名', info.author.url);
      row('版本', `第 ${info.revision} 版${info.updated ? `（${info.updated}）` : ''}`);
      row('授权', `${info.license.name}${info.license.attributionRequired ? '；使用须署名' : ''}${info.license.shareAlike ? '；改编须以同样方式共享' : ''}`);
      row('派生作品可用的授权', info.derivative.allowed.length ? info.derivative.allowed.join('、') : `无法确定（${info.derivative.reason}）`);
      if (info.derivedFrom) row('派生自', `${info.derivedFrom.missing ? `${info.derivedFrom.id}（已不在目录里）` : info.ancestors.map((a) => `${a.title}${a.revision ? `（第 ${a.revision} 版${a.currentRevision > a.revision ? `，现为第 ${a.currentRevision} 版` : ''}）` : ''}`).join(' ← ')}`);
      if (info.derived.length) row('已有派生', info.derived.map((d) => d.title).join('、'));
      if (info.tools.length) row('需要工具', info.tools.map((tool) => tool.title).join('、'));
      if (info.structures.length) row('结构', info.structures.join('、'));
    } else {
      row('来源', `${info.origin.provider.toUpperCase()} ${info.origin.accession}${info.origin.retrievedAt ? `（取回于 ${info.origin.retrievedAt}）` : ''}`, info.origin.url);
      row('版本', info.version);
      row('授权', `${info.license.name}${info.license.attributionRequired ? '；使用须署名' : ''}${info.license.shareAlike ? '；改编须以同样方式共享' : ''}`, info.license.url);
      if (info.license.credit) row('署名', info.license.credit);
      row('文件', info.files.map((file) => `${file.path} · ${formatSize(file.bytes)} · sha256 ${file.sha256.slice(0, 12)}…`).join('；'));
      row('嵌入', info.license.embedAllowed ? '允许嵌入作品' : '不允许嵌入作品');
      if (info.usedBy.length) row('被使用于', info.usedBy.map((work) => work.title).join('、'));
    }
    const box = el('div', { class: 'workshop-details' });
    const list = el('dl', {});
    for (const [label, value, href] of rows) {
      list.append(el('dt', { text: label }));
      const dd = el('dd', {}); if (href) dd.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: value })); else dd.textContent = value; list.append(dd);
    }
    box.append(list);
    if (items.length) box.append(el('ul', { class: 'workshop-diagnosis', 'aria-label': '依赖诊断' }, ...items.map((item) => el('li', { class: `workshop-diag-${item.level}`, 'data-code': item.code, text: `${LEVELS[item.level]}：${item.message}` }))));
    else box.append(el('p', { class: 'workshop-diag-ok', text: '依赖检查：没有发现问题。' }));
    return box;
  }

  function card(entry) {
    const item = el('li', { class: 'workshop-card', 'data-entry': entry.id });
    const head = el('div', { class: 'workshop-card-head' }, el('h3', { text: entry.title }), el('span', { class: 'workshop-badge', text: [TOPICS[entry.topic], SOURCE_NAMES[entry.source] ?? entry.source].filter(Boolean).join(' · ') }));
    item.append(head);
    if (entry.description) item.append(el('p', { class: 'workshop-desc', text: entry.description }));
    if (entry.kind === 'work') {
      const { found, missing } = relatedResources(catalog, entry);
      item.append(el('p', { class: 'workshop-meta', text: [entry.license, entry.size ? formatSize(entry.size) : '', entry.zone === 'template' ? '静态：看结构、读解说' : '动态：演示作用原理'].filter(Boolean).join(' · ') }));
      const uses = [...found.map((resource) => `${resource.record.source.accession}（${resource.record.attribution.license}）`), ...missing.map((id) => `${id}（本目录未收录）`)];
      if (uses.length) item.append(el('p', { class: 'workshop-deps', text: `使用资源：${uses.join('、')}` }));
      else if (entry.pdb.length) item.append(el('p', { class: 'workshop-deps', text: `使用结构：${entry.pdb.join('、')}（尚未登记为资源）` }));
      if (entry.tools.length) item.append(el('p', { class: 'workshop-deps', text: `需要工具：${entry.tools.map(toolTitle).join('、')}` }));
    } else {
      const { record } = entry, [file] = record.files, used = worksUsing(catalog, entry);
      item.append(el('p', { class: 'workshop-meta', text: [`${record.source.provider.toUpperCase()} ${record.source.accession}`, record.attribution.license, formatSize(file.bytes), record.card?.species, record.card?.mutation ? `突变 ${record.card.mutation}` : '', record.card?.method].filter(Boolean).join(' · ') }));
      item.append(el('p', { class: 'workshop-deps', text: `离线副本：${entry.delivery === 'reference' ? '仅引用，需要时从来源取回并核对哈希' : '随作品嵌入'}${record.attribution.embedAllowed === false ? '（授权不允许嵌入）' : ''}` }));
      if (used.length) item.append(el('p', { class: 'workshop-deps', text: `被 ${used.length} 个作品使用：${used.slice(0, 4).map((work) => work.title).join('、')}${used.length > 4 ? '…' : ''}` }));
    }
    const buttons = el('div', { class: 'workshop-actions' });
    const problems = diagnose(catalog, entry, { toolAvailable }).filter((item) => item.level === 'error').length;
    if (problems) item.append(el('p', { class: 'workshop-flag', role: 'note', text: `有 ${problems} 个会妨碍打开的问题（见“详情”）` }));
    const more = el('button', { type: 'button', class: 'workshop-more', 'aria-expanded': 'false', text: '详情' });
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') === 'true', existing = item.querySelector('.workshop-details');
      if (open) { existing?.remove(); more.setAttribute('aria-expanded', 'false'); more.textContent = '详情'; return; }
      item.insertBefore(detailsOf(entry), buttons); more.setAttribute('aria-expanded', 'true'); more.textContent = '收起详情';
    });
    buttons.append(more);
    for (const action of actions[entry.kind === 'work' ? (entry.zone === 'template' ? 'templates' : 'works') : 'resources'] ?? []) {
      const button = el('button', { type: 'button', text: action.label, ...(action.title ? { title: action.title } : {}) });
      button.addEventListener('click', async () => {
        if (busy) return;
        busy = true; list.setAttribute('aria-busy', 'true');
        for (const each of dialog.querySelectorAll('.workshop-actions button')) each.disabled = true;
        setNote(`${action.label}：${entry.title}…`);
        try {
          const result = await action.run(entry, catalog);
          if (result !== false) { setNote(''); dialog.close(); }
        } catch (error) { setNote(error.message, 'error'); }
        finally { busy = false; list.removeAttribute('aria-busy'); for (const each of dialog.querySelectorAll('.workshop-actions button')) each.disabled = false; }
      });
      buttons.append(button);
    }
    item.append(buttons);
    return item;
  }

  function render() {
    for (const [name, tab] of Object.entries(zoneTabs)) { tab.setAttribute('aria-selected', String(name === zone)); tab.tabIndex = name === zone ? 0 : -1; }
    if (!catalog) { list.replaceChildren(); return; }
    const entries = queryCatalog(catalog, { zone, source: source.value || undefined, text: search.value, tag: tag.value || undefined, topic: topic.value || undefined });
    list.replaceChildren(...entries.map(card));
    if (!entries.length) list.append(el('li', { class: 'workshop-empty', text: zone === 'templates' ? '没有符合条件的模板。' : zone === 'works' ? '没有符合条件的作品。' : '没有符合条件的资源。' }));
  }

  function fillFilters() {
    const sources = [...new Set([...catalog.templates, ...catalog.works, ...catalog.resources].map((entry) => entry.source))];
    source.replaceChildren(new doc.defaultView.Option('全部来源', ''), ...sources.map((name) => new doc.defaultView.Option(SOURCE_NAMES[name] ?? name, name)));
    topic.replaceChildren(new doc.defaultView.Option('全部主题', ''), ...Object.entries(TOPICS).map(([id, name]) => new doc.defaultView.Option(name, id)));
    tag.replaceChildren(new doc.defaultView.Option('全部标签', ''), ...allTags(catalog, zone).map((name) => new doc.defaultView.Option(name, name)));
  }

  async function refresh() {
    setNote('正在读取工坊目录…');
    try {
      catalog = await load();
      fillFilters();
      // A missing catalogue of one source (say, the community has no resources yet) is ordinary while something else loaded;
      // when nothing loaded at all, every error is shown so the empty dialog explains itself.
      const empty = !catalog.templates.length && !catalog.works.length && !catalog.resources.length;
      const problems = empty ? catalog.errors : catalog.errors.filter(({ message }) => !/HTTP 404/.test(message));
      setNote(problems.length ? `${empty ? '工坊目录不可用' : '部分目录不可用'}：${problems.map(({ message }) => message).join('；')}` : '', problems.length ? 'error' : '');
      render();
    } catch (error) { catalog = undefined; render(); setNote(`无法读取工坊目录：${error.message}`, 'error'); }
  }

  for (const [name, tab] of Object.entries(zoneTabs)) tab.addEventListener('click', () => { zone = name; tag.value = ''; if (catalog) fillFilters(); render(); });
  for (const control of [topic, source, tag]) control.addEventListener('change', render);
  search.addEventListener('input', render);
  reload.addEventListener('click', refresh);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });   // a click on the backdrop

  return {
    element: dialog,
    async open(startZone = zone) {
      zone = startZone;
      dialog.showModal();
      if (!catalog) await refresh(); else { fillFilters(); render(); }
    },
    close: () => dialog.close(),
    /** The loaded catalogue (loading it if needed), for callers that open a work by id without showing the dialog. */
    async catalog() { if (!catalog) { catalog = await load(); } return catalog; },
  };
}
