// 4.3 completion gate, software part on real data: the generic conformation pair (plugins/motion/state-pair.mjs + the selection language) is configured for a SECOND real
// structure pair with configuration only — maltose-binding protein, ligand-free "open" 1OMP and maltose-bound "closed" 1ANF (one chain A of 370 residues each) — and no plugin source
// changes. The domain boundaries are the two domains of the protein (N: 1-109 and 264-309, C: 114-259 and 317-370; the rest is the hinge). The checks are about the geometry of the two
// coordinate sets: a rigid core, a large rotation of the other domain, a motion that is the same seen from either domain, and an interpolation that grows with the fraction.
// Usage: node tools/second-pair-check.mjs <structures-dir> [--output file]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures)
import fs from 'node:fs';
import path from 'node:path';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace, evaluateSelection } from '../plugins/structure/selection.mjs';
import { fitStates, domainMotions } from '../plugins/motion/state-pair.mjs';
import { buildAdkStructure } from '../plugins/adenylate-kinase/structure.mjs';
import { MBP_1OMP_1ANF_TEMPLATE } from '../plugins/adenylate-kinase/templates.mjs';

const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/second-pair-check.mjs <structures-dir> [--output file]'); process.exit(2); }
export const CONFIG = { core: 'chain A and resi 1-109,264-309', domains: [['N', 'chain A and resi 1-109,264-309'], ['C', 'chain A and resi 114-259,317-370'], ['hinge', 'chain A and resi 110-113,260-263,310-316']] };
const open = parseMmcif(fs.readFileSync(path.join(dir, '1OMP.cif'), 'utf8')), closed = parseMmcif(fs.readFileSync(path.join(dir, '1ANF.cif'), 'utf8'));
const space = selectionSpace(open), residues = (expression) => new Set(evaluateSelection(expression, space).residues);
const lines = []; let bad = 0, total = 0;
const check = (what, ok, detail) => { total++; if (!ok) bad++; lines.push(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`); };

const fitN = fitStates(open, closed, { core: residues(CONFIG.core) });
const moves = (fit, name, fraction) => domainMotions(fit, CONFIG.domains.filter(([n]) => n === name).map(([n, e]) => ({ name: n, residues: residues(e) })), fraction)[0];
check('370 residues matched between 1OMP and 1ANF', fitN.pairs.length === 370, `${fitN.pairs.length}`);
check(`N domain is a rigid core: ${fitN.coreCount} residues fit within 1 Å`, fitN.coreCount === 155 && fitN.rmsdCore < 1, `RMSD ${fitN.rmsdCore.toFixed(2)} Å`);
const c = moves(fitN, 'C', 1);
check('C domain turns by a large angle relative to the N domain (30–45°)', c.angle > 30 && c.angle < 45, `${c.angle.toFixed(1)}°, centre shift ${c.shift.toFixed(1)} Å`);
const fitC = fitStates(open, closed, { core: residues(CONFIG.domains[1][1]) }), n = moves(fitC, 'N', 1);
check('the same rotation is found with the C domain as core (symmetric within 0.5°)', Math.abs(n.angle - c.angle) < 0.5, `${n.angle.toFixed(1)}° vs ${c.angle.toFixed(1)}°`);
const h = moves(fitN, 'hinge', 1);
check('the hinge residues sit between the two domains: they turn less than the C domain', h.angle < c.angle, `${h.angle.toFixed(1)}° vs ${c.angle.toFixed(1)}°`);
const angles = [0, 0.25, 0.5, 0.75, 1].map((f) => moves(fitN, 'C', f).angle);
check('the C domain angle is 0 at fraction 0 and grows monotonically to the full angle', angles[0] < 1e-6 && angles.every((a, i) => !i || a > angles[i - 1]) && Math.abs(angles[4] - c.angle) < 1e-9, angles.map((a) => a.toFixed(1)).join(' → '));
check('a global fit (no core) is worse for the rigid domain than the core fit', fitStates(open, closed, {}).rmsdCore > fitN.rmsdCore, 'the global fit spreads the domain motion over the whole chain');
// the same pair through the other code path: the two-state player's structure builder (the one adenylate kinase uses), configured only by the MBP template
const player = buildAdkStructure(open, closed, MBP_1OMP_1ANF_TEMPLATE), pm = player.measurements(1), pc = pm.find((x) => x.name === 'C'), ph = pm.find((x) => x.name === '铰链');
check('the player\'s structure builder, given only the MBP template, agrees with the generic fit (RMSD, C domain, hinge)',
  Math.abs(player.rmsd - fitN.rmsdCore) < 1e-9 && Math.abs(pc.angle - c.angle) < 1e-9 && Math.abs(pc.shift - c.shift) < 1e-9 && Math.abs(ph.angle - h.angle) < 1e-9,
  `RMSD ${player.rmsd.toFixed(4)} Å, C ${pc.angle.toFixed(2)}° / ${pc.shift.toFixed(2)} Å, hinge ${ph.angle.toFixed(2)}°`);
check('the reference ligand (maltose, chain B of 1ANF) is found: 23 atoms', player.inhibitor.molecule.length === 23, `${player.inhibitor.molecule.length}`);
const text = lines.join('\n') + `\n\n${total - bad}/${total} checks passed (maltose-binding protein, 1OMP open / 1ANF closed; config: ${JSON.stringify(CONFIG)})`;
console.log(text); if (out) fs.writeFileSync(out, text + '\n');
process.exitCode = bad ? 1 : 0;
