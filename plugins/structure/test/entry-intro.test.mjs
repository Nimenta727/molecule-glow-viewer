import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { introductionQuery, introductionFromRcsb, functionAccessions, functionFromUniprot, loadIntroduction, describeIntroduction, readableTitle, EntryIntroError } from '../entry-intro.mjs';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const offline = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  if (!key) throw new Error(`HTTP 404 ${url}`);
  return map[key];
};

test('KcsA: source, species, substitutions and citation come from the records', () => {
  const intro = introductionFromRcsb(fixture('rcsb-intro-1K4C.json'), '1k4c');
  assert.equal(intro.id, '1K4C');
  assert.deepEqual([intro.methods, intro.resolution, intro.released], [['X-RAY DIFFRACTION'], 2.0, '2001-11-14']);
  assert.ok(intro.organisms.includes('Streptomyces lividans'));
  const channel = intro.entities.find((e) => e.uniprotIds.includes('P0A334'));
  assert.equal(channel.substitutions, 'P2A, L90C');
  assert.equal(channel.description, 'potassium channel KcsA');
  assert.deepEqual([intro.citation.doi, intro.citation.pubmed, intro.citation.journal, intro.citation.year], ['10.1038/35102009', 11689936, 'Nature', 2001]);
  assert.ok(intro.families.some((f) => /KcsA Potassium channel/.test(f)) && !intro.families.some((f) => /<sup>/.test(f)), 'HTML tags are stripped from annotations');
  assert.equal(intro.missing.length, 0);
  assert.equal(intro.sources.entry, 'RCSB PDB');
});

test('missing data is listed as unavailable, never invented', () => {
  const intro = introductionFromRcsb({ data: { entry: { struct: { title: 'SOME NMR ENTRY' }, exptl: [{ method: 'SOLUTION NMR' }], polymer_entities: [] } } }, '9ABC');
  assert.equal(intro.resolution, null);
  assert.equal(intro.citation, null);
  assert.deepEqual(intro.organisms, []);
  assert.deepEqual(intro.missing, ['分辨率', '来源物种', '文献', '发布日期', '实体信息']);
  const lines = describeIntroduction(intro);
  assert.equal(lines[0], 'Some nmr entry');
  assert.match(lines.join('\n'), /分辨率不可用/);
  assert.match(lines.join('\n'), /来源物种：不可用/);
  assert.match(lines.join('\n'), /文献：不可用/);
});

test('function accessions: largest entity first, fusion partners last, capped', () => {
  const intro = { entities: [
    { entityId: '1', uniprotIds: ['P00720', 'P11111'] }, { entityId: '2', uniprotIds: ['P22222'] }, { entityId: '3', uniprotIds: ['P33333'] },
  ] };
  const sizes = { 1: 100, 2: 300, 3: 200 };
  assert.deepEqual(functionAccessions(intro, { sizeOf: (e) => sizes[e.entityId], limit: 3 }), ['P22222', 'P33333', 'P11111']);
  assert.deepEqual(functionAccessions(intro, { sizeOf: (e) => sizes[e.entityId], limit: 5 }).at(-1), 'P00720');
});

test('UniProt function text drops evidence markers and says when there is none', () => {
  const kcsa = functionFromUniprot(fixture('uniprot-function-P0A334.json'), 'P0A334');
  assert.equal(kcsa.name, 'pH-gated potassium channel KcsA');
  assert.equal(kcsa.gene, 'kcsA');
  assert.match(kcsa.text, /^Acts as a pH-gated potassium ion channel/);
  assert.ok(!/PubMed|ECO:/.test(kcsa.text));
  assert.equal(functionFromUniprot({ comments: [] }, 'P99999').text, null);
});

test('loading: both sources are used, and a UniProt failure leaves the RCSB part intact', async () => {
  const whole = await loadIntroduction('4AKE', { fetchJson: offline({ graphql: fixture('rcsb-intro-4AKE.json'), P69441: fixture('uniprot-function-P69441.json') }) });
  assert.equal(whole.warnings.length, 0);
  assert.equal(whole.intro.functions[0].accession, 'P69441');
  const partial = await loadIntroduction('4AKE', { fetchJson: offline({ graphql: fixture('rcsb-intro-4AKE.json') }) });
  assert.equal(partial.intro.title, 'ADENYLATE KINASE');
  assert.deepEqual(partial.intro.functions, []);
  assert.match(partial.warnings[0], /P69441/);
  await assert.rejects(loadIntroduction('4AKE', { fetchJson: async () => ({ data: { entry: null } }) }), EntryIntroError);
});

test('only PDB ids are accepted and sentence case is for display only', () => {
  assert.throws(() => introductionQuery('local.cif'), EntryIntroError);
  assert.throws(() => introductionQuery('4AKE" } }'), EntryIntroError);
  assert.equal(readableTitle('Already Mixed Case'), 'Already Mixed Case');
  assert.equal(readableTitle('ADENYLATE KINASE'), 'Adenylate kinase');
});
