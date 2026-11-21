// GPU acceptance for a machine with a real graphics card. Opens the Viewer in Chromium with hardware acceleration, runs the workshop works and the platform commands that are heavy on the GPU,
// measures the real frame rate of each scene with glow.benchmark(), takes a screenshot of each, and writes report.json + report.md + screenshots to the output folder. It never stops at the first
// failure: every phase is recorded, so one run says everything that is wrong. It REFUSES to call a run a pass when WebGL turns out to be a software renderer (SwiftShader / llvmpipe / "Microsoft Basic Render").
//
//   node tools/gpu-acceptance.cjs [--out <dir>] [--headless] [--only <name,name>] [--fixtures <dir>] [--software]
//
//   --out       output folder (default gpu-acceptance-out)                  --headless  no visible window (the default is a visible window: closest to real use)
//   --only      run only the named phases (gpu, hemoglobin, atp-synthase, respiratory-chain, translation, flagellar-motor, whole-cell, chloroplast-light, instancing, embed, commands)
//   --fixtures  folder with pinned PDB files (node tools/fetch-smoke-structures.mjs --dir ...); without it the real RCSB is used (needs the network)
//   --software  allow software rendering (for testing this script on a machine without a GPU); the verdict then says "NOT A GPU RUN"
// Needs: Node 20+, `npm ci`, `npm ci --prefix desktop` (the vendored Three.js), and Playwright with Chromium (`npx playwright install chromium`).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] ?? true) : fallback; };
const OUT = path.resolve(arg('--out', 'gpu-acceptance-out')), HEADLESS = process.argv.includes('--headless'), SOFTWARE_OK = process.argv.includes('--software');
const FIXTURES = arg('--fixtures') ? path.resolve(arg('--fixtures')) : null, ONLY = arg('--only') ? String(arg('--only')).split(',') : null;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
fs.mkdirSync(OUT, { recursive: true });

const communityWork = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/community/index.json'), 'utf8')).packs.find((p) => /^2hhb-/.test(p.id))?.id ?? null; } catch { return null; } };
const WORKS = { hemoglobin: communityWork(), 'atp-synthase': 'official.atp-synthase.work', 'respiratory-chain': 'official.respiratory-chain.work', translation: 'official.translation.work', 'flagellar-motor': 'official.flagellar-motor.work',
  'whole-cell': 'official.whole-cell.work', 'chloroplast-light': 'official.chloroplast-light.work' };
// the lighter scenes should hold 30 fps on any discrete card; the heavy ones are measured and reported, and only flagged
const MIN_FPS = { hemoglobin: 30, 'atp-synthase': 30, 'respiratory-chain': 30 };
const phases = [], errors = [];

(async () => {
  const launchArgs = SOFTWARE_OK ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser = await chromium.launch({ headless: HEADLESS, args: launchArgs });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)); return f ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = FIXTURES && path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); return f && fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.continue(); }   // the real RCSB
    if (/^https:\/\/(data\.rcsb\.org|rest\.uniprot\.org)\//.test(url.href)) return route.continue();
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });

  async function open(query = '') {
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(`${query || 'start'}: ${e.message}`));
    await page.goto(`${ORIGIN}/apps/viewer-web/index.html?startup=skip${query}`); await page.waitForFunction(() => window.glow, null, { timeout: 60000 }); return page;
  }
  const bench = (page, seconds = 3) => page.evaluate((s) => window.glow.benchmark({ seconds: s, targetFps: 30 }), seconds);
  const summary = (r) => ({ renderer: r.renderer, software: r.software, fps: r.stats ? +r.stats.fps.toFixed(1) : null, p95Ms: r.stats ? +r.stats.p95Ms.toFixed(1) : null, triangles: r.triangles, budget: r.budget, tier: r.tier });
  async function phase(name, work) {
    if (ONLY && !ONLY.includes(name)) return;
    const started = Date.now(), entry = { name, ok: false, notes: [] }; console.log(`\n== ${name}`);
    try { Object.assign(entry, await work(entry)); entry.ok = entry.ok !== false && !entry.failure; }
    catch (error) { entry.failure = error.message.split('\n')[0]; }
    entry.seconds = +((Date.now() - started) / 1000).toFixed(1); phases.push(entry);
    console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${name}${entry.failure ? ' — ' + entry.failure : ''}${entry.fps != null ? ` (${entry.fps} fps, ${entry.renderer})` : ''}`);
  }
  const shot = async (page, name) => { const file = `${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); return file; };
  const heavy = async (name, query, ready, { settle = 4000, after } = {}) => phase(name, async (entry) => {
    if (query === null) throw new Error('这个作品不在本机工坊目录里（社区区没有血红蛋白作品？）');
    const page = await open(query); await page.waitForFunction(ready, null, { timeout: 240000 }); await page.waitForTimeout(settle); if (after) await after(page);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const report = await bench(page), s = summary(report); Object.assign(entry, s); entry.screenshot = await shot(page, name);
    if (report.software && !SOFTWARE_OK) throw new Error(`WebGL 是软件渲染器（${report.renderer}）：没有用到显卡`);
    const min = MIN_FPS[name]; if (min && s.fps < min) entry.notes.push(`帧率 ${s.fps} 低于这个场景的预期 ${min}`), entry.ok = false, entry.failure = `帧率 ${s.fps} < ${min}`;
    else if (s.fps != null && s.fps < 15) entry.notes.push(`帧率 ${s.fps}，低于 15：这个场景在这张卡上偏重`);
    await page.close(); return {};
  });

  // ---- 1. is the GPU really used? ---------------------------------------------------------------------------------------------------------------------------
  await phase('gpu', async (entry) => {
    const page = await open(); await page.evaluate(() => window.glow.load({ pdb: '6N2Y' })); await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(2500);
    const report = await bench(page, 4), s = summary(report); Object.assign(entry, s); entry.advice = report.advice; entry.screenshot = await shot(page, 'gpu');
    entry.gl = await page.evaluate(() => { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? { version: gl.getParameter(gl.VERSION), vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : null, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) } : null; });
    if (report.software && !SOFTWARE_OK) throw new Error(`WebGL 是软件渲染器（${report.renderer}）：没有用到显卡。检查显卡驱动、浏览器的硬件加速设置，或换用 --headless 以外的模式再试`);
    if (report.software) entry.notes.push('软件渲染（--software）：这次不是显卡验收');
    await page.close(); return {};
  });

  // ---- 2. the workshop works ------------------------------------------------------------------------------------------------------------------------------------
  await heavy('hemoglobin', WORKS.hemoglobin && `&work=${WORKS.hemoglobin}`, () => /血红蛋白/.test(document.body.innerText));
  await heavy('atp-synthase', `&work=${WORKS['atp-synthase']}`, () => document.querySelector('#play') && !document.querySelector('#play').disabled);
  await heavy('respiratory-chain', `&work=${WORKS['respiratory-chain']}`, () => document.querySelector('#data-play') && document.querySelector('#data-play').offsetParent !== null || /呼吸链/.test(document.body.innerText), { settle: 6000 });
  await heavy('translation', `&work=${WORKS.translation}`, () => /因子与抗生素结构就绪/.test(document.querySelector('#status')?.textContent ?? ''), { settle: 6000,
    after: async (page) => { await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); document.querySelector('#process-play')?.click(); }); await page.waitForTimeout(8000); } });
  await heavy('flagellar-motor', `&work=${WORKS['flagellar-motor']}`, () => document.querySelector('#play') && !document.querySelector('#play').disabled, { settle: 6000 });
  await heavy('whole-cell', `&work=${WORKS['whole-cell']}`, () => document.querySelector('#play') && !document.querySelector('#play').disabled, { settle: 8000 });
  await heavy('chloroplast-light', `&work=${WORKS['chloroplast-light']}`, () => /叶绿体|光反应/.test(document.body.innerText), { settle: 6000 });

  // ---- 3. instancing with levels of detail ----------------------------------------------------------------------------------------------------------------------
  await phase('instancing', async (entry) => {
    const page = await open(); await page.evaluate(() => window.glow.load({ pdb: '6N2Y' })); await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(2500);
    const rows = [];
    for (const copies of [100, 400, 2000]) {
      const made = await page.evaluate((n) => window.glow.instances({ copies: n, layout: 'sphere' }), copies); await page.waitForTimeout(1500);
      const r = await bench(page, 3); rows.push({ copies, ...summary(r), levels: made.levels?.length ?? null, withoutLod: made.trianglesWithoutLod ?? null }); entry.screenshot = await shot(page, `instancing-${copies}`);
    }
    entry.rows = rows; entry.fps = rows.at(-1).fps; entry.renderer = rows[0].renderer; entry.software = rows[0].software; entry.notes.push(...rows.map((r) => `${r.copies} 份：${r.fps} fps，${r.triangles} 个三角形`));
    if (rows.some((r) => r.software) && !SOFTWARE_OK) throw new Error('软件渲染');
    await page.evaluate(() => window.glow.instances(null)); await page.close(); return {};
  });

  // ---- 4. membrane embedding -----------------------------------------------------------------------------------------------------------------------------------
  await phase('embed', async (entry) => {
    const page = await open(); await page.evaluate(() => window.glow.load({ pdb: '1K4C', assembly: true })); await page.waitForTimeout(3000); const rows = [];
    for (const copies of [40, 400]) {
      const made = await page.evaluate((n) => window.glow.embed({ shape: { kind: 'sphere', radius: 600 }, copies: n, seed: 3 }), copies); await page.waitForTimeout(1500);
      const r = await bench(page, 3); rows.push({ copies, placed: made.placed, thickness: made.membrane.thicknessFromStructure, ...summary(r) }); entry.screenshot = await shot(page, `embed-${copies}`);
    }
    entry.rows = rows; entry.fps = rows.at(-1).fps; entry.renderer = rows[0].renderer; entry.software = rows[0].software; entry.notes.push(...rows.map((r) => `${r.placed} 份嵌入膜（膜厚 ${r.thickness} Å）：${r.fps} fps`));
    if (rows.some((r) => r.software) && !SOFTWARE_OK) throw new Error('软件渲染');
    await page.close(); return {};
  });

  // ---- 5. the new commands run (their numbers are checked in the repository's own tests; here only: no errors, on this machine) ----------------------------------
  await phase('commands', async (entry) => {
    const page = await open(); await page.evaluate(() => window.glow.load({ pdb: '4AKE' })); await page.waitForTimeout(2500); const done = [];
    const run = async (name, arg) => { const r = await page.evaluate(([n, a]) => window.glow[n](a).then((v) => ({ ok: v }), (e) => ({ error: e.message })), [name, arg]); if (r.error) throw new Error(`${name}: ${r.error}`); done.push(name); return r.ok; };
    await run('complex', { record: true }); await run('interactions', {}); await run('compose', { region: { kind: 'sphere', radius: 500 }, components: [{ id: 'a', copies: 200, radius: 20 }, { id: 'b', copies: 400, radius: 10 }], seed: 2 }); await run('compose', null);
    const b = await run('binding', { box: 60, particles: 40, D: 100, radius: 2, microseconds: 60, dt: 0.002, seed: 4, reinject: true }); entry.notes.push(`结合速率 / Smoluchowski = ${b.ratio.toFixed(2)}`);
    entry.commands = done; await page.close(); return {};
  });

  await browser.close();
  // ---- report ---------------------------------------------------------------------------------------------------------------------------------------------------------
  const gpu = phases.find((p) => p.name === 'gpu'), software = phases.some((p) => p.software) || (gpu && gpu.software);
  const failed = phases.filter((p) => !p.ok), verdict = software ? 'NOT A GPU RUN（软件渲染）' : failed.length ? `FAIL（${failed.length} 项未通过）` : 'PASS';
  const report = { verdict, when: new Date().toISOString(), machine: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version }, gpu: gpu ? { renderer: gpu.renderer, gl: gpu.gl, software: gpu.software, tier: gpu.tier, budgetTrianglesPerFrame: gpu.budget } : null, phases, pageErrors: errors };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = [`# GPU 验收报告：${verdict}`, '', `- 时间：${report.when}`, `- 系统：${report.machine.os}；CPU：${report.machine.cpu}；内存：${report.machine.memoryGB} GB；Node ${report.machine.node}`,
    `- 渲染器：${gpu?.renderer ?? '未知'}${gpu?.gl ? `（WebGL：${gpu.gl.vendor ?? '?'} / ${gpu.gl.renderer ?? '?'}，最大贴图 ${gpu.gl.maxTexture}）` : ''}`, `- 这张卡能保持 30 fps 的每帧三角形预算：${gpu?.budget ?? '未知'}（档位：${gpu?.tier ?? '未知'}）`, '',
    '| 项 | 结果 | 帧率 | 三角形 | 备注 |', '|---|---|---|---|---|', ...phases.map((p) => `| ${p.name} | ${p.ok ? '通过' : '**未通过**'} | ${p.fps ?? ''} | ${p.triangles ?? ''} | ${[p.failure, ...(p.notes ?? [])].filter(Boolean).join('；')} |`), '',
    errors.length ? `页面报错（${errors.length}）：\n${errors.slice(0, 10).map((e) => `- ${e}`).join('\n')}` : '页面没有报错。', '', '截图都在同一个文件夹里（每个场景一张）。**帧率只说明“跑得动”；画面对不对、看着顺不顺，要人来看截图和实际操作。**'];
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
  console.log(`\n${md.join('\n')}\n\nreport: ${path.join(OUT, 'report.md')}`); process.exit(software || failed.length ? 1 : 0);
})().catch((error) => { console.error('gpu-acceptance crashed:', error); process.exit(2); });
