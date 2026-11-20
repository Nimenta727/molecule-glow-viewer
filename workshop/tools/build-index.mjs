#!/usr/bin/env node
// Rebuild workshop/<source>/index.json (+ covers/<id>.jpg) from the packs. Deterministic: running it twice changes nothing,
// so CI can run it on every push and only commit when a pack really changed.
// A pack's embedded cover (data URI) is written to covers/<id>.<ext>; a pack without one uses an existing covers/<id>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, listPacks, checkFile, sha256, SOURCES, WS } from './glow-lib.mjs';
import { toolEntriesForScene } from '../../plugins/mechanism-catalog.mjs';

const R = loadRules();
const NAMES = { official: '官方', community: '社区' };
/* the resource zone: which structures a catalogue knows (workshop/<source>/resources/index.json, written by build-resources.mjs) */
const resourceIds = (src) => {
  const file = path.join(WS, src, 'resources', 'index.json');
  return new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).resources.map(({ record }) => record.source.accession) : []);
};
/* The two kinds of pack the workshop shows, over four subjects (机理 mechanism, 蛋白质 protein, 局部系统 local system, 细胞 cell):
   - template (模板): fully static, for looking at the structure and reading the explanation; nothing moves, no tool is attached;
   - work (作品): dynamic, shows how it works (tools attached: player, data animation, stochastic process, ...).
   One pack file can serve both: the template entry opens it as a static scene, the work entry as the animated one. A pack that only demonstrates
   an animation format (a data animation without a built-in process) is a work only. */
const TOPICS = { 'official.atp-synthase': 'mechanism', 'official.kcsa': 'mechanism', 'official.adenylate-kinase': 'mechanism', 'official.respiratory-chain': 'mechanism', 'official.chloroplast-light': 'mechanism',
  'official.flagellar-motor': 'mechanism', 'official.translation': 'mechanism', 'official.kcsa-data': 'mechanism', 'official.adk-reaction-data': 'mechanism',
  'official.groel': 'protein', 'official.nucleosome': 'protein', 'official.proteasome-20s': 'protein', 'official.spike': 'protein', 'official.cell-corner': 'local-system', 'official.whole-cell': 'cell' };
/* a template's own name: the pack titles of the animated ones promise simulations ("可加抗生素", "同时模拟"); a static template is just the thing */
const TEMPLATE_TITLES = { 'official.translation': '核糖体（70S，翻译机器）', 'official.kcsa': '钾离子通道 KcsA', 'official.cell-corner': '细胞一角：核糖体与钾通道', 'official.respiratory-chain': '线粒体呼吸链（复合体 I、III、IV 与 ATP 合酶）',
  'official.chloroplast-light': '叶绿体光系统 II', 'official.atp-synthase': 'ATP 合酶', 'official.adenylate-kinase': '腺苷酸激酶', 'official.whole-cell': '整个细胞：大肠杆菌', 'official.flagellar-motor': '鞭毛马达' };
const DYNAMIC_TAGS = new Set(['实时模拟', '数据动画', '示例']);
const topicOf = (id, category) => TOPICS[id] ?? ({ single: 'protein', system: 'local-system', cell: 'cell' }[category] ?? 'protein');
let bad = 0;
/* moderation: community scenes on hold after reports (workshop/community/held.json, written by report.mjs) stay out of the catalogue */
const heldF = path.join(WS, 'community', 'held.json');
const HELD = new Set(fs.existsSync(heldF) ? JSON.parse(fs.readFileSync(heldF, 'utf8')).held.map(h => h.id) : []);
for (const src of SOURCES) {
  const dir = path.join(WS, src), covers = path.join(dir, 'covers'); fs.mkdirSync(covers, { recursive: true });
  const packs = [], known = resourceIds(src);
  for (const file of listPacks(src)) {
    const r = checkFile(file, src, R);
    if (!r.ok) { bad++; r.errors.forEach(e => console.log('✗ ' + e)); continue; }
    const P = r.pack, S = P.scene;
    if (src === 'community' && HELD.has(P.id)) { console.log(`⏸ ${P.id}：被举报暂停展示`); continue; }
    let cover = null;
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(r.raw.cover || '');
    if (m) { const ext = m[1] === 'jpeg' ? 'jpg' : m[1]; cover = `covers/${P.id}.${ext}`; fs.writeFileSync(path.join(dir, cover), Buffer.from(m[2], 'base64')); }
    else for (const ext of ['jpg', 'png', 'webp']) if (fs.existsSync(path.join(covers, `${P.id}.${ext}`))) { cover = `covers/${P.id}.${ext}`; break; }
    const buf = fs.readFileSync(file);
    const pdb = [...new Set([S.id, ...(S.states || []), ...(S.components || []).map(c => c.id)].filter(Boolean))];
    const tools = [...new Set(toolEntriesForScene({ nodes: [], assets: [], legacy: { scene: S } }).map((entry) => entry.tool.id))];   /* what the animated version needs */
    const base = {
      kind: 'work',   /* a pack of the work / template zones; the resource zone is resources/index.json */
      title: P.title, category: P.category, topic: topicOf(P.id, P.category), tags: P.tags, author: { name: P.author?.name || '', ...(P.author?.url ? { url: P.author.url } : {}) },
      revision: P.revision, license: P.license || '', description: (r.raw.description || '').slice(0, 240),
      pdb,
      resources: pdb.filter(id => known.has(id)).map(id => `res.rcsb.${id}`),   /* resources of the catalogue this pack is built from */
      animation: S.animation ? 'data' : S.process ? 'builtin' : 'none',
      updated: r.raw.updated || r.raw.created || '', file: `packs/${path.basename(file)}`, cover, size: buf.length, sha256: sha256(buf),
    };
    const dynamic = tools.length > 0 || Boolean(S.animation), demoOnly = S.animation && !S.process;
    if (!demoOnly) packs.push({ ...base, zone: 'template', id: P.id, title: TEMPLATE_TITLES[P.id] ?? P.title, tags: (P.tags || []).filter((tag) => !DYNAMIC_TAGS.has(tag)), tools: [] });   /* static: looking and reading */
    if (dynamic) packs.push({ ...base, zone: 'work', id: demoOnly ? P.id : `${P.id}.work`, title: demoOnly ? P.title : `${P.title}（动态演示）`, tools });
  }
  packs.sort((a, b) => a.title.localeCompare(b.title, 'zh') || a.zone.localeCompare(b.zone));
  const index = { format: 'glow-index', version: 1, source: src, name: NAMES[src], updated: packs.map(p => p.updated).sort().pop() || '', packs };
  const out = path.join(dir, 'index.json'), json = JSON.stringify(index, null, 1) + '\n';
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ ${src}/index.json：${packs.length} 个场景`); }
  else console.log(`= ${src}/index.json 无变化（${packs.length} 个场景）`);
}
process.exit(bad ? 1 : 0);
