import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBiologicalAssembly, expandAssemblyExpression } from '../assembly.mjs';
import { parseMmcif, parsePdb } from '../parser.mjs';
import { buildRepresentations } from '../representation.mjs';

const cif = `data_assembly
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.auth_asym_id
_atom_site.label_seq_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA GLY X A 1 7 1 0 0
ATOM 2 C CA GLY Y B 1 7 3 0 0
loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 2 0 1 0 0 0 0 1 0
2 0 -1 0 0 1 0 0 0 0 0 1 0
_pdbx_struct_assembly_gen.assembly_id 1
_pdbx_struct_assembly_gen.asym_id_list X
_pdbx_struct_assembly_gen.oper_expression '(2)(1,2)'
`;

test('PDBx expression products expand lists and ranges in order', () => {
  assert.deepEqual(expandAssemblyExpression('(X0)(1-2,4)'), [['X0', '1'], ['X0', '2'], ['X0', '4']]);
  assert.throws(() => expandAssemblyExpression('(1-256)(1-256)'), /副本过多/);
  assert.throws(() => expandAssemblyExpression('(2)unknown(1)'), /无效/);
});

test('scalar assembly generators select label chains and apply the rightmost operation first', () => {
  const raw = parseMmcif(cif);
  const model = applyBiologicalAssembly(raw);
  assert.equal(model.assemblyId, '1');
  assert.deepEqual(model.atoms.map(({ authChainId, authSeqId, position, assemblyCopy }) =>
    [authChainId, authSeqId, position, assemblyCopy]), [
    ['A', '7', [0, 3, 0], '2 × 1'],
    ['A', '7', [-1, 0, 0], '2 × 2'],
  ]);
  assert.deepEqual(raw.atoms[0].position, [1, 0, 0]);
  assert.equal(new Set(buildRepresentations(model).map(({ key }) => key)).size, 2);
  assert.throws(() => applyBiologicalAssembly(raw, '2'), /没有所选/);
  assert.throws(() => applyBiologicalAssembly({ ...raw, assemblyOperators: [] }), /缺失/);
});

test('PDB REMARK 350 honors continued chain lists and leaves the source atoms unchanged', () => {
  const raw = parsePdb([
    'REMARK 350 BIOMOLECULE: 1',
    'REMARK 350 APPLY THE FOLLOWING TO CHAINS: A,',
    'REMARK 350                    AND CHAINS: B',
    'REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000  10.00000',
    'REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000   0.00000',
    'REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000   0.00000',
    'ATOM      1  CA  ALA A   1       1.250   2.000   3.000  1.00 10.00           C',
    'ATOM      2  CA  ALA B   1       2.250   2.000   3.000  1.00 10.00           C',
  ].join('\n'));
  const model = applyBiologicalAssembly(raw);
  assert.deepEqual(model.atoms.map(({ position }) => position[0]), [11.25, 12.25]);
  assert.deepEqual(raw.atoms.map(({ position }) => position[0]), [1.25, 2.25]);
});
