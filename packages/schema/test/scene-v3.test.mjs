import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScene, validateProject, SchemaValidationError } from '../documents.mjs';
import { upgradeSceneToV3, attachStructureResources } from '../migrate.mjs';
import { writeScenePackage, readScenePackage } from '../archive.mjs';
import { sha256Hex } from '../resource.mjs';

const text = (value) => new TextEncoder().encode(value);
async function structure(id = 'source', body = 'data_x') {
  const data = text(body);
  return { data, asset: { id, kind: 'file', path: `assets/${id}.cif`, sha256: await sha256Hex(data), mediaType: 'chemical/x-mmcif',
    provenance: { parserVersion: '1.0.0', source: { provider: 'RCSB PDB', accession: '6ZPO' }, playback: { time: 3 } } } };
}
const v2 = (assets = []) => ({
  format: 'glow-scene', schemaVersion: 2, id: 'work', title: 'Work', units: { length: 'meter', time: 'second' },
  assets, nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [{ type: 'source', citation: 'kept' }],
  legacy: { scene: { process: 'atpSynthase' } },
});

test('v2 scenes keep validating exactly as before and may not carry v3 fields', async () => {
  const { asset } = await structure();
  assert.equal(validateScene(v2([asset])).schemaVersion, 2);
  assert.throws(() => validateScene({ ...v2(), tools: [] }), SchemaValidationError);
  assert.throws(() => validateScene(v2([{ ...asset, resource: { id: 'r', version: '1', sha256: asset.sha256 } }])), SchemaValidationError);
});

test('v3 requires tools and resources, and tool entries are checked', async () => {
  const base = { ...v2(), schemaVersion: 3, tools: [], resources: [] };
  assert.equal(validateScene(base).schemaVersion, 3);
  const { tools, ...withoutTools } = base;
  assert.throws(() => validateScene(withoutTools), /tools/);
  const entry = (extra = {}) => ({ id: 'atp', tool: { id: 'org.glow.legacy-process.atp-synthase', version: '1.0.0' }, config: { a: 1 }, ...extra });
  assert.equal(validateScene({ ...base, tools: [entry({ state: { time: 2 } })] }).tools[0].state.time, 2);
  assert.throws(() => validateScene({ ...base, tools: [entry(), entry()] }), /duplicate tool entry ID "atp"/);
  assert.throws(() => validateScene({ ...base, tools: [entry({ tool: { id: 'x', version: '1.0' } })] }), SchemaValidationError);
  assert.throws(() => validateScene({ ...base, tools: [entry({ config: 'text' })] }), SchemaValidationError);
  assert.throws(() => validateScene({ ...base, tools: [entry({ extra: true })] }), SchemaValidationError);
});

test('upgrade v2 -> v3 keeps every v2 field, adds resource records and links, and is idempotent', async () => {
  const { asset, data } = await structure();
  const input = v2([asset]);
  const { scene, diagnostics } = await upgradeSceneToV3(input, new Map([[asset.path, data]]));
  assert.deepEqual(diagnostics, []);
  assert.equal(scene.schemaVersion, 3);
  for (const key of ['id', 'title', 'units', 'nodes', 'timeline', 'dependencies', 'evidence', 'legacy']) assert.deepEqual(scene[key], input[key], key);
  assert.deepEqual(scene.tools, []);
  assert.equal(scene.resources.length, 1);
  assert.equal(scene.resources[0].id, 'res.rcsb.6ZPO');
  assert.deepEqual(scene.assets[0].resource, { id: 'res.rcsb.6ZPO', version: asset.sha256.slice(0, 8), sha256: asset.sha256 });
  assert.deepEqual({ ...scene.assets[0], resource: undefined }, { ...asset, resource: undefined }, 'the asset itself is unchanged apart from the link');
  const again = await upgradeSceneToV3(scene, new Map([[asset.path, data]]));
  assert.deepEqual(again.scene, scene);
});

test('upgrade promotes the transitional provenance.resource link and gives given tools to the work', async () => {
  const { asset, data } = await structure();
  asset.provenance.resource = { id: 'res.rcsb.6ZPO', version: asset.sha256.slice(0, 8), sha256: asset.sha256 };
  const tools = [{ id: 't', tool: { id: 'x.y', version: '1.2.3' }, config: { k: 'v' } }];
  const { scene } = await upgradeSceneToV3(v2([asset]), new Map([[asset.path, data]]), { tools });
  assert.equal(scene.assets[0].provenance.resource, undefined);
  assert.equal(scene.assets[0].resource.id, 'res.rcsb.6ZPO');
  assert.deepEqual(scene.tools, tools);
});

test('upgrade with missing or tampered bytes still opens the scene, without a link, and says why', async () => {
  const a = await structure('a', 'data_a'), b = await structure('b', 'data_b');
  b.asset.path = 'assets/b.cif';
  const { scene, diagnostics } = await upgradeSceneToV3(v2([a.asset, b.asset]), new Map([['assets/b.cif', text('tampered')]]));
  assert.deepEqual(diagnostics.map(({ code, assetId }) => [code, assetId]).sort(), [['res-hash-mismatch', 'b'], ['res-missing', 'a']]);
  assert.equal(scene.resources.length, 0);
  assert.ok(scene.assets.every((asset) => asset.resource === undefined));
});

test('references are checked: unknown record, wrong hash and duplicate records are refused', async () => {
  const { asset, data } = await structure();
  const { scene } = await upgradeSceneToV3(v2([asset]), new Map([[asset.path, data]]));
  const broken = (change) => { const copy = structuredClone(scene); change(copy); return () => validateScene(copy); };
  assert.throws(broken((s) => { s.resources = []; }), /does not carry/);
  assert.throws(broken((s) => { s.assets[0].resource.sha256 = 'f'.repeat(64); }), /not part of resource|differ/);
  assert.throws(broken((s) => { s.resources.push(structuredClone(s.resources[0])); }), /duplicate resource/);
  assert.throws(broken((s) => { s.resources[0].kind = 'banana'; }), /Resource is invalid/);
  assert.equal(validateScene(scene).resources.length, 1);
});

test('a v3 work survives writing and reading its package, with the exact bytes and configuration', async () => {
  const { asset, data } = await structure();
  const tools = [{ id: 'atp', tool: { id: 'org.glow.legacy-process.atp-synthase', version: '1.0.0' }, config: { parts: { ring: 'subunit C1' }, steps: [1, 2] }, state: { time: 4, rates: [{ time: 0, speed: 0.25 }] } }];
  const { scene } = await upgradeSceneToV3(v2([asset]), new Map([[asset.path, data]]), { tools });
  const bytes = await writeScenePackage(scene, new Map([[asset.path, data]]));
  const reopened = await readScenePackage(bytes);
  assert.deepEqual(reopened.scene, scene);
  assert.deepEqual(reopened.resources.get(asset.path), data);
});

test('a project may hold v2 and v3 scenes side by side', async () => {
  const { asset, data } = await structure();
  const { scene } = await upgradeSceneToV3(v2([asset]), new Map([[asset.path, data]]));
  const project = { format: 'glow-project', schemaVersion: 1, id: 'p', title: 'P', activeSceneId: 'work', scenes: [scene, { ...v2(), id: 'old' }] };
  assert.deepEqual(validateProject(project).scenes.map(({ schemaVersion }) => schemaVersion), [3, 2]);
  assert.throws(() => validateProject({ ...project, scenes: [{ ...scene, schemaVersion: 4 }] }), SchemaValidationError);
  assert.throws(() => validateProject({ ...project, scenes: [{ ...scene, tools: 'x' }] }), SchemaValidationError);
});

test('attachStructureResources completes a scene after a mechanism added structure files', async () => {
  const a = await structure('source', 'data_a');
  const { scene } = await upgradeSceneToV3(v2([a.asset]), new Map([[a.asset.path, a.data]]));
  const added = await structure('adk-state-1AKE', 'data_1ake');
  added.asset.provenance = { source: { provider: 'RCSB PDB', accession: '1AKE' }, mechanismState: { player: 'p', accession: '1AKE' } };
  scene.assets.push(added.asset);
  const { diagnostics } = await attachStructureResources(scene, new Map([[a.asset.path, a.data], [added.asset.path, added.data]]));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(scene.resources.map(({ id }) => id), ['res.rcsb.6ZPO', 'res.rcsb.1AKE']);
  assert.equal(validateScene(scene).assets.length, 2);
});
