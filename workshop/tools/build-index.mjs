#!/usr/bin/env node
// Rebuild workshop/<source>/index.json (+ covers/<id>.jpg) from the packs. Deterministic: running it twice changes nothing,
// so CI can run it on every push and only commit when a pack really changed.
// A pack's embedded cover (data URI) is written to covers/<id>.<ext>; a pack without one uses an existing covers/<id>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, listPacks, checkFile, sha256, SOURCES, WS } from './glow-lib.mjs';

const R = loadRules();
const NAMES = { official: '官方', community: '社区' };
let bad = 0;
for (const src of SOURCES) {
  const dir = path.join(WS, src), covers = path.join(dir, 'covers'); fs.mkdirSync(covers, { recursive: true });
  const packs = [];
  for (const file of listPacks(src)) {
    const r = checkFile(file, src, R);
    if (!r.ok) { bad++; r.errors.forEach(e => console.log('✗ ' + e)); continue; }
    const P = r.pack, S = P.scene;
    let cover = null;
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(r.raw.cover || '');
    if (m) { const ext = m[1] === 'jpeg' ? 'jpg' : m[1]; cover = `covers/${P.id}.${ext}`; fs.writeFileSync(path.join(dir, cover), Buffer.from(m[2], 'base64')); }
    else for (const ext of ['jpg', 'png', 'webp']) if (fs.existsSync(path.join(covers, `${P.id}.${ext}`))) { cover = `covers/${P.id}.${ext}`; break; }
    const buf = fs.readFileSync(file);
    packs.push({
      id: P.id, title: P.title, category: P.category, tags: P.tags, author: { name: P.author?.name || '', ...(P.author?.url ? { url: P.author.url } : {}) },
      revision: P.revision, license: P.license || '', description: (r.raw.description || '').slice(0, 240),
      pdb: [...new Set([S.id, ...(S.states || []), ...(S.components || []).map(c => c.id)].filter(Boolean))],
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
