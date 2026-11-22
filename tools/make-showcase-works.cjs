// Makes three showcase works with the Studio's command interface only (window.studio — no button is clicked), one for each look pack family, and writes them as scene packages:
//   1. the 70S ribosome (4V9H; the 4V6F file is over the 32 MiB limit of a scene package) as two atomic surfaces on the dark "cell interior" look
//   2. human haemoglobin (2HHB): the four chains as surfaces on the warm look, with the alpha/beta interface analysed and recorded
//   3. adenylate kinase, open (4AKE) and closed (1AKE) on one scene, core domains superposed, on the white paper look
// Each work says what is computed and what is not; every analysis result is derived evidence. Usage: node tools/make-showcase-works.cjs <out-dir> [structures-dir]
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = path.resolve(process.argv[2] || path.join(ROOT, 'workshop/community/packs')), FIX = path.resolve(process.argv[3] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const AUTHOR = { author: 'Molecule Glow 项目', license: 'CC-BY-4.0', updated: new Date().toISOString().slice(0, 10) };
setTimeout(() => { console.error('the builder hung'); process.exit(1); }, 1500000).unref?.();
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  async function work(name, build) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
      if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
      if (rcsb) { const f = path.join(FIX, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'nf' }); }
      if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForFunction(() => window.studio, null, { timeout: 30000 });
    const call = async (cmd, ...args) => { const r = await page.evaluate(([n, a]) => window.studio[n](...a).then((v) => ({ ok: v }), (e) => ({ error: e.message })), [cmd, args]); assert.ok(!r.error, `${name}: ${cmd}: ${r.error}`); return r.ok; };
    await build(call);
    const exported = await call('exportScene'), file = path.join(OUT, `${name}.glow`); fs.writeFileSync(file, Buffer.from(exported.data, 'base64'));
    const shot = await call('snapshot', { width: 1600 }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
    assert.deepEqual(errors, [], `${name}: no page errors`); console.log(name, exported.bytes, 'bytes'); await context.close();
  }

  await work('ribosome-70s-dark', async (call) => {
    const info = await call('import', { pdb: '4V9H' }), all = info.structures[0].chains, groups = new Set(all.map((c) => c[0])), chains = all.filter((c) => c[0] === all[0][0]), one = `chain ${chains.join(',')}`;
    await call('title', '70S 核糖体（4V9H）：暗场里的 rRNA 与核糖体蛋白');
    await call('part', 'all', false);   // only the two surfaces are drawn
    const rna = await call('surface', `(${one}) and nucleic`, 'plain', '#d92f1c'), protein = await call('surface', `(${one}) and protein`, 'plain', '#b04df5');
    await call('lookPack', 'glow.cell-dark', { recolor: false }); await call('camera', { focus: one, margin: 1.2 });
    const comp = await call('composition', { part: `(${one}) and protein`, write: ['record'] });
    await call('cameraKey', { time: 0 }); const cam = (await call('camera')).camera; await call('camera', { position: [cam.position[2], cam.position[1], -cam.position[0]], target: cam.target }); await call('cameraKey', { time: 8 }); await call('camera', { position: cam.position, target: cam.target });
    await call('note', `4V9H 文件里的链分成 ${groups.size} 组（按链名首字母），这里只画第一组（${chains.length} 条链）。红色是 rRNA（${rna.surface.atoms} 个原子），紫色是核糖体蛋白（${protein.surface.atoms} 个原子）。`);
    await call('note', `表面是高斯分子表面（近似溶剂排除面，网格 ${rna.surface.resolution} Å，比小蛋白粗），不是严格的 SES；颜色按类别（核酸红、蛋白紫），不表示任何数值。蛋白部分共 ${comp.residues} 个残基。`);
    await call('note', '光影（深蓝暗场、环境遮蔽、轮廓光、景深）只改外观，不改坐标；“推导”证据里写明了表面的方法和限制。');
    await call('publication', { ...AUTHOR, topic: 'protein', description: '70S 核糖体（4V9H）的两层原子级表面：rRNA 红、蛋白紫，暗场光影。', tags: ['核糖体', '表面', '暗场'] });
  });

  await work('hemoglobin-surface-warm', async (call) => {
    await call('import', { pdb: '2HHB' }); await call('title', '血红蛋白（2HHB）：α、β 亚基的表面与界面');
    await call('part', 'all', false);
    await call('surface', 'chain A,C', 'plain', '#e6cfa9'); await call('surface', 'chain B,D', 'plain', '#c98a5a');
    await call('lookPack', 'glow.active-site-warm', { recolor: false }); await call('camera', { focus: 'all', margin: 1.15 });
    const contacts = await call('contacts', { a: 'chain A', b: 'chain B', write: ['record'] });
    const comp = await call('composition', { part: 'chain A,B,C,D', write: ['record'] });
    const sec = await call('secondary', { part: 'chain A,B,C,D', write: ['record'] });
    await call('note', `浅色是 α 链（A、C），深色是 β 链（B、D）。血红素和磷酸根没有画出。`);
    await call('note', `α1 与 β1 之间：${contacts.pairs} 对残基接触（重原子 ≤ ${contacts.cutoff} Å），盐桥 ${contacts.counts.salt}、氢键 ${contacts.counts.hbond}、疏水接触 ${contacts.counts.hydrophobic}——只用距离判据，没有氢原子和角度，是筛查不是结论。`);
    await call('note', `四条链共 ${comp.residues} 个残基，平均亲水性 GRAVY ${comp.gravy}，按个数数出的净电荷 ${comp.netCharge}（不含 pKa 与环境）。二级结构是文件登记的，螺旋占比约 ${sec.chains.map((c) => c.helixPercent).join('、')}%（A、B、C、D）。`);
    await call('cameraKey', { time: 0 }); const cam = (await call('camera')).camera; await call('camera', { position: [-cam.position[0], cam.position[1], cam.position[2]], target: cam.target }); await call('cameraKey', { time: 6 }); await call('camera', { position: cam.position, target: cam.target });
    await call('publication', { ...AUTHOR, topic: 'protein', description: '人脱氧血红蛋白（2HHB）四聚体：α/β 亚基的表面、亚基间界面的距离分析和组成统计，暖色光影。', tags: ['血红蛋白', '界面', '表面'] });
  });

  await work('adenylate-kinase-open-closed-paper', async (call) => {
    await call('import', { pdb: '4AKE' }); const added = await call('addStructure', { pdb: '1AKE' }), [open, closed] = added.structures.map((s) => s.id);
    await call('title', '腺苷酸激酶：开放态（4AKE）与闭合态（1AKE）的核心域叠合');
    const CORE = 'chain A and (resi 1-29 or resi 60-121 or resi 160-214)';
    const fit = await call('superpose', { mobile: CORE, reference: CORE, mobileStructure: open, referenceStructure: closed, write: ['place', 'mark', 'record'] });
    // 1AKE is expanded to its biological assembly on import (chains A, B, A, B): keep only the first chain A of the closed form, and chain A of the open form
    const listed = (await call('parts')).parts, keep = new Set([listed.find((p) => p.structure === closed && p.chain === 'A').id, listed.find((p) => p.structure === open && p.chain === 'A').id]);
    for (const p of listed) if (!keep.has(p.id)) await call('part', `node:${p.id}`, false);
    await call('lookPack', 'paper.clean-white', { recolor: false }); await call('color', 'protein and not nucleic', '#3e6fc4'); await call('color', 'protein and not nucleic', '#e0782f', { structure: closed });   // open form blue, closed form orange
    await call('camera', { focus: 'chain A', structure: closed, margin: 1.3 });
    await call('note', '蓝色是开放态（4AKE），橙色是闭合态（1AKE）；颜色只区分是哪个结构。');
    await call('note', `核心域（残基 1–29、60–121、160–214，${fit.pairs} 对 Cα）叠合后 RMSD ${fit.rmsd} Å（叠合前 ${fit.rmsdBefore} Å 没有意义：两个文件各在自己的坐标系里）。`);
    await call('note', `叠合后偏差超过 2 Å 的 ${fit.farResidues} 个残基（开放态一侧）标为红色，应当主要在盖子域和 NMP 结合域——这是两态之间运动的部分（这一点是按已知的结构域运动写的，没有在这里单独验证）。核心域的划分是经验选择，未经专业审阅。`);
    await call('note', '叠合只用 Cα、不迭代剔除离群点；位置是计算出来的，不是测得的。1AKE 的生物组装体展开后链名重复（A、B、A、B），这里只对链 A 做了叠合，画面里只留下两个结构各自的链 A（其余链和拷贝已隐藏）。');
    await call('publication', { ...AUTHOR, topic: 'protein', description: '腺苷酸激酶开放态（4AKE）与闭合态（1AKE）的核心域叠合：RMSD 和偏差大的残基，白底论文光影。', tags: ['腺苷酸激酶', '构象', '叠合'] });
  });
  await browser.close(); console.log('showcase works written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
