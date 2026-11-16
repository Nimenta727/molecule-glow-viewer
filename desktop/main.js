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
  return new Response(buf, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' } });
}
const passThrough = (req) => net.fetch(req, { bypassCustomProtocolHandlers: true });

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
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links (DOI, UniProt pages) open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL('app://glow/index.html' + (process.env.GLOW_QUERY || ''));
  if (process.env.GLOW_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
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
  fs.mkdirSync(cacheDir, { recursive: true });
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
