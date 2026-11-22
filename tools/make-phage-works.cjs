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
    const groups = [[0, 1, 2], [3, 4], [5, 6]], pal = ['#5f7fc9', '#7fa6e0', '#4a6bb8'];   // the surface rules are limited to 4: three colour groups of subunits
    for (let g = 0; g < groups.length; g++) await call('surface', `chain ${groups[g].map((i) => chains[i]).join(',')}`, 'plain', pal[g]);
    await call('lookPack', 'glow.membrane-cool', { recolor: false }); await call('camera', { focus: 'all', margin: 1.2 });
    { const c = (await call('camera')).camera, t = c.target, d = Math.hypot(c.position[0] - t[0], c.position[1] - t[1], c.position[2] - t[2]), n = Math.hypot(...t) || 1;   // look at the patch from outside the capsid, along the radius through it
      await call('camera', { position: [t[0] + (t[0] / n) * d, t[1] + (t[1] / n) * d, t[2] + (t[2] / n) * d], target: t }); }
    const comp = await call('composition', { part: 'protein', write: ['record'] }), sec = await call('secondary', { part: 'protein', write: ['record'] });
    await call('note', `主衣壳蛋白 gp10A：一个不对称单元含 7 个亚基（每个二十面体面的一个位置），共 ${comp.residues} 个残基；完整衣壳是 60 个这样的单元，共 415 个亚基（T=7）。颜色只区分亚基，不表示数值。`);
    await call('note', `二级结构按文件登记：螺旋占比约 ${sec.chains.map((c) => c.helixPercent).join('、')}%。整体是 HK97 型折叠（文献中的归类）。组成统计是按个数数的，没有 pKa 与环境。`);
    await call('note', `来源：${PAPERS.head}。注意 3J7W 是 DNA 包装中间体（capsid II），不是成熟衣壳；本作品用的是 3J7X。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 噬菌体成熟衣壳（3J7X）主衣壳蛋白 gp10A 的 7 个亚基表面。', tags: ['噬菌体', 'T7', '衣壳', 'gp10A'] });
  });

  const ENT = JSON.parse(fs.readFileSync(path.join(DIR, 'entities.json'), 'utf8')), chainSel = (e, name) => 'chain ' + e[name].join(',');
  await work('t7-portal-tail', async (call) => {
    const info = await call('import', { pdb: '9JYZ' }), e = ENT['9JYZ'], have = new Set(info.structures[0].chains);
    for (const list of Object.values(e)) for (const c of list) assert.ok(have.has(c), `chain ${c} is in the file`);
    await call('title', 'T7 成熟噬菌体的门户-尾部复合体（9JYZ）：门户、衔接蛋白、喷嘴与尾丝');
    await call('part', 'all', false);
    const r = [['Portal protein', '#4f7fd0'], ['Tail tubular protein gp11', '#3fbf9f'], ['Tail tubular protein gp12', '#e8b04a'], ['Tail fiber protein', '#e8604a']];
    for (const [name, colour] of r) await call('surface', chainSel(e, name), 'plain', colour);
    const small = `${chainSel(e, 'Protein 6.7')},${e['Protein 7.3'].join(',')}`.replace(/^chain /, ''); await call('part', 'chain ' + small, true); await call('color', 'chain ' + e['Protein 6.7'].join(','), '#b04df5'); await call('color', 'chain ' + e['Protein 7.3'].join(','), '#f58ac0');
    await call('lookPack', 'glow.active-site-warm', { recolor: false }); await sideOn(call, 'all');
    const comp = await call('composition', { part: 'protein', write: ['record'] });
    await call('note', `门户-尾部复合体：${info.structures[0].chains.length} 条链、${comp.residues} 个残基。蓝：门户蛋白 gp8（12 聚体）；青：衔接蛋白 gp11（12 个拷贝）；金：喷嘴 gp12（6 个拷贝）；红：尾丝蛋白 gp17（18 条链，6 根三聚体尾丝）；紫、粉的细线（卡通表示）：gp6.7（12 个拷贝）与 gp7.3（6 个拷贝）。颜色只区分蛋白种类，不表示数值。`);
    await call('note', `链与蛋白种类的对应取自文件自己的实体表（entity）；6.7、7.3 号蛋白没有画表面（表面规则最多 4 条）。尾丝在文件里只有一部分（为结构可见的部分）。`);
    await call('note', `来源：${PAPERS.tail}；早期的同一复合体 ${PAPERS.old}。文献描述：LPS 结合使喷嘴打开，随后门户构象变化触发基因组射出（这一机理未在本作品里计算）。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 成熟噬菌体门户-尾部复合体（9JYZ）的分子表面，按蛋白种类分色。', tags: ['噬菌体', 'T7', '门户', '尾部', '尾丝'] });
  });

  await work('t7-core-proteins', async (call) => {
    const info = await call('import', { pdb: '9JYY' }), e = ENT['9JYY'], have = new Set(info.structures[0].chains);
    for (const list of Object.values(e)) for (const c of list) assert.ok(have.has(c), `chain ${c} is in the file`);
    await call('title', 'T7 成熟噬菌体的内部核心蛋白（9JYY：gp14、gp15、gp16、gp6.7）');
    await call('part', 'all', false);
    const r = [['Peptidoglycan transglycosylase gp16', '#e8b04a'], ['Internal virion protein gp15', '#3fbf9f'], ['Internal virion protein gp14', '#4f7fd0'], ['Protein 6.7', '#b04df5']];
    for (const [name, colour] of r) await call('surface', chainSel(e, name), 'plain', colour);
    await call('lookPack', 'glow.cell-dark', { recolor: false }); await sideOn(call, 'all');
    const comp = await call('composition', { part: 'protein', write: ['record'] });
    await call('note', `核心蛋白复合体：${info.structures[0].chains.length} 条链、${comp.residues} 个残基。金：gp16（4 个拷贝，含转糖基酶结构域）；青：gp15（8 个拷贝）；蓝：gp14（8 个拷贝）；紫：gp6.7（8 个拷贝）。颜色只区分蛋白种类。`);
    await call('note', `文献描述：核心由 gp16（4 聚体环）、gp15（8 聚体环）、gp14（8 聚体环）堆叠在门户之上，感染时经尾部通道射出；gp14 的对称归属在原文中不完全确定，这里按文件登记的链原样画出，不加解读。`);
    await call('note', `来源：${PAPERS.tail}。`);
    await call('publication', { ...AUTHOR, topic: 'protein', description: 'T7 成熟噬菌体内部核心蛋白（9JYY）的分子表面，按蛋白种类分色。', tags: ['噬菌体', 'T7', '核心蛋白'] });
  });

  await browser.close(); console.log('phage works written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
