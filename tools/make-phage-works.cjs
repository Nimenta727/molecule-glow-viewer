// Makes the bacteriophage T7 static works with the Studio command interface only (window.studio).
//   t7-virion           the whole virion from `tools/build-phage-model.py` (head shell 3J7X as 60 hexons + 11 pentons, portal-tail 9JYZ, core 9JYY, genome spool): 3D cartoon, coloured by part, ready to take apart
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

  await work('t7-virion', async (call) => {
    // the whole virion as one static model: every part in the 3D cartoon, coloured by what it is, and each capsomer, tail protein, core protein and genome strand its own chain,
    // so the Viewer's 拆装 (take apart) moves them out one by one
    const text = fs.readFileSync(path.join(DIR, 'out/t7-virion-model.cif'), 'utf8'), parts = JSON.parse(fs.readFileSync(path.join(DIR, 'out/t7-virion-parts.json'), 'utf8'));
    const chainsOf = (pattern) => Object.entries(parts).filter(([name]) => pattern.test(name)).flatMap(([, chains]) => chains), sel = (list) => 'chain ' + list.join(',');
    await call('import', { name: 't7-virion-model.cif', text });
    await call('title', '噬菌体 T7 完整病毒颗粒（静态整体模型，可拆解）');
    await call('show', 'all', 'cartoon');
    const COLORS = [
      [/hexon subunit/, '#5b8fd9'], [/penton subunit/, '#8a6fd8'],
      [/Portal protein/, '#e8b04a'], [/gp11/, '#3fbf9f'], [/gp12/, '#e0703a'], [/Tail fiber/, '#d65a5a'], [/Protein 6\.7 \[9JYZ\]|Protein 7\.3/, '#b25fd0'],
      [/gp14/, '#2f8f6f'], [/gp15/, '#58c79a'], [/gp16/, '#9bd46a'], [/Protein 6\.7 \[9JYY\]/, '#7fbf5f'],
      [/Genome DNA/, '#e8472f'],
      [/DRAWN/, '#efb3c4'],   // the drawn middle of the fibres is told apart from the experimental parts by a pale colour
    ];
    for (const [pattern, colour] of COLORS) { const chains = chainsOf(pattern); if (chains.length) await call('color', sel(chains), colour); }
    await call('lookPack', 'paper.clean-white', { recolor: false });
    await sideOn(call, 'all');
    const count = (pattern) => chainsOf(pattern).length;
    await call('note', `整体结构：头部衣壳由主衣壳蛋白 gp10A 组成（${count(/hexon/)} 个六聚体，蓝；${count(/penton/)} 个五聚体，紫；共 415 个亚基，T=7；门户所在的顶点没有五聚体）。尾部（9JYZ）：门户 gp8（金）、衔接蛋白 gp11（青绿）、喷嘴 gp12（橙）、gp6.7 与 gp7.3（紫红）；6 根尾丝 gp17，每根三条链：靠尾部的一段（红，9JYZ 冷冻电镜）、中段（浅粉，画出来的示意）、末端（红，4A0T 晶体结构）。头部里面：内部核心（9JYY）gp14、gp15、gp16、gp6.7（深浅绿），以及盘绕的基因组 DNA（红，39,937 bp，两条链）。`);
    await call('note', '拆解：在 Viewer 打开后，到“查看”页下方的“拆装”点“拆开”，每个衣壳粒、每个尾部蛋白、核心蛋白和两条 DNA 链各是一块，会沿着离开中心的方向移开；可以逐块移出、放回，也可以看两块之间的接触面。');
    await call('note', '【实验结构】衣壳（3J7X，成熟噬菌体衣壳，3.6 Å，只用了 Cα）、门户-尾部（9JYZ，2.7 Å）、核心（9JYY，3.0 Å）的坐标都来自已发表的冷冻电镜结构，原样使用。【示意/假设】三部分之间的相对位置（核心放进头部的位置、头部相对门户的距离）和 DNA 的缠绕方式（同轴线轴）是作图时的假设，不是实验测得；DNA 只画了磷酸骨架（每个核苷酸一个点），没有序列。衣壳只有 Cα，所以衣壳不能显示价键模型。尾丝中段（第 144–370 号残基）没有任何实验或预测结构（AlphaFold 数据库不收录病毒蛋白，这里也无法运行预测），是按尾丝的长度和折角画出的三股示意链；尾丝末端（4A0T）的位置和朝向也是示意。');
    await call('note', `来源：${PAPERS.head}；${PAPERS.tail}；${PAPERS.old}；尾丝末端：Garcia-Doval C., van Raaij M. J.，PNAS 2012（PDB 4A0T）。`);
    await call('publication', { ...AUTHOR, topic: 'local-system', description: '噬菌体 T7 完整病毒颗粒的静态整体模型：衣壳按六聚体、五聚体分块，尾部、核心和基因组 DNA 各自成块，可在 Viewer 里逐块拆开；部件之间的位置是示意。', tags: ['噬菌体', 'T7', '病毒', '拆解', '整体模型'] });
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
