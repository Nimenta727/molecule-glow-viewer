// Differential test (offline): UniProt site mapping of plugins/structure/functional-sites.mjs against the classic loadSeqFeatures
// (src/ui/sequence-bar.js), both fed the same recorded RCSB / UniProt responses. Usage: node tools/sites-parity.mjs [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadFunctionalSites } from '../plugins/structure/functional-sites.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIX = path.join(ROOT, 'plugins/structure/test/fixtures');
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
const source = fs.readFileSync(path.join(ROOT, 'src/ui/sequence-bar.js'), 'utf8');
const slice = (startMarker, endMarker) => source.slice(source.indexOf(startMarker), source.indexOf(endMarker));
const ctx = vm.createContext({ console, JSON, Promise, Object, Math, current: null, fetchText: null });
vm.runInContext(slice('const FT_CAT', 'let seqFt'), ctx);
vm.runInContext(slice('async function loadSeqFeatures', 'function markSeqFeatures'), ctx);

const lines = []; let bad = 0;
for (const entry of ['4AKE', '1K4C']) {
  const graphql = fs.readFileSync(path.join(FIX, `rcsb-align-${entry}.json`), 'utf8');
  const uniprot = (url) => { const acc = /uniprotkb\/([A-Z0-9]+)\.json/.exec(url)?.[1]; const f = path.join(FIX, `uniprot-${acc}.json`); if (!fs.existsSync(f)) throw new Error('no fixture ' + acc); return fs.readFileSync(f, 'utf8'); };
  ctx.current = { id: entry, local: false };
  ctx.fetchText = async (url) => url.includes('graphql') ? graphql : uniprot(url);
  const classic = await vm.runInContext('loadSeqFeatures()', ctx);
  const fetchJson = async (url) => JSON.parse(url.includes('graphql') ? graphql : uniprot(url));
  const next = (await loadFunctionalSites(entry, { fetchJson })).sites;
  const norm = (sites) => JSON.stringify(Object.keys(sites).sort().map((t) => [t, sites[t].map((s) => [s.asyms.join(), s.from, s.to, s.to2 ?? null, s.text, s.acc ?? s.accession]).sort()]));
  const same = norm(classic) === norm(next);
  if (!same) bad++;
  const count = Object.values(next).reduce((n, l) => n + l.length, 0);
  lines.push(`${same ? 'ok  ' : 'DIFF'} ${entry}: ${Object.keys(next).length} categories, ${count} sites${same ? '' : ` — classic ${norm(classic)} vs new ${norm(next)}`}`);
}
console.log(lines.join('\n') + `\n\n${lines.length - bad}/${lines.length} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${lines.length - bad}/${lines.length} identical\n`);
process.exitCode = bad ? 1 : 0;
