// Differential test: domain motions of the generic conformation pair (plugins/motion/state-pair.mjs, fit on a core selection) against the adenylate kinase
// player's measurements (plugins/adenylate-kinase/structure.mjs), which were verified against the classic code. 4AKE (open) and 1AKE (closed), chain A,
// CORE / NMP / LID with the work configuration's residue ranges. Usage: node tools/domain-motion-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace, evaluateSelection } from '../plugins/structure/selection.mjs';
import { fitStates, domainMotions } from '../plugins/motion/state-pair.mjs';
import { buildAdkStructure } from '../plugins/adenylate-kinase/structure.mjs';
import { ADK_4AKE_TEMPLATE } from '../plugins/adenylate-kinase/config.mjs';

const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/domain-motion-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const open = parseMmcif(fs.readFileSync(path.join(dir, '4AKE.cif'), 'utf8')), closed = parseMmcif(fs.readFileSync(path.join(dir, '1AKE.cif'), 'utf8'));
const onlyA = (m) => ({ ...m, atoms: m.atoms.filter((a) => a.authChainId === 'A') });
const adk = buildAdkStructure(onlyA(open), onlyA(closed));

const space = selectionSpace(open);
const expression = (domain) => `chain A and resi ${domain.ranges.map(([lo, hi]) => `${lo}-${hi}`).join(',')}`;
const residuesOf = (domain) => new Set(evaluateSelection(expression(domain), space).residues);
const domains = ADK_4AKE_TEMPLATE.domains, core = domains.find(({ name }) => name === ADK_4AKE_TEMPLATE.fitDomain);
const fit = fitStates(open, closed, { core: residuesOf(core) });

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
check(`core selection "${expression(core)}": ${fit.coreCount} residues fitted (AdK: ${adk.matched} CA in the chain)`, fit.coreCount === domains.find((d) => d.name === 'CORE').ranges.reduce((n, [lo, hi]) => n + hi - lo + 1, 0), `${fit.coreCount}`);
for (const fraction of [1, 0.5, 0.25]) {
  const mine = domainMotions(fit, domains.filter((d) => d.name !== core.name).map((d) => ({ name: d.name, residues: residuesOf(d) })), fraction);
  const reference = adk.measurements(fraction);
  for (const r of reference) {
    const m = mine.find((x) => x.name === r.name);
    const dAngle = Math.abs(m.angle - r.angle), dShift = Math.abs(m.shift - r.shift);
    check(`fraction ${fraction} ${r.name}: ${r.angle.toFixed(3)}° / ${r.shift.toFixed(3)} Å (differences ${dAngle.toExponential(1)}° / ${dShift.toExponential(1)} Å)`, dAngle < 1e-6 && dShift < 1e-6, `generic ${m.angle}/${m.shift} vs AdK ${r.angle}/${r.shift}`);
  }
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
