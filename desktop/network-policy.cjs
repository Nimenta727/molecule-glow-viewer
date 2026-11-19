// Only exact application pages may navigate internally; only web links reach the OS.
const INTERNAL = new Set(['/', '/index.html', '/dev.html', '/web/', '/web/index.html', '/web/dev.html',
  '/apps/viewer-web/', '/apps/viewer-web/index.html', '/apps/studio-web/', '/apps/studio-web/index.html']);
function classifyNavigation(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return 'deny';
    if (['https:', 'http:'].includes(url.protocol) && url.hostname) return 'external';
    if (url.protocol === 'app:' && url.host === 'glow' && INTERNAL.has(url.pathname)) return 'internal';
  } catch {}
  return 'deny';
}
function installNavigationPolicy(contents, { openExternal, loadURL }) {
  const external = (url) => { Promise.resolve(openExternal(url)).catch(() => {}); };
  contents.setWindowOpenHandler(({ url }) => {
    const kind = classifyNavigation(url);
    if (kind === 'external') external(url);
    else if (kind === 'internal') setImmediate(() => loadURL(url));
    return { action: 'deny' };
  });
  const navigate = (event, url) => {
    const kind = classifyNavigation(url);
    if (kind !== 'internal') { event.preventDefault(); if (kind === 'external') external(url); }
  };
  contents.on('will-navigate', navigate);
  contents.on('will-redirect', navigate);
}
module.exports = { classifyNavigation, installNavigationPolicy };
