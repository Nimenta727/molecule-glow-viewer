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
  return { kind: 'resource', title: meta.title, description: meta.description, tags: meta.tags, delivery: 'reference', updated: '2026-11-20', record };
});
resources.sort((a, b) => a.record.id.localeCompare(b.record.id));
const index = { format: 'glow-resources', version: 1, source: 'official', name: '官方资源', updated: resources.map((r) => r.updated).sort().pop(), resources };
const dir = path.join(WS, 'official', 'resources'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'index.json'), json = JSON.stringify(index, null, 1) + '\n';
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ official/resources/index.json：${resources.length} 个资源`); }
else console.log(`= official/resources/index.json 无变化（${resources.length} 个资源）`);
