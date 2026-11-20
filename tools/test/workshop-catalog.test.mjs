import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateResource } from '../../packages/schema/resource.mjs';
import { ATP_TOOL } from '../../plugins/atp-synthase/tool.mjs';
import { ADK_TOOL } from '../../plugins/adenylate-kinase/tool.mjs';
import { KCSA_TOOL } from '../../plugins/kcsa/tool.mjs';

const root = new URL('../../', import.meta.url);
const json = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const resources = json('workshop/official/resources/index.json');
const works = json('workshop/official/index.json');

test('the official resource catalogue holds valid, reproducible records that agree with the reviewed structure data', () => {
  assert.equal(resources.format, 'glow-resources');
  const science = new Map(json('docs/science/structures.json').structures.map((entry) => [entry.id, entry.coordinate]));
  const fixtures = new Map(json('tools/fixtures/structures.json').structures.map((entry) => [entry.id, entry]));
  const ids = new Set();
  for (const entry of resources.resources) {
    const record = validateResource(entry.record);
    assert.ok(!ids.has(record.id), `${record.id} is unique`); ids.add(record.id);
    assert.equal(entry.delivery, 'reference', 'bytes are never stored in the workshop');
    assert.equal(record.kind, 'structure');
    assert.equal(record.id, `res.rcsb.${record.source.accession}`);
    assert.equal(record.version, record.files[0].sha256.slice(0, 8), 'the version is the content hash, as the importers name it');
    assert.equal(record.attribution.license, 'CC0-1.0');
    assert.equal(record.attribution.embedAllowed, true);
    const [file] = record.files, reviewed = science.get(record.source.accession), fixture = fixtures.get(record.source.accession);
    assert.deepEqual([file.sha256, file.bytes], [reviewed.sha256, reviewed.bytes], `${record.id} agrees with docs/science/structures.json`);
    if (fixture) assert.deepEqual([file.sha256, file.bytes], [fixture.sha256, fixture.bytes], `${record.id} agrees with the release fixtures`);
    assert.ok(entry.title && entry.description && entry.tags.length > 0, `${record.id} has catalogue text`);
    assert.ok(record.card.species && record.card.method, `${record.id} keeps species and method in its card`);
  }
  assert.equal(ids.size, 8);
});

test('every work names resources the catalogue holds and tools the application registers', () => {
  const tools = new Set([ATP_TOOL, ADK_TOOL, KCSA_TOOL]);
  const known = new Set(resources.resources.map(({ record }) => record.id));
  assert.equal(works.packs.length, 15);
  for (const work of works.packs) {
    assert.equal(work.kind, 'work', work.id);
    assert.ok(work.resources.every((id) => known.has(id)), `${work.id}: resources exist in the catalogue`);
    assert.ok(work.resources.every((id) => work.pdb.includes(id.replace('res.rcsb.', ''))), `${work.id}: resources are structures the work uses`);
    assert.ok(work.tools.every((id) => tools.has(id)), `${work.id}: tools are registered ones`);
  }
  const by = Object.fromEntries(works.packs.map((work) => [work.id, work.tools]));
  assert.deepEqual(by['official.atp-synthase'], [ATP_TOOL]);
  assert.deepEqual(by['official.kcsa'], [KCSA_TOOL]);
  assert.deepEqual(by['official.adenylate-kinase'], [ADK_TOOL]);
});

test('the committed catalogues are exactly what the build scripts produce', () => {
  for (const script of ['build-resources.mjs', 'build-index.mjs']) {
    const run = spawnSync(process.execPath, [`workshop/tools/${script}`], { cwd: new URL('.', root), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.doesNotMatch(run.stdout, /↻/, `${script} changed a committed catalogue: run it and commit the result`);
  }
});
