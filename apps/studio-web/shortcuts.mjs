/**
 * Keyboard shortcuts of the Studio, as the other authoring tools have them: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Delete / Backspace remove the selected objects. Pure: `shortcutFor(event)` says
 * which action a key press means (or null); it never fires while the person is typing in a field.
 */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
export function shortcutFor(event) {
  const target = event.target, tag = target?.tagName;
  if (TYPING.has(tag) || target?.isContentEditable) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey), key = String(event.key ?? '').toLowerCase();
  if (mod && !event.altKey && key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (mod && !event.altKey && !event.shiftKey && key === 'y') return 'redo';
  if (!mod && !event.altKey && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) return 'remove';
  return null;
}

/** Menus made of <details class="menu">: one open at a time; a click on an item, a click elsewhere or Escape closes it. */
export function wireMenus(doc = document) {
  const menus = [...doc.querySelectorAll('details.menu')], closeAll = (except) => { for (const menu of menus) if (menu !== except) menu.open = false; };
  for (const menu of menus) {
    menu.addEventListener('toggle', () => { if (menu.open) closeAll(menu); });
    menu.addEventListener('click', (event) => { if (event.target.closest('.menu-list button')) menu.open = false; });
  }
  doc.addEventListener('click', (event) => { if (!event.target.closest?.('details.menu')) closeAll(); });
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = menus.find((menu) => menu.open); if (!open) return;
    open.open = false; open.querySelector('summary')?.focus();
  });
}
