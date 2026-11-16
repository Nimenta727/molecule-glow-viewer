#!/usr/bin/env node
// Check workshop scene packs. With no arguments: every pack in workshop/official/packs and workshop/community/packs.
// With file arguments: just those (the source is taken from the path; anything outside official/ counts as community).
// Exit code 1 if any pack is invalid. Usage: node workshop/tools/validate.mjs [file.glow ...]
import path from 'node:path';
import { loadRules, listPacks, checkFile, SOURCES } from './glow-lib.mjs';

const R = loadRules();
const args = process.argv.slice(2);
const jobs = args.length
  ? args.map(f => [path.resolve(f), /[\\/]official[\\/]/.test(path.resolve(f)) ? 'official' : 'community'])
  : SOURCES.flatMap(src => listPacks(src).map(f => [f, src]));

let bad = 0; const ids = new Map();
for (const [file, src] of jobs) {
  const r = checkFile(file, src, R);
  if (r.raw?.id) { if (ids.has(r.raw.id)) { r.errors.push(`${path.basename(file)}: id ${r.raw.id} 和 ${ids.get(r.raw.id)} 重复`); r.ok = false; } else ids.set(r.raw.id, path.relative(process.cwd(), file)); }
  for (const w of r.warnings) console.log('  ⚠ ' + w);
  if (r.ok) console.log(`✓ [${src}] ${path.basename(file)} — ${r.pack.title}${r.raw.scene.animation ? '（数据动画）' : ''}`);
  else { bad++; for (const e of r.errors) console.log('✗ ' + e); }
}
console.log(`\n${jobs.length - bad} 个通过，${bad} 个不通过`);
process.exit(bad ? 1 : 0);
