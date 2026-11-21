import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractStructureCard, cardStrings, readCifHeader, CardError } from '../structure-card.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');   // the header of the real RCSB entries (public domain, CC0), no coordinates

test('a real single-chain entry (4AKE): the facts the file states, nothing else', () => {
  const card = extractStructureCard(fixture('4AKE-header.cif'));
  assert.equal(card.format, 'mmcif'); assert.equal(card.id, '4AKE'); assert.equal(card.title, 'ADENYLATE KINASE');
  assert.equal(card.method, 'X-RAY DIFFRACTION'); assert.equal(card.resolution, 2.2); assert.deepEqual(card.organisms, ['Escherichia coli']);
  assert.equal(card.deposited, '1995-12-29'); assert.equal(card.released, '1996-06-10');
  assert.equal(card.polymerEntities, 1); assert.equal(card.chains, 2, 'two polymer chains; the waters have asym ids of their own and are not counted');
  const [adk] = card.entities.filter((e) => e.type === 'polymer'); assert.equal(adk.length, 214); assert.equal(adk.sequence.length, 214); assert.equal(adk.polymerType, 'polypeptide(L)');
  assert.equal(card.citation.year, '1996'); assert.equal(card.citation.doi, '10.1016/S0969-2126(96)00018-4');
});

test('a real complex (1K4C): several organisms, the mutations of the construct, the ligands and ions, in the order the file lists them', () => {
  const card = extractStructureCard(fixture('1K4C-header.cif'));
  assert.deepEqual(card.organisms.sort(), ['Mus musculus', 'Streptomyces lividans']); assert.equal(card.polymerEntities, 3);
  assert.deepEqual(card.mutations, [{ entity: 'potassium channel KcsA', mutation: 'P2A, L90C' }]);
  assert.ok(card.ligands.some((l) => l.comp === 'K' && l.count === 7), 'seven potassium ions'); assert.equal(card.resolution, 2);
  const kcsa = card.entities.find((e) => /KcsA/.test(e.name)); assert.equal(kcsa.length, 124); assert.equal(kcsa.organism, 'Streptomyces lividans');
});

test('the strings that go into a resource record say only what the file says, and are short', () => {
  const strings = cardStrings(extractStructureCard(fixture('1K4C-header.cif')));
  assert.equal(strings.method, 'X-RAY DIFFRACTION'); assert.equal(strings.resolution, '2 Å'); assert.equal(strings.mutation, 'P2A, L90C'); assert.equal(strings.doi, '10.1038/35102009');
  assert.match(strings.chains, /3 条链，3 种聚合物.*KcsA 124 aa ×1/); assert.match(strings.ligands, /K ×7/);
  assert.ok(Object.values(strings).every((v) => typeof v === 'string' && v.length <= 500));
});

test('a PDB-format file gives what its header records give', () => {
  const pdb = ['HEADER    TRANSFERASE                             29-DEC-95   4AKE', 'TITLE     ADENYLATE KINASE', 'COMPND    MOL_ID: 1;', 'COMPND   2 MOLECULE: ADENYLATE KINASE;', 'COMPND   3 CHAIN: A, B;', 'COMPND   4 MUTATION: C77S;',
    'SOURCE    MOL_ID: 1;', 'SOURCE   2 ORGANISM_SCIENTIFIC: ESCHERICHIA COLI;', 'EXPDTA    X-RAY DIFFRACTION', 'REMARK   2 RESOLUTION.    2.20 ANGSTROMS.',
    'SEQRES   1 A  214  MET ARG ILE ILE LEU LEU GLY ALA PRO GLY ALA GLY LYS', 'HET    AP5  A 215      57', 'HETNAM     AP5 BIS(ADENOSINE)-5\'-PENTAPHOSPHATE', 'ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00  0.00           N'].join('\n');
  const card = extractStructureCard(pdb);
  assert.equal(card.format, 'pdb'); assert.equal(card.id, '4AKE'); assert.equal(card.title, 'ADENYLATE KINASE'); assert.equal(card.resolution, 2.2); assert.deepEqual(card.organisms, ['ESCHERICHIA COLI']);
  assert.deepEqual(card.entities[0].chains, ['A', 'B']); assert.equal(card.entities[0].length, 214); assert.equal(card.mutations[0].mutation, 'C77S'); assert.deepEqual(card.ligands.map((l) => l.comp), ['AP5']);
});

test('empty input and files that are not structures are refused with a reason, quoted values and text blocks are read right', () => {
  assert.throws(() => extractStructureCard(''), CardError); assert.throws(() => extractStructureCard('hello world\nthis is not a structure'), /没有读到|不像|没有从文件里读到/);
  const header = readCifHeader("data_X\n_struct.title\n;A long\ntitle in a block\n;\n_entity.id 1\n_citation.title 'it''s quoted'\nloop_\n_atom_site.id\n1\n");
  assert.equal(header.scalars.get('_struct.title'), 'A long\ntitle in a block'); assert.equal(header.scalars.get('_entity.id'), '1'); assert.equal(header.loops.length, 0, 'the coordinate loop is not read');
});

test('a coordinate section is never read: a header followed by a huge atom list costs nothing', () => {
  const big = fixture('4AKE-header.cif') + 'ATOM 1 0.0\n'.repeat(200000); const start = performance.now();
  extractStructureCard(big); assert.ok(performance.now() - start < 500, 'header only');
});
