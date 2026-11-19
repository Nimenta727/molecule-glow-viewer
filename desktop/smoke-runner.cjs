// Opt-in build/CI harness. No renderer privilege bridge is added to normal launches.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function runSmoke({ win, app, cacheInfo, buildInfo }) {
  const output = process.env.GLOW_SMOKE_REPORT;
  const errors = [], requests = [], downloads = []; let finishing = false, probeRunning = false;
  const started = Date.now();
  win.webContents.on('console-message', (event, level, message) => {
    const severity = event.level ?? event.params?.level ?? level;
    if (severity === 'error' || severity === 3) { const text = event.message ?? event.params?.message ?? message; errors.push(text); console.log('[page error]', text); }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => errors.push(`load ${code} ${description} ${url}`));
  win.webContents.session.on('will-download', (_event, item) => {
    if (!output) return;
    const file = path.join(path.dirname(output), path.basename(item.getFilename()));
    item.setSavePath(file);
    const entry = { file, state: 'pending' }; downloads.push(entry);
    item.once('done', (_event, state) => { entry.state = state; });
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    requests.push(details.url);
    const u = new URL(details.url);
    if (process.env.GLOW_SMOKE_OFFLINE === '1' && !['app:', 'blob:', 'data:'].includes(u.protocol) &&
        !(u.protocol === 'https:' && ['files.rcsb.org', 'cdn.jsdelivr.net'].includes(u.hostname))) {
      errors.push('unexpected external request: ' + details.url); callback({ cancel: true });
    } else callback({});
  });
  async function finish(result, error) {
    if (finishing) return; finishing = true; clearTimeout(timeout);
    if (error) errors.push(String(error.stack ?? error));
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      // Wait for real save-button downloads, rather than returning while the OS is still writing.
      const end = Date.now() + 10000;
      while (downloads.some(({ state }) => state === 'pending') && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
      for (const item of downloads) if (item.state !== 'completed') errors.push('download ' + item.state);
      const screenshots = [];
      for (const [name, width] of output ? [['normal', 1440], ['narrow', 560]] : [['normal', win.getContentSize()[0]]]) {
        win.setContentSize(width, 900);
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const image = await win.webContents.capturePage();
        const file = output ? path.join(path.dirname(output), name + '.png') : path.join(app.getPath('temp'), 'glow-smoke.png');
        fs.writeFileSync(file, image.toPNG()); screenshots.push(file);
        if (process.env.GLOW_SHOT) {
          const { width: w, height: h } = image.getSize(), ch = Math.min(h, Math.round(w * 9 / 16)), cw = Math.round(ch * 16 / 9);
          fs.writeFileSync(process.env.GLOW_SHOT, image.crop({ x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch }).resize({ width: 640, height: 360 }).toJPEG(82));
        }
      }
      const report = { ok: errors.length === 0, packaged: app.isPackaged, appPath: app.getAppPath(),
        asarSha256: app.isPackaged ? crypto.createHash('sha256').update(require('original-fs').readFileSync(app.getAppPath())).digest('hex') : null,
        build: { ...buildInfo, files: undefined }, milliseconds: Date.now() - started, result, errors, requests, downloads, screenshots,
        preferences: { contextIsolation: win.webContents.getLastWebPreferences().contextIsolation,
          nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration, sandbox: win.webContents.getLastWebPreferences().sandbox }, cache: cacheInfo() };
      if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log('[smoke-js]', JSON.stringify(result)); console.log('[smoke]', JSON.stringify({ ok: report.ok, ...cacheInfo() }));
      app.exit(report.ok ? 0 : 1);
    } catch (caught) {
      if (output) fs.writeFileSync(output, JSON.stringify({ ok: false, errors: [...errors, String(caught.stack ?? caught)] }, null, 2));
      console.error(caught); app.exit(1);
    }
  }
  const timeout = setTimeout(() => finish(null, new Error('Desktop smoke timed out')), Number(process.env.GLOW_SMOKE) * 1000);
  if (process.env.GLOW_SMOKE_JS) win.webContents.once('did-finish-load', async () => {
    if (probeRunning) return; probeRunning = true;
    try { await finish(await win.webContents.executeJavaScript(fs.readFileSync(process.env.GLOW_SMOKE_JS, 'utf8'))); }
    catch (error) { await finish(null, error); }
  });
  else {
    clearTimeout(timeout);
    setTimeout(() => finish(null), Number(process.env.GLOW_SMOKE) * 1000);
  }
}
module.exports = { runSmoke };
