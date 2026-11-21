// D1 on a real complex (docs/PLUGIN_ROADMAP.md): Bacillus PS3 ATP synthase (6N2Y). The topology of its parts is known in advance and is a geometric fact the coordinates have to show: in the F1 head the three
// alpha and three beta subunits alternate round a ring, so every beta touches exactly two alphas and every alpha two betas (and the same-kind subunits do not touch each other); the c subunits form a ring of
// ten, so each touches exactly two others. The contacts are computed from the coordinates only; the expectations come from the architecture of the enzyme, not from the numbers printed.
// Usage: node tools/interaction-check.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { describeStructureAsset, sha256Hex } from '../packages/schema/resource.mjs';
import { complexFromStructure } from '../packages/schema/complex.mjs';
import { interactionsOfComplex, degrees } from '../plugins/structure/interaction-evidence.mjs';

const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/interaction-check.mjs <structures-dir> [--output file]'); process.exit(2); }
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null, lines = [];
const log = (t) => { lines.push(t); console.log(t); };
const bytes = new Uint8Array(fs.readFileSync(path.join(dir, '6N2Y.cif'))), sha256 = await sha256Hex(bytes), { record } = describeStructureAsset({ path: '6N2Y.cif', sha256, mediaType: 'chemical/x-mmcif', provenance: { source: { provider: 'RCSB PDB', accession: '6N2Y' } } }, bytes);
const resource = { id: record.id, version: record.version, sha256 }, model = parseMmcif(new TextDecoder().decode(bytes));
const complex = complexFromStructure({ model, resource, id: 'cx.6n2y', title: '6N2Y', citation: 'RCSB 6N2Y' });
const proteinMembers = complex.members.filter((m) => /ATP synthase/.test(m.name));   // the protein subunits (not the ligands and ions)
const sub = { ...complex, members: proteinMembers };
const result = interactionsOfComplex({ complex: sub, models: new Map([[`${resource.id}@${resource.version}`, model]]), cutoff: 4.5, minContacts: 10 });
log(`${proteinMembers.reduce((n, m) => n + m.copies, 0)} protein chains, ${result.checked} pairs checked, ${result.interactions.length} interacting pairs`);
const kind = (name) => (/subunit alpha/i.test(name) ? 'alpha' : /subunit beta/i.test(name) ? 'beta' : /subunit c$/i.test(name) ? 'c' : /gamma/i.test(name) ? 'gamma' : 'other');
const pairs = new Map(); for (const { a, b, contacts } of result.interactions) { const key = [kind(a.name), kind(b.name)].sort().join('-'); pairs.set(key, (pairs.get(key) ?? 0) + 1); void contacts; }
log('pairs by kind: ' + [...pairs].map(([k, n]) => `${k} ${n}`).join(', '));
const neighboursOf = (target, other) => { const count = new Map(); for (const { a, b } of result.interactions) { for (const [x, y] of [[a, b], [b, a]]) if (kind(x.name) === target && kind(y.name) === other) { const id = `${x.member}#${x.copy}`; count.set(id, (count.get(id) ?? 0) + 1); } } return count; };
const betaAlpha = neighboursOf('beta', 'alpha'), alphaBeta = neighboursOf('alpha', 'beta'), cc = neighboursOf('c', 'c');
log(`each beta touches ${[...betaAlpha.values()].join(', ')} alpha(s); each alpha touches ${[...alphaBeta.values()].join(', ')} beta(s); each c touches ${[...cc.values()].join(', ')} other c`);
assert.equal(betaAlpha.size, 3); assert.ok([...betaAlpha.values()].every((n) => n === 2), 'every beta touches exactly two alphas (alternating hexamer)');
assert.equal(alphaBeta.size, 3); assert.ok([...alphaBeta.values()].every((n) => n === 2), 'every alpha touches exactly two betas');
assert.equal(neighboursOf('alpha', 'alpha').size + neighboursOf('beta', 'beta').size, 0, 'alphas do not touch alphas, betas do not touch betas');
assert.equal(cc.size, 10); assert.ok([...cc.values()].every((n) => n === 2), 'the ten c subunits form a ring: each touches exactly two');
assert.ok(result.interactions.every((i) => i.level === 'experimental'), 'all from one deposited entry: experimental'); assert.ok(result.interactions.some((i) => kind(i.a.name) === 'gamma' || kind(i.b.name) === 'gamma'), 'the central gamma stalk touches the head');
const top = result.interactions[0]; log(`largest interface: ${top.a.name} (${top.a.chains}) with ${top.b.name} (${top.b.chains}): ${top.contacts} atom pairs, ${top.residues.a.length} + ${top.residues.b.length} residues`);
console.log('\nok: the architecture of the enzyme is what the coordinates show');
if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
