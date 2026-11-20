import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioSession } from '../session.mjs';
import { GEOMETRY_MEDIA_TYPE } from '../../schema/geometry.mjs';

const transform = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const scene = () => ({
  format: 'glow-scene', schemaVersion: 2, id: 'studio-scene', title: 'Studio test',
  units: { length: 'meter', time: 'second' },
  assets: [
    { id: 'primitive', kind: 'primitive', shape: 'box', color: '#123456', provenance: { importedFrom: 'fixture' } },
    { id: 'geometry', kind: 'file', path: 'assets/geometry.json', sha256: 'a'.repeat(64), mediaType: GEOMETRY_MEDIA_TYPE },
    { id: 'structure', kind: 'external', source: { provider: 'fixture', accession: 'structure-1' }, mediaType: 'chemical/x-mmcif' },
  ],
  nodes: [
    { id: 'root', name: 'Root', parentId: null, assetId: null, visible: true, transform: transform() },
    { id: 'primitive-node', name: 'Primitive', parentId: 'root', assetId: 'primitive', visible: true, transform: transform() },
    { id: 'geometry-node', name: 'Geometry', parentId: 'root', assetId: 'geometry', visible: true, transform: transform(), extensions: { 'org.example.meta': { keep: true } } },
    { id: 'structure-node', name: 'Structure', parentId: 'root', assetId: 'structure', visible: true, transform: transform(), extensions: { 'org.example.color': '#abcdef' } },
  ],
  timeline: { duration: 0, tracks: [] },
  dependencies: [], evidence: [],
  presentation: { notes: [{ id: 'existing-note', text: 'Keep me', nodeId: 'structure-node' }], bookmarks: [] },
});

test('navigation edits are undoable and referenced node deletion is rejected atomically', () => {
  const session = createStudioSession(scene());
  const navigation = { version: 1, entryId: 'cell-view', views: [{
    id: 'cell-view', mode: 'cell', title: '教学细胞', nodeId: 'primitive-node',
    parentIds: [], bookmarkId: null, labelIds: ['existing-note'],
  }] };
  assert.equal(session.dispatch({ type: 'setNavigation', navigation }), true);
  assert.equal(session.getScene().presentation.navigation.views[0].nodeId, 'primitive-node');
  const snapshot = session.getScene();
  assert.throws(() => session.dispatch({ type: 'removeNode', id: 'primitive-node' }), /Primitive.*教学细胞/);
  assert.throws(() => session.dispatch({ type: 'removeNode', id: 'structure-node' }), /Structure.*教学细胞/);
  assert.throws(() => session.dispatch({
    type: 'setNavigation',
    navigation: { ...navigation, entryId: 'missing-view' },
  }), /requires unique view IDs and a cell, system or protein entry/);
  assert.equal(session.getScene(), snapshot);
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().presentation.navigation, undefined);
  assert.equal(session.redo(), true);
  assert.equal(session.getScene(), snapshot);
});

test('Core projection recognizes available geometry and treats unsupported assets as groups', () => {
  const resource = new Uint8Array([1, 2, 3]);
  const resources = new Map([['assets/geometry.json', resource]]);
  const session = createStudioSession(scene(), resources);
  const core = session.getCoreDocument();
  assert.equal(core.assets.find((asset) => asset.id === 'geometry').kind, 'geometry');
  assert.equal(core.nodes.find((node) => node.id === 'geometry-node').assetId, 'geometry');
  assert.equal(core.nodes.find((node) => node.id === 'structure-node').assetId, null);
  const exported = session.getResources();
  assert.deepEqual(exported.get('assets/geometry.json'), resource);
  exported.get('assets/geometry.json')[0] = 99;
  exported.clear();
  resource[0] = 42;
  assert.deepEqual(session.getResources().get('assets/geometry.json'), new Uint8Array([1, 2, 3]));
});

test('generic Core edits merge back while preserving v2 refs, extensions, and primitive provenance', () => {
  const session = createStudioSession(scene(), new Map([['assets/geometry.json', new Uint8Array([9])]]));
  assert.equal(session.dispatch({ type: 'updateNode', id: 'structure-node', patch: { visible: false } }), true);
  let current = session.getScene();
  assert.equal(current.nodes.find((node) => node.id === 'structure-node').assetId, 'structure');
  assert.deepEqual(current.nodes.find((node) => node.id === 'structure-node').extensions, { 'org.example.color': '#abcdef' });
  assert.equal(current.nodes.find((node) => node.id === 'structure-node').visible, false);

  assert.equal(session.dispatch({ type: 'updateAsset', id: 'primitive', patch: { shape: 'sphere', color: '#fedcba' } }), true);
  current = session.getScene();
  assert.equal(current.assets.find((asset) => asset.id === 'primitive').shape, 'sphere');
  assert.deepEqual(current.assets.find((asset) => asset.id === 'primitive').provenance, { importedFrom: 'fixture' });
  assert.ok(current.assets.some((asset) => asset.id === 'geometry'));
  assert.ok(current.assets.some((asset) => asset.id === 'structure'));

  const added = { id: 'new-structure-node', name: 'New structure ref', parentId: 'root', assetId: 'structure', visible: true, transform: transform() };
  assert.equal(session.dispatch({ type: 'addNode', node: added }), true);
  assert.equal(session.getScene().nodes.find((node) => node.id === added.id).assetId, 'structure');
  assert.equal(session.dispatch({ type: 'removeNode', id: 'structure-node' }), true);
  assert.equal(session.getScene().presentation.notes.some((note) => note.nodeId === 'structure-node'), false);
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().presentation.notes.some((note) => note.nodeId === 'structure-node'), true);
});

test('metadata and generic edits share reversible history', () => {
  const session = createStudioSession(scene());
  assert.equal(session.canUndo(), false);
  assert.equal(session.dispatch({ type: 'addNote', note: { id: 'note-1', text: 'A note', nodeId: 'primitive-node' } }), true);
  assert.equal(session.dispatch({ type: 'addBookmark', bookmark: { id: 'camera-1', name: 'Front', position: [0, 0, 5], target: [0, 0, 0] } }), true);
  assert.equal(session.dispatch({ type: 'addEvidence', entry: { type: 'experimental', citation: 'Synthetic reference' } }), true);
  assert.equal(session.dispatch({ type: 'updateNode', id: 'primitive-node', patch: { name: 'Edited primitive' } }), true);
  assert.equal(session.getScene().nodes.find((node) => node.id === 'primitive-node').name, 'Edited primitive');
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().nodes.find((node) => node.id === 'primitive-node').name, 'Primitive');
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().evidence.length, 0);
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().presentation.bookmarks.length, 0);
  assert.equal(session.undo(), true);
  assert.equal(session.getScene().presentation.notes.length, 1);
  assert.equal(session.canUndo(), false);
  assert.equal(session.canRedo(), true);
  assert.equal(session.redo(), true);
  assert.equal(session.getScene().presentation.notes.length, 2);
});

test('invalid generic or metadata commands throw without changing scene or history', () => {
  const session = createStudioSession(scene());
  const before = session.getScene();
  assert.throws(() => session.dispatch({ type: 'updateNode', id: 'missing', patch: { name: 'Bad' } }), /unknown node/);
  assert.throws(() => session.dispatch({ type: 'addNote', note: { id: 'bad', text: 'dangling', nodeId: 'missing' } }), /unknown node/);
  assert.equal(session.getScene(), before);
  assert.equal(session.canUndo(), false);
  assert.equal(session.undo(), false);
});

test('scene and Core document snapshots are deeply immutable', () => {
  const session = createStudioSession(scene());
  assert.ok(Object.isFrozen(session.getScene()));
  assert.ok(Object.isFrozen(session.getScene().assets[0].provenance));
  assert.ok(Object.isFrozen(session.getCoreDocument().nodes[0].transform.position));
  assert.throws(() => { session.getScene().title = 'Mutated'; }, TypeError);
});

test('a v3 work keeps its tools, resource records and links through editing, undo and redo', async () => {
  const { createStudioSession } = await import('../session.mjs');
  const { upgradeSceneToV3 } = await import('../../schema/migrate.mjs');
  const data = new TextEncoder().encode('data_x');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((n) => n.toString(16).padStart(2, '0')).join('');
  const asset = { id: 'source', kind: 'file', path: 'assets/source.cif', sha256: hash, mediaType: 'chemical/x-mmcif', provenance: { parserVersion: '1', source: { provider: 'RCSB PDB', accession: '6ZPO' } } };
  const tools = [{ id: 't', tool: { id: 'x.y', version: '1.0.0' }, config: { a: [1, 2] }, state: { time: 1 } }];
  const { scene } = await upgradeSceneToV3({ format: 'glow-scene', schemaVersion: 2, id: 's', title: 'S', units: { length: 'meter', time: 'second' },
    assets: [asset], nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [] }, new Map([[asset.path, data]]), { tools });
  const session = createStudioSession(scene, new Map([[asset.path, data]]));
  session.dispatch({ type: 'setSceneTitle', title: 'Renamed' });
  const edited = session.getScene();
  assert.equal(edited.title, 'Renamed');
  assert.deepEqual(edited.tools, scene.tools);
  assert.deepEqual(edited.resources, scene.resources);
  assert.deepEqual(edited.assets[0].resource, scene.assets[0].resource);
  session.undo(); assert.deepEqual(session.getScene(), scene);
  session.redo(); assert.deepEqual(session.getScene().tools, scene.tools);
});

test('setToolConfig replaces one tool entry\'s configuration, is undoable, and refuses bad targets', async () => {
  const { createStudioSession } = await import('../session.mjs');
  const base = { format: 'glow-scene', schemaVersion: 3, id: 's', title: 'S', units: { length: 'meter', time: 'second' },
    assets: [], nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [], resources: [],
    tools: [{ id: 'a', tool: { id: 'x.y', version: '1.0.0' }, config: { n: 1 }, state: { time: 2 } }, { id: 'b', tool: { id: 'x.z', version: '1.0.0' }, config: { m: 1 } }] };
  const session = createStudioSession(base);
  assert.equal(session.dispatch({ type: 'setToolConfig', id: 'a', config: { n: 5, nested: { ok: true } } }), true);
  assert.deepEqual(session.getScene().tools[0], { id: 'a', tool: { id: 'x.y', version: '1.0.0' }, config: { n: 5, nested: { ok: true } }, state: { time: 2 } });
  assert.deepEqual(session.getScene().tools[1].config, { m: 1 }, 'other entries are untouched');
  assert.equal(session.dispatch({ type: 'setToolConfig', id: 'a', config: { n: 5, nested: { ok: true } } }), false, 'no change, no history entry');
  session.undo(); assert.deepEqual(session.getScene().tools[0].config, { n: 1 });
  session.redo(); assert.equal(session.getScene().tools[0].config.n, 5);
  assert.throws(() => session.dispatch({ type: 'setToolConfig', id: 'missing', config: {} }), /没有工具条目/);
  assert.throws(() => session.dispatch({ type: 'setToolConfig', id: 'a', config: [] }), /config object/);
  assert.throws(() => session.dispatch({ type: 'setToolConfig', id: 'a', config: { bad: () => 1 } }), /JSON|non/i);
  const { tools, resources, ...v2 } = base;
  assert.throws(() => createStudioSession({ ...v2, schemaVersion: 2 }).dispatch({ type: 'setToolConfig', id: 'a', config: {} }), /v3/);
});
