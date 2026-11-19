// 分子光影 desktop shell.
// - Serves the viewer from app://glow/ (a standard, secure scheme so modules, fetch and workers behave like https).
// - Three.js requests to the jsDelivr CDN are answered from the bundled vendor/three, so the app starts offline.
// - Structure / annotation downloads (RCSB, UniProt) are cached on disk in userData/structure-cache:
//   coordinate files are cache-first (an entry's coordinates don't change), metadata is network-first with
//   the cache as offline fallback.
const { app, BrowserWindow, protocol, net, session, shell, ipcMain } = require('electron');
const path = require('path'), fs = require('fs');
const { createResponseCache, CacheLimitError } = require('./response-cache.cjs');
const { installNavigationPolicy } = require('./network-policy.cjs');
const { configureWorkspaces, resolveEntry, readBuildInfo } = require('./platform-shell.cjs');
if (process.env.GLOW_SMOKE && process.env.GLOW_SMOKE_PROFILE) app.setPath('userData', path.resolve(process.env.GLOW_SMOKE_PROFILE));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = __dirname;
const buildInfo = readBuildInfo(ROOT);
const APP_DIR = path.join(ROOT, 'app');
const THREE_DIR = path.join(ROOT, 'vendor', 'three');   // filled by scripts/sync.js
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const CACHE_FIRST = new Set(['files.rcsb.org', 'models.rcsb.org']);
const NETWORK_FIRST = new Set(['data.rcsb.org', 'rest.uniprot.org', 'search.rcsb.org', 'raw.githubusercontent.com']);   // + workshop indexes / packs / covers
const MIME = { '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

let cacheDir, responseCache;
const stats = { hit: 0, miss: 0, offline: 0 };

function fileResponse(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' },
  });
}
function inside(base, rel) { const f = path.resolve(base, rel); return f.startsWith(base + path.sep) ? f : null; }

const passThrough = (req, signal = req.signal) => net.fetch(req, { bypassCustomProtocolHandlers: true, signal });

async function handleHttps(req) {
  const u = new URL(req.url);
  if (req.url.startsWith(THREE_CDN)) {
    const f = inside(THREE_DIR, decodeURIComponent(u.pathname.slice('/npm/three@0.160.0/'.length)));
    return f ? fileResponse(f) : new Response('bad path', { status: 400 });
  }
  const cacheable = req.method === 'GET' && (CACHE_FIRST.has(u.host) || NETWORK_FIRST.has(u.host));
  if (!cacheable) return passThrough(req);
  if (CACHE_FIRST.has(u.host)) { const c = responseCache.read(req.url); if (c) { stats.hit++; return c; } }
  if (process.env.GLOW_SMOKE && process.env.GLOW_SMOKE_OFFLINE === '1') {
    const cached = responseCache.read(req.url);
    return cached || new Response('Offline smoke fixture is missing', { status: 503 });
  }
  try {
    const res = await responseCache.download(req.url, signal => passThrough(req, signal), { signal: req.signal });
    if (res.ok) stats.miss++;
    return res;
  } catch (e) {
    if (req.signal.aborted || e instanceof CacheLimitError || e?.name === 'AbortError') throw e;
    const c = responseCache.read(req.url);
    if (c) { stats.offline++; return c; }
    throw e;
  }
}

function cacheInfo() {
  let files = 0, bytes = 0;
  for (const f of fs.readdirSync(cacheDir)) if (f.endsWith('.bin')) {
    try { const size = fs.statSync(path.join(cacheDir, f)).size; files++; bytes += size; } catch { /* Concurrent eviction. */ }
  }
  return { dir: cacheDir, files, bytes, ...stats };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#ffffff', title: '分子光影',
    autoHideMenuBar: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !(process.env.GLOW_REGRESS || process.env.GLOW_SMOKE) },
  });
  // Links (DOI, UniProt pages) open in the user's browser, not inside the app.
  installNavigationPolicy(win.webContents, { openExternal: url => shell.openExternal(url), loadURL: url => win.loadURL(url) });
  configureWorkspaces(win, ROOT, buildInfo);
  // GLOW_PAGE=dev.html opens another page of app/ (tests of the developer workbench)
  const page = resolveEntry(process.env.GLOW_PAGE);
  win.loadURL('app://glow/' + page + (process.env.GLOW_QUERY || (process.env.GLOW_REGRESS ? '?noauto=1' : '')));   // regression: no automatic quality changes
  if (process.env.GLOW_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  // GLOW_REGRESS=<dir>: regression baseline (scripts/regress.mjs). Loads every scene in scripts/regress-scenes.json one after the
  // other in this window, measures it (__viewer.loadAndProbe), saves <dir>/<n>.jpg, then loads the first scene again: if the
  // geometry / texture counts grew, something was not disposed. Writes <dir>/report.json and quits.
  if (process.env.GLOW_REGRESS) {
    const out = process.env.GLOW_REGRESS; fs.mkdirSync(out, { recursive: true });
    const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scripts', 'regress-scenes.json'), 'utf8'));
    win.webContents.on('console-message', (e) => { const lv = e.level ?? e.params?.level; if (lv === 'error' || lv === 3) console.log('[page error]', e.message ?? e.params?.message); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const run = (cfg) => win.webContents.executeJavaScript(`window.__viewer.loadAndProbe(${JSON.stringify(cfg)}, ${scenes.settle ?? 2}, ${scenes.seconds ?? 5})`);
      const report = { size: win.getContentSize(), scenes: [] };
      try {
        for (const [i, s] of scenes.list.entries()) {
          const r = await run(s.load); r.key = s.key;
          const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, `${s.key}.jpg`), img.resize({ width: 640 }).toJPEG(80));
          report.scenes.push(r); console.log('[regress]', s.key, JSON.stringify({ loadMs: r.loadMs, fps: r.fps, geometries: r.geometries, error: r.error }));
        }
        const again = await run(scenes.list[0].load); report.revisit = { key: scenes.list[0].key, geometries: again.geometries, textures: again.textures, objects: again.objects, jsHeapMB: again.jsHeapMB, overlayObjects: again.overlayObjects, procRootChildren: again.procRootChildren, domTags: again.domTags, listeners: again.listeners, session: again.session };
        if (scenes.rapid) {   // rapid switch: fire several loads without waiting, measure the last
          const r = await win.webContents.executeJavaScript(`window.__viewer.rapid(${JSON.stringify(scenes.rapid.list)}, ${scenes.settle ?? 2}, ${scenes.seconds ?? 5})`);
          r.key = 'rapid-switch'; r.compare = scenes.rapid.compare; report.rapid = r;
          console.log('[regress] rapid', JSON.stringify({ loadMs: r.loadMs, residues: r.residues, domTags: r.domTags, listeners: r.listeners, error: r.error }));
        }
        for (const d of scenes.determinism || []) {   // same seed twice -> identical counters and events; plus minimum activity
          const go = () => win.webContents.executeJavaScript(`window.__viewer.seededRun(${JSON.stringify(d.load)}, ${JSON.stringify(d.seed ?? 1)}, ${d.dt ?? 1 / 30}, ${d.steps ?? 600})`);
          const a = await go(), b = await go(); (report.determinism ??= []).push({ key: d.key, expect: d.expect || {}, a, b });
          console.log('[regress] determinism', d.key, JSON.stringify({ seed: a.seed, counters: a.counters, events: a.events?.length, ms: a.ms, error: a.error || b.error }));
        }
        for (const w of scenes.twice || []) {   // load a scene twice: the second load must not leave more behind than the first
          const a = await run(w.load), b = await run(w.load); (report.twice ??= []).push({ key: w.key, a, b });
          console.log('[regress] twice', w.key, JSON.stringify({ geometries: [a.geometries, b.geometries], listeners: [a.listeners, b.listeners], domTags: [a.domTags, b.domTags], error: a.error || b.error }));
        }
        for (const k of ['backTest', 'animTest', 'failKeepTest', 'bridgeTest']) {   // back navigation (A9), pending animations (A11), failed load keeps the scene (WP2), bridge (A1)
          report[k] = await win.webContents.executeJavaScript(`window.__viewer.${k}()`).catch(e => ({ error: String(e.message || e) }));
          console.log('[regress]', k, JSON.stringify(report[k]));
        }
      } catch (e) { report.fatal = String(e.message || e); }
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); app.quit();
    }, 3000));
  }
  if (process.env.GLOW_SMOKE) require('./smoke-runner.cjs').runSmoke({ win, app, cacheInfo, buildInfo });
}

app.whenReady().then(() => {
  // not 'cache': on Windows that is the same folder as Chromium's own HTTP cache (userData/Cache), which it wipes
  cacheDir = path.join(app.getPath('userData'), 'structure-cache');
  responseCache = createResponseCache(cacheDir);
  responseCache.prune().catch(error => console.warn('cache prune', error));
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    if (url.host !== 'glow' || url.username || url.password) return new Response('bad host', { status: 403 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const f = inside(APP_DIR, rel.endsWith('/') ? rel + 'index.html' : rel);
    return f ? fileResponse(f) : new Response('bad path', { status: 400 });
  });
  session.defaultSession.protocol.handle('https', handleHttps);
  ipcMain.handle('glow:cache-info', () => cacheInfo());
  ipcMain.handle('glow:build-info', () => ({ ...buildInfo, packaged: app.isPackaged }));
  ipcMain.handle('glow:cache-clear', async () => { await responseCache.clear(); return cacheInfo(); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
