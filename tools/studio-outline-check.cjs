// Real-browser check of the Studio outline (4.3.2): multi-select (Ctrl-click, Shift-click), group and delete of a selection, drag and drop to re-parent (rows and scene root),
// a refused cycle, and one undo per drop. Usage: node tools/studio-outline-check.cjs   (Playwright with Chromium; no server process; the repository is served by request interception)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForSelector('#add-box', { timeout: 30000 }); await page.waitForTimeout(1500);
  const rows = () => page.$$eval('#scene-tree li', (l) => l.map((li) => ({ id: li.dataset.nodeId, name: li.querySelector('button').textContent, depth: Math.round(parseFloat(li.style.paddingInlineStart) / 0.85) || 0, on: li.querySelector('button').getAttribute('aria-pressed') === 'true' })));
  const row = (i) => page.locator('#scene-tree li').nth(i);
  const base = (await rows()).length;
  await page.click('#add-box'); await page.click('#add-box'); await page.click('#add-sphere');   // three new objects after whatever the starter scene has
  let r = await rows(); assert.equal(r.length, base + 3);
  const [b1, b2, s1] = [base, base + 1, base + 2];

  // multi-select
  await row(b1).locator('button').click(); await row(b2).locator('button').click({ modifiers: ['Control'] });
  r = await rows(); assert.deepEqual([r[b1].on, r[b2].on, r[s1].on], [true, true, false], 'ctrl-click adds a row');
  await row(s1).locator('button').click({ modifiers: ['Shift'] });
  r = await rows(); assert.deepEqual([r[b1].on, r[b2].on, r[s1].on], [false, true, true], 'shift-click selects the range from the anchor (the last ctrl-clicked row) to the row');
  await row(b1).locator('button').click(); await row(s1).locator('button').click({ modifiers: ['Control'] });
  r = await rows(); assert.deepEqual([r[b1].on, r[b2].on, r[s1].on], [true, false, true], 'a plain click starts over; ctrl-click adds');

  // group the selection (b1 + s1): one group, both inside, one undo step
  await page.click('#group-node'); r = await rows();
  const group = r.find((x) => x.name === '组'); assert.ok(group, 'a group was made');
  const gi = r.indexOf(group); assert.deepEqual([r[gi + 1].depth, r[gi + 2].depth], [group.depth + 1, group.depth + 1], 'both selected rows are inside the group');
  await page.click('#undo'); r = await rows(); assert.equal(r.length, base + 3, 'one undo takes the whole grouping back'); assert.ok(!r.find((x) => x.name === '组'));
  await page.click('#redo'); r = await rows(); assert.ok(r.find((x) => x.name === '组'));

  // drag the loose box (b2) onto the group row: it becomes a child; undo once reverts
  r = await rows(); const loose = r.findIndex((x) => x.id && x.depth === 0 && x.name === '方盒' && r.indexOf(x) >= base); const groupRow = r.findIndex((x) => x.name === '组');
  await row(loose).dragTo(row(groupRow)); await page.waitForTimeout(300); r = await rows();
  const g2 = r.findIndex((x) => x.name === '组'); const childDepths = r.slice(g2 + 1, g2 + 4).map((x) => x.depth);
  assert.deepEqual(childDepths, [r[g2].depth + 1, r[g2].depth + 1, r[g2].depth + 1], 'the dropped row is now inside the group (three children)');
  await page.click('#undo'); r = await rows(); assert.equal(r.slice(r.findIndex((x) => x.name === '组') + 1).filter((x) => x.depth > r[r.findIndex((y) => y.name === '组')].depth).length, 2, 'one undo reverts the drop');
  await page.click('#redo');

  // refused: the group onto its own child
  r = await rows(); const gIdx = r.findIndex((x) => x.name === '组');
  await row(gIdx).dragTo(row(gIdx + 1)); await page.waitForTimeout(300);
  assert.match(await page.$eval('#status', (n) => n.textContent), /自己或它的子对象/, 'a cycle is refused and says why');

  // drop on the empty part of the list = scene root: take a child out of the group
  r = await rows(); const gDepth = r[r.findIndex((x) => x.name === '组')].depth, child = r.findIndex((x, i) => i > r.findIndex((y) => y.name === '组') && x.depth === gDepth + 1);
  const box = await page.locator('#scene-tree').boundingBox();
  await row(child).dragTo(page.locator('#scene-tree'), { targetPosition: { x: box.width / 2, y: box.height - 3 } }); await page.waitForTimeout(300);
  r = await rows(); assert.equal(r.filter((x) => x.depth > gDepth).length, 2, 'one child went back to the root');

  // delete a selection: one undo brings all back
  await row(b1).locator('button').click(); await row(b2).locator('button').click({ modifiers: ['Control'] }); const before = (await rows()).length;
  await page.click('#remove-node'); const after = (await rows()).length; assert.ok(after < before, 'selected rows were deleted');
  await page.click('#undo'); assert.equal((await rows()).length, before, 'one undo brings them back');
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: outline multi-select, group, delete and drag-and-drop re-parenting');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
