import { SITE_CATEGORIES, sitesAtResidue } from '../../plugins/structure/functional-sites.mjs';
import { sequenceRows, rangeExpression, residueTitle } from '../../plugins/structure/sequence.mjs';

/**
 * The sequence bar: one row per chain copy, one cell per residue, drag to select a stretch, selections made elsewhere light up here.
 * The data (rows, gaps, secondary structure) comes from plugins/structure/sequence.mjs; this file only draws and forwards events.
 */
export function createSequenceBar({ root, rowsBox, info, onSelect }) {
  let data = { rows: [], hidden: 0 }, cells = [], dragFrom = null, visible = false, model = null, sites = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render() {
    rowsBox.replaceChildren();
    cells = [];
    if (!visible || !model) return;
    data = sequenceRows(model);
    data.rows.forEach((row, rowIndex) => {
      const line = el('div', 'seq-row');
      const label = el('b', null, row.label);
      label.title = `作者链名 ${row.chain}（label ${row.asym}）${row.copy ? `，对称拷贝 ${row.label}` : ''} · ${row.cells.length} 个残基`;
      line.append(label);
      row.cells.forEach((cell, index) => {
        if (cell.gapBefore) {
          const gap = el('span', 'seq-gap');
          gap.title = `缺失 ${cell.gapBefore.count} 个残基（label_seq ${cell.gapBefore.from}–${cell.gapBefore.to}）：结构里没有坐标`;
          line.append(gap);
        }
        const node = el('span', `seq-cell${cell.structure === 'helix' ? ' helix' : cell.structure === 'sheet' ? ' sheet' : ''}`, cell.code);
        node.title = residueTitle(cell);
        node.dataset.row = rowIndex;
        node.dataset.index = index;
        line.append(node);
        cells.push({ node, cell });
      });
      rowsBox.append(line);
    });
    markSites();
    if (data.hidden) rowsBox.append(el('p', 'seq-more', `另有 ${data.hidden} 条链没有列出（用 glow.select('chain …') 选择）`));
  }

  /** Colours the cells covered by UniProt sites (a bar on top) and lists them, with the accession, in each cell's tooltip. */
  function markSites() {
    for (const { node, cell } of cells) {
      const found = sites ? sitesAtResidue(sites, cell.residue) : [];
      node.style.boxShadow = found.length ? `inset 0 3px 0 ${SITE_CATEGORIES[found[0].type].color}` : '';
      const base = residueTitle(cell);
      node.title = found.length ? `${base}\n${found.map(({ type, site }) => `${SITE_CATEGORIES[type].label}${site.text ? `：${site.text}` : ''}（UniProt ${site.accession}）`).join('\n')}` : base;
    }
  }
  function setSites(next) { sites = next; markSites(); }
  function setModel(next) { model = next; sites = null; render(); }
  function setVisible(on) {
    visible = on == null ? !visible : Boolean(on);
    root.hidden = !visible;
    render();
    return visible;
  }

  /** Lights up the cells whose residue is in `chosen` (a Set of residue objects or a predicate on residues). */
  function highlight(isChosen) {
    let first = null;
    for (const { node, cell } of cells) {
      const on = Boolean(isChosen?.(cell.residue));
      node.classList.toggle('on', on);
      if (on && !first) first = node;
    }
    first?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  rowsBox.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('.seq-cell');
    dragFrom = node ? { row: +node.dataset.row, index: +node.dataset.index } : null;
  });
  rowsBox.addEventListener('pointerup', (event) => {
    const node = event.target.closest('.seq-cell'), from = dragFrom;
    dragFrom = null;
    if (!from || !node) return;
    const row = data.rows[from.row], to = +node.dataset.row === from.row ? +node.dataset.index : from.index;
    const expression = rangeExpression(row, from.index, to);
    if (expression) onSelect(expression, { first: row.cells[Math.min(from.index, to)] });
  });

  return { setModel, setSites, setVisible, render, highlight, get visible() { return visible; }, setInfo(text) { info.textContent = text; } };
}
