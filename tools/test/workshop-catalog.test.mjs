import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateResource } from '../../packages/schema/resource.mjs';
import { ATP_TOOL } from '../../plugins/atp-synthase/tool.mjs';
import { ADK_TOOL } from '../../plugins/adenylate-kinase/tool.mjs';
import { KCSA_TOOL } from '../../plugins/kcsa/tool.mjs';
import { DATA_TOOL, TRANSLATION_TOOL, COMPOSITION_TOOL, PROCESS_TOOL } from '../../plugins/mechanism-catalog.mjs';

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
  assert.equal(ids.size, 29);
});

test('every template and work names resources the catalogue holds and tools the application registers; templates need no tool', () => {
  const tools = new Set([ATP_TOOL, ADK_TOOL, KCSA_TOOL, DATA_TOOL, TRANSLATION_TOOL, COMPOSITION_TOOL, PROCESS_TOOL]);
  const known = new Set(resources.resources.map(({ record }) => record.id));
  assert.equal(works.packs.length, 24);
  for (const work of works.packs) {
    assert.equal(work.kind, 'work', work.id);
    assert.ok(['template', 'work'].includes(work.zone), `${work.id}: zone`);
    assert.ok(['mechanism', 'protein', 'local-system', 'cell'].includes(work.topic), `${work.id}: subject`);
    assert.ok(work.resources.every((id) => known.has(id)), `${work.id}: resources exist in the catalogue`);
    assert.ok(work.resources.every((id) => work.pdb.includes(id.replace('res.rcsb.', ''))), `${work.id}: resources are structures the work uses`);
    assert.ok(work.tools.every((id) => tools.has(id)), `${work.id}: tools are registered ones`);
    assert.equal(work.zone === 'template', work.tools.length === 0, `${work.id}: a template needs no tool, a work needs at least one`);
  }
  const by = Object.fromEntries(works.packs.map((work) => [work.id, work.tools]));
  assert.deepEqual(by['official.atp-synthase.work'], [ATP_TOOL]);
  assert.deepEqual(by['official.kcsa.work'], [KCSA_TOOL]);
  assert.deepEqual(by['official.adenylate-kinase.work'], [ADK_TOOL]);
  assert.deepEqual(by['official.respiratory-chain.work'], [DATA_TOOL]);
  assert.deepEqual(by['official.translation.work'], [TRANSLATION_TOOL]);
  assert.deepEqual(by['official.cell-corner.work'], [COMPOSITION_TOOL]);
  const templates = works.packs.filter((work) => work.zone === 'template'), animated = new Set(works.packs.filter((work) => work.zone === 'work').map((work) => work.id.replace(/\.work$/, '')));
  assert.equal(templates.length, 13); assert.ok(templates.every((template) => template.file && !template.id.endsWith('.work')));
  assert.ok(!templates.some((template) => ['official.kcsa-data', 'official.adk-reaction-data'].includes(template.id)), 'a pure animation-format demo is a work only');
  assert.deepEqual(by['official.whole-cell.work'], [COMPOSITION_TOOL], 'the whole cell has an animated version: its two stations run inside the cell');
});

test('the committed catalogues are exactly what the build scripts produce', () => {
  for (const script of ['build-resources.mjs', 'build-index.mjs']) {
    const run = spawnSync(process.execPath, [`workshop/tools/${script}`], { cwd: new URL('.', root), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.doesNotMatch(run.stdout, /↻/, `${script} changed a committed catalogue: run it and commit the result`);
  }
});

test('a pack may record what it was derived from; the validator checks the shape and the catalogue-wide rules', async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { loadRules, checkFile } = await import('../../workshop/tools/glow-lib.mjs');
  const R = loadRules(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-derive-'));
  try {
    const original = JSON.parse(fs.readFileSync(new URL('workshop/official/packs/official.kcsa.glow', root), 'utf8'));
    const make = (extra) => {
      const pack = { ...original, id: 'tester.kcsa-copy', author: { name: 'Tester' }, license: 'CC-BY-4.0', ...extra }, file = path.join(dir, 'tester.kcsa-copy.glow');
      fs.writeFileSync(file, JSON.stringify(pack)); return checkFile(file, 'community', R);
    };
    assert.equal(make({}).ok, true, 'a plain community pack passes');
    assert.equal(make({ derivedFrom: { id: 'official.kcsa', revision: 1 } }).ok, true);
    assert.equal(make({ derivedFrom: { id: 'official.kcsa' } }).ok, true, 'revision is optional');
    for (const bad of ['official.kcsa', null, {}, { id: 5 }, { id: 'X' }, { id: 'official.kcsa', revision: 0 }, { id: 'official.kcsa', revision: 1.5 }, { id: 'official.kcsa', note: 'x' }, [{ id: 'official.kcsa' }]]) {
      const result = make({ derivedFrom: bad });
      assert.equal(result.ok, false, JSON.stringify(bad)); assert.ok(result.errors.some((text) => /derivedFrom/.test(text)));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const { derivationProblems } = await import('../../workshop/tools/glow-lib.mjs');
  assert.deepEqual(derivationProblems(), [], 'the packs in the repository have consistent derivation records');
});

test('a v3 scene package published from Studio is checked, indexed and found by the catalogue client; an update needs a newer revision', async () => {
  const os = await import('node:os'), path = await import('node:path'), { writeScenePackage } = await import('../../packages/schema/archive.mjs');
  const { loadCatalog, queryCatalog } = await import('../../plugins/workshop/catalog.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-ws-'));
  try {
    fs.cpSync(new URL('workshop/', root), dir, { recursive: true });
    fs.rmSync(path.join(dir, 'community'), { recursive: true, force: true });   // this test starts from an empty community source whatever has been published to the real one
    fs.mkdirSync(path.join(dir, 'community/packs'), { recursive: true });
    const scene = (publication, id = 'tester.lab-one') => ({ format: 'glow-scene', schemaVersion: 3, id, title: 'Lab one', units: { length: 'meter', time: 'second' }, assets: [], nodes: [{ id: 'root', name: 'Root', parentId: null, assetId: null, visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [{ type: 'illustrative', citation: 'test' }], tools: [], resources: [], publication });
    const publish = async (publication, id) => { const s = scene(publication, id); fs.writeFileSync(path.join(dir, 'community/packs', `${s.id}.glow`), await writeScenePackage(s, new Map())); };
    const run = (script) => spawnSync(process.execPath, [script], { cwd: new URL('.', root).pathname, env: { ...process.env, GLOW_WORKSHOP_DIR: dir }, encoding: 'utf8' });
    const base = { license: 'CC-BY-4.0', author: { name: 'Tester', url: 'https://example.org/t' }, topic: 'protein', description: 'A lab.', updated: '2026-11-21', tags: ['lab'] };
    await publish(base);
    let result = run('workshop/tools/validate.mjs'); assert.equal(result.status, 0, result.stdout); assert.match(result.stdout, /tester\.lab-one\.glow — Lab one（场景包）/);
    result = run('workshop/tools/build-index.mjs'); assert.equal(result.status, 0, result.stdout);
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'community/index.json'), 'utf8')), [entry] = index.packs;
    assert.deepEqual([entry.id, entry.zone, entry.topic, entry.license, entry.revision, entry.author.name, entry.tools], ['tester.lab-one', 'template', 'protein', 'CC-BY-4.0', 1, 'Tester', []]);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/); assert.equal(entry.file, 'packs/tester.lab-one.glow');
    const files = (u) => { const f = path.join(dir, String(u).replace('https://x.test/', '')); if (!fs.existsSync(f)) return { ok: false, status: 404 }; const b = fs.readFileSync(f); return { ok: true, headers: new Headers(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
    const catalog = await loadCatalog({ base: 'https://x.test/', fetch: async (u) => files(u) });
    assert.deepEqual(queryCatalog(catalog, { zone: 'templates', source: 'community', text: 'lab' }).map(({ id }) => id), ['tester.lab-one']);
    assert.equal(run('workshop/tools/validate.mjs').status, 0, 'validating again after indexing still passes (the identical published file is not an "update")');
    assert.equal(run('workshop/tools/build-index.mjs').status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'community/index.json'), 'utf8'), JSON.stringify(index, null, 1) + '\n', 'indexing is deterministic');
    await publish({ ...base, description: 'Changed.' });   // the same revision with other content: an update that did not raise the version
    result = run('workshop/tools/validate.mjs'); assert.equal(result.status, 1); assert.match(result.stdout, /第 1 版.*升级请把版本设为 2/);
    await publish({ ...base, description: 'Changed.', revision: 2 });
    assert.equal(run('workshop/tools/validate.mjs').status, 0, 'a newer revision passes');
    await publish({ ...base, license: 'CC-BY-SA-4.0', revision: 3, derivedFrom: { id: 'official.kcsa', revision: 1 } }, 'tester.derived');
    assert.equal(run('workshop/tools/validate.mjs').status, 0, 'a BY-SA work derived from a BY work passes');
    await publish({ ...base, license: 'CC0-1.0', derivedFrom: { id: 'official.kcsa' } }, 'tester.bad-derived');
    result = run('workshop/tools/validate.mjs'); assert.equal(result.status, 1); assert.match(result.stdout, /不能用于派生/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
