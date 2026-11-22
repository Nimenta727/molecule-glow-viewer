// Makes the bacteriophage T7 static works with the Studio command interface only (window.studio).
//   t7-virion-cutaway   the assembled virion from `tools/build-phage-model.py` (head shell 3J7X + portal-tail 9JYZ + core 9JYY + genome spool), cut open side-on
//   t7-capsid-gp10a     the major capsid protein gp10A, the 7-chain asymmetric unit of the mature capsid (3J7X)
//   t7-portal-tail      the portal-tail complex of the mature phage (9JYZ)
//   t7-core-proteins    the internal core proteins of the mature phage (9JYY)
// Usage: node tools/make-phage-works.cjs <out-dir> <phage-dir>   (phage-dir holds 3J7X.cif 9JYZ.cif 9JYY.cif and out/t7-virion-model.cif; ONLY=<name part> builds one)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = path.resolve(process.argv[2] || path.join(ROOT, 'workshop/community/packs')), DIR = path.resolve(process.argv[3] || '/tmp/phage');
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const AUTHOR = { author: 'Molecule Glow 项目', license: 'CC-BY-4.0', updated: new Date().toISOString().slice(0, 10) };
const PAPERS = {
  head: 'Guo F. 等，PNAS 2014，111(43):E4606（噬菌体 T7 衣壳膨胀的多状态原子模型；成熟衣壳 PDB 3J7X，3.6 Å）',
  tail: 'T7 成熟噬菌体门户-尾部复合体 PDB 9JYZ（2.7 Å）、核心蛋白 PDB 9JYY（3.0 Å），J. Virol. 2025',
  old: 'Cuervo A. 等，Nat. Commun. 2019，10:3746（T7 门户和尾部复合体 gp8-gp11-gp12 的结构）',
};
setTimeout(() => { console.error('the builder hung'); process.exit(1); }, 3300000).unref?.();
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  async function work(name, build) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
      if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
      if (rcsb) { const f = path.join(DIR, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'nf' }); }
      if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForFunction(() => window.studio, null, { timeout: 30000 });
    const call = async (cmd, ...args) => { const r = await page.evaluate(([n, a]) => window.studio[n](...a).then((v) => ({ ok: v }), (e) => ({ error: e.message })), [cmd, args]); assert.ok(!r.error, `${name}: ${cmd}: ${r.error}`); return r.ok; };
    await build(call, page);
    await page.waitForTimeout(3000);
    const exported = await call('exportScene'), file = path.join(OUT, `${name}.glow`); fs.writeFileSync(file, Buffer.from(exported.data, 'base64'));
    const shot = await call('snapshot', { width: 1600 }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
    assert.deepEqual(errors, [], `${name}: no page errors`); console.log(name, exported.bytes, 'bytes'); await context.close();
  }
  const sideOn = async (call, focus) => {   // look along -x so the z axis (tail axis) runs across the picture
    await call('camera', { focus, margin: 1.05 }); const c = (await call('camera')).camera, t = c.target, d = Math.hypot(c.position[0] - t[0], c.position[1] - t[1], c.position[2] - t[2]);
    await call('camera', { position: [t[0] + d, t[1], t[2]], target: t });
  };

  await work('t7-virion-cutaway', async (call, page) => {
    const text = fs.readFileSync(path.join(DIR, 'out/t7-virion-model.cif'), 'utf8');
    const info = await call('import', { name: 't7-virion-model.cif', text }), chains = info.structures[0].chains, sel = (l) => 'chain ' + l.join(',');
    const tail = chains.filter((c) => c[0] === 'T'), core = chains.filter((c) => c[0] === 'C'), shell = chains.filter((c) => /^H\d\d$/.test(c)), dna = chains.filter((c) => /^G\d$/.test(c));
    await call('title', '噬菌体 T7 病毒颗粒（静态示意装配）：剖开的头部、核酸、内部核心与尾部');
    await call('part', 'all', false);
    const a = await call('surface', sel(shell), 'plain', '#5f7fc9', { inflate: 1.6 }), b = await call('surface', sel(tail), 'plain', '#e8b04a', { inflate: 0.6 }), c = await call('surface', sel(core), 'plain', '#3fbf9f', { inflate: 0.6 });
    await call('show', sel(dna), 'backbone'); await call('part', sel(dna), true); await call('color', sel(dna), '#e8472f');
    await call('lookPack', 'glow.cell-dark', { recolor: false });
    await sideOn(call, 'all'); await call('clip', { depth: 0 });
    await call('note', '蓝色：头部衣壳（415 个主衣壳蛋白 gp10A，T=7 二十面体；来自成熟衣壳 PDB 3J7X 的 7 条链，按 60 个二十面体对称操作展开，门户顶点处 5 个拷贝省去）。金色：门户-尾部复合体（9JYZ：门户 gp8、衔接蛋白 gp11、喷嘴 gp12、尾丝 gp17 等）。绿色：内部核心蛋白（9JYY：gp14、gp15、gp16 与 gp6.7）。红色：基因组 DNA 的骨架轨迹（39,937 bp）。');
    await call('note', '【实验结构】衣壳、门户-尾部、核心三部分的原子坐标均来自已发表的冷冻电镜结构，原样使用，未改动坐标。 【示意/假设】三部分之间的相对位置（核心放进头部、头部相对门户的距离）、DNA 的缠绕方式都是作图时的假设：核心的位置按“不碰撞且与门户相接”扫描选定，DNA 画成绕核心的同轴盘绕线轴（线轴模型），具体缠绕并非测得；序列没有表示。表面是高斯分子表面，不是严格的溶剂排除面。');
    await call('note', `来源：${PAPERS.head}；${PAPERS.tail}；${PAPERS.old}。门户-尾部和核心的两个结构来自同一份 2025 年成熟噬菌体工作。已知：头壳 gp10A 共 415 个拷贝；核心由 gp14、gp15（8 聚体环）与 gp16（4 聚体环）堆叠于门户之上（文献描述，8/4 重对称的归属在原文中有不确定之处）。`);
    await call('note', `本画面剖开面按镜头方向取过场景中心，只是为了看内部；剖面本身没有物理意义。表面三角面：头 ${a.surface.triangles}，尾 ${b.surface.triangles}，核心 ${c.surface.triangles}。`);
    await call('publication', { ...AUTHOR, topic: 'local-system', description: '噬菌体 T7 成熟病毒颗粒的静态示意装配：由已发表的冷冻电镜结构拼成，剖开显示核酸线轴与内部核心，位置关系为示意。', tags: ['噬菌体', 'T7', '病毒', '冷冻电镜', '示意装配'] });
  });

  await work('t7-capsid-gp10a', async (call) => {
    const info = await call('import', { pdb: '3J7X' }), chains = info.structures[0].chains;
    await call('title', 'T7 噬菌体成熟衣壳的主衣壳蛋白 gp10A（3J7X 不对称单元，7 个亚基）');
    await call('part', 'all', false);
    const pal = ['#5f7fc9', '#7a8fd8', '#4a6bb8', '#6f9fd8', '#5a7ac0', '#8296de', '#4f86c6'];
    for (let i = 0; i < 7; i++) await call('surface', `chain ${chains[i]}`, 'plain', pal[i]);   // one surface rule each (max rules permitting)
    await call('lookPack', 'glow.membrane-cool', { recolor: false }); await call('camera', { focus: 'all', margin: 1.2 });
    const comp = await call('composition', { part: 'protein', write: ['record'] }), sec = await call('secondary', { part: 'protein', write: ['record'] });
    await call('note', `主衣壳蛋白 gp10A：一个不对称单元含 7 个亚基（每个二十面体面的一个位置），共 ${comp.residues} 个残基；完整衣壳是 60 个这样的单元，共 415 个亚基（T=7）。颜色只区分亚基，不表示数值。`);
    await call('note', `二级结构按文件登记：螺旋占比约 ${sec.chains.map((c) => c.helixPercent).join('、')}%。整体是 HK97 型折叠（文献中的归类）。组成统计是按个数数的，没有 pKa 与环境。`);
    await call('note', `来源：${PAPERS.head}。注意 3J7W 是 DNA 包装中间体（capsid II），不是成熟衣壳；本作品用的是 3J7X。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 噬菌体成熟衣壳（3J7X）主衣壳蛋白 gp10A 的 7 个亚基表面。', tags: ['噬菌体', 'T7', '衣壳', 'gp10A'] });
  });

  await work('t7-portal-tail', async (call) => {
    const info = await call('import', { pdb: '9JYZ' }), chains = info.structures[0].chains;
    await call('title', 'T7 成熟噬菌体的门户-尾部复合体（9JYZ）');
    await call('part', 'all', false);
    const s = await call('structures'), ents = s.structures[0].entities ?? null;
    console.log('9JYZ chains', chains.length, JSON.stringify(ents)?.slice(0, 600));
    await call('surface', 'protein and not nucleic', 'plain', '#e8b04a');
    await call('lookPack', 'glow.active-site-warm', { recolor: false }); await call('camera', { focus: 'all', margin: 1.1 });
    const comp = await call('composition', { part: 'protein', write: ['record'] });
    await call('note', `门户-尾部复合体：${chains.length} 条链、${comp.residues} 个残基。文件里的组分有 gp8 门户、gp11 衔接蛋白、gp12 喷嘴、尾丝 gp17、gp6.7、gp7.3（以文件登记的名称为准）。`);
    await call('note', `来源：${PAPERS.tail}；早期结构 ${PAPERS.old}。本作品只用一种颜色画整体表面，尚未按组分分色。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 成熟噬菌体门户-尾部复合体（9JYZ）的分子表面。', tags: ['噬菌体', 'T7', '门户', '尾部'] });
  });

  await work('t7-core-proteins', async (call) => {
    const info = await call('import', { pdb: '9JYY' }), chains = info.structures[0].chains;
    await call('title', 'T7 成熟噬菌体的内部核心蛋白（9JYY：gp14、gp15、gp16、gp6.7）');
    await call('part', 'all', false);
    await call('surface', 'protein and not nucleic', 'plain', '#3fbf9f');
    await call('lookPack', 'glow.cell-dark', { recolor: false }); await call('camera', { focus: 'all', margin: 1.1 });
    const comp = await call('composition', { part: 'protein', write: ['record'] });
    await call('note', `核心蛋白复合体：${chains.length} 条链、${comp.residues} 个残基。文献描述核心由 gp16（4 聚体环）、gp15（8 聚体环）、gp14（8 聚体环）堆叠在门户之上，射出时经尾部通道进入宿主；其中 gp14 的对称归属在原文中不完全确定。`);
    await call('note', `来源：${PAPERS.tail}。单一颜色，尚未按组分分色。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 成熟噬菌体内部核心蛋白（9JYY）的分子表面。', tags: ['噬菌体', 'T7', '核心蛋白'] });
  });

  await browser.close(); console.log('phage works written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
