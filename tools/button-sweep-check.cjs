const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
// Clicks every visible, enabled button of the Viewer and the Studio (page by page of their panels) with a structure open, and reports the buttons that raise an error or change nothing
// that can be seen (text, pressed/expanded states, open dialogs, the camera, the scene). A button that "does nothing" is a candidate, not a proof: some only act on a selection.
//   node tools/button-sweep-check.cjs <structure.cif> <out.json>
const ROOT = require('node:path').resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FILE = process.argv[2], OUT = process.argv[3];
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const SKIP = /^(关闭|close)$/i;   // closing the scene would empty the page for the buttons after it (it is clicked last)
  const report = [];
  async function sweep(app, setup) {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    page.on('dialog', (d) => d.dismiss().catch(() => {})); page.on('filechooser', () => {});
    await setup(page);
    const fingerprint = () => page.evaluate(async () => {
      const cam = window.glow ? await window.glow.camera().catch(() => null) : window.studio ? await window.studio.camera().then((r) => r.camera, () => null) : null;
      const pressed = [...document.querySelectorAll('[aria-pressed],[aria-expanded],[aria-selected],[aria-checked]')].map((n) => n.getAttribute('aria-pressed') + n.getAttribute('aria-expanded') + n.getAttribute('aria-selected') + n.getAttribute('aria-checked')).join('');
      const open = [...document.querySelectorAll('dialog[open], details[open]')].length, hidden = [...document.querySelectorAll('[hidden]')].length;
      const values = [...document.querySelectorAll('input, select, textarea')].map((n) => n.type === 'checkbox' || n.type === 'radio' ? String(n.checked) : n.value).join('|');
      return JSON.stringify([document.body.innerText.length, document.body.innerText.slice(-400), pressed, open, hidden, cam, document.querySelectorAll('canvas').length, values, document.body.className]);
    });
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((t) => t.offsetParent).map((t) => t.id).filter(Boolean));
    const seen = new Set();
    for (const tab of [null, ...tabs]) {
      if (tab) { await page.click('#' + tab).catch(() => {}); await page.waitForTimeout(300); }
      const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b, i) => ({ i, id: b.id, text: b.textContent.trim().slice(0, 24), visible: Boolean(b.offsetParent) && getComputedStyle(b).visibility !== 'hidden', disabled: b.disabled })).filter((b) => b.visible));
      for (const button of buttons) {
        const key = button.id || button.text; if (seen.has(key) || SKIP.test(button.text)) continue; seen.add(key);
        if (button.disabled) { report.push({ app, tab, button: key, result: 'disabled' }); continue; }
        // the button may have been hidden by an earlier one (a collapsed panel, a closed menu): bring the panel back, open the menu it belongs to, or skip it
        await page.evaluate(() => { if (document.body.classList.contains('panel-collapsed')) document.getElementById('panel-toggle')?.click(); });
        const reachable = await page.evaluate(({ id, text }) => {
          const b = id ? document.getElementById(id) : [...document.querySelectorAll('button')].find((n) => n.textContent.trim().slice(0, 24) === text);
          if (!b) return 'gone';
          const menu = b.closest('details'); if (menu && !menu.open) menu.open = true;   // a menu item: open its menu first
          return b.offsetParent ? 'yes' : 'hidden';
        }, button);
        if (reachable !== 'yes') { report.push({ app, tab, button: key, result: `not reachable (${reachable})` }); continue; }
        const before = await fingerprint(), errorsBefore = errors.length;
        const handle = button.id ? page.locator('#' + button.id) : page.locator('button', { hasText: button.text }).first();
        const clicked = await handle.click({ timeout: 4000 }).then(() => true, (e) => e.message.split('\n')[0]);
        await page.waitForTimeout(900);
        const after = await fingerprint();
        const result = clicked !== true ? `click failed: ${clicked}` : errors.length > errorsBefore ? `error: ${errors.slice(errorsBefore).join(' | ').slice(0, 300)}` : before === after ? 'no visible effect' : 'ok';
        report.push({ app, tab, button: key, result });
        await page.keyboard.press('Escape').catch(() => {}); await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); }).catch(() => {});
        if (tab) await page.click('#' + tab).catch(() => {});
      }
    }
    await page.close();
  }
  const text = fs.readFileSync(FILE, 'utf8');
  await sweep('viewer', async (page) => {
    await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
    await page.click('#panel-tab-structure'); await page.check('#structure-enabled'); await page.waitForTimeout(1000);
    await page.setInputFiles('#file', FILE); await page.waitForFunction(() => !document.getElementById('view-controls').hidden, null, { timeout: 120000 }); await page.waitForTimeout(3000);
  });
  await sweep('studio', async (page) => {
    await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForFunction(() => window.studio, null, { timeout: 30000 });
    await page.evaluate((t) => window.studio.import({ name: 'structure.cif', text: t }), text); await page.waitForTimeout(4000);
  });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  const bad = report.filter((r) => r.result !== 'ok');
  console.log(`${report.length} buttons clicked; ${bad.length} to look at`); for (const r of bad) console.log(JSON.stringify(r));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
