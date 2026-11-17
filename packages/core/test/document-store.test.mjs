import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument, createDocumentStore, validateDocument } from '../index.mjs';

const transform = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const asset = { id: 'asset-box', kind: 'primitive', shape: 'box', color: '#336699' };
const root = { id: 'root', name: 'Root', parentId: null, assetId: null, visible: true, transform: transform() };
const child = { id: 'child', name: 'Box', parentId: 'root', assetId: 'asset-box', visible: true, transform: transform() };
const makeDocument = () => createDocument([asset], [root, child], {
  duration: 2,
  tracks: [{ nodeId: 'child', keyframes: [{ time: 0, transform: transform() }, { time: 2, transform: { ...transform(), position: [2, 0, 0] } }] }],
});

test('createDocument builds a valid prototype scene', () => {
  const document = makeDocument();
  assert.equal(document.format, 'glow-prototype');
  assert.equal(document.nodes.length, 2);
  assert.equal(validateDocument(document).timeline.tracks[0].nodeId, 'child');
});

test('validation rejects non-finite data, unresolved references, cycles and invalid transforms', () => {
  const nonFinite = makeDocument();
  nonFinite.nodes[1].transform.position[0] = Infinity;
  assert.throws(() => validateDocument(nonFinite), /finite/);

  const missingAsset = makeDocument();
  missingAsset.nodes[1].assetId = 'missing';
  assert.throws(() => validateDocument(missingAsset), /unknown asset/);

  const missingAncestor = makeDocument();
  missingAncestor.nodes.reverse();
  missingAncestor.nodes[1].parentId = 'missing';
  assert.throws(() => validateDocument(missingAncestor), /unknown parent/);

  const sparseTransform = makeDocument();
  delete sparseTransform.nodes[0].transform.position[1];
  assert.throws(() => validateDocument(sparseTransform), /JSON-compatible/);

  const cycle = makeDocument();
  cycle.nodes[0].parentId = 'child';
  assert.throws(() => validateDocument(cycle), /cycle/);

  const invalidQuaternion = makeDocument();
  invalidQuaternion.nodes[0].transform.rotation = [0, 0, 0, 2];
  assert.throws(() => validateDocument(invalidQuaternion), /normalized/);
});

test('snapshots are deeply immutable and detached from the caller input', () => {
  const input = makeDocument();
  const store = createDocumentStore(input);
  input.nodes[0].name = 'mutated input';
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.nodes[0].name, 'Root');
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.nodes));
  assert.ok(Object.isFrozen(snapshot.nodes[0].transform.position));
  assert.throws(() => { snapshot.nodes[0].name = 'mutated snapshot'; }, TypeError);
});

test('batch is atomic, records one history entry, and notifies once', () => {
  const store = createDocumentStore(makeDocument());
  const notifications = [];
  const unsubscribe = store.subscribe((snapshot, meta) => {
    notifications.push({ name: snapshot.nodes[0].name, ...meta });
  });
  const added = { id: 'extra', name: 'Extra', parentId: 'root', assetId: 'asset-box', visible: true, transform: transform() };
  const outcome = store.dispatch({ type: 'batch', commands: [
    { type: 'updateNode', id: 'root', patch: { name: 'Renamed' } },
    { type: 'addNode', node: added },
  ] });
  assert.deepEqual(outcome, { ok: true, changed: true, revision: 1 });
  assert.equal(store.getSnapshot().nodes.length, 3);
  assert.deepEqual(notifications, [{ name: 'Renamed', reason: 'dispatch', revision: 1 }]);
  unsubscribe();
  assert.deepEqual(store.undo(), { ok: true, changed: true, revision: 2 });
  assert.equal(store.getSnapshot().nodes.length, 2);
  assert.equal(store.getSnapshot().nodes[0].name, 'Root');
  assert.deepEqual(store.redo(), { ok: true, changed: true, revision: 3 });
  assert.equal(store.getSnapshot().nodes[0].name, 'Renamed');
});

test('primitive assets can be added with a referencing node in one undoable batch', () => {
  const store = createDocumentStore(makeDocument());
  const sphere = { id: 'asset-sphere', kind: 'primitive', shape: 'sphere', color: '#ffcc00' };
  const node = { id: 'sphere-node', name: 'Sphere', parentId: 'root', assetId: 'asset-sphere', visible: true, transform: transform() };
  assert.deepEqual(store.dispatch({ type: 'batch', commands: [
    { type: 'addAsset', asset: sphere },
    { type: 'addNode', node },
  ] }), { ok: true, changed: true, revision: 1 });
  assert.equal(store.getSnapshot().assets.at(-1).id, 'asset-sphere');
  assert.equal(store.getSnapshot().nodes.at(-1).assetId, 'asset-sphere');
  store.undo();
  assert.equal(store.getSnapshot().assets.some((asset) => asset.id === 'asset-sphere'), false);
  assert.equal(store.getSnapshot().nodes.some((entry) => entry.id === 'sphere-node'), false);
  store.redo();
  assert.equal(store.getSnapshot().nodes.at(-1).assetId, 'asset-sphere');
});

test('primitive asset updates preserve identity and validate shape/color', () => {
  const store = createDocumentStore(makeDocument());
  assert.deepEqual(store.dispatch({ type: 'updateAsset', id: 'asset-box', patch: { shape: 'sphere', color: '#123abc' } }), { ok: true, changed: true, revision: 1 });
  assert.equal(store.getSnapshot().assets[0].id, 'asset-box');
  assert.equal(store.getSnapshot().assets[0].kind, 'primitive');
  assert.equal(store.getSnapshot().assets[0].shape, 'sphere');
  assert.equal(store.getSnapshot().assets[0].color, '#123abc');
  const before = store.getSnapshot();
  assert.equal(store.dispatch({ type: 'updateAsset', id: 'asset-box', patch: { id: 'changed' } }).ok, false);
  assert.equal(store.dispatch({ type: 'updateAsset', id: 'asset-box', patch: { color: 'red' } }).ok, false);
  assert.equal(store.getSnapshot(), before);
  store.undo();
  assert.equal(store.getSnapshot().assets[0].shape, 'box');
});

test('setTimeline replaces validated timeline atomically and participates in history', () => {
  const store = createDocumentStore(makeDocument());
  const timeline = { duration: 3, tracks: [{ nodeId: 'root', keyframes: [{ time: 0, transform: transform() }, { time: 3, transform: { ...transform(), position: [3, 0, 0] } }] }] };
  assert.deepEqual(store.dispatch({ type: 'setTimeline', timeline }), { ok: true, changed: true, revision: 1 });
  assert.equal(store.getSnapshot().timeline.duration, 3);
  assert.equal(store.getSnapshot().timeline.tracks[0].nodeId, 'root');
  store.undo();
  assert.equal(store.getSnapshot().timeline.duration, 2);
  assert.equal(store.getSnapshot().timeline.tracks[0].nodeId, 'child');
  store.redo();
  assert.equal(store.getSnapshot().timeline.duration, 3);
});

test('asset and timeline changes inside a rejected batch leave history and snapshots unchanged', () => {
  const store = createDocumentStore(makeDocument());
  const before = store.getSnapshot();
  const outcome = store.dispatch({ type: 'batch', commands: [
    { type: 'updateAsset', id: 'asset-box', patch: { color: '#ffffff' } },
    { type: 'setTimeline', timeline: { duration: 1, tracks: [{ nodeId: 'missing', keyframes: [{ time: 0, transform: transform() }] }] } },
  ] });
  assert.equal(outcome.ok, false);
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(store.undo(), { ok: true, changed: false, revision: 0 });
});

test('invalid final batch state leaves snapshot, revision and history unchanged', () => {
  const store = createDocumentStore(makeDocument());
  const before = store.getSnapshot();
  const outcome = store.dispatch({ type: 'batch', commands: [
    { type: 'updateNode', id: 'root', patch: { name: 'Should roll back' } },
    { type: 'addNode', node: { ...child, id: 'broken', parentId: 'missing' } },
  ] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.revision, 0);
  assert.match(outcome.error.message, /unknown parent/);
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(store.undo(), { ok: true, changed: false, revision: 0 });
});

test('subtree removal also removes animation tracks and is undoable', () => {
  const store = createDocumentStore(makeDocument());
  assert.deepEqual(store.dispatch({ type: 'removeNode', id: 'root' }), { ok: true, changed: true, revision: 1 });
  assert.equal(store.getSnapshot().nodes.length, 0);
  assert.equal(store.getSnapshot().timeline.tracks.length, 0);
  store.undo();
  assert.equal(store.getSnapshot().nodes.length, 2);
  assert.equal(store.getSnapshot().timeline.tracks.length, 1);
});

test('no-op edits do not add history; a new edit after undo clears redo', () => {
  const store = createDocumentStore(makeDocument());
  assert.deepEqual(store.dispatch({ type: 'updateNode', id: 'root', patch: { name: 'Root' } }), { ok: true, changed: false, revision: 0 });
  assert.deepEqual(store.undo(), { ok: true, changed: false, revision: 0 });
  store.dispatch({ type: 'updateNode', id: 'root', patch: { name: 'Changed' } });
  store.undo();
  store.dispatch({ type: 'updateNode', id: 'root', patch: { visible: false } });
  assert.deepEqual(store.redo(), { ok: true, changed: false, revision: 3 });
  assert.equal(store.getSnapshot().nodes[0].visible, false);
});

test('subscription returns an idempotent unsubscribe function', () => {
  const store = createDocumentStore(makeDocument());
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  store.dispatch({ type: 'updateNode', id: 'root', patch: { name: 'Changed' } });
  assert.equal(calls, 0);
  assert.throws(() => store.subscribe(null), /function/);
});
