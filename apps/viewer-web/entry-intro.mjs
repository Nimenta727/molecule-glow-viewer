import { loadIntroduction, readableTitle } from '../../plugins/structure/entry-intro.mjs';

/**
 * The introduction card of a PDB entry: what it is, where the information comes from, and what is not available. The data and its sourcing
 * are in plugins/structure/entry-intro.mjs; this file reads it (on request, over the network) and draws it with DOM text only (no HTML strings).
 */
const DOI = /^10\.\d{4,9}\/\S+$/;

export function createEntryIntro({ box, button, context }) {
  let token = 0;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const link = (text, href) => {
    const a = el('a', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  const section = (title, ...children) => {
    const div = el('div', null, 'intro-section');
    if (title) div.append(el('b', title), ' ');
    div.append(...children);
    return div;
  };
  const source = (name) => el('span', `（${name}）`, 'intro-source');

  function render({ intro, warnings }, ligands) {
    box.replaceChildren();
    box.append(el('h3', readableTitle(intro.title) || `${intro.id}（RCSB 没有标题）`, 'intro-title'));
    const facts = [intro.id, intro.methods.join(' / ') || '实验方法不可用', intro.resolution != null ? `${intro.resolution.toFixed(1)} Å` : '分辨率不可用'];
    if (intro.released) facts.push(`发布 ${intro.released}`);
    if (intro.keywords) facts.push(intro.keywords);
    box.append(section(null, facts.join(' · '), ' ', source('RCSB PDB')));
    box.append(section('来源物种', intro.organisms.length ? el('i', intro.organisms.join('、')) : '不可用', ' ', source('RCSB PDB')));
    const mutated = intro.entities.filter((e) => e.substitutions);
    if (mutated.length) box.append(section('替换/突变', mutated.map((e) => `${e.description ?? `实体 ${e.entityId}`}：${e.substitutions}`).join('；'), ' ', source('RCSB PDB')));
    if (intro.citation) {
      const { title, journal, year, doi, pubmed } = intro.citation, parts = [title, ` ${[journal, year].filter(Boolean).join(' ')} `];
      if (doi && DOI.test(doi)) parts.push(link('DOI', `https://doi.org/${encodeURI(doi)}`), ' ');
      if (Number.isInteger(pubmed)) parts.push(link('PubMed', `https://pubmed.ncbi.nlm.nih.gov/${pubmed}/`), ' ');
      box.append(section('文献', ...parts, source('RCSB PDB')));
    } else box.append(section('文献', '不可用', ' ', source('RCSB PDB')));
    if (intro.entities.length) {
      const list = el('ul', null, 'intro-list');
      for (const e of intro.entities) {
        const item = el('li', `${e.description ?? `实体 ${e.entityId}`}${e.copies ? ` ×${e.copies}` : ''}`);
        for (const accession of e.uniprotIds) item.append(' ', link(accession, `https://www.uniprot.org/uniprotkb/${accession}`));
        list.append(item);
      }
      box.append(section('组成', list));
    }
    if (ligands.length) {
      const chips = el('span', null, 'intro-chips');
      for (const comp of ligands) {
        const chip = el('button', comp);
        chip.type = 'button';
        chip.title = `在 3D 中选中所有 ${comp}`;
        chip.addEventListener('click', () => context.select(`ligand ${comp}`));
        chips.append(chip);
      }
      box.append(section('小分子 / 离子', '（点击在 3D 中选中）', chips));
    }
    if (intro.families.length || intro.go.length) {
      box.append(section('注释', intro.families.join('；'), intro.go.length ? el('div', `GO：${intro.go.join('；')}`, 'intro-source') : '', ' ', source('RCSB PDB')));
    }
    if (intro.functions.length) {
      for (const f of intro.functions) {
        const text = f.text ? (f.text.length > 520 ? `${f.text.slice(0, 520)}…` : f.text) : 'UniProt 没有这条蛋白的功能注释';
        box.append(section(`功能 · ${f.name}${f.gene ? ` (${f.gene})` : ''}`, link(f.accession, `https://www.uniprot.org/uniprotkb/${f.accession}`), '：', text, ' ', source('UniProt 原文')));
      }
    } else if (!warnings.length) box.append(section('功能', '不可用（RCSB 没有给出可用的 UniProt 条目）'));
    for (const warning of warnings) box.append(el('p', warning, 'intro-warning'));
    if (intro.missing.length) box.append(el('p', `RCSB 没有提供：${intro.missing.join('、')}。`, 'intro-source'));
  }

  button.addEventListener('click', async () => {
    const mine = ++token;
    const entry = context.entryId();
    box.hidden = false;
    box.replaceChildren(el('p', '正在读取 RCSB / UniProt …', 'intro-source'));
    try {
      if (!entry) throw new Error('只有 PDB 条目才能读取自动简介');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      let result;
      try {
        result = await loadIntroduction(entry, {
          signal: controller.signal, sizeOf: context.sizeOf,
          async fetchJson(url, init) {
            const response = await fetch(url, init);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          },
        });
      } finally { clearTimeout(timer); }
      if (mine === token) render(result, context.ligands());
    } catch (error) {
      if (mine === token) box.replaceChildren(el('p', error.name === 'AbortError' ? '读取超时，请稍后再试。' : error.message, 'intro-warning'));
    }
  });

  return { reset() { token++; box.hidden = true; box.replaceChildren(); } };
}
