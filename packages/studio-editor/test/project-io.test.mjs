import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { encodeProject, decodeProject } from '../project-io.mjs';

globalThis.crypto ??= webcrypto;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scene = (id, assets = []) => ({
  format: 'glow-scene', schemaVersion: 2, id, title: `Scene ${id}`,
  units: { length: 'meter', time: 'second' }, assets,
  nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [],
});
const fixture = (data = new Uint8Array([0, 255, 1, 2])) => {
  const project = {
    format: 'glow-project', schemaVersion: 1, id: 'project', title: 'Project',
    scenes: [scene('scene-a', [{ id: 'model', kind: 'file', path: 'assets/model.cif', sha256: hash(data), mediaType: 'chemical/x-mmcif' }]), scene('scene-b')],
    activeSceneId: 'scene-b',
  };
  const resources = new Map([['scene-a', new Map([['assets/model.cif', data]])], ['scene-b', new Map()]]);
  project.scenes[1].presentation = {
    notes: [{ id: 'note-1', text: 'Keep this annotation', nodeId: null }],
    bookmarks: [{ id: 'view-1', name: 'Overview', position: [1, 2, 3], target: [0, 0, 0] }],
  };
  return { project, resources, data };
};

test('round trips multiple scenes, active selection and exact resource bytes', async () => {
  const { project, resources, data } = fixture();
  const encoded = await encodeProject(project, resources);
  const decoded = await decodeProject(encoded);
  assert.equal(decoded.project.activeSceneId, 'scene-b');
  assert.deepEqual(decoded.project.scenes.map(scene => scene.id), ['scene-a', 'scene-b']);
  assert.deepEqual(decoded.project.scenes[1].presentation, project.scenes[1].presentation);
  assert.deepEqual(decoded.resourcesByScene.get('scene-a').get('assets/model.cif'), data);
  assert.deepEqual(decoded.resourcesByScene.get('scene-b'), new Map());
  assert.ok(encoded instanceof Uint8Array);
});

test('preserves inputs and supports arbitrary binary without altering high bytes', async () => {
  const { project, resources, data } = fixture();
  const savedProject = structuredClone(project);
  const savedData = new Uint8Array(data);
  await encodeProject(project, resources);
  data.fill(0);
  assert.deepEqual(project, savedProject);
  assert.deepEqual(savedData, new Uint8Array([0, 255, 1, 2]));
});

test('rejects missing, unknown and incorrect resources during encode', async () => {
  const { project, resources } = fixture();
  await assert.rejects(encodeProject(project, new Map([['scene-a', new Map()]])), /Missing resource/);
  const unknown = new Map([['scene-a', new Map([['assets/other.cif', new Uint8Array([0, 255, 1, 2])]])], ['scene-b', new Map()]]);
  await assert.rejects(encodeProject(project, unknown), /Unknown resource path/);
  const corrupt = new Map([['scene-a', new Map([['assets/model.cif', new Uint8Array([1, 2, 3])]])], ['scene-b', new Map()]]);
  await assert.rejects(encodeProject(project, corrupt), /SHA-256 mismatch/);
  const extraScene = new Map([...resources, ['ghost', new Map()]]);
  await assert.rejects(encodeProject(project, extraScene), /Unknown resource scene/);
});

test('rejects malformed envelope, nonportable project and unknown or missing restored references', async () => {
  await assert.rejects(decodeProject(new TextEncoder().encode('{')), /Invalid project file JSON/);
  const { project, resources } = fixture();
  const encoded = await encodeProject(project, resources);
  const envelope = JSON.parse(new TextDecoder().decode(encoded));
  envelope.resources['scene-a']['assets/model.cif'] = 'AAAA';
  await assert.rejects(decodeProject(new TextEncoder().encode(JSON.stringify(envelope))), /SHA-256 mismatch/);

  const missing = JSON.parse(new TextDecoder().decode(encoded));
  delete missing.resources['scene-a']['assets/model.cif'];
  await assert.rejects(decodeProject(new TextEncoder().encode(JSON.stringify(missing))), /Missing resource/);

  const unknown = JSON.parse(new TextDecoder().decode(encoded));
  unknown.resources['scene-a']['assets/extra.cif'] = '';
  await assert.rejects(decodeProject(new TextEncoder().encode(JSON.stringify(unknown))), /Unknown resource path/);

  const badPath = structuredClone(project);
  badPath.scenes[0].assets[0].path = 'assets/../escape.cif';
  await assert.rejects(encodeProject(badPath, resources), /portable/);
});

test('enforces the 32 MiB raw asset limit and base64 syntax', async () => {
  const tooLarge = new Uint8Array(32 * 1024 * 1024 + 1);
  const { project, resources } = fixture(tooLarge);
  await assert.rejects(encodeProject(project, resources), /exceeds 32 MiB/);

  const small = fixture();
  const encoded = await encodeProject(small.project, small.resources);
  const envelope = JSON.parse(new TextDecoder().decode(encoded));
  envelope.resources['scene-a']['assets/model.cif'] = '*invalid*';
  await assert.rejects(decodeProject(new TextEncoder().encode(JSON.stringify(envelope))), /Invalid base64/);
});
