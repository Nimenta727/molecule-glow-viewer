// Differential test: the ribosome translation scheme written as data (plugins/simulation/translation.mjs, run by the generic Markov engine) against the
// classic code: `rates()` of src/sim/processes/translation.js, run unchanged on a stand-in object, with the constants of src/sim/translation-constants.js. For
// tens of thousands of random states (ribosome state, incoming tRNA class, drugs bound, E site, peptide length, A-site codon, penultimate residue, concentrations,
// ORF) the list of possible next events must be the same: the same events in the same order with exactly the same rates. The sequence tables the data model reads
// are compared with the classic genetic code and near-cognate sets too.
// Usage: node tools/translation-parity.mjs [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createMarkovRun } from '../plugins/simulation/markov-model.mjs';
import { translationModel, translationTables, ORFS, GENCODE, PREF_CODON, nearAA } from '../plugins/simulation/translation.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };

const ctx = vm.createContext({ THREE, console: { log() {}, warn() {}, error() {} }, Math });
vm.runInContext(`var PROCESSES = {}, RES_CHEM = {}, AA1 = {}, randVis = Math.random, rand = Math.random;`, ctx);
vm.runInContext(read('src/sim/translation-constants.js'), ctx);
vm.runInContext(`Object.assign(PROCESSES, {${read('src/sim/processes/translation.js')}\n});`, ctx);
const run = (code) => vm.runInContext(code, ctx);
ctx.__result = null;

// 1. constants and tables ---------------------------------------------------------------------------------------------------------------------------------------
{
  const classicCode = run('JSON.stringify(GENCODE)'), classicPref = run('JSON.stringify(PREF_CODON)'), classicK = run('JSON.stringify(TL_K)'), classicDrug = run('JSON.stringify(Object.fromEntries(Object.entries(TL_DRUG).map(([k, v]) => [k, { kon: v.kon, koff: v.koff, kd: v.kd }])))');
  check('genetic code, preferred codons: identical to the classic', classicCode === JSON.stringify(GENCODE) && classicPref === JSON.stringify(PREF_CODON), 'tables differ');
  const mine = translationModel(ORFS.ubq);
  const kSame = Object.entries(JSON.parse(classicK)).every(([k, v]) => k === 'dropErm' ? true : mine.constants[k] === v);
  check('elongation rate constants: identical to the classic TL_K', kSame, 'a constant differs');
  const drug = JSON.parse(classicDrug), dSame = ['TAC', 'PAR', 'CLM', 'ERY'].every((d) => mine.constants[`kon${d}`] === drug[d].kon && mine.constants[`koff${d}`] === drug[d].koff) && mine.constants.kdKIR === drug.KIR.kd && mine.constants.kdFUA === drug.FUA.kd;
  check('antibiotic binding constants (kon, koff, Kd): identical to the classic TL_DRUG', dSame, 'a constant differs');
  let worst = 0, tablesDiffer = 0, n = 0;
  for (const [key, aaSeq] of Object.entries(ORFS)) {
    const t = translationTables(aaSeq);
    for (let k = 1; k <= t.n; k++) {
      n++; const cod = t.codons[k];
      const classicNear = JSON.parse(run(`JSON.stringify(nearAA(${JSON.stringify(cod)}))`)), mineNear = nearAA(cod);
      if (JSON.stringify([...classicNear].sort()) !== JSON.stringify([...mineNear].sort())) tablesDiffer++;
      const stop = run(`GENCODE[${JSON.stringify(cod)}] === '*'`);
      if ((stop ? 2 : 1) !== t.codonClass[k]) tablesDiffer++;
      if (!stop && +['A', 'S', 'T'].includes(run(`GENCODE[${JSON.stringify(cod)}]`)) !== t.st[k]) tablesDiffer++;
      if (!stop) worst = Math.max(worst, Math.abs(classicNear.filter((a) => ['A', 'S', 'T'].includes(a)).length / Math.max(1, classicNear.length) - t.nearST[k]));
    }
    // the codon list is the classic mRNA: AUG, a preferred codon per residue, UAA
    const aa = aaSeq[0] === 'M' ? aaSeq : 'M' + aaSeq, expect = ['AUG', ...[...aa.slice(1)].map((x) => run(`PREF_CODON[${JSON.stringify(x)}]`)), 'UAA'];
    if (JSON.stringify(expect) !== JSON.stringify(t.codons)) tablesDiffer++;
  }
  check(`sequence tables for ${Object.keys(ORFS).length} ORFs, ${n} positions (codon class, Ala/Ser/Thr, near-cognate shares, the codon list): ${tablesDiffer} differences`, tablesDiffer === 0 && worst < 1e-15, `${tablesDiffer} / ${worst}`);
}

// 2. the rate tables: classic rates() against the data model --------------------------------------------------------------------------------------------------
{
  let a = 12345; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }, pick = (list) => list[Math.floor(rnd() * list.length)];
  const STATES = ['init', 'post', 'tc', 'cr', 'gtp', 'kir', 'rel', 'acc', 'pre', 'g', 'gpost', 'rf', 'term', 'drop'];
  const CONC = { TC: [0, 1, 25, 80], EFG: [0, 5, 20, 40], RF1: [0, 2, 10], TAC: [0, 0.5, 5, 50], PAR: [0, 0.1, 2, 20], CLM: [0, 1, 10, 50], ERY: [0, 0.05, 1, 5], KIR: [0, 0.05, 1, 5], FUA: [0, 0.1, 5, 20] };
  const runs = {}; let compared = 0, mismatches = 0, example = null, ids = new Set(), states = new Set();
  for (const [key, ermcl] of [['ubq', false], ['ermcl', true], ['polyu', false]]) { const model = translationModel(ORFS[key], { ermcl }); runs[key] = { run: createMarkovRun(model, 1), t: translationTables(ORFS[key]) }; }
  for (let i = 0; i < 40000; i++) {
    const key = pick(['ubq', 'ermcl', 'polyu']), { run: r, t } = runs[key], st = pick(STATES), k = 1 + Math.floor(rnd() * t.n), L = pick([1, 2, 3, 6, 7, 8, 9, 10, 15, 40]);
    let inc = pick(['none', 'c', 'n']); if (st === 'gtp' && inc === 'none') inc = pick(['c', 'n']);
    const kir = rnd() < 0.3, E = rnd() < 0.5, fua = rnd() < 0.3, drug = Object.fromEntries(['TAC', 'PAR', 'CLM', 'ERY'].map((d) => [d, rnd() < 0.35])), penST = L >= 2 ? +(rnd() < 0.5) : 0;
    const conc = Object.fromEntries(Object.entries(CONC).map(([c, v]) => [c, pick(v)]));
    ctx.__fake = { st, inc, kir, E, fua, drug, L, penST, k, conc, seq: t.codons.join(''), orfKey: key };
    const classic = run(`(() => { const f = __fake, T = PROCESSES.translation, me = Object.create(T);
      me.ctx = { cell: { ctrl: f.conc } }; me.seq = f.seq; me.pi = 3 * (f.k - 1); me.orfKey = f.orfKey; me.RF = {};
      me.pep = Array.from({ length: f.L }, (_, i) => ({ aa: i === f.L - 2 ? (f.penST ? 'A' : 'G') : 'G' }));
      me.s = { st: f.st, L: f.L, E: f.E, fua: f.fua, drug: { ...f.drug }, inc: f.inc === 'none' ? null : { cls: f.inc, kir: f.kir } };
      return me.rates().map(([r, id]) => [r, id]); })()`);
    const vars = { st, inc, kir: kir ? 'on' : 'off', E: E ? 'on' : 'off', fua: fua ? 'on' : 'off', ...Object.fromEntries(['TAC', 'PAR', 'CLM', 'ERY'].map((d) => [`b${d}`, drug[d] ? 'on' : 'off'])) };
    const mine = r.ratesAt({ vars, nums: { k, L, penST }, params: conc }); compared++; states.add(st); for (const [, id] of classic) ids.add(id);
    const same = classic.length === mine.length && classic.every(([rate, id], j) => mine[j][1] === id && mine[j][0] === rate);
    if (!same) { mismatches++; example ??= JSON.stringify({ key, st, inc, k, L, drug, E, conc, classic, mine }).slice(0, 600); }
  }
  check(`rate tables: ${compared} random states over ${states.size} ribosome states, ${ids.size} different events, 3 ORFs: the next events and their rates equal the classic, in the same order, to the last bit (${mismatches} differences)`, mismatches === 0, example);
}

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
