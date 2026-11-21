// Real-browser check of rewind and intervention on a data-animation work (the respiratory chain, whose compartment kinetics the interventions change): play, change a switch (an intervention is logged),
// play on, rewind with the time slider, come forward again and get exactly the same moment back (time, counters, kinetics read-outs), then change something in the past: the logged future is dropped and
// the panel says so. Software rendering runs only a few frames a second, so the animation is short; nothing here depends on speed. Screenshots of the panel go to the output directory.
// Usage: node tools/rewind-check.cjs [output-dir] [fixtures-dir]   (Playwright with Chromium; structures from node tools/fetch-smoke-structures.mjs; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/images')), FIXTURES = path.resolve(process.argv[3] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/apps/viewer-web/index.html?startup=skip&work=official.respiratory-chain.work`);
  await page.waitForFunction(() => document.querySelector('#data-play') && !document.querySelector('#data-play').closest('[hidden]'), null, { timeout: 150000 });
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const panel = page.locator('#data-controls');
  const seconds = async () => Number((await page.$eval('#data-time', (n) => n.textContent)).split('/')[1]);   // the furthest time reached
  const nowT = async () => Number((await page.$eval('#data-time', (n) => n.textContent)).split('/')[0]);
  const snapshot = async () => ({ t: await nowT(), counters: await page.$eval('#data-counters', (n) => n.innerText), kinetics: await page.$eval('#data-kinetics', (n) => n.innerText), log: await page.$$eval('#data-interventions li', (l) => l.map((x) => x.textContent)) });
  const runUntil = async (target) => { await page.check('#data-play'); await page.waitForFunction((t) => Number(document.querySelector('#data-time').textContent.split('/')[1]) >= t, target, { timeout: 120000 }); await page.uncheck('#data-play'); await page.waitForTimeout(300); };
  const seekTo = async (s) => { await page.$eval('#data-seek', (n, v) => { n.value = String(v); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, Math.round(s * 30)); await page.waitForTimeout(500); };

  await runUntil(2.0);
  const t0 = await seconds(); console.log('ran to', t0, 's');
  // an intervention: the "high energy use" switch (third switch)
  const switches = page.locator('#data-kinetics input[type=checkbox]');
  assert.equal(await switches.count(), 5, 'five switches: substrate, O2, high energy use, oligomycin, DNP');
  const before = await snapshot();
  await switches.nth(2).check(); await page.waitForTimeout(500);
  const afterSwitch = await snapshot();
  assert.equal(afterSwitch.log.length, 1, 'the switch is logged as one intervention'); assert.match(afterSwitch.log[0], /高耗能.*开/);
  assert.notEqual(afterSwitch.kinetics, before.kinetics, 'and it changed the read-outs');
  await runUntil(Math.ceil(t0) + 2.0);
  const forward = await snapshot(); const top = await seconds();
  await page.screenshot({ path: path.join(OUT, 'rewind-1-forward.png') });
  // rewind to before the intervention
  await seekTo(1.0);
  const rewound = await snapshot();
  assert.ok(Math.abs(rewound.t - 1.0) < 0.05, `the time slider goes back to 1.0 s (${rewound.t})`);
  assert.equal(await seconds(), top, 'the furthest time is remembered');
  assert.match(await page.$eval('#data-info', (n) => n.textContent), /现在在过去/, 'the panel says it is the past');
  assert.equal(await page.isDisabled('#data-forward'), false);
  await page.screenshot({ path: path.join(OUT, 'rewind-2-rewound.png') });
  // come forward again, exactly
  await seekTo(top);
  const again = await snapshot();
  assert.deepEqual(again, forward, 'coming forward to the same time gives exactly the same moment: time, counters, read-outs, logged interventions');
  // two small steps with the buttons
  await page.click('#data-back'); const stepped = await nowT(); assert.ok(stepped < top - 4.9 || stepped === 0, `back 5 s (${stepped})`);
  await page.click('#data-forward'); assert.equal(await nowT(), top, 'forward 5 s is capped at the furthest time');
  // change something in the past: the logged future ends
  await seekTo(1.0);
  await switches.nth(3).check(); await page.waitForTimeout(600);   // oligomycin, before the earlier intervention
  const edited = await snapshot();
  assert.match(await page.$eval('#data-info', (n) => n.textContent), /作废/, 'the panel says the later intervention record was dropped');
  assert.equal(edited.log.length, 1, 'only the new intervention is left'); assert.match(edited.log[0], /寡霉素/);
  assert.equal(await seconds(), edited.t, 'and the future that was is gone: the furthest time is now');
  await page.screenshot({ path: path.join(OUT, 'rewind-3-edited-past.png') });
  await panel.screenshot({ path: path.join(OUT, 'rewind-panel.png') });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: rewind and intervention on the respiratory chain work');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
