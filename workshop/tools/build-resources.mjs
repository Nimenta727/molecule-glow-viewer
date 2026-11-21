#!/usr/bin/env node
// Rebuild workshop/official/resources/index.json — the resource zone of the workshop — from docs/science/structures.json
// (the reviewed RCSB lookup that already carries each structure's size and sha256). Deterministic and offline: running it
// twice changes nothing. A resource entry is a glow-resource record WITHOUT bytes (delivery "reference"): the workshop keeps
// the identity, source, licence and hash; the bytes are fetched from RCSB on demand and must match the recorded hash.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WS } from './glow-lib.mjs';
import { describeStructureAsset } from '../../packages/schema/resource.mjs';

// Short, human titles and tags for the entries (the RCSB title stays in the card). `species`/`mutation` fill what the RCSB lookup left empty,
// taken from the reviewed scientific card of the KcsA plugin (plugins/kcsa/scientific-card.json).
const ENTRIES = {
  '6ZPO': { title: '牛线粒体 ATP 合酶（整体，状态 1）', tags: ['ATP 合酶', '膜蛋白', '冷冻电镜'], description: '完整的 F1Fo ATP 合酶：F1 头部、中央柄、c 环和 a 亚基。ATP 合酶作品使用的主结构。' },
  '1K4C': { species: 'Streptomyces lividans', title: 'KcsA 钾通道（关闭态）', tags: ['钾通道', '膜蛋白', '离子通道'], description: '链霉菌 KcsA 在高 K⁺ 下的结构（含抗体 Fab），选择性过滤器中有 K⁺ 位点。KcsA 作品的主结构。' },
  '5VK6': { species: 'Streptomyces lividans', mutation: 'E71A', title: 'KcsA E71A（开放态）', tags: ['钾通道', '离子通道', '门控'], description: '非失活突变体 E71A 的开放构象，用于推算 K⁺ 进入中央腔的孔道。' },
  '5VKE': { species: 'Streptomyces lividans', title: 'KcsA（深度失活态）', tags: ['钾通道', '离子通道', '失活'], description: 'KcsA 深度失活的开放构象。' },
  '2HVK': { species: 'Streptomyces lividans', title: 'KcsA 与 TBA（中央腔阻断剂）', tags: ['钾通道', '阻断剂'], description: '四丁基铵（TBA）结合在中央腔的 KcsA 结构。' },
  '2ITD': { species: 'Streptomyces lividans', title: 'KcsA 与 Ba²⁺（过滤器阻断剂）', tags: ['钾通道', '阻断剂'], description: 'Ba²⁺ 结合在选择性过滤器的 KcsA 结构。' },
  '5GUP': { species: 'Bos taurus', title: '哺乳动物呼吸链超复合体 I1III2IV1（呼吸体）', tags: ['呼吸链', '膜蛋白', '冷冻电镜', '超复合体'], description: '复合体 I、III 二聚体和 IV 组成的呼吸体。呼吸链作品使用的主结构（与 ATP 合酶 6ZPO、细胞色素 c 1HRC 同场景）。' },
  '3JCU': { species: 'Spinacia oleracea', title: '菠菜光系统 II–LHCII 超复合体', tags: ['光合作用', '膜蛋白', '冷冻电镜', '光系统'], description: '含天线蛋白 LHCII 的光系统 II 超复合体。叶绿体光反应作品使用的主结构。' },
  '1HRC': { species: 'Equus caballus', title: '马心细胞色素 c', tags: ['细胞色素 c', '电子载体', '晶体结构'], description: '线粒体膜间隙里携带电子的小蛋白，在呼吸链作品里作为移动的载体。' },
  '4AKE': { title: '大肠杆菌腺苷酸激酶（张开态）', tags: ['腺苷酸激酶', '构象变化', '酶'], description: '底物结合前的张开构象，含 CORE、NMP、LID 三个域。' },
  '1AKE': { title: '大肠杆菌腺苷酸激酶与 Ap5A（闭合态）', tags: ['腺苷酸激酶', '构象变化', '酶', '抑制剂'], description: '与双底物类似物抑制剂 Ap5A 结合的闭合构象。' },
  // added 2026-11-21 for the structures the official works use (hashes recorded from the RCSB files as downloaded that day; awaiting the maintainer's hash review)
  '1A70': { updated: '2026-11-21', title: '菠菜铁氧还蛋白', tags: ['铁氧还蛋白', '电子载体', '晶体结构'], description: '叶绿体光反应里的小型铁硫电子载体：把光系统 I 出来的电子交给铁氧还蛋白-NADP⁺ 还原酶。' },
  '1FNB': { updated: '2026-11-21', title: '菠菜铁氧还蛋白-NADP⁺ 还原酶', tags: ['光合作用', '电子载体', '酶', '晶体结构'], description: '接收铁氧还蛋白的电子、把 NADP⁺ 还原为 NADPH 的黄素酶（1.7 Å）。' },
  '1PLC': { updated: '2026-11-21', title: '杨树质体蓝素', tags: ['光合作用', '电子载体', '晶体结构'], description: '含铜的小蛋白，在叶绿体里把电子从细胞色素 b6f 复合体带给光系统 I。' },
  '5L8R': { updated: '2026-11-21', title: '豌豆光系统 I 超复合体', tags: ['光合作用', '膜蛋白', '晶体结构', '光系统'], description: '植物光系统 I 与其天线蛋白组成的超复合体（2.6 Å，X 射线晶体学）。' },
  '6FKF': { updated: '2026-11-21', title: '菠菜叶绿体 F1Fo ATP 合酶（构象 1）', tags: ['ATP 合酶', '光合作用', '膜蛋白', '冷冻电镜'], description: '叶绿体的 F1Fo ATP 合酶，类囊体膜上用质子梯度合成 ATP。' },
  '6RQF': { updated: '2026-11-21', title: '菠菜二聚体细胞色素 b6f 复合体', tags: ['光合作用', '膜蛋白', '冷冻电镜', '电子传递'], description: '连接光系统 II 与光系统 I 的细胞色素 b6f 复合体二聚体（3.6 Å 冷冻电镜）。' },
  '1AON': { updated: '2026-11-21', title: '大肠杆菌 GroEL/GroES 伴侣蛋白复合体', tags: ['分子伴侣', '蛋白折叠', '晶体结构'], description: '不对称的 GroEL–GroES–ADP7 复合体：GroEL 桶状腔帮助蛋白折叠，GroES 做盖子。' },
  '1KX5': { updated: '2026-11-21', title: '核小体核心颗粒（1.9 Å）', tags: ['染色质', '核小体', '晶体结构'], description: '147 个碱基对的 DNA 绕在组蛋白八聚体上的核小体核心颗粒。' },
  '5LE5': { updated: '2026-11-21', title: '人 20S 蛋白酶体（1.8 Å）', tags: ['蛋白酶体', '蛋白降解', '晶体结构'], description: '天然人 20S 蛋白酶体：四层环叠成的桶状蛋白降解机器。' },
  '6VXX': { updated: '2026-11-21', title: 'SARS-CoV-2 刺突糖蛋白（关闭态）', tags: ['病毒', '刺突蛋白', '冷冻电镜'], description: 'SARS-CoV-2 刺突糖蛋白三聚体，三个受体结合域都处于关闭状态。' },
  '6YKM': { updated: '2026-11-21', title: '空肠弯曲菌 MotAB 定子', tags: ['鞭毛马达', '定子', '膜蛋白', '冷冻电镜'], description: '鞭毛马达定子单元 MotAB：质子顺梯度通过它驱动转子转动。' },
  '7CGO': { updated: '2026-11-21', title: '沙门氏菌鞭毛马达—钩复合体', tags: ['鞭毛马达', '膜蛋白', '冷冻电镜'], description: '鞭毛马达与钩（hook）的复合体冷冻电镜结构。' },
  '8YJT': { updated: '2026-11-21', title: '沙门氏菌鞭毛 C 环（逆时针态）', tags: ['鞭毛马达', 'C 环', '冷冻电镜', '换向'], description: '鞭毛马达的 C 环（转子的胞质部分）处于逆时针（CCW）状态。' },
  '1UCU': { updated: '2026-11-21', title: '沙门氏菌 R 型直鞭毛丝', tags: ['鞭毛', '鞭毛蛋白', '冷冻电镜'], description: '由全长鞭毛蛋白组成的 R 型直鞭毛丝（电子显微镜）。' },
  '4V6F': { updated: '2026-11-21', title: '70S 核糖体延伸复合体（三个 tRNA 与 mRNA）', tags: ['核糖体', '翻译', '晶体结构', 'tRNA'], description: '嗜热栖热菌 70S 核糖体与 mRNA、三个 tRNA 的延伸复合体：同一条目里有两个核糖体拷贝。' },
  '1OMP': { updated: '2026-11-21', title: '麦芽糖结合蛋白（无配体，张开态）', tags: ['麦芽糖结合蛋白', '构象变化', '晶体结构'], description: '不带配体的结构，两个结构域之间的裂缝张开；条目标题说明它与结合麦芽糖后的结构相比有大幅铰链-扭转运动。' },
  '1ANF': { updated: '2026-11-21', title: '麦芽糖结合蛋白与麦芽糖（闭合态）', tags: ['麦芽糖结合蛋白', '构象变化', '晶体结构', '配体'], description: '结合麦芽糖后的结构：糖被夹在两个结构域之间，裂缝闭合。' },
  '6N2Y': { updated: '2026-11-21', title: '枯草芽孢杆菌 PS3 ATP 合酶（c10 环）', tags: ['ATP 合酶', '膜蛋白', '冷冻电镜'], description: '细菌 F1Fo ATP 合酶（3.0 Å 冷冻电镜），c 环有 10 个亚基。' },
};

const science = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'science', 'structures.json'), 'utf8'));
const resources = science.structures.map((entry) => {
  const meta = ENTRIES[entry.id];
  if (!meta) throw new Error(`no catalogue text for ${entry.id}`);
  const { coordinate } = entry;
  // The same naming the Viewer and Studio use when they import the file, so a scene built from this resource links to this record.
  const asset = { path: 'assets/source.cif', sha256: coordinate.sha256, mediaType: 'chemical/x-mmcif', provenance: { source: { provider: 'RCSB PDB', accession: entry.id } } };
  const { record } = describeStructureAsset(asset, { byteLength: coordinate.bytes });
  const citation = entry.primary_citation ?? {};
  record.card = {
    title: entry.title, species: entry.organisms?.map((o) => o.ncbi_scientific_name).filter(Boolean).join('; ') || meta.species || null,
    method: entry.method?.map((m) => m.method).join('; ') || null, ...(entry.mutation || meta.mutation ? { mutation: String(entry.mutation ?? meta.mutation) } : {}),
    ...(citation.title ? { citation: `${citation.title}${citation.year ? ` (${citation.year})` : ''}` } : {}),
    ...(citation.pdbx_database_id_DOI ? { doi: citation.pdbx_database_id_DOI } : {}),
  };
  record.files[0].path = `${entry.id}.cif`;
  return { kind: 'resource', title: meta.title, description: meta.description, tags: meta.tags, delivery: 'reference', updated: meta.updated ?? '2026-11-20', record };
});
resources.sort((a, b) => a.record.id.localeCompare(b.record.id));
const index = { format: 'glow-resources', version: 1, source: 'official', name: '官方资源', updated: resources.map((r) => r.updated).sort().pop(), resources };
const dir = path.join(WS, 'official', 'resources'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'index.json'), json = JSON.stringify(index, null, 1) + '\n';
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ official/resources/index.json：${resources.length} 个资源`); }
else console.log(`= official/resources/index.json 无变化（${resources.length} 个资源）`);
