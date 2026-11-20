import assert from 'node:assert/strict';
import test from 'node:test';
import { fitToReference, loadAlignedEntry } from '../entry-alignment.mjs';
import { rotateVector } from '../../structure/alignment.mjs';

// A made-up rRNA of 120 residues and a copy of it turned and moved (with a few residues out of place), as another crystal of the same ribosome would be.
const rna = Array.from({ length: 120 }, (_, i) => [40 * Math.cos(i / 9), 3 * i - 180, 40 * Math.sin(i / 9)]);
const q = [0, Math.sin(0.4), 0, Math.cos(0.4)], move = (p) => rotateVector(p, q).map((v, k) => v + [30, -20, 55][k]), moved = rna.map(move);
const scene = rna.map((p, i) => ({ p, seq: i + 1, aseq: String(i + 1) }));
const rows = (list, shift = 0) => list.map((p, i) => ({ p: i % 25 === 3 ? p.map((v) => v + 40) : p, seq: i + 1 + shift, aseq: String(i + 1) }));   // 5 residues are far out of place (a flexible loop)

test('the fit sends the entry onto the scene; residues that are far out are dropped and the fit repeated; the better numbering wins', () => {
  const fit = fitToReference(scene, rows(moved, 1000));   // the label numbers do not match (offset 1000): the author numbers do
  assert.equal(fit.key, 'aseq'); assert.ok(fit.n >= 110 && fit.n <= 115, `${fit.n} of ${fit.of}`); assert.ok(fit.rmsd < 1e-6, `${fit.rmsd}`);
  assert.ok(fit.f(moved[50]).every((v, k) => Math.abs(v - rna[50][k]) < 1e-6), 'a good residue lands on its partner');
  assert.equal(fitToReference(scene, rows(moved, 0)).key, 'seq', 'label numbers agree: they are tried first and win ties on fit');
  assert.equal(fitToReference(scene, rows(moved.slice(0, 10))), null, 'fewer than 20 pairs: no fit');
});

// a minimal ModelServer: mmCIF text of the atoms asked for
const cif = (atoms) => `data_X\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_alt_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_entity_id\n_atom_site.label_seq_id\n_atom_site.pdbx_PDB_ins_code\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.occupancy\n_atom_site.B_iso_or_equiv\n_atom_site.auth_seq_id\n_atom_site.auth_comp_id\n_atom_site.auth_asym_id\n_atom_site.auth_atom_id\n_atom_site.pdbx_PDB_model_num\n${atoms.map((a, i) => `${a.group ?? 'ATOM'} ${i + 1} ${a.el} ${a.name} . ${a.comp} ${a.asym} 1 ${a.seq} ? ${a.p[0].toFixed(3)} ${a.p[1].toFixed(3)} ${a.p[2].toFixed(3)} 1.00 10.00 ${a.seq} ${a.comp} ${a.asym} ${a.name} 1`).join('\n')}\n`;
const entry = [
  ...moved.map((p, i) => ({ el: 'P', name: 'P', comp: 'A', asym: 'RR', seq: i + 1, p })),
  ...Array.from({ length: 30 }, (_, i) => ({ el: 'C', name: 'CA', comp: 'ALA', asym: 'FA', seq: i + 1, p: move([5 * i, 0, 90]) })),
  ...Array.from({ length: 30 }, (_, i) => ({ el: 'C', name: 'CA', comp: 'GLY', asym: 'FB', seq: i + 1, p: move([5 * i, 20, 90]) })),
  { group: 'HETATM', el: 'C', name: 'C1', comp: 'DRG', asym: 'L1', seq: 1, p: move([0, 0, 0]) }, { group: 'HETATM', el: 'O', name: 'O1', comp: 'DRG', asym: 'L1', seq: 1, p: move([2, 0, 0]) },
  { group: 'HETATM', el: 'C', name: 'C1', comp: 'DRG', asym: 'L2', seq: 1, p: move([100, 100, 0]) },
];
const graphql = async (query) => { assert.match(query, /entry_id:"9XYZ"/); return { data: { entry: {
  polymer_entities: [{ rcsb_polymer_entity: { pdbx_description: '23S ribosomal RNA' }, rcsb_polymer_entity_container_identifiers: { asym_ids: ['RR'] } }, { rcsb_polymer_entity: { pdbx_description: 'Elongation factor A' }, rcsb_polymer_entity_container_identifiers: { asym_ids: ['FA', 'FB'] } }],
  assemblies: [{ rcsb_assembly_container_identifiers: { assembly_id: '1' }, pdbx_struct_assembly_gen: [{ asym_id_list: ['RR', 'FA', 'L1'] }] }] } } }; };
const fetchText = async (url) => { const m = /atoms\?(.*?)&encoding/.exec(url)[1], asym = /label_asym_id=(\w+)/.exec(m)?.[1], name = /label_atom_id=(\w+)/.exec(m)?.[1], comp = /label_comp_id=(\w+)/.exec(m)?.[1];
  return cif(entry.filter((a) => (!asym || a.asym === asym) && (!name || a.name === name) && (!comp || a.comp === comp))); };

test('loadAlignedEntry: the reference chain is found by name, the entry is fitted, and only chains of assembly 1 are used; chains and the nearest ligand copy come out in the scene frame', async () => {
  const out = await loadAlignedEntry('9XYZ', { ref: '23S', refAtoms: scene, chains: [['f', 'Elongation factor']], ligands: ['DRG'], near: { DRG: [0, 0, 0] } }, { fetchJson: graphql, fetchText });
  assert.equal(out.refAsym, 'RR'); assert.ok(out.rmsd < 1e-2 && out.nFit === 120, `${out.nFit} ${out.rmsd}`);
  assert.equal(out.chains.f.asym, 'FA', 'chain FB is not in assembly 1'); assert.equal(out.chains.f.atoms.length, 30);
  assert.ok(out.chains.f.atoms[5].p.every((v, k) => Math.abs(v - [25, 0, 90][k]) < 1e-2), 'a factor residue is back where it was in the scene frame');
  assert.deepEqual(out.ligands.DRG.atoms.map((a) => a.name), ['C1', 'O1'], 'L1 is in the assembly and nearest to the point; L2 is not');
  assert.ok(Math.hypot(...out.ligands.DRG.centre.map((v, k) => v - [1, 0, 0][k])) < 1e-2);
  await assert.rejects(loadAlignedEntry('9XYZ', { ref: 'nothing', refAtoms: scene }, { fetchJson: graphql, fetchText }), /找不到参考链/);
});
