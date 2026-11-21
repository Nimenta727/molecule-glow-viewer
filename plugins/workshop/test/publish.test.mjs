import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPublication, nextRevision, deriveFrom, WORK_ID } from '../publish.mjs';

const author = { name: 'Ann', url: 'https://example.org/ann' };
const parent = { kind: 'work', id: 'official.kcsa', title: 'KcsA', zone: 'work', license: 'CC-BY-4.0', revision: 2, author: { name: 'official' }, topic: 'mechanism', tools: [], resources: [], pdb: [] };
const catalog = (works = [parent], resources = []) => ({ templates: [], works, resources, errors: [] });
const scene = (over = {}, publication = {}) => ({ id: 'ann.kcsa-lab', title: 'KcsA lab', assets: [], tools: [], resources: [], evidence: [{ type: 'modelled' }],
  publication: { license: 'CC-BY-4.0', author, topic: 'mechanism', description: 'A lab.', ...publication }, ...over });
const codes = (result) => result.problems.map(({ code }) => code);

test('a complete new work passes with its draft catalogue entry', () => {
  const result = checkPublication(scene(), catalog());
  assert.equal(result.ok, true); assert.deepEqual(codes(result), ['updated-missing', 'revision-default']);
  assert.deepEqual(result.entry, { kind: 'work', zone: 'work', source: 'community', id: 'ann.kcsa-lab', title: 'KcsA lab', topic: 'mechanism', license: 'CC-BY-4.0', revision: 1, author, description: 'A lab.', updated: '', tags: [], tools: [], resources: [] });
});
test('what is missing is said: no publication block, bad id, reserved id, no topic, unknown licence, long title', () => {
  assert.deepEqual(codes(checkPublication({ ...scene(), publication: undefined }, catalog())), ['publication-missing']);
  const bad = (over, publication) => codes(checkPublication(scene(over, publication), catalog()));
  assert.ok(bad({ id: 'AB' }).includes('id-invalid')); assert.ok(bad({ id: 'official.mine' }).includes('id-reserved')); assert.ok(bad({}, { topic: undefined }).includes('topic-missing'));
  assert.ok(bad({}, { license: 'GPL-3.0' }).includes('license-unknown')); assert.ok(bad({ title: 'x'.repeat(81) }).includes('title-invalid')); assert.ok(bad({ title: '  ' }).includes('title-invalid'));
  assert.ok(bad({ evidence: [] }, { description: undefined }).includes('evidence-missing')); assert.ok(WORK_ID.test('a.b-c_1') && !WORK_ID.test('a'));
  assert.ok(!codes(checkPublication(scene({ id: 'official.mine' }), catalog(), { source: 'official' })).includes('id-reserved'));
});
test('version upgrade: an existing id needs the same author and a newer revision; another author cannot take the id; share-alike cannot be relaxed', () => {
  const mine = { ...parent, id: 'ann.kcsa-lab', author: { name: 'Ann' }, revision: 2, license: 'CC-BY-SA-4.0' };
  const check = (publication) => codes(checkPublication(scene({}, { license: 'CC-BY-SA-4.0', ...publication }), catalog([mine])));
  assert.ok(check({ revision: 2 }).includes('revision-not-newer')); assert.ok(check({}).includes('revision-not-newer')); assert.ok(check({ revision: 1 }).includes('revision-not-newer'));
  assert.deepEqual(check({ revision: 3 }), ['updated-missing']);
  assert.ok(codes(checkPublication(scene({}, { revision: 3, license: 'CC-BY-4.0' }), catalog([mine]))).includes('license-relaxed'));
  assert.ok(codes(checkPublication(scene({}, { revision: 3, author: { name: 'Mallory' } }), catalog([mine]))).includes('id-taken'));
  const next = nextRevision(mine); assert.equal(next.revision, 3); assert.deepEqual(next.author, { name: 'Ann' }); assert.equal(next.license, 'CC-BY-SA-4.0');
});
test('derivation is checked against the parent: it must exist, the licence must be allowed, the revision must exist', () => {
  const kid = (publication, over) => checkPublication(scene(over, { derivedFrom: { id: 'official.kcsa', revision: 2 }, ...publication }), catalog());
  assert.equal(kid({}).ok, true); assert.equal(kid({ license: 'CC-BY-SA-4.0' }).ok, true);
  assert.ok(codes(kid({ license: 'CC0-1.0' })).includes('derivation'));
  assert.ok(codes(kid({ derivedFrom: { id: 'gone.work' } })).includes('derivation')); assert.ok(codes(kid({ derivedFrom: { id: 'official.kcsa', revision: 9 } })).includes('derivation'));
  const sa = { ...parent, license: 'CC-BY-SA-4.0' };
  assert.ok(codes(checkPublication(scene({}, { derivedFrom: { id: 'official.kcsa' } }), catalog([sa]))).includes('derivation'), 'a BY derivative of a BY-SA work is refused');
  const made = deriveFrom(parent, author); assert.deepEqual(made, { license: 'CC-BY-4.0', author, revision: 1, topic: 'mechanism', derivedFrom: { id: 'official.kcsa', revision: 2 } });
  assert.throws(() => deriveFrom(sa, author, { license: 'CC-BY-4.0' }), /不能用于派生/); assert.equal(deriveFrom(sa, author).license, 'CC-BY-SA-4.0');
  assert.throws(() => deriveFrom({ ...parent, license: 'Proprietary' }, author), /不在工坊认可/);
  assert.equal(checkPublication(scene({}, { ...made }), catalog()).ok, true, 'what deriveFrom writes passes the check');
});
test('dependencies: a tool this application lacks and a resource that forbids embedding are errors; share-alike resources force the licence; unlisted resources are information', () => {
  const record = (id, attribution) => ({ id, version: '1', attribution, source: { provider: 'rcsb', accession: 'X' }, files: [] });
  const withResources = (resources, assets = []) => scene({ resources, assets, tools: [{ id: 't1', tool: { id: 'org.glow.tool.gone', version: '1.0.0' }, config: {} }] });
  const result = checkPublication(withResources([record('res.a', { license: 'CC0-1.0', embedAllowed: false }), record('res.b', { license: 'CC-BY-SA-4.0' }), record('res.c', { license: 'weird' })],
    [{ id: 'f', kind: 'file', resource: { id: 'res.a' } }]), catalog(), { toolAvailable: (id) => id !== 'org.glow.tool.gone' });
  for (const code of ['tool-missing', 'embed-forbidden', 'license-conflict', 'resource-license-unknown', 'resource-unlisted']) assert.ok(codes(result).includes(code), code);
  assert.equal(result.ok, false);
  const fine = checkPublication(withResources([record('res.d', { license: 'CC0-1.0' })]), catalog([parent], [{ id: 'res.d' }]), { toolAvailable: () => true });
  assert.equal(fine.ok, true); assert.ok(!codes(fine).includes('resource-unlisted')); assert.deepEqual(fine.entry.tools, ['org.glow.tool.gone']); assert.deepEqual(fine.entry.resources, ['res.d']);
});

test('a predicted structure needs a "modelled" evidence entry that names it, or the work cannot be published', async () => {
  const { describePredictedStructure, predictionEvidence } = await import('../../../packages/schema/resource.mjs');
  const record = describePredictedStructure({ provider: 'alphafold', accession: 'AF-P69441-F1', sha256: 'd'.repeat(64), bytes: 1000, method: 'AlphaFold', license: 'CC-BY-4.0' });
  const withRecord = (evidence) => scene({ resources: [record], evidence });
  assert.ok(codes(checkPublication(withRecord([{ type: 'modelled' }]), catalog())).includes('prediction-unlabelled'), 'a modelled entry that does not name the resource is not enough');
  assert.ok(codes(checkPublication(withRecord([{ type: 'derived', resourceId: record.id }]), catalog())).includes('prediction-unlabelled'), 'nor is another kind of evidence');
  assert.ok(!codes(checkPublication(withRecord([predictionEvidence(record)]), catalog())).includes('prediction-unlabelled'), 'the evidence the helper writes satisfies the rule');
});
