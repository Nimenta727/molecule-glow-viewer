import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolEntriesForScene } from '../../plugins/mechanism-catalog.mjs';
import { makeStaticTemplate } from '../../apps/viewer-web/work-scene.mjs';
import { normalizeDataConfig } from '../../plugins/simulation/data-tool.mjs';
import { normalizeTranslationConfig, translationProcessConfig } from '../../plugins/simulation/translation-tool.mjs';
import { normalizeCompositionConfig } from '../../plugins/simulation/composition-tool.mjs';
import { createMarkovRun } from '../../plugins/simulation/markov-model.mjs';
import { DataAnimation } from '../../plugins/simulation/data-animation.mjs';
import { seededRng } from '../../plugins/motion/particles.mjs';

/**
 * The fifteen official packs together (4.4.8 acceptance of the behaviour that does not need a GPU or the real coordinates): every pack is a well-formed pack with a unique id; opened as a
 * template it is fully static; every tool entry its declared mechanism gives is valid for its tool; the data-animation works run for twenty animation seconds on a made-up structure
 * deterministically, with the metering balanced and no violated conservation; the translation work runs as a seeded Markov chain. The three packs whose tool entries need the real structure
 * (adenylate kinase, ATP synthase, KcsA players) are checked for the pack itself and the template.
 */
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../workshop/official/packs');
const packs = fs.readdirSync(dir).filter((f) => f.endsWith('.glow')).sort().map((f) => ({ file: f, pack: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
const points = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) points.push([i * 8 - 44, ((i + j) % 3) * 2 - 2, j * 8 - 44]);
const structure = { points, membraneY: [0], residue: () => null, part: () => null, partPoints: () => [], ligands: [] };
const entriesOf = (scene) => { try { return toolEntriesForScene({ legacy: { scene } }); } catch { return null; } };

test('there are fifteen official packs, each well formed, with unique ids and a scene', () => {
  assert.equal(packs.length, 15);
  const ids = new Set();
  for (const { file, pack } of packs) {
    assert.equal(pack.format, 'glow-scene', file); assert.ok(pack.id && !ids.has(pack.id), `${file}: unique id`); ids.add(pack.id);
    assert.ok(typeof pack.title === 'string' && pack.title && pack.license && pack.author?.name, `${file}: title, licence and author`);
    assert.ok(pack.scene && typeof pack.scene === 'object', `${file}: a scene`);
  }
});

test('opened as a template every pack is static: nothing that makes it move is left', () => {
  for (const { file, pack } of packs) {
    const loaded = { scene: { legacy: { scene: structuredClone(pack.scene) } } }; makeStaticTemplate(loaded);
    const left = loaded.scene.legacy.scene;
    for (const key of ['process', 'animation', 'states', 'energy', 'energyHL']) assert.equal(key in left, false, `${file}: ${key}`);
    assert.equal(loaded.isTemplate, true);
  }
});

test('every tool entry that a pack\'s mechanism gives is valid for its tool', () => {
  let checked = 0;
  for (const { file, pack } of packs) {
    const entries = entriesOf(pack.scene); if (!entries) continue;
    for (const e of entries) {
      const id = e.tool.id.replace('org.glow.tool.', '');
      if (id === 'data-animation') normalizeDataConfig(e.config);
      else if (id === 'translation') translationProcessConfig(normalizeTranslationConfig(e.config));
      else if (id === 'multi-process') normalizeCompositionConfig(e.config);
      else assert.fail(`${file}: unknown tool ${e.tool.id}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `${checked} entries checked`);
});

test('the data-animation works run twenty seconds deterministically with the metering balanced', () => {
  let ran = 0;
  for (const { file, pack } of packs) {
    const entry = entriesOf(pack.scene)?.find((e) => e.tool.id === 'org.glow.tool.data-animation'); if (!entry) continue;
    const config = normalizeDataConfig(entry.config), run = () => {
      const engine = new DataAnimation(config.animation, structure, { rng: seededRng(config.seed), kinetics: config.kinetics ?? null });
      for (let i = 0; i < 30 * 20; i++) engine.step(1 / 30);
      return engine;
    };
    const a = run(), b = run();
    assert.deepEqual(a.summary().counters, b.summary().counters, `${file}: same seed, same counters`); assert.deepEqual(a.summary().events, b.summary().events, `${file}: same events`);
    assert.deepEqual(Object.entries(a.balance()).filter(([, v]) => v.expected !== v.actual), [], `${file}: the metering balances`); assert.deepEqual(a.summary().violations, [], `${file}: conservation`);
    ran++;
  }
  assert.ok(ran >= 5, `${ran} works run`);   // adk-reaction-data, kcsa-data, respiratory chain, chloroplast, flagellar motor
});

test('the translation work runs as a seeded Markov chain: same seed, same history; the ribosome elongates', () => {
  const pack = packs.find((p) => p.pack.scene.process === 'translation').pack, entry = entriesOf(pack.scene).find((e) => e.tool.id === 'org.glow.tool.translation');
  const config = translationProcessConfig(normalizeTranslationConfig(entry.config)), run = () => createMarkovRun(config.process, config.seed, config.schedule);
  const a = run().at(30), b = run().at(30);
  assert.deepEqual(a.events, b.events); assert.ok(a.nums.L > 3, `the chain has grown to ${a.nums.L}`);
});
