// Real-browser check of camera keyframes: in the Studio the camera is moved and saved at two times, the keys are listed and removable, the scene is exported, and a fresh Viewer follows the keys when the playhead moves (and the keys survive undo).
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIX = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), OUT = process.argv[3] || 'docs/images';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png' };
setTimeout(() => { console.error('the check hung'); process.exit(1); }, 540000).unref?.();
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const errors = [], studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  const exportPack = async (name) => { const [d] = await Promise.all([studio.waitForEvent('download', { timeout: 60000 }), studio.evaluate(() => { document.querySelector('#export-scene').click(); })]); const f = path.join(os.tmpdir(), `${name}-${process.pid}.glow`); await d.saveAs(f); return f; };
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#add-camera-key', { timeout: 30000 }); await studio.waitForTimeout(1200);
  await studio.click('#add-box').catch(async () => { await studio.getByText('方盒').first().click(); }); await studio.waitForTimeout(500);
  const canvas = await studio.locator('canvas').first().boundingBox(), cx = canvas.x + canvas.width * 0.6, cy = canvas.y + canvas.height * 0.6;
  const setTime = async (t) => studio.evaluate((time) => { const r = document.querySelector('#studio-playhead'); r.value = time; r.dispatchEvent(new Event('input', { bubbles: true })); }, t);
  const orbit = async (dx) => { await studio.mouse.move(cx, cy); await studio.mouse.wheel(0, -400); await studio.waitForTimeout(400); await studio.mouse.move(cx - 150, cy - 150); await studio.mouse.down({ button: 'right' }); await studio.mouse.move(cx + dx, cy, { steps: 8 }); await studio.mouse.up({ button: 'right' }); await studio.waitForTimeout(300); };
  await setTime(0); await studio.click('#add-camera-key'); await studio.waitForTimeout(500); console.log('status:', await studio.$eval('#status', (n) => n.textContent)); await studio.waitForFunction(() => document.querySelectorAll('#camera-key-list li').length === 1);
  await setTime(4); await orbit(220); await studio.click('#add-camera-key'); await studio.waitForFunction(() => document.querySelectorAll('#camera-key-list li').length === 2);
  assert.deepEqual(await studio.$$eval('#camera-key-list li button:first-child', (b) => b.map((x) => x.textContent)), ['0.00 秒', '4.00 秒']);
  // the preview follows the keys: at 0 the camera is the first view, at 4 the second, in between something else
  await studio.screenshot({ path: path.join(os.tmpdir(), 'camera-keys-studio.png') });
  const pack = await exportPack('camkeys'); const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs'));
  const { scene } = await readScenePackage(new Uint8Array(fs.readFileSync(pack))); const keys = scene.presentation.cameraKeys; assert.equal(keys.length, 2); assert.deepEqual(keys.map((k) => k.time), [0, 4]);
  const marks = new Map(scene.presentation.bookmarks.map((b) => [b.id, b])); const a = marks.get(keys[0].bookmarkId), b = marks.get(keys[1].bookmarkId); console.log('keys:', JSON.stringify([a.position, b.position])); assert.notDeepEqual(a.position, b.position, 'the two keys hold different views');
  // delete one, undo brings it back
  await studio.evaluate(() => document.querySelectorAll('#camera-key-list li')[1].querySelectorAll('button')[1].click()); await studio.waitForFunction(() => document.querySelectorAll('#camera-key-list li').length === 1);
  await studio.click('#undo'); await studio.waitForFunction(() => document.querySelectorAll('#camera-key-list li').length === 2);
  // a fresh Viewer follows the keys
  const viewer = await context.newPage(); viewer.on('pageerror', (e) => errors.push('viewer: ' + e.message));
  await viewer.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await viewer.waitForFunction(() => window.glow, null, { timeout: 30000 }); await viewer.setInputFiles('#file', pack); await viewer.waitForFunction(() => document.querySelector('#playhead') && !document.querySelector('#playhead').disabled, null, { timeout: 60000 });
  const at = async (t) => { await viewer.evaluate((time) => { const r = document.querySelector('#playhead'); r.value = time; r.dispatchEvent(new Event('input', { bubbles: true })); }, t); await viewer.waitForTimeout(200); return viewer.evaluate(() => window.glow.camera()); };
  const c0 = await at(0), c2 = await at(2), c4 = await at(4), c9 = await at(9);
  console.log('viewer camera at 0/2/4/9 s:', JSON.stringify([c0.position, c2.position, c4.position, c9.position]));
  const close = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 1e-3 * (1 + Math.abs(q[i])));
  assert.ok(close(c0.position, a.position), 'at the first key the camera is the first view'); assert.ok(close(c4.position, b.position) && close(c9.position, b.position), 'at and after the last key it stays on the last view');
  assert.ok(!close(c2.position, a.position) && !close(c2.position, b.position), 'in between it is somewhere else');
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('camera keys: ok');
})().catch((e) => { console.error(e); process.exit(1); });
