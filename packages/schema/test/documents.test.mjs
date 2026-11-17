import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPackagePath, toCoreDocument, validatePackageManifest, validateProject, validateScene,
} from '../documents.mjs';

const transform = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const primitive = { id: 'box', kind: 'primitive', shape: 'box', color: '#336699' };
const scene = (id = 'scene-a') => ({
  format: 'glow-scene', schemaVersion: 2, id, title: 'A Scene',
  units: { length: 'meter', time: 'second' },
  assets: [primitive, { id: 'external-model', kind: 'external', source: { provider: 'example', accession: 'model-1' }, mediaType: 'model/example' }],
  nodes: [
    { id: 'root', name: 'Root', parentId: null, assetId: null, visible: true, transform: transform() },
    { id: 'mesh', name: 'Box', parentId: 'root', assetId: 'box', visible: true, transform: transform(), extensions: { 'com.example.note': ['stored as extension data'] } },
    { id: 'external-node', name: 'External model', parentId: 'root', assetId: 'external-model', visible: true, transform: transform() },
  ],
  timeline: { duration: 2, tracks: [{ nodeId: 'external-node', keyframes: [{ time: 0, transform: transform() }, { time: 2, transform: { ...transform(), position: [1, 0, 0] } }] }] },
  dependencies: [{ id: 'renderer.basic', version: '1.2.3', optional: false }],
  evidence: [{ type: 'illustrative', details: { confidence: 0.2 } }],
});

test('scene validation returns detached structured JSON and preserves optional metadata', () => {
  const input = scene();
  const output = validateScene(input);
  input.nodes[1].extensions['com.example.note'][0] = 'mutated';
  assert.equal(output.nodes[1].extensions['com.example.note'][0], 'stored as extension data');
  assert.equal(output.evidence[0].details.confidence, 0.2);
});

test('scene validates references, timeline constraints and cross-variant asset ID uniqueness', () => {
  const unknownAsset = scene();
  unknownAsset.nodes[1].assetId = 'missing';
  assert.throws(() => validateScene(unknownAsset), /unknown asset/);

  const duplicateAsset = scene();
  duplicateAsset.assets[1].id = 'box';
  assert.throws(() => validateScene(duplicateAsset), /duplicate asset ID/);

  const outOfRange = scene();
  outOfRange.timeline.tracks[0].keyframes[1].time = 3;
  assert.throws(() => validateScene(outOfRange), /within the timeline duration/);

  const duplicateTrack = scene();
  duplicateTrack.timeline.tracks.push({ nodeId: 'external-node', keyframes: [{ time: 0, transform: transform() }] });
  assert.throws(() => validateScene(duplicateTrack), /already has a track/);

  const invalidRotation = scene();
  invalidRotation.nodes[1].transform.rotation = [0, 0, 0, 2];
  assert.throws(() => validateScene(invalidRotation), /quaternion must be normalized/);
});

test('Core projection strips schema fields and maps unsupported assets to groups', () => {
  const projected = toCoreDocument(scene());
  assert.deepEqual(Object.keys(projected).sort(), ['assets', 'format', 'nodes', 'timeline', 'version']);
  assert.deepEqual(projected.assets, [primitive]);
  assert.equal(projected.nodes[1].assetId, 'box');
  assert.equal(projected.nodes[2].assetId, null);
  assert.equal(projected.nodes[1].extensions, undefined);
  assert.equal(projected.timeline.tracks[0].nodeId, 'external-node');
});

test('project enforces unique scene IDs and a resolvable active scene', () => {
  const valid = { format: 'glow-project', schemaVersion: 1, id: 'project', title: 'Project', scenes: [scene()], activeSceneId: 'scene-a' };
  assert.equal(validateProject(valid).activeSceneId, 'scene-a');
  assert.throws(() => validateProject({ ...valid, scenes: [scene(), scene()] }), /duplicate scene ID/);
  assert.throws(() => validateProject({ ...valid, activeSceneId: 'missing' }), /does not reference a scene/);
});

test('package paths are portable, normalized and limited to scene.json or assets/', () => {
  for (const path of ['scene.json', 'assets/model.pdb', 'assets/nested/mesh.glb', 'assets/A_file-1.bin']) assert.equal(isPackagePath(path), true, path);
  for (const path of ['', '../scene.json', 'assets/../secret', 'assets//file', 'assets/a\\b', '/assets/file', 'C:/assets/file', 'assets/%2e%2e/file', 'assets/CON', 'assets/name.', 'readme.txt']) {
    assert.equal(isPackagePath(path), false, path);
  }
});

test('package manifest must list scene.json and rejects unsafe or case-colliding paths', () => {
  const manifest = {
    format: 'glow-package', schemaVersion: 1, id: 'pkg-1', kind: 'scene', scene: 'scene.json',
    files: [{ path: 'scene.json', sha256: 'a'.repeat(64), size: 100 }, { path: 'assets/model.glb', sha256: 'b'.repeat(64), size: 50 }],
  };
  assert.equal(validatePackageManifest(manifest).files.length, 2);
  assert.throws(() => validatePackageManifest({ ...manifest, files: manifest.files.slice(1) }), /must list scene.json/);
  assert.throws(() => validatePackageManifest({ ...manifest, files: [...manifest.files, { ...manifest.files[1], path: 'assets/MODEL.glb' }] }), /duplicate package file path/);
  assert.throws(() => validatePackageManifest({ ...manifest, files: [{ ...manifest.files[1], path: 'assets/../secret' }] }), /not portable/);
});
