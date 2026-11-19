import assert from 'node:assert/strict';
import test from 'node:test';
import { CoordinateParseError, parseMmcif, parsePdb } from '../parser.mjs';

function pdbAtom({ record = 'ATOM', serial = '1', name = ' CA ', alt = '', residue = 'GLY', chain = 'A', seq = '7', insertion = '', xyz = [1.25, -2, 3], element = 'C' } = {}) {
  const chars = Array(80).fill(' ');
  const put = (start, end, value) => { chars.splice(start, end - start, ...String(value).padEnd(end - start, ' ').slice(0, end - start)); };
  put(0, 6, record); put(6, 11, serial.padStart(5)); put(12, 16, name); put(16, 17, alt);
  put(17, 20, residue); put(21, 22, chain); put(22, 26, seq.padStart(4)); put(26, 27, insertion);
  put(30, 38, xyz[0].toFixed(3).padStart(8)); put(38, 46, xyz[1].toFixed(3).padStart(8)); put(46, 54, xyz[2].toFixed(3).padStart(8));
  put(76, 78, element.padStart(2));
  return chars.join('');
}

function cifFixture() {
  return `data_synthetic
loop_
_entity.id
_entity.pdbx_description
1 'Primary subunit'
loop_
_struct_asym.id
_struct_asym.entity_id
X 1
# A quoted and multiline non-coordinate value must not shift atom columns.
loop_
_struct_conf.conf_type_id
_struct_conf.beg_auth_asym_id
_struct_conf.beg_auth_seq_id
_struct_conf.end_auth_seq_id
_struct_conf.beg_label_asym_id
_struct_conf.beg_label_seq_id
_struct_conf.end_label_seq_id
_struct_conf.details
HELX_RH_AL_P 'chain A' 10 12 X 2 4
;
synthetic multiline annotation
with additional words
;
# atom site loop has two model numbers and a retained alternate.
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.auth_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.auth_comp_id
_atom_site.label_asym_id
_atom_site.auth_asym_id
_atom_site.label_seq_id
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.pdbx_PDB_model_num
ATOM 1 C CA CA . GLY GLY X 'chain A' 2 10 ? 1.0 2.0 3.0 1
ATOM 2 N N N B GLY GLY X 'chain A' 2 10 A 4.0 5.0 6.0 1
HETATM 3 O 'O atom' 'O atom' . HOH HOH X 'chain A' . 99 . .5 -1.25 2 2
#
`;
}

test('PDB fixed columns preserve mapping fields, alternate locations and explicit models', () => {
  const pdb = [
    'MODEL        1',
    pdbAtom({ serial: '00042', alt: 'B', seq: '-12', insertion: 'A', xyz: [0.125, -1.5, 2], element: 'N' }),
    'ENDMDL',
    'MODEL        2',
    pdbAtom({ record: 'HETATM', serial: '88', name: ' O  ', residue: 'HOH', seq: '4', xyz: [9, 8, 7], element: 'O' }),
    'ENDMDL',
  ].join('\n');
  const parsed = parsePdb(pdb);
  assert.equal(parsed.format, 'pdb');
  assert.deepEqual(parsed.atoms.map((atom) => atom.modelId), ['1', '2']);
  assert.deepEqual(parsed.atoms.map((atom) => atom.record), ['ATOM', 'HETATM']);
  assert.equal(parsed.atoms[0].serial, '00042');
  assert.equal(parsed.atoms[0].name, 'CA');
  assert.equal(parsed.atoms[0].authAtomId, 'CA');
  assert.equal(parsed.atoms[0].labelAtomId, 'CA');
  assert.equal(parsed.atoms[0].authSeqId, '-12');
  assert.equal(parsed.atoms[0].labelSeqId, '-12');
  assert.equal(parsed.atoms[0].insertionCode, 'A');
  assert.equal(parsed.atoms[0].altLoc, 'B');
  assert.deepEqual(parsed.atoms[0].position, [0.125, -1.5, 2]);
  assert.equal(parsed.atoms[1].element, 'O');
  for (const atom of parsed.atoms) {
    assert.ok(Array.isArray(atom.position) && atom.position.length === 3);
    for (const [key, value] of Object.entries(atom)) if (key !== 'position') assert.equal(typeof value, 'string', `${key} is a string field`);
  }
});

test('PDB without MODEL records returns an empty model ID and deposited secondary ranges', () => {
  const helix = Array(80).fill(' ');
  helix.splice(0, 6, ...'HELIX ');
  helix.splice(19, 1, 'A'); helix.splice(21, 4, ...'   2'); helix.splice(33, 4, ...'   8');
  const sheet = Array(80).fill(' ');
  sheet.splice(0, 6, ...'SHEET ');
  sheet.splice(21, 1, 'B'); sheet.splice(22, 4, ...'   3'); sheet.splice(33, 4, ...'  10');
  const parsed = parsePdb([pdbAtom(), helix.join(''), sheet.join('')].join('\n'));
  assert.equal(parsed.atoms[0].modelId, '');
  assert.deepEqual(parsed.secondaryStructure, [
    { type: 'helix', chainId: 'A', from: '2', to: '8', numbering: 'auth' },
    { type: 'sheet', chainId: 'B', from: '3', to: '10', numbering: 'auth' },
  ]);
});

test('mmCIF tokenization handles quoted and semicolon multiline values, auth/label IDs, alternates and models', () => {
  const parsed = parseMmcif(cifFixture());
  assert.equal(parsed.format, 'mmcif');
  assert.equal(parsed.atoms.length, 3);
  assert.deepEqual(parsed.chainNames, { X: 'Primary subunit' });
  assert.deepEqual(parsed.secondaryStructure, [{ type: 'helix', chainId: 'chain A', from: '10', to: '12', numbering: 'auth' }]);
  const [first, second, third] = parsed.atoms;
  assert.equal(first.record, 'ATOM');
  assert.equal(first.serial, '1');
  assert.equal(first.element, 'C');
  assert.equal(first.name, 'CA');
  assert.equal(first.authAtomId, 'CA');
  assert.equal(first.labelAtomId, 'CA');
  assert.equal(first.authChainId, 'chain A');
  assert.equal(first.labelChainId, 'X');
  assert.equal(first.authSeqId, '10');
  assert.equal(first.labelSeqId, '2');
  assert.equal(first.insertionCode, '');
  assert.equal(first.altLoc, '');
  assert.equal(first.modelId, '1');
  assert.equal(second.altLoc, 'B');
  assert.equal(second.insertionCode, 'A');
  assert.equal(third.name, 'O atom');
  assert.equal(third.authAtomId, 'O atom');
  assert.equal(third.modelId, '2');
  assert.equal(third.authSeqId, '99');
  assert.equal(third.labelSeqId, '');
  assert.deepEqual(third.position, [0.5, -1.25, 2]);
  for (const atom of parsed.atoms) {
    assert.ok(Array.isArray(atom.position) && atom.position.length === 3);
    for (const [key, value] of Object.entries(atom)) if (key !== 'position') assert.equal(typeof value, 'string', `${key} is a string field`);
  }
});

test('mmCIF secondary ranges fall back to label numbering when author values are absent', () => {
  const text = `data_ss
loop_
_struct_sheet_range.beg_label_asym_id
_struct_sheet_range.beg_label_seq_id
_struct_sheet_range.end_label_seq_id
S 4 9
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA GLY S 4 0 0 0
`;
  assert.deepEqual(parseMmcif(text).secondaryStructure, [{ type: 'sheet', chainId: 'S', from: '4', to: '9', numbering: 'label' }]);
});

test('invalid coordinates, empty input and missing coordinate rows fail clearly', () => {
  assert.throws(() => parsePdb(''), CoordinateParseError);
  assert.throws(() => parsePdb('HEADER no atoms'), /No coordinate atoms/);
  assert.throws(() => parsePdb(pdbAtom({ xyz: [NaN, 1, 2] })), /Invalid x coordinate/);
  assert.throws(() => parseMmcif(''), CoordinateParseError);
  assert.throws(() => parseMmcif('data_no_atoms\n#'), /No coordinate atoms/);
  const bad = cifFixture().replace('1.0 2.0 3.0 1', 'not-a-number 2.0 3.0 1');
  assert.throws(() => parseMmcif(bad), /Invalid x coordinate/);
});
