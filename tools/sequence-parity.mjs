// Differential test: sequence-bar rows (plugins/structure/sequence.mjs) against the classic bar's data (src/ui/sequence-bar.js seqChains + parse.js).
// Usage: node tools/sequence-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { sequenceRows } from '../plugins/structure/sequence.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/sequence-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const ctx = vm.createContext({ THREE, IGNORE_LIGANDS: new Set(['HOH', 'WAT']) });
vm.runInContext(read('src/data/parse.js'), ctx);
// parseLoop lives in rcsb.js next to browser-only code; run just that function
const rcsb = read('src/data/rcsb.js');
for (const name of ['parseLoop']) { const m = new RegExp(`function ${name}\\(`).exec(rcsb); if (!m) throw new Error(name + ' not found'); let i = rcsb.indexOf('{', m.index), depth = 0, j = i; do { if (rcsb[j] === '{') depth++; else if (rcsb[j] === '}') depth--; j++; } while (depth); vm.runInContext(rcsb.slice(m.index, j), ctx); }

const lines = []; let bad = 0, total = 0;
for (const id of fs.readdirSync(dir).filter((f) => f.endsWith('.cif')).map((f) => f.slice(0, -4))) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8');
  const entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {});
  ctx.applyDepositedSS?.(entry.atoms, text);   // sets a.ss like the loader does
  const classic = new Map();
  for (const a of entry.atoms) { if (!classic.has(a.asym)) classic.set(a.asym, []); classic.get(a.asym).push(a); }
  const model = parseMmcif(text), { rows, hidden } = sequenceRows(model, { maxRows: 1e9 });
  const summary = (list) => list.map(([asym, A]) => {
    A = A.slice().sort((x, y) => x.seq - y.seq);
    let gaps = 0, missing = 0;
    A.forEach((a, i) => { if (i && a.seq - A[i - 1].seq > 1) { gaps++; missing += a.seq - A[i - 1].seq - 1; } });
    return `${asym}:${A.length}r/${gaps}g/${missing}m/${A.filter((a) => a.ss === 1).length}h/${A.filter((a) => a.ss === 2).length}e`;
  }).join(' ');
  const mine = rows.map((row) => {
    let gaps = 0, missing = 0;
    for (const c of row.cells) if (c.gapBefore) { gaps++; missing += c.gapBefore.count; }
    return `${row.asym}:${row.cells.length}r/${gaps}g/${missing}m/${row.cells.filter((c) => c.structure === 'helix').length}h/${row.cells.filter((c) => c.structure === 'sheet').length}e`;
  }).join(' ');
  const old = summary([...classic.entries()]);
  total++;
  const same = old === mine && !hidden;
  if (!same) bad++;
  lines.push(`${same ? 'ok  ' : 'DIFF'} ${id}: ${same ? mine.split(' ').length + ' chains' : `classic [${old}] vs new [${mine}]`}`);
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
