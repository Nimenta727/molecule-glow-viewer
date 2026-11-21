import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { CONFIDENCE_BANDS, confidenceBand, confidenceColor, residueConfidence, confidenceSummary, residueIdentity } from '../confidence.mjs';

function line(serial, name, residue, seq, b) {   // a PDB ATOM record in its fixed columns
  const chars = Array(80).fill(' '), put = (start, text, right = false) => { const t = String(text); const at = right ? start + (right - t.length) : start; for (let i = 0; i < t.length; i++) chars[at + i] = t[i]; };
  put(0, 'ATOM'); put(6, serial, 5); chars.splice(6, 5, ...String(serial).padStart(5)); put(12, name.padStart(name.length === 1 ? 2 : 3).padEnd(4)); put(17, residue); chars[21] = 'A'; chars.splice(22, 4, ...String(seq).padStart(4));
  chars.splice(30, 8, ...(seq * 3.8).toFixed(3).padStart(8)); chars.splice(38, 8, ...'0.000'.padStart(8)); chars.splice(46, 8, ...'0.000'.padStart(8)); chars.splice(54, 6, ...'1.00'.padStart(6));
  if (b !== null) chars.splice(60, 6, ...b.toFixed(2).padStart(6)); chars[77] = 'C';
  return chars.join('');
}
const model = (values) => parsePdb(values.flatMap((b, i) => [line(2 * i + 1, 'N', 'GLY', i + 1, b), line(2 * i + 2, 'CA', 'GLY', i + 1, b)]).join('\n') + '\n');

test('the bands are the AlphaFold database\'s: above 90, above 70, above 50, otherwise very low', () => {
  assert.deepEqual([95, 90, 80, 70, 60, 50, 20].map((v) => confidenceBand(v).id), ['very-high', 'confident', 'confident', 'low', 'low', 'very-low', 'very-low']);
  assert.equal(confidenceBand(NaN), null); assert.equal(confidenceBand(null), null);
  assert.deepEqual(CONFIDENCE_BANDS.map(({ color }) => color), ['#0053d6', '#65cbf3', '#ffdb13', '#ff7d45']);
  assert.equal(confidenceColor(95), '#0053d6'); assert.equal(confidenceColor(undefined), '#b0b0b0', 'no value: a neutral grey, not a band');
});

test('the confidence of a residue comes from its alpha carbon, only on the 0-100 scale', () => {
  const m = model([95.5, 72, 40.25, null]);
  const { values, residues, missing } = residueConfidence(m);
  assert.equal(residues, 4); assert.equal(missing, 1);
  assert.deepEqual([...values.values()], [95.5, 72, 40.25]);
  const out = parsePdb(line(1, 'CA', 'ALA', 1, 250) + '\n'), r = residueConfidence(out);
  assert.equal(r.values.size, 0, 'a value outside 0-100 (an ordinary B-factor) is not a confidence'); assert.equal(r.missing, 1);
});

test('the summary counts residues per band and keeps the missing ones apart', () => {
  const s = confidenceSummary(model([95, 92, 75, 55, 30, 20, null]));
  assert.deepEqual(s.counts, { 'very-high': 2, confident: 1, low: 1, 'very-low': 2 });
  assert.ok(Math.abs(s.mean - (95 + 92 + 75 + 55 + 30 + 20) / 6) < 1e-9); assert.equal(s.missing, 1); assert.equal(s.residues, 7);
  assert.ok(Math.abs(s.fractions['very-high'] - 2 / 6) < 1e-9);
});

test('a residue keeps one identity whichever of its atoms is asked', () => {
  const m = model([88]); assert.equal(residueIdentity(m.atoms[0]), residueIdentity(m.atoms[1]));
});

test('a file that declares a pLDDT quality metric is recognised as predicted; an ordinary one is not', async () => {
  const { parseMmcif } = await import('../parser.mjs'), { describeStructureAsset } = await import('../../../packages/schema/resource.mjs');
  const atoms = 'loop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.B_iso_or_equiv\nATOM 1 C CA GLY A 1 0.0 0.0 0.0 91.5\n';
  const predicted = `data_AF\nloop_\n_ma_qa_metric.id\n_ma_qa_metric.name\n_ma_qa_metric.mode\n1 pLDDT global\n2 pLDDT local\n${atoms}`;
  assert.equal(parseMmcif(predicted).confidenceMetric, 'pLDDT'); assert.equal(parseMmcif(`data_x\n${atoms}`).confidenceMetric, undefined);
  const asset = (extra) => ({ path: 'assets/source.cif', sha256: 'e'.repeat(64), mediaType: 'chemical/x-mmcif', provenance: { source: { provider: 'local', accession: 'model.cif' }, ...extra } });
  const { record } = describeStructureAsset(asset({ predicted: { metric: 'pLDDT' } }), { byteLength: 99 });
  assert.equal(record.kind, 'predicted-structure'); assert.equal(record.attribution.license, 'unknown'); assert.equal(record.attribution.embedAllowed, false, 'a licence nobody stated is not a licence to embed');
  assert.equal(describeStructureAsset(asset({}), { byteLength: 99 }).record.kind, 'structure');
});
