// Checks the complex records made from real structures against what the entries themselves say (their chain names), for the complexes the project already works with:
// the stoichiometry of bovine ATP synthase 6ZPO (alpha3 beta3 gamma delta epsilon, c8) and of Bacillus PS3 6N2Y (alpha3 beta3 gamma delta epsilon, b2, a, c10), and that a ribosome entry
// (4V6F) yields members that all resolve. Usage: node tools/complex-check.mjs <structures-dir>   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; 4V6F from tools/fixtures is not pinned: it is skipped when absent)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { describeStructureAsset, sha256Hex } from '../packages/schema/resource.mjs';
import { complexFromStructure, stoichiometry, resolveComplex, diagnoseComplex } from '../packages/schema/complex.mjs';

const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/complex-check.mjs <structures-dir>'); process.exit(2); }
async function build(id) {
  const file = path.join(dir, `${id}.cif`); if (!fs.existsSync(file)) return null;
  const bytes = new Uint8Array(fs.readFileSync(file)), sha256 = await sha256Hex(bytes);
  const { record } = describeStructureAsset({ path: `${id}.cif`, sha256, mediaType: 'chemical/x-mmcif', provenance: { source: { provider: 'RCSB PDB', accession: id } } }, bytes);
  const resource = { id: record.id, version: record.version, sha256 };
  return { resource, complex: complexFromStructure({ model: parseMmcif(new TextDecoder().decode(bytes)), resource, id: `cx.${id.toLowerCase()}`, title: id }) };
}
const count = (cx, pattern) => [...stoichiometry(cx)].filter(([name]) => pattern.test(name)).reduce((n, [, c]) => n + c, 0);
let checks = 0; const ok = (what, cond, detail = '') => { assert.ok(cond, `${what} ${detail}`); checks++; console.log('ok  ', what, detail); };

const ps3 = await build('6N2Y');
if (ps3) {
  const cx = ps3.complex;
  ok('6N2Y: alpha x3, beta x3', count(cx, /subunit alpha/i) === 3 && count(cx, /subunit beta/i) === 3);
  ok('6N2Y: gamma, epsilon, delta once each; subunit a once; subunit b twice', count(cx, /gamma chain/i) === 1 && count(cx, /epsilon chain/i) === 1 && count(cx, /subunit delta/i) === 1 && count(cx, /subunit a$/i) === 1 && count(cx, /subunit b$/i) === 2);
  ok('6N2Y: the c ring has ten subunits', count(cx, /subunit c$/i) === 10);
  const held = new Map([[`${ps3.resource.id}@${ps3.resource.version}`, ps3.resource.sha256]]), { instances } = resolveComplex(cx, held);
  ok('6N2Y: every copy resolves, with the entry as its evidence', instances.length === cx.members.reduce((n, m) => n + m.copies, 0) && instances.every((i) => i.evidence.type === 'experimental'), `${instances.length} instances`);
  ok('6N2Y: nothing for the author to fix', diagnoseComplex(cx, held).length === 0);
}
const bovine = await build('6ZPO');
if (bovine) {
  const cx = bovine.complex;
  ok('6ZPO: alpha x3, beta x3 (mitochondrial subunits)', count(cx, /subunit alpha/i) === 3 && count(cx, /subunit beta/i) === 3);
  ok('6ZPO: the c ring has eight subunits (bovine c8)', count(cx, /subunit C1/i) === 8);
}
const ribosome = await build('4V6F');
if (ribosome) {
  const held = new Map([[`${ribosome.resource.id}@${ribosome.resource.version}`, ribosome.resource.sha256]]), { instances, missing, mismatched } = resolveComplex(ribosome.complex, held);
  ok('4V6F: a large entry (many entities) becomes members that all resolve', missing.length === 0 && mismatched.length === 0 && instances.length > 100, `${ribosome.complex.members.length} members, ${instances.length} copies`);
}
console.log(`\n${checks} checks passed`);
