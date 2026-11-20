import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWorkScene, toolEntryFor, readPlayerState, storePlayerState } from '../work-scene.mjs';
import { createMechanismRuntime } from '../mechanism-runtime.mjs';
import { toolEntriesForScene } from '../../../plugins/mechanism-catalog.mjs';
import { ATP_6ZPO_TEMPLATE } from '../../../plugins/atp-synthase/config.mjs';
import { ADK_4AKE_TEMPLATE } from '../../../plugins/adenylate-kinase/config.mjs';
import { KCSA_1K4C_TEMPLATE } from '../../../plugins/kcsa/config.mjs';

const v2 = (legacy, extra = {}) => ({ format: 'glow-scene', schemaVersion: 2, id: 'w', title: 'W', units: { length: 'meter', time: 'second' },
  assets: [], nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [], ...(legacy ? { legacy: { scene: legacy } } : {}), ...extra });

test('each declared built-in mechanism gets its player with the full default configuration', () => {
  const atp = toolEntriesForScene(v2({ process: 'atpSynthase' }));
  assert.deepEqual(atp.map(({ id, tool }) => [id, tool.id, tool.version]), [['atp-synthase-6ZPO', 'org.glow.legacy-process.atp-synthase', '1.0.0']]);
  assert.deepEqual(atp[0].config, JSON.parse(JSON.stringify(ATP_6ZPO_TEMPLATE)));
  assert.equal(toolEntriesForScene(v2({ process: 'kcsa' }))[0].config.id, KCSA_1K4C_TEMPLATE.id);
  const adk = toolEntriesForScene(v2({ id: '4AKE', states: ['4AKE', '1AKE'] }));
  assert.deepEqual(adk[0].config, JSON.parse(JSON.stringify(ADK_4AKE_TEMPLATE)));
  for (const scene of [v2(), v2({ process: 'translation' }), v2({ id: '4AKE', states: ['4AKE', '1AKE'], components: [{}] })]) assert.deepEqual(toolEntriesForScene(scene), []);
  assert.notEqual(atp[0].config, toolEntriesForScene(v2({ process: 'atpSynthase' }))[0].config, 'every scene gets its own copy');
});

test('prepareWorkScene upgrades a v2 scene to v3 with the mechanism configuration, and leaves everything else alone', async () => {
  const loaded = { scene: v2({ process: 'kcsa' }), resources: new Map(), warnings: [] };
  const before = structuredClone(loaded.scene);
  await prepareWorkScene(loaded);
  assert.equal(loaded.scene.schemaVersion, 3);
  assert.equal(loaded.scene.tools.length, 1);
  for (const key of ['id', 'title', 'legacy', 'nodes', 'assets', 'evidence']) assert.deepEqual(loaded.scene[key], before[key], key);
  const plain = { scene: v2(), resources: new Map(), warnings: [] };
  await prepareWorkScene(plain);
  assert.deepEqual([plain.scene.schemaVersion, plain.scene.tools, plain.scene.resources], [3, [], []]);
});

test('a v3 work keeps its own configuration; an empty one gets the default for its declared mechanism', async () => {
  const custom = { ...KCSA_1K4C_TEMPLATE, steps: KCSA_1K4C_TEMPLATE.steps.map((step) => ({ ...step, title: '自定义' })) };
  const own = { id: 'mine', tool: { id: 'org.glow.legacy-process.kcsa', version: '1.0.0' }, config: JSON.parse(JSON.stringify(custom)), state: { time: 9 } };
  const loaded = { scene: { ...v2({ process: 'kcsa' }), schemaVersion: 3, tools: [own], resources: [] }, resources: new Map(), warnings: [] };
  await prepareWorkScene(loaded);
  assert.deepEqual(loaded.scene.tools, [own], 'not overwritten by the template');
  const empty = { scene: { ...v2({ process: 'kcsa' }), schemaVersion: 3, tools: [], resources: [] }, resources: new Map(), warnings: [] };
  await prepareWorkScene(empty);
  assert.equal(empty.scene.tools[0].config.id, KCSA_1K4C_TEMPLATE.id);
});

test('resource problems found while preparing become warnings and the scene still opens', async () => {
  const asset = { id: 'source', kind: 'file', path: 'assets/source.cif', sha256: 'a'.repeat(64), mediaType: 'chemical/x-mmcif', provenance: { parserVersion: '1' } };
  const loaded = { scene: v2(null, { assets: [asset] }), resources: new Map(), warnings: [] };
  await prepareWorkScene(loaded);
  assert.equal(loaded.scene.schemaVersion, 3);
  assert.match(loaded.warnings[0], /资源文件缺失/);
});

test('playback state lives in the tool entry; scenes without one keep it on the primary structure asset', () => {
  const asset = () => ({ id: 's', kind: 'file', path: 'assets/s.cif', provenance: { parserVersion: '1', playback: { time: 1 } } });
  const old = { assets: [asset()], tools: [] };
  assert.deepEqual(readPlayerState(old, 'p'), { time: 1 });
  storePlayerState(old, 'p', { time: 5 });
  assert.deepEqual(old.assets[0].provenance.playback, { time: 5 });
  const work = { assets: [asset()], tools: [{ id: 't', tool: { id: 'p', version: '1.0.0' }, config: {} }] };
  assert.deepEqual(readPlayerState(work, 'p'), { time: 1 }, 'falls back to the asset until the entry has a state');
  storePlayerState(work, 'p', { time: 7 });
  assert.deepEqual(work.tools[0].state, { time: 7 });
  assert.equal(work.assets[0].provenance.playback, undefined, 'one place only');
  assert.deepEqual(readPlayerState(work, 'p'), { time: 7 });
  assert.equal(toolEntryFor(work, 'other'), undefined);
});

test('the player receives the configuration and state of its tool entry, for preparation and creation', async () => {
  const config = { id: 'custom' }, state = { time: 3 };
  const scene = { model: { atoms: [] }, warnings: [],
    scene: { legacy: { scene: { process: 'kcsa' } }, assets: [], tools: [{ id: 't', tool: { id: 'org.glow.legacy-process.kcsa', version: '1.0.0' }, config, state }] } };
  let prepareInput, createInput;
  const factory = { prepare: async (input) => { prepareInput = input; return {}; }, create: (input) => { createInput = input; return 'player'; } };
  const runtime = createMechanismRuntime({ getPlayer: () => factory, getService: () => ({ parse() {} }) }, {});
  await runtime.preparePlayer(scene, new AbortController().signal);
  assert.equal(prepareInput.config, config);
  assert.equal(runtime.createPlayer(scene), 'player');
  assert.equal(createInput.config, config);
  assert.equal(createInput.state, state);
  runtime.createPlayer(scene, { time: 8 });
  assert.deepEqual(createInput.state, { time: 8 }, 'an explicit state wins');
});
