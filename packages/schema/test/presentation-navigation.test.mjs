import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fourModesDemo } from '../../../apps/viewer-web/four-modes-demo.mjs';
import { openSceneFile, geometryLayers, fromPrototype } from '../../../apps/viewer-web/scene-io.mjs';
import { exampleScene } from '../../../apps/viewer-web/example-scene.mjs';
import { writeScenePackage } from '../archive.mjs';
import { toCoreDocument, validateScene } from '../documents.mjs';

const demoUrl = new URL('../../../apps/viewer-web/four-modes-demo.glow', import.meta.url);

test('the published four-mode demo opens and survives a Viewer package round trip', async () => {
  const original = await openSceneFile(new Blob([await readFile(demoUrl)]));
  assert.deepEqual(original.scene, fourModesDemo);
  assert.deepEqual(original.scene.dependencies, []);
  assert.equal(geometryLayers(original).size, 0);
  assert.equal(toCoreDocument(original.scene).assets.length, fourModesDemo.assets.length);
  const saved = await writeScenePackage(original.scene, original.resources);
  assert.deepEqual(await openSceneFile(new Blob([saved])), original);
});

test('older v2 packages and v1 imports work without navigation metadata', async () => {
  const { scene } = fromPrototype(exampleScene);
  scene.presentation = { notes: [], bookmarks: [] };
  const legacyV2 = await openSceneFile(new Blob([await writeScenePackage(scene)]));
  assert.deepEqual(legacyV2.scene, scene);
  const v1 = await readFile(new URL('../../../workshop/official/packs/official.kcsa-data.glow', import.meta.url));
  const migrated = await openSceneFile(new Blob([v1]));
  assert.equal(migrated.scene.schemaVersion, 2);
  assert.equal(migrated.scene.presentation?.navigation, undefined);
});

test('navigation rejects invalid links, loops, camera references and timed steps', () => {
  const cases = [
    (p) => { p.navigation.version = 2; },
    (p) => { p.navigation.views[1].nodeId = 'missing'; },
    (p) => { p.navigation.views[1].hotspotNodeId = 'missing'; },
    (p) => { p.navigation.views[1].connections[0].to = 'missing'; },
    (p) => { p.navigation.views[2].connections = p.navigation.views[1].connections; },
    (p) => { p.navigation.views[1].parentIds = ['missing']; },
    (p) => { p.navigation.views[0].parentIds = ['view-system']; },
    (p) => { p.navigation.views[1].bookmarkId = 'missing'; },
    (p) => { p.bookmarks[0].position = p.bookmarks[0].target; },
    (p) => { p.navigation.views[3].steps[1].time = 5; },
    (p) => { delete p.navigation.views[3].steps[1].time; },
  ];
  for (const edit of cases) {
    const scene = structuredClone(fourModesDemo);
    edit(scene.presentation);
    assert.throws(() => validateScene(scene), { name: 'SchemaValidationError' });
  }
});

test('a scene can omit custom cameras and use untimed mechanism steps', () => {
  const scene = structuredClone(fourModesDemo);
  scene.timeline = { duration: 0, tracks: [] };
  assert.throws(() => validateScene(scene), /invalid step time/);
  scene.presentation.bookmarks = [];
  for (const view of scene.presentation.navigation.views) {
    view.bookmarkId = null;
    for (const step of view.steps ?? []) delete step.time;
  }
  assert.deepEqual(validateScene(scene), scene);
});

test('a molecular scene can enter through its system without an invented cell view', () => {
  const scene = structuredClone(fourModesDemo);
  const navigation = scene.presentation.navigation;
  navigation.views = navigation.views.filter(({ mode }) => mode !== 'cell');
  navigation.entryId = navigation.views[0].id;
  navigation.views[0].parentIds = [];
  delete navigation.views[0].hotspotNodeId;
  assert.deepEqual(validateScene(scene), scene);
});
