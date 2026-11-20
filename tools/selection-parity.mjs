// Differential test: the new selection language (plugins/structure/selection.mjs) against the classic one
// (src/derived/selection-language.js), run on real structures. Usage: node tools/selection-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { selectionSpace, evaluateSelection } from '../plugins/structure/selection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/selection-parity.mjs <structures-dir> [--output file]'); process.exit(2); }

const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
class CmdError extends Error {}
const ctx = vm.createContext({ THREE, CmdError, IGNORE_LIGANDS: new Set(['HOH', 'WAT']), glowSel: { r: [], l: [] }, groups: [], model: null });
for (const f of ['src/data/parse.js', 'src/derived/selection-language.js']) vm.runInContext(read(f), ctx);

// `entity "..."` is not compared: classic entity names are filled in by the running viewer (a.entName/a.part), which a headless run does not have;
// the new language reads them from the structure's own chain names (covered by unit tests).
const EXPRESSIONS = ['all', 'none', 'protein', 'nucleic', 'ligands', 'chain A', 'chain A,B', 'chain B and protein', 'resi 1-50', 'resi 10,20,30-40', 'resi -3-5',
  'resn HIS,CYS', 'resn GLY and chain A', 'not protein', 'not (chain A or chain B)', 'protein and not resn ALA,GLY', 'within 5 of ligands', 'within 4 of resn HIS',
  'within 8 of (chain A and resi 1-20)', 'protein and within 6 of ligands', 'ligand ATP', 'ligand MG,ZN,K', 'label_seq 5-40', 'asym A', 'label_asym A', 'resi 52A', 'resi 1A-30'];

const lines = [];
let bad = 0, total = 0;
for (const id of fs.readdirSync(dir).filter((f) => f.endsWith('.cif')).map((f) => f.slice(0, -4))) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8');
  const model = parseMmcif(text), space = selectionSpace(model);
  const entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {});
  vm.runInContext('0', ctx);
  ctx.groups = [{ atoms: entry.atoms }]; ctx.model = { ligands: entry.ligands };
  const classicKey = (a) => `${a.ach}|${a.aseq}|${a.ins}|${a.resn}`;
  const newKey = (r) => `${r.chain}|${r.atom.authSeqId}|${r.insertion}|${r.resn}`;
  const ligKey = (x) => `${x.comp}|${x.asym}`;
  for (const e of EXPRESSIONS) {
    let a, b;
    try { a = ctx.evalSel(ctx.parseSel(e)); } catch (error) { a = { error: String(error.message) }; }
    try { b = evaluateSelection(e, space); } catch (error) { b = { error: String(error.message) }; }
    total++;
    let same;
    if (a.error || b.error) same = !!a.error === !!b.error;
    else {
      const ra = a.r.map(classicKey).sort().join(), rb = b.residues.map(newKey).sort().join();
      const la = a.l.map((x) => `${x.comp}|${x.asym}`).sort().join(), lb = b.ligands.map(ligKey).sort().join();
      same = ra === rb && la === lb && a.r.length === b.residues.length;
    }
    if (!same) { bad++; lines.push(`DIFF ${id} "${e}": classic ${a.error ?? `${a.r.length}r/${a.l.length}l`} vs new ${b.error ?? `${b.residues.length}r/${b.ligands.length}l`}`); }
    else lines.push(`ok   ${id} "${e}": ${a.error ? 'both reject' : `${a.r.length}r/${a.l.length}l`}`);
  }
}
console.log(lines.join('\n'));
console.log(`\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
