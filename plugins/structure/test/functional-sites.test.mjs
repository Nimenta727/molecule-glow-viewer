import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { alignmentsFromRcsb, sitesFromUniprot, loadFunctionalSites, siteExpression, sitesAtResidue, mapPosition, alignmentQuery, FunctionalSiteError } from '../functional-sites.mjs';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const offline = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  if (!key) throw new Error(`HTTP 404 ${url}`);
  return typeof map[key] === 'function' ? map[key](url) : map[key];
};

test('alignments: 4AKE is UniProt P69441 on chains A,B; KcsA skips entities without a UniProt alignment', () => {
  assert.deepEqual(alignmentsFromRcsb(fixture('rcsb-align-4AKE.json')),
    [{ entityId: '1', asyms: ['A', 'B'], accession: 'P69441', regions: [{ entityStart: 1, refStart: 1, length: 214 }] }]);
  const kcsa = alignmentsFromRcsb(fixture('rcsb-align-1K4C.json'));
  assert.ok(kcsa.length >= 1 && kcsa.every((a) => /^[A-Z0-9]{6,10}$/.test(a.accession)));
  assert.ok(kcsa.some((a) => a.accession === 'P0A334'));
});

test('positions map through aligned regions and respect their ends', () => {
  const regions = [{ entityStart: 5, refStart: 20, length: 10 }];
  assert.equal(mapPosition(regions, 20), 5);
  assert.equal(mapPosition(regions, 29), 14);
  assert.equal(mapPosition(regions, 30), null);
  assert.equal(mapPosition(regions, 19), null);
});

test('4AKE binding sites keep their accession and label numbering', async () => {
  const result = await loadFunctionalSites('4AKE', { fetchJson: offline({ graphql: fixture('rcsb-align-4AKE.json'), P69441: fixture('uniprot-P69441.json') }) });
  assert.deepEqual(result.accessions, ['P69441']);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.sites['Binding site'].length, 12);
  assert.ok(result.sites['Binding site'].every((s) => s.accession === 'P69441' && s.asyms.join() === 'A,B'));
  assert.deepEqual(result.sites['Binding site'][0].from, 10);
  assert.equal(siteExpression(result.sites['Binding site'].slice(0, 2)), '(label_asym A,B and label_seq 10-15) or (label_asym A,B and label_seq 31-31)');
});

test('KcsA transmembrane segments, intramembrane and motif', async () => {
  const result = await loadFunctionalSites('1K4C', { fetchJson: offline({ graphql: fixture('rcsb-align-1K4C.json'), P0A334: fixture('uniprot-P0A334.json'), P01837: fixture('uniprot-P01837.json') }) });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.accessions.sort(), ['P01837', 'P0A334']);
  assert.ok(result.sites['Disulfide bond'].every((site) => site.to2 > site.from && site.accession === 'P01837'));
  assert.deepEqual(result.sites.Transmembrane.map((s) => [s.from, s.to]), [[28, 50], [88, 111]]);
  assert.equal(result.sites.Motif[0].from, 75);
  const hit = sitesAtResidue(result.sites, { labelAsym: result.sites.Motif[0].asyms[0], labelSeq: 77 });
  assert.deepEqual(hit.map((h) => h.type).sort(), ['Intramembrane', 'Motif']);
  assert.deepEqual(sitesAtResidue(result.sites, { labelAsym: 'ZZ', labelSeq: 77 }), []);
});

test('disulfide bonds mark the two cysteines, not the range between', () => {
  const uniprot = { features: [{ type: 'Disulfide bond', location: { start: { value: 3 }, end: { value: 9 } }, description: 'x' }] };
  const [site] = sitesFromUniprot(uniprot, { asyms: ['A'], accession: 'P00001', regions: [{ entityStart: 1, refStart: 1, length: 20 }] });
  assert.deepEqual([site.from, site.to, site.to2], [3, 3, 9]);
  assert.equal(siteExpression([site]), '(label_asym A and label_seq 3-3 or label_asym A and label_seq 9)');
  assert.equal(sitesAtResidue({ 'Disulfide bond': [site] }, { labelAsym: 'A', labelSeq: 5 }).length, 0);
  assert.equal(sitesAtResidue({ 'Disulfide bond': [site] }, { labelAsym: 'A', labelSeq: 9 }).length, 1);
});

test('failures: not a PDB id, UniProt down for one entity, and sites outside the structure', async () => {
  assert.throws(() => alignmentQuery('local.cif'), FunctionalSiteError);
  assert.throws(() => alignmentQuery('4AKE" } }'), FunctionalSiteError);
  const partial = await loadFunctionalSites('4AKE', { fetchJson: offline({ graphql: fixture('rcsb-align-4AKE.json') }) });
  assert.deepEqual(partial.sites, {});
  assert.match(partial.warnings[0], /P69441/);
  await assert.rejects(loadFunctionalSites('4AKE', { fetchJson: async () => ({ data: { entry: null } }) }), FunctionalSiteError);
  const outside = sitesFromUniprot({ features: [{ type: 'Site', location: { start: { value: 500 } } }] },
    { asyms: ['A'], accession: 'P00001', regions: [{ entityStart: 1, refStart: 1, length: 20 }] });
  assert.deepEqual(outside, []);
});
