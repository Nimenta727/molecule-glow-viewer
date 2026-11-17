import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { migrateLegacyScene } from '../index.mjs';
import { readScenePackage, writeScenePackage } from '../../schema/archive.mjs';
import { validateScene } from '../../schema/documents.mjs';

globalThis.crypto ??= webcrypto;
const packDir = new URL('../../../workshop/official/packs/', import.meta.url);
const readPack = async name => JSON.parse(await readFile(new URL(name, packDir), 'utf8'));

test('migrates every official v1 fixture without mutating source or fetching assets', async () => {
  const names = [
    'official.whole-cell.glow', 'official.translation.glow', 'official.spike.glow',
    'official.respiratory-chain.glow', 'official.proteasome-20s.glow', 'official.nucleosome.glow',
    'official.kcsa.glow', 'official.kcsa-data.glow', 'official.groel.glow',
    'official.flagellar-motor.glow', 'official.adenylate-kinase.glow', 'official.adk-reaction-data.glow',
    'official.chloroplast-light.glow', 'official.cell-corner.glow', 'official.atp-synthase.glow',
  ];
  for (const name of names) {
    const source = await readPack(name);
    const before = structuredClone(source);
    const { scene, resources, warnings } = await migrateLegacyScene(source);
    assert.deepEqual(validateScene(scene), scene, name);
    assert.deepEqual(source, before, `${name} was mutated`);
    assert.equal(scene.format, 'glow-scene');
    assert.equal(scene.schemaVersion, 2);
    assert.equal(scene.units.length, 'meter');
    assert.deepEqual(scene.timeline, { duration: 0, tracks: [] });
    assert.ok(Array.isArray(scene.assets));
    assert.ok(Array.isArray(scene.nodes));
    assert.ok(Array.isArray(scene.dependencies));
    assert.ok(Array.isArray(scene.evidence));
    assert.ok(Array.isArray(warnings));
    assert.ok(resources instanceof Map);
    for (const asset of scene.assets) if (asset.kind === 'external') assert.ok(asset.source.accession);
  }
});

test('normalizes dataAnim to animation data without process code or a process dependency', async () => {
  const source = await readPack('official.kcsa-data.glow');
  const { scene } = await migrateLegacyScene(source);
  assert.equal(scene.legacy.scene.process, undefined);
  assert.ok(scene.legacy.scene.animation.flows.length > 0);
  assert.equal(scene.dependencies.some(dep => dep.id.includes('legacy-process')), false);
});

test('maps known processes and preserves unsupported playback as a named optional dependency', async () => {
  const source = await readPack('official.kcsa.glow');
  const { scene, warnings } = await migrateLegacyScene(source);
  assert.deepEqual(scene.dependencies.find(dep => dep.id.includes('legacy-process')), {
    id: 'org.glow.legacy-process.kcsa', version: '1.0.0', optional: true,
  });
  assert.ok(warnings.some(warning => warning.includes('kcsa')));
  assert.equal(scene.legacy.scene.process, 'kcsa');
});

test('embeds generic structure bytes in resources and records digest without duplicating text', async () => {
  const source = {
    format: 'glow-scene', version: 1, id: 'test.embed', title: 'Embedded',
    scene: { structure: { name: 'sample.pdb', text: 'ATOM  generic bytes\n' }, evidence: { illustrative: ['fixture'] } },
  };
  const { scene, resources } = await migrateLegacyScene(source);
  const asset = scene.assets[0];
  const bytes = resources.get(asset.path);
  assert.equal(asset.kind, 'file');
  assert.equal(new TextDecoder().decode(bytes), source.scene.structure.text);
  assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(scene.legacy.scene.structure.text, undefined);
  assert.deepEqual(scene.evidence, [{ illustrative: ['fixture'] }]);
  const reopened = await readScenePackage(await writeScenePackage(scene, resources));
  assert.deepEqual(reopened.scene, scene);
  assert.deepEqual(reopened.resources.get(asset.path), bytes);
});

test('rejects unknown process names before sanitizer and reports absent geometry', async () => {
  const invalid = { format: 'glow-scene', version: 1, id: 'test.bad', title: 'Bad', scene: { id: '1ABC', process: 'unknown' } };
  await assert.rejects(migrateLegacyScene(invalid), /未知的旧版过程/);
  const sparse = { format: 'glow-scene', version: 1, id: 'test.empty', title: 'Empty', scene: { caption: 'notes', previousField: 'keep' } };
  const result = await migrateLegacyScene(sparse);
  assert.equal(result.scene.nodes.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('没有可迁移的 PDB 编号')));
  assert.deepEqual(result.scene.legacy.unmappedSceneFields, { previousField: 'keep' });
});
