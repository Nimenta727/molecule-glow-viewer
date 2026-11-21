// Makes the hemoglobin work (a static "structure split" work) with the platform itself, step by step, the way a person would in the Studio: the PDB entry 2HHB is added to the template library
// ("我的模板" -> 从 PDB 添加), a new work is made from that template, its parts are named, notes and evidence are written, a camera bookmark is saved, the publication block is filled in and checked, and
// the package is exported. Nothing is edited by hand afterwards. Usage: node tools/make-hemoglobin-work.cjs <out-dir> [structures-dir]   (Playwright with Chromium; 2HHB.cif in the structures dir stands in for the RCSB download)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = path.resolve(process.argv[2] || path.join(ROOT, 'workshop/community/packs')), FIXTURES = path.resolve(process.argv[3] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
// What the file says (checked by the card reader, plugins/templates/structure-card.mjs): entity 1 = alpha chain, 141 residues, chains A and C; entity 2 = beta chain, 146 residues, chains B and D; four HEM (E, G, H, J), two PO4 (F, I).
// Studio lists the parts as preview-1..10 = chains A B C D then the ligand chains E F G H I J, in file order.
const PARTS = [['α1 链（A，141 个残基）', 'α 链：文件里有两条（链 A 和链 C），各 141 个残基。'], ['β1 链（B，146 个残基）', 'β 链：文件里有两条（链 B 和链 D），各 146 个残基。'], ['α2 链（C）', null], ['β2 链（D）', null],
  ['血红素 · α1（E）', '血红素（HEM，原卟啉 IX 含铁）：文件里共 4 个（E、G、H、J），每个亚基抱着一个。氧结合在铁原子上——这是背景知识，不是这个文件测出来的。'], ['磷酸根（F）', '磷酸根（PO₄）：文件里列出 2 个（F、I）。它们为什么在晶体里，文件没有说明。'],
  ['血红素 · β1（G）', null], ['血红素 · α2（H）', null], ['磷酸根（I）', null], ['血红素 · β2（J）', null]];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
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
  const story = async () => { await page.click('#tab-story'); await page.evaluate(() => document.querySelectorAll('#pane-story details').forEach((d) => { d.open = true; })); };   // the story sections are collapsed by default
  await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForSelector('#workshop', { timeout: 30000 }); await page.waitForTimeout(1200);

  // 1. the template (layer 1): the PDB entry, original file, from the workshop's "我的模板"
  await page.click('#workshop'); await page.waitForSelector('.workshop-card'); await page.click('#workshop-tab-mine'); await page.waitForSelector('.workshop-template-form');
  await page.evaluate(() => { document.querySelector('.workshop-template-form').open = true; });
  await page.fill('input[aria-label="PDB 编号"]', '2hhb'); await page.click('button:has-text("从 PDB 添加")');
  await page.waitForSelector('.workshop-template', { timeout: 60000 });
  const card = await page.locator('.workshop-template').first().innerText();
  for (const word of ['X-RAY DIFFRACTION', '1.74 Å', 'Homo sapiens', 'HEMOGLOBIN (DEOXY) (ALPHA CHAIN) 141 aa ×2', 'HEMOGLOBIN (DEOXY) (BETA CHAIN) 146 aa ×2', 'HEM ×4', 'CC0']) assert.ok(card.includes(word), `the template card shows ${word}`);
  // 2. a work (layer 2) made from the template
  await page.locator('.workshop-template button', { hasText: '用此模板新建作品' }).click();
  await page.waitForFunction(() => /已用模板/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length === 10, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  await page.fill('#scene-title', '血红蛋白：四个亚基与四个血红素'); await page.press('#scene-title', 'Enter'); await page.waitForTimeout(300);
  // 3. name the ten parts and write what the file says about them
  const row = (i) => page.locator('#scene-tree li').nth(i).locator('button').first();
  for (let i = 0; i < PARTS.length; i++) {
    await row(i).click(); await page.fill('#node-name', PARTS[i][0]); await page.press('#node-name', 'Enter'); await page.waitForTimeout(150);
    if (PARTS[i][1]) { await story(); await page.fill('#annotation', PARTS[i][1]); await page.click('#add-annotation'); await page.click('#tab-properties'); }
  }
  const names = await page.$$eval('#scene-tree li', (l) => l.map((li) => li.querySelector('button').textContent)); assert.deepEqual(names, PARTS.map((p) => p[0]), 'all ten parts are named');
  // 4. the story tab: the evidence and a camera bookmark
  await story();   // (a note belongs to the selected part, so there is no whole-scene note here: the overview lives in the description and the evidence)
  await page.selectOption('#evidence-kind', 'source'); await page.fill('#citation', '2HHB：人脱氧血红蛋白晶体结构，1.74 Å，X 射线衍射（Fermi G, Perutz MF, Shaanan B, Fourme R. J Mol Biol 175:159–174, 1984；doi:10.1016/0022-2836(84)90472-8）。坐标取自 RCSB PDB（CC0），原样使用，没有修改。'); await page.click('#add-evidence');
  await page.selectOption('#evidence-kind', 'illustrative'); await page.fill('#citation', '各部分的名称是教学表达；形状与位置都是原文件的坐标。“氧结合在血红素铁上”是通行的背景知识，不是这个条目测得的内容。'); await page.click('#add-evidence');
  await page.fill('#bookmark-name', '全貌'); await page.click('#add-bookmark'); await page.waitForTimeout(300);
  // 5. publication
  await page.click('#tab-publish'); await page.click('#pub-catalog'); await page.waitForFunction(() => /已读取工坊目录/.test(document.querySelector('#pub-note').textContent), null, { timeout: 20000 });
  await page.fill('#pub-author', 'Molecule Glow 项目'); await page.selectOption('#pub-license', 'CC-BY-4.0'); await page.selectOption('#pub-topic', 'protein');
  await page.fill('#pub-description', '人脱氧血红蛋白（2HHB，1.74 Å）的组成拆分：两条 α 链、两条 β 链、四个血红素和两个磷酸根，每一部分都命名并附上文件里写的事实。静态，不带动画。'); await page.fill('#pub-tags', '血红蛋白, 四级结构, 血红素, X射线晶体学'); await page.click('#pub-today');
  await page.click('#pub-check'); await page.waitForTimeout(500);
  const note = await page.$eval('#pub-note', (n) => n.textContent), problems = await page.$$eval('#pub-results li', (l) => l.map((x) => x.textContent)); console.log('check:', note, JSON.stringify(problems));
  assert.match(note, /检查通过/);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#pub-export')]);
  fs.mkdirSync(OUT, { recursive: true }); const target = path.join(OUT, download.suggestedFilename()); await download.saveAs(target); console.log('exported', target, fs.statSync(target).size, 'bytes');
  await page.click('#tab-properties'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(ROOT, 'docs/images/studio-hemoglobin-work.png') });
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('hemoglobin work: made');
})().catch((e) => { console.error(e); process.exit(1); });
