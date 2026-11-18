// Reorder panel sections only in the Windows desktop shell; web/embed/dev pages keep the source DOM unchanged.
(() => {
  if (!window.glowDesktop || document.querySelector('#panel[data-desktop-groups]')) return;
  const params = new URLSearchParams(location.search);
  if (/(?:^|\/)dev\.html$/i.test(location.pathname) || params.has('dev') || params.has('embed')) return;

  const panel = document.getElementById('panel');
  if (!panel) return;
  const title = [...panel.children].find((node) => node.tagName === 'H1');
  const content = [...panel.children].filter((node) => node !== title);
  const headingIndex = (label) => content.findIndex((node) => node.tagName === 'H2' && node.textContent.trim() === label);
  const processAt = headingIndex('过程动画');
  const displayAt = headingIndex('小分子');
  if (!title || processAt < 0 || displayAt <= processAt) return;

  const makeGroup = (label, nodes) => {
    const group = document.createElement('details');
    group.className = 'desktopGroup';
    group.open = true;
    const summary = document.createElement('summary');
    summary.textContent = label;
    group.append(summary, ...nodes);
    return group;
  };
  const sceneAndFiles = content.slice(0, processAt);
  const playback = content.slice(processAt, displayAt);
  const displayAndView = content.slice(displayAt);
  panel.replaceChildren(
    title,
    makeGroup('场景与文件', sceneAndFiles),
    makeGroup('显示与视角', displayAndView),
    makeGroup('播放与模拟', playback),
  );
  panel.dataset.desktopGroups = 'true';
})();
