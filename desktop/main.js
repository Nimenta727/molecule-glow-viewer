// 分子光影 desktop shell.
// - Serves the viewer from app://glow/ (a standard, secure scheme so modules, fetch and workers behave like https).
// - Three.js requests to the jsDelivr CDN are answered from the bundled vendor/three, so the app starts offline.
// - Structure / annotation downloads (RCSB, UniProt) are cached on disk in userData/structure-cache:
//   coordinate files are cache-first (an entry's coordinates don't change), metadata is network-first with
//   the cache as offline fallback.
const { app, BrowserWindow, protocol, net, session, shell, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = __dirname;
const APP_DIR = path.join(ROOT, 'app');
const THREE_DIR = path.join(ROOT, 'vendor', 'three');   // filled by scripts/sync.js
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const CACHE_FIRST = new Set(['files.rcsb.org', 'models.rcsb.org']);
const NETWORK_FIRST = new Set(['data.rcsb.org', 'rest.uniprot.org', 'search.rcsb.org', 'raw.githubusercontent.com']);   // + workshop indexes / packs / covers
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

let cacheDir;
const stats = { hit: 0, miss: 0, offline: 0 };

function fileResponse(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' },
  });
}
function inside(base, rel) { const f = path.resolve(base, rel); return f.startsWith(base + path.sep) ? f : null; }

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');
function readCache(url) {
  const f = path.join(cacheDir, keyOf(url));
  if (!fs.existsSync(f + '.bin')) return null;
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(f + '.json', 'utf8')); } catch {}
  return new Response(fs.readFileSync(f + '.bin'), {
    status: 200,
    headers: { 'content-type': meta.type || 'application/octet-stream', 'access-control-allow-origin': '*', 'x-glow-cache': 'hit' },
  });
}
async function writeCache(url, res) {
  const buf = Buffer.from(await res.arrayBuffer()), f = path.join(cacheDir, keyOf(url));
  fs.writeFileSync(f + '.bin', buf);
  fs.writeFileSync(f + '.json', JSON.stringify({ url, type: res.headers.get('content-type'), at: new Date().toISOString(), size: buf.length }));
  if (++writes % 40 === 0) setImmediate(pruneCache);
  return new Response(buf, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' } });
}
/* L6: the page's AbortController (a newer scene cancels old downloads) reaches the real request */
const passThrough = (req) => net.fetch(req, { bypassCustomProtocolHandlers: true, signal: req.signal });
/* the disk cache keeps at most 2 GB: oldest files (by last write) go first; checked at start and every 40 new files */
const CACHE_MAX = 2 * 1024 ** 3; let writes = 0;
function pruneCache() {
  try { const F = fs.readdirSync(cacheDir).filter(f => f.endsWith('.bin')).map(f => { const st = fs.statSync(path.join(cacheDir, f)); return { f, size: st.size, t: st.mtimeMs }; });
    let total = F.reduce((n, x) => n + x.size, 0); if (total <= CACHE_MAX) return;
    for (const x of F.sort((a, b) => a.t - b.t)) { if (total <= CACHE_MAX * 0.9) break; const b = path.join(cacheDir, x.f); fs.rmSync(b, { force: true }); fs.rmSync(b.replace(/\.bin$/, '.json'), { force: true }); total -= x.size; }
  } catch (e) { console.warn('cache prune', e); }
}

async function handleHttps(req) {
  const u = new URL(req.url);
  if (req.url.startsWith(THREE_CDN)) {
    const f = inside(THREE_DIR, decodeURIComponent(u.pathname.slice('/npm/three@0.160.0/'.length)));
    return f ? fileResponse(f) : new Response('bad path', { status: 400 });
  }
  const cacheable = req.method === 'GET' && (CACHE_FIRST.has(u.host) || NETWORK_FIRST.has(u.host));
  if (!cacheable) return passThrough(req);
  if (CACHE_FIRST.has(u.host)) { const c = readCache(req.url); if (c) { stats.hit++; return c; } }
  try {
    const res = await passThrough(req);
    if (!res.ok) return res;
    stats.miss++;
    return await writeCache(req.url, res);
  } catch (e) {
    const c = readCache(req.url);
    if (c) { stats.offline++; return c; }
    throw e;
  }
}

function cacheInfo() {
  let files = 0, bytes = 0;
  for (const f of fs.readdirSync(cacheDir)) if (f.endsWith('.bin')) { files++; bytes += fs.statSync(path.join(cacheDir, f)).size; }
  return { dir: cacheDir, files, bytes, ...stats };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#ffffff', title: '分子光影',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !(process.env.GLOW_REGRESS || process.env.GLOW_SMOKE) },
  });
  // Links (DOI, UniProt pages) open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
  // GLOW_PAGE=dev.html opens another page of app/ (tests of the developer workbench)
  const page = /^[\w.-]+\.html$/.test(process.env.GLOW_PAGE || '') ? process.env.GLOW_PAGE : 'index.html';
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
        const again = await run(scenes.list[0].load); report.revisit = { key: scenes.list[0].key, geometries: again.geometries, textures: again.textures, objects: again.objects, jsHeapMB: again.jsHeapMB, overlayObjects: again.overlayObjects, procRootChildren: again.procRootChildren, domTags: again.domTags, listeners: again.listeners };
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
      } catch (e) { report.fatal = String(e.message || e); }
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); app.quit();
    }, 3000));
  }
  // GLOW_SMOKE=<seconds>: self-test for CI / builds — print console errors and cache stats, save a screenshot, quit.
  if (process.env.GLOW_SMOKE) {
    win.webContents.on('console-message', (e) => { const lv = e.level ?? e.params?.level; if (lv === 'error' || lv === 3) console.log('[page error]', e.message ?? e.params?.message); });
    // GLOW_SMOKE_JS=<file>: a script run in the page 3 s after load (tests: open a .glow, switch modes ...); its result is printed
    if (process.env.GLOW_SMOKE_JS) win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { console.log('[smoke-js]', JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(process.env.GLOW_SMOKE_JS, 'utf8')))); }
      catch (e) { console.log('[smoke-js error]', e.message); }
    }, 3000));
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(app.getPath('temp'), 'glow-smoke.png'), img.toPNG());
      if (process.env.GLOW_SHOT) {   // a 16:9 640x360 JPEG (workshop covers)
        const { width: w, height: h } = img.getSize(), ch = Math.min(h, Math.round(w * 9 / 16)), cw = Math.round(ch * 16 / 9);
        fs.writeFileSync(process.env.GLOW_SHOT, img.crop({ x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch }).resize({ width: 640, height: 360, quality: 'best' }).toJPEG(82));
      }
      console.log('[smoke]', JSON.stringify({ status: await win.webContents.executeJavaScript("document.getElementById('status')?.textContent || ''"), result: await win.webContents.executeJavaScript('window.__smoke ?? null'), ...cacheInfo() }));
      app.quit();
    }, +process.env.GLOW_SMOKE * 1000);
  }
}

app.whenReady().then(() => {
  // not 'cache': on Windows that is the same folder as Chromium's own HTTP cache (userData/Cache), which it wipes
  cacheDir = path.join(app.getPath('userData'), 'structure-cache');
  fs.mkdirSync(cacheDir, { recursive: true }); setTimeout(pruneCache, 5000);
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const f = inside(APP_DIR, rel);
    return f ? fileResponse(f) : new Response('bad path', { status: 400 });
  });
  session.defaultSession.protocol.handle('https', handleHttps);
  ipcMain.handle('glow:cache-info', () => cacheInfo());
  ipcMain.handle('glow:cache-clear', () => { for (const f of fs.readdirSync(cacheDir)) fs.rmSync(path.join(cacheDir, f)); return cacheInfo(); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
