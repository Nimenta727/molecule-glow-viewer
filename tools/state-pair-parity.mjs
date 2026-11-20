// Differential test: the conformation pair (plugins/motion/state-pair.mjs) against the classic "states" morph set-up in src/core/load-scene.js
// (match by asym|seq, superpose B onto A over all matched residues, p2 = fitted B position, B's ligands moved with the same fit), run on real structure
// pairs. Usage: node tools/state-pair-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { fitStates, stateLigands } from '../plugins/motion/state-pair.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/state-pair-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));

const loadScene = read('src/core/load-scene.js');
const i = loadScene.indexOf('const B = keepChains(entryB);'), j = loadScene.indexOf('// ---- orientation', i);
if (i < 0 || j < 0) throw new Error('classic morph set-up not found');
const setup = loadScene.slice(i, j);
const ctx = vm.createContext({ THREE, console, Math, Map, Set, Array, Object, Number, String, JSON, IGNORE_LIGANDS: new Set(['HOH', 'WAT']), status: () => {}, cfg: { states: ['A', 'B'] } });
vm.runInContext(read('src/derived/geometry.js'), ctx);
vm.runInContext(read('src/data/parse.js'), ctx);
vm.runInContext(`function morphSetup(main, entryB, keepChains) { if (entryB) { ${setup} }`, ctx);

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const pairsToTry = [['4AKE', '1AKE'], ['1K4C', '5VK6'], ['5VK6', '5VKE'], ['1K4C', '5VKE'], ['2HVK', '2ITD']];
for (const [idA, idB] of pairsToTry) {
  const textA = fs.readFileSync(path.join(dir, idA + '.cif'), 'utf8'), textB = fs.readFileSync(path.join(dir, idB + '.cif'), 'utf8');
  const classicA = ctx.rowsToEntry(ctx.parseAtomSite(textA), {}), classicB = ctx.rowsToEntry(ctx.parseAtomSite(textB), {});
  for (const a of classicA.atoms) a.p2 = undefined;
  ctx.morphSetup(classicA, classicB, (e) => e);
  const matchedClassic = classicA.atoms.filter((a) => a.p2);
  let mine;
  try { mine = fitStates(parseMmcif(textA), parseMmcif(textB)); } catch (error) { check(`${idA} ⇄ ${idB}: fit`, matchedClassic.length < 3, `new refused (${error.message}) but classic matched ${matchedClassic.length}`); continue; }
  check(`${idA} ⇄ ${idB}: ${mine.matched} matched residues`, matchedClassic.length === mine.matched, `classic ${matchedClassic.length} vs new ${mine.matched}`);
  if (matchedClassic.length !== mine.matched) continue;
  let maxError = 0;
  mine.pairs.forEach(({ a, b }, k) => {
    const c = matchedClassic[k], t = mine.fit(b.position);
    maxError = Math.max(maxError, Math.hypot(c.p2.x - t[0], c.p2.y - t[1], c.p2.z - t[2]), Math.hypot(c.p.x - a.position[0], c.p.y - a.position[1], c.p.z - a.position[2]));
  });
  check(`${idA} ⇄ ${idB}: fitted target positions, max difference ${maxError.toExponential(1)} Å`, maxError < 1e-6, `max error ${maxError}`);
  const classicLigands = classicA.ligands.filter((L) => L.state === 1), mineLigands = stateLigands(parseMmcif(textB), mine);
  let ligandError = 0;
  const same = classicLigands.length === mineLigands.length;
  if (same) classicLigands.forEach((L, k) => L.atoms.forEach((x, n) => { const m = mineLigands[k].atoms[n].position; ligandError = Math.max(ligandError, Math.hypot(x.p.x - m[0], x.p.y - m[1], x.p.z - m[2])); }));
  check(`${idA} ⇄ ${idB}: ${mineLigands.length} state-B small molecules moved by the same fit`, same && ligandError < 1e-6, `classic ${classicLigands.length} vs new ${mineLigands.length}, error ${ligandError}`);
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
