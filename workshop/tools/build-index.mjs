#!/usr/bin/env node
// Rebuild workshop/<source>/index.json (+ covers/<id>.jpg) from the packs. Deterministic: running it twice changes nothing,
// so CI can run it on every push and only commit when a pack really changed.
// A pack's embedded cover (data URI) is written to covers/<id>.<ext>; a pack without one uses an existing covers/<id>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, listPacks, checkFile, sha256, SOURCES, WS } from './glow-lib.mjs';
import { toolIdForScene } from '../../plugins/mechanism-catalog.mjs';

const R = loadRules();
const NAMES = { official: '官方', community: '社区' };
/* the resource zone: which structures a catalogue knows (workshop/<source>/resources/index.json, written by build-resources.mjs) */
const resourceIds = (src) => {
  const file = path.join(WS, src, 'resources', 'index.json');
  return new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).resources.map(({ record }) => record.source.accession) : []);
};
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
    const tool = toolIdForScene({ legacy: { scene: S } });
    packs.push({
      kind: 'work',   /* the work zone; the resource zone is resources/index.json */
      id: P.id, title: P.title, category: P.category, tags: P.tags, author: { name: P.author?.name || '', ...(P.author?.url ? { url: P.author.url } : {}) },
      revision: P.revision, license: P.license || '', description: (r.raw.description || '').slice(0, 240),
      pdb,
      resources: pdb.filter(id => known.has(id)).map(id => `res.rcsb.${id}`),   /* resources of the catalogue this work is built from */
      tools: tool ? [tool] : [],                                                 /* the tool its mechanism needs */
      animation: S.animation ? 'data' : S.process ? 'builtin' : 'none',
      updated: r.raw.updated || r.raw.created || '', file: `packs/${path.basename(file)}`, cover, size: buf.length, sha256: sha256(buf),
    });
  }
  packs.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  const index = { format: 'glow-index', version: 1, source: src, name: NAMES[src], updated: packs.map(p => p.updated).sort().pop() || '', packs };
  const out = path.join(dir, 'index.json'), json = JSON.stringify(index, null, 1) + '\n';
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ ${src}/index.json：${packs.length} 个场景`); }
  else console.log(`= ${src}/index.json 无变化（${packs.length} 个场景）`);
}
process.exit(bad ? 1 : 0);
