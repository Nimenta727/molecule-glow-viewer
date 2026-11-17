#!/usr/bin/env node
// Build the single-file viewer from src/ (docs/history/HANDOFF_PLAN.md WP1). Zero dependencies, Node 18+.
//   node tools/build.mjs           write web/index.html (+ web/dev.html from src/dev.html)
//   node tools/build.mjs --check   build in memory and compare with the files in web/; exit 1 if they differ
//
// How it works (see src/README.md):
//   src/index.html.tpl is the page skeleton. Every line `<!-- @include path -->` is replaced by the file src/<path>.
//   The script fragments share ONE module scope in the output (as before the split), so the order of the includes
//   is the order of the code. A fragment may also be a real ES module that Node can import (src/data/presets.js,
//   src/pack/rules.js): the build drops its relative `import ... from './x.js'` lines and the `export ` keyword at the
//   start of a line, and drops `//!` comment lines (notes for people reading src/ only).
//   The output keeps the importmap / CDN loading of Three.js and works when opened by double-click.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src'), WEB = path.join(ROOT, 'web');
const check = process.argv.includes('--check');
const lf = (t) => t.replace(/\r\n/g, '\n');
const INCLUDE = /^<!-- @include (\S+) -->$/;
const REL_IMPORT = /^import\s[^;]*?\sfrom\s+(['"])\.{1,2}\/[^'"]+\1;?\s*$/;

function fragment(rel) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) throw new Error(`src/index.html.tpl includes a missing file: src/${rel}`);
  let lines = lf(fs.readFileSync(file, 'utf8')).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (rel.endsWith('.js')) lines = lines.flatMap((l, i) => {
    if (l.startsWith('//!') || REL_IMPORT.test(l)) return [];
    if (/^export\s+default\b/.test(l) || /^export\s*\{/.test(l)) throw new Error(`src/${rel}:${i + 1}: only "export const/let/function/class" is allowed in a fragment`);
    return [l.replace(/^export (?=(async\s+)?(const|let|var|function|class)\b)/, '')];
  });
  return lines;
}

export function buildViewer() {
  const tpl = lf(fs.readFileSync(path.join(SRC, 'index.html.tpl'), 'utf8')).split('\n');
  if (tpl[tpl.length - 1] === '') tpl.pop();
  const used = new Set(), out = [];
  for (const line of tpl) {
    const m = INCLUDE.exec(line);
    if (!m) { out.push(line); continue; }
    if (used.has(m[1])) throw new Error(`src/${m[1]} is included twice`);
    used.add(m[1]); out.push(...fragment(m[1]));
  }
  /* every fragment under src/ must be in the page (a forgotten file would silently drop code) */
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const orphans = walk(SRC).map(f => path.relative(SRC, f).split(path.sep).join('/'))
    .filter(f => /\.(js|css)$/.test(f) && !used.has(f));
  if (orphans.length) throw new Error('fragments not included by src/index.html.tpl: ' + orphans.join(', '));
  return out.join('\n') + '\n';
}

const OUTPUTS = () => [
  ['web/index.html', buildViewer()],
  ['web/dev.html', lf(fs.readFileSync(path.join(SRC, 'dev.html'), 'utf8'))],
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const [rel, text] of OUTPUTS()) {
    const file = path.join(ROOT, rel);
    if (!check) { fs.writeFileSync(file, text); console.log(`built ${rel}  (${text.split('\n').length - 1} lines)`); continue; }
    const have = fs.existsSync(file) ? lf(fs.readFileSync(file, 'utf8')) : null;
    if (have === text) { console.log(`✓ ${rel} 与 src/ 的构建结果一致`); continue; }
    bad++;
    if (have == null) { console.log(`✗ ${rel} 不存在`); continue; }
    const a = have.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`✗ ${rel} 与 src/ 的构建结果不同（第 ${i + 1} 行起）\n  仓库：${(a[i] ?? '<文件结束>').slice(0, 120)}\n  构建：${(b[i] ?? '<文件结束>').slice(0, 120)}`);
  }
  if (bad) { console.log('\nweb/ 是生成物，不要手改：改 src/ 后运行 node tools/build.mjs 再提交。'); process.exit(1); }
}
