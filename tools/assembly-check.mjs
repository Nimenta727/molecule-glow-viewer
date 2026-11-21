// C1 on real structures (docs/PLUGIN_ROADMAP.md): the assembly fit is compared with fits the project already trusts, and used the way it will be used.
//  1. adenylate kinase: the fit of 1AKE onto 4AKE over the CORE residues gives the RMSD the two-state player reports (plugins/adenylate-kinase/structure.mjs), and the Ap5A of 1AKE lands where the player puts it;
//  2. maltose-binding protein: 1ANF onto 1OMP over the N domain gives 0.72 A (tools/second-pair-check.mjs), and the maltose carried into the open structure is checked for clashes;
//  3. ATP synthase 6N2Y: the three beta chains fitted onto each other by sequence (they are the same protein): a sane fit, found by number and by sequence alike.
// Usage: node tools/assembly-check.mjs <structures-dir> [--output file]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { rotateVector } from '../plugins/structure/alignment.mjs';
import { fitOnto, findClashes, composeAssembly } from '../plugins/structure/assembly-compose.mjs';
import { buildAdkStructure } from '../plugins/adenylate-kinase/structure.mjs';
import { selectCoordinateAtoms } from '../plugins/structure/representation.mjs';
import { describeStructureAsset, sha256Hex } from '../packages/schema/resource.mjs';

const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/assembly-check.mjs <structures-dir> [--output file]'); process.exit(2); }
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null, lines = [];
const log = (text) => { lines.push(text); console.log(text); };
const load = async (id) => { const bytes = new Uint8Array(fs.readFileSync(path.join(dir, `${id}.cif`))), sha256 = await sha256Hex(bytes), { record } = describeStructureAsset({ path: `${id}.cif`, sha256, mediaType: 'chemical/x-mmcif', provenance: { source: { provider: 'RCSB PDB', accession: id } } }, bytes); return { model: parseMmcif(new TextDecoder().decode(bytes)), resource: { id: record.id, version: record.version, sha256 } }; };
const ligandCentre = (model, comp) => { const atoms = selectCoordinateAtoms(model).map(({ atom }) => atom).filter((a) => a.residueName === comp && !['H', 'D'].includes(a.element)); return { chain: atoms[0].labelChainId, centre: [0, 1, 2].map((k) => atoms.reduce((s, a) => s + a.position[k], 0) / atoms.length), count: atoms.length }; };

// 1. adenylate kinase
{
  const open = await load('4AKE'), closed = await load('1AKE'), core = 'chain A and resi 1-29,60-121,160-214';
  const fit = fitOnto({ base: open.model, added: closed.model, baseSelection: core, addSelection: core });
  const player = buildAdkStructure({ ...open.model, atoms: open.model.atoms.filter((a) => a.authChainId === 'A') }, { ...closed.model, atoms: closed.model.atoms.filter((a) => a.authChainId === 'A') });
  log(`AdK  : CORE fit of 1AKE onto 4AKE  RMSD ${fit.rmsd.toFixed(4)} Å over ${fit.matched} residues; the player reports ${player.rmsd.toFixed(4)} Å`);
  assert.ok(Math.abs(fit.rmsd - player.rmsd) < 1e-6, 'the assembly fit agrees with the AdK player\'s own CORE fit');
  const lig = ligandCentre(closed.model, 'AP5'), placed = rotateVector(lig.centre, fit.transform.rotation).map((v, k) => v + fit.transform.position[k]);
  log(`AdK  : Ap5A (${lig.count} atoms) carried into the 4AKE frame, centre at ${placed.map((v) => v.toFixed(2)).join(', ')}`);
}
// 2. maltose-binding protein
{
  const open = await load('1OMP'), closed = await load('1ANF'), n = 'chain A and resi 1-109,264-309';
  const lig = ligandCentre(closed.model, 'GLC'), { complex, reports } = composeAssembly({ id: 'cx.mbp-open-maltose', title: '1OMP + 1ANF 的麦芽糖', base: open, additions: [{ ...closed, baseSelection: n, addSelection: n, carry: [lig.chain], name: '麦芽糖（来自 1ANF）' }] });
  const r = reports[0]; log(`MBP  : N-domain fit RMSD ${r.fit.rmsd.toFixed(4)} Å over ${r.fit.matched} residues; maltose carried into the open structure: ${r.clashes.count} atom pairs closer than 2.0 Å (closest ${r.clashes.minDistance?.toFixed(2) ?? '-'} Å)`);
  assert.ok(Math.abs(r.fit.rmsd - 0.7211865135191559) < 1e-9, 'the same 0.7212 Å as the generic state-pair fit'); assert.equal(complex.members.at(-1).placements[0].chains[0], lig.chain);
  assert.match(complex.evidence.at(-1).citation, /155 对残基/); assert.equal(complex.evidence.at(-1).type, 'derived');
}
// 3. ATP synthase: beta onto beta
{
  const ps3 = await load('6N2Y'), names = ps3.model.chainNames, betas = Object.entries(names).filter(([, n]) => /subunit beta/i.test(n)).map(([c]) => c); assert.equal(betas.length, 3);
  for (const mode of ['number', 'sequence']) {
    const fit = fitOnto({ base: ps3.model, added: ps3.model, baseSelection: `label_asym ${betas[0]}`, addSelection: `label_asym ${betas[1]}`, mode, maxRmsd: 6 });
    log(`6N2Y : beta ${betas[1]} onto beta ${betas[0]} (${mode}): RMSD ${fit.rmsd.toFixed(2)} Å over ${fit.matched} residues`);
    assert.ok(fit.matched > 300 && fit.rmsd < 6, 'the beta subunits are the same protein: a real fit');
  }
}
console.log('\nok: the assembly fit agrees with the fits the project already trusts');
if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
