import assert from 'node:assert/strict';
import test from 'node:test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { readScenePackage, writeScenePackage } from '../archive.mjs';

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text);
const scene = (asset) => ({
  format: 'glow-scene', schemaVersion: 2, id: 'archive-test', title: 'Archive test',
  units: { length: 'meter', time: 'second' },
  assets: asset ? [{ id: 'file', kind: 'file', path: 'assets/sample.bin', sha256: asset.hash, mediaType: 'application/octet-stream' }] : [],
  nodes: [], timeline: { duration: 0, tracks: [] }, dependencies: [], evidence: [],
});

async function digest(data) {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function makeArchive(entries) {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false, level: 0 });
  for (const [name, content] of Object.entries(entries)) {
    await writer.add(name, new Uint8ArrayReader(content), { useWebWorkers: false, level: 0 });
  }
  return writer.close();
}

test('scene package round trips scene JSON and verified asset bytes', async () => {
  const assetBytes = bytes('sample local binary payload');
  const document = scene({ hash: await digest(assetBytes) });
  const archive = await writeScenePackage(document, new Map([['assets/sample.bin', assetBytes]]));
  assert.ok(archive instanceof Uint8Array);
  const loaded = await readScenePackage(archive);
  assert.deepEqual(loaded.scene, document);
  assert.deepEqual(loaded.resources.get('assets/sample.bin'), assetBytes);
  assert.equal(loaded.manifest.id, document.id);
});

test('writing rejects assets whose declared content hash is wrong', async () => {
  const assetBytes = bytes('payload');
  const document = scene({ hash: '0'.repeat(64) });
  await assert.rejects(writeScenePackage(document, new Map([['assets/sample.bin', assetBytes]])), /Asset hash does not match bytes/);
});

test('reading rejects a package whose manifest hash does not match scene bytes', async () => {
  const sceneBytes = bytes(JSON.stringify(scene()));
  const manifest = bytes(JSON.stringify({
    format: 'glow-package', schemaVersion: 1, id: 'archive-test', kind: 'scene', scene: 'scene.json',
    files: [{ path: 'scene.json', sha256: '0'.repeat(64), size: sceneBytes.byteLength }],
  }));
  const archive = await makeArchive({ 'manifest.json': manifest, 'scene.json': sceneBytes });
  await assert.rejects(readScenePackage(archive), /SHA-256 does not match manifest/);
});

test('reading rejects empty and corrupted archive bytes', async () => {
  await assert.rejects(readScenePackage(new Uint8Array()), /empty/);
  await assert.rejects(readScenePackage(bytes('not a zip')), /ZIP|archive|directory|format/i);
});
