const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
// Real-browser check of the Viewer's 查看 and 视角 pages: drives the buttons (ball-and-stick, surfaces, look pack, neighbourhood, composition, contacts, pan, standard view, zoom, mouse mode, double-click re-centre) on a local structure file.
//   node tools/viewer-view-panel-check.cjs <structure.cif> <out.png>   (screenshots are written next to <out.png>; exits non-zero on a page error)
const ROOT = require('node:path').resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FILE = process.argv[2], OUT = process.argv[3];
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'warning' && !/GL Driver/.test(m.text())) console.log('warn', m.text().slice(0, 160)); });
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.click('#panel-tab-structure'); await page.check('#structure-enabled'); await page.waitForTimeout(1500);
  await page.setInputFiles('#file', FILE); await page.waitForTimeout(12000);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[id^=panel-tab-]')].filter((b) => !b.hidden).map((b) => b.textContent.trim()));
  console.log('tabs', JSON.stringify(tabs), 'selected', await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent));
  await page.click('#panel-tab-view'); await page.waitForTimeout(500); await page.screenshot({ path: OUT.replace('.png', '-1.png') });
  const msg = () => page.evaluate(() => document.querySelector('.view-message')?.textContent);
  const click = async (text, scopeSel = '#view-controls') => { await page.locator(scopeSel + ' button', { hasText: text }).first().click(); await page.waitForTimeout(2500); };
  await click('球棍'); console.log('ballstick:', await msg());
  await page.selectOption('#view-scope', 'chain A'); await click('球棍'); console.log('chain A ballstick:', await msg());
  await page.fill('#view-scope-custom', 'within 6 of ligands'); await click('球棍模型'); console.log('ballstick pocket:', await msg());
  await click('价键模型'); console.log('sticks pocket:', await msg());
  await click('画氢键和盐桥线'); console.log('hbonds:', await page.evaluate(() => document.querySelector('.view-report').textContent), '|', await msg());
  const bonds = await page.evaluate(() => window.glow.hbonds()); console.log('lines in scene', JSON.stringify(bonds));
  await page.fill('#view-scope-custom', 'chain A and resi 1-60'); await click('球棍模型'); await click('画氢键和盐桥线'); console.log('hbonds helix part:', await page.evaluate(() => document.querySelector('.view-report').textContent)); console.log('lines drawn', JSON.stringify(await page.evaluate(() => window.glow.hbonds()))); await page.waitForTimeout(2500); await page.screenshot({ path: OUT.replace('.png', '-bonds.png') });
  await click('清除键线'); await page.fill('#view-scope-custom', '');
  await click('疏水性'); console.log('hydrophobicity:', await msg());
  await click('暖光'); console.log('pack:', await msg());
  await click('单色表面'); console.log('surface:', await msg());
  await click('显示周围残基'); console.log('neighborhood:', await msg(), '|', await page.evaluate(() => document.querySelector('.view-report').textContent));
  await click('算当前对象的组成与性质'); console.log('composition:', await page.evaluate(() => document.querySelector('.view-report').textContent));
  await page.fill('#view-ct-a', 'chain A'); await page.fill('#view-ct-b', 'chain B'); await click('计算并高亮界面'); console.log('contacts:', await page.evaluate(() => document.querySelector('.view-report').textContent), '|', await msg());
  await page.waitForTimeout(3000); await page.screenshot({ path: OUT.replace('.png', '-2.png') });
  const cam0 = await page.evaluate(() => window.glow.camera());
  await page.click('#panel-tab-navigate'); await click('→', '#view-navigation'); const cam1 = await page.evaluate(() => window.glow.camera()); console.log('pan moved target:', JSON.stringify(cam0.target.map((v) => +v.toFixed(4))), '->', JSON.stringify(cam1.target.map((v) => +v.toFixed(4))));
  await click('正面', '#view-navigation'); await click('放大', '#view-navigation');
  const cam2 = await page.evaluate(() => window.glow.camera()); console.log('after front+zoom position', JSON.stringify(cam2.position.map((v) => +v.toFixed(3))));
  await page.click('#view-navigation button[data-mode=pan]'); const mode = await page.evaluate(() => document.querySelector('#view-navigation [aria-checked=true]').textContent); console.log('mode', mode);
  await page.dblclick('#viewport canvas', { position: { x: 500, y: 350 } }); await page.waitForTimeout(1200);
  const cam3 = await page.evaluate(() => window.glow.camera()); console.log('dblclick target', JSON.stringify(cam3.target.map((v) => +v.toFixed(4))));
  await page.screenshot({ path: OUT.replace('.png', '-3.png') });
  console.log('errors', JSON.stringify(errors)); if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
