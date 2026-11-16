#!/usr/bin/env node
// Turn the viewer's built-in presets into official workshop packs (workshop/official/packs/official.<slug>.glow).
// Re-run after changing a preset: a pack is rewritten (and its revision bumped) only when its scene really changed.
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, WS } from './glow-lib.mjs';

const R = loadRules();
/* preset name -> [slug, tags, one-line description for the workshop card] */
const META = {
  'ATP 合酶（合成 ATP）': ['atp-synthase', ['分子马达', '能量', '膜蛋白'], 'H⁺ 顺梯度流过 c 环使其转动，γ 亚基依次改变三个 β 亚基的构象，把 ADP + Pi 合成 ATP（Boyer 结合变构机制）。'],
  '线粒体呼吸链（电子传递 → ATP）': ['respiratory-chain', ['线粒体', '电子传递', '能量', '实时模拟'], '复合体 I、III、IV 和 ATP 合酶在同一层膜上：电子从 NADH 经铁硫簇和血红素传到 O₂，泵出的 H⁺ 回流合成 ATP；膜两侧 pH 和电位实时模拟。'],
  '叶绿体光反应（光 → NADPH + ATP）': ['chloroplast-light', ['叶绿体', '光合作用', '电子传递', '实时模拟'], 'PSII、b6f、PSI 和 ATP 合酶排在类囊体膜上：光子激发 P680 / P700，电子从水出发经 Z 方案生成 NADPH，H⁺ 回流合成 ATP。'],
  '鞭毛马达': ['flagellar-motor', ['分子马达', '细菌', '膜蛋白'], '细菌鞭毛马达：H⁺ 流过 11 个定子产生力矩，带动 C 环、杆、钩和鞭毛丝一起转动。'],
  '钾离子通道 KcsA（膜中，pH 门控，可加阻断剂）': ['kcsa', ['离子通道', '膜蛋白', '实时模拟'], 'K⁺ 按敲击机制单列通过选择性过滤器，Na⁺ 被排斥；胞内 pH 控制门的开关和失活，可调膜电位、浓度，加 TBA / Ba²⁺ 阻断。'],
  '细胞一角：核糖体 + 钾通道（同时模拟）': ['cell-corner', ['细胞', '核糖体', '离子通道', '实时模拟'], '细胞质里的核糖体在翻译，上方细胞膜里的 KcsA 按胞内 pH 开关，两套模拟同时运行。'],
  '整个细胞：大肠杆菌（从 2 µm 缩放到原子）': ['whole-cell', ['细胞', '多尺度'], '一个大肠杆菌从 2 µm 一路缩放到原子：外膜、肽聚糖、内膜、拟核、2.5 万个核糖体、鞭毛，再放大到正在工作的分子机器。'],
  '腺苷酸激酶（开合）': ['adenylate-kinase', ['酶', '构象变化'], '腺苷酸激酶的 LID 和 NMP 结构域在张开（4AKE）和闭合（1AKE）两个晶体结构之间开合，抑制剂 Ap5A 占据活性位点。'],
  'GroEL 伴侣蛋白': ['groel', ['伴侣蛋白', '蛋白折叠'], 'GroEL 两个七聚体环背靠背组成折叠腔，GroES 像盖子一样盖在 cis 环上。'],
  '核糖体翻译（mRNA → 蛋白质，可加抗生素）': ['translation', ['核糖体', '翻译', '抗生素', '实时模拟'], '70S 核糖体按真实速率读 mRNA：tRNA 选择、校对、肽键形成、移位；可加抗生素，并放大到解码中心和肽基转移中心的真实原子。'],
  '核小体': ['nucleosome', ['DNA', '染色质'], '147 bp DNA 以约 1.65 圈缠绕在组蛋白八聚体外。'],
  '20S 蛋白酶体（核心颗粒）': ['proteasome-20s', ['蛋白降解', '酶'], '20S 蛋白酶体核心颗粒：四个七聚体环叠成的桶，蛋白水解活性位点在内部。'],
  'SARS-CoV-2 刺突蛋白（三聚体）': ['spike', ['病毒', '膜蛋白'], 'SARS-CoV-2 刺突蛋白三聚体（6VXX，闭合构象）。'],
};
const DATE = process.env.GLOW_DATE || new Date().toISOString().slice(0, 10);
const dir = path.join(WS, 'official', 'packs'); fs.mkdirSync(dir, { recursive: true });
const stable = (o) => JSON.stringify(o);
for (const [name, preset] of Object.entries(R.PRESETS)) {
  const m = META[name]; if (!m) { console.log('⚠ 没有元数据，跳过：' + name); continue; }
  const [slug, tags, description] = m, id = 'official.' + slug, file = path.join(dir, id + '.glow');
  const scene = JSON.parse(JSON.stringify(preset)); delete scene.key; delete scene.tier;   /* runtime fields added by the viewer (v18) */
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (old && stable(old.scene) === stable(scene) && old.title === name && old.description === description && stable(old.tags) === stable(tags)) { console.log('= ' + id); continue; }
  const ids = [...new Set([scene.id, ...(scene.states || []), ...(scene.components || []).map(c => c.id)].filter(Boolean))];
  const pack = { format: 'glow-scene', version: 1, id, revision: (old?.revision || 0) + 1, title: name, category: R.presetCat(name), tags,
    author: { name: 'molecule-glow-viewer', url: 'https://github.com/Nimenta727/molecule-glow-viewer' }, license: 'CC-BY-4.0',
    description, created: old?.created || DATE, updated: DATE, viewer: 17, citations: ids.map(pdb => ({ pdb })), scene };
  fs.writeFileSync(file, JSON.stringify(pack, null, 1) + '\n');
  console.log(`${old ? '↻' : '+'} ${id}（第 ${pack.revision} 版）`);
}
