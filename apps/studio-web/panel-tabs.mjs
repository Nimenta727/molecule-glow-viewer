/**
 * Accessible tabs for a panel: buttons with role="tab" and aria-controls, panels with role="tabpanel".
 * Arrow keys, Home and End move between tabs. The chosen tab is remembered for the next visit when storage is available.
 */
export function initTabs(list, { storageKey, onSelect = () => {} } = {}) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panel = (tab) => list.ownerDocument.getElementById(tab.getAttribute('aria-controls'));
  function select(tab, { focus = false } = {}) {
    for (const item of tabs) {
      const on = item === tab;
      item.setAttribute('aria-selected', String(on));
      item.tabIndex = on ? 0 : -1;
      panel(item).hidden = !on;
    }
    if (focus) tab.focus();
    try { if (storageKey) localStorage.setItem(storageKey, tab.id); } catch { /* storage may be unavailable */ }
    onSelect(tab);
  }
  list.addEventListener('click', (event) => { const tab = event.target.closest('[role="tab"]'); if (tab) select(tab); });
  list.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const target = { ArrowRight: tabs[(index + 1) % tabs.length], ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length], Home: tabs[0], End: tabs.at(-1) }[event.key];
    if (target) { event.preventDefault(); select(target, { focus: true }); }
  });
  let saved = null;
  try { if (storageKey) saved = localStorage.getItem(storageKey); } catch { /* ignore */ }
  select(tabs.find((tab) => tab.id === saved) ?? tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  return { select: (id) => select(tabs.find((tab) => tab.id === id)) };
}
