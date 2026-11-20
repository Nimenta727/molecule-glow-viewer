import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { toolControls, authorFields, getPath, editAuthorField, validateToolValues } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { mechanismPlugins } from '../../mechanism-catalog.mjs';
import { ATP_PLAYER, createAtpPlayer } from '../../atp-synthase/index.mjs';
import { KCSA_PLAYER, createKcsaPlayer } from '../../kcsa/index.mjs';
import { ADK_PLAYER } from '../../adenylate-kinase/index.mjs';
import { PARAMETERS as KCSA_PARAMETERS, validateParameters as validateKcsa } from '../../kcsa/kinetics.mjs';
import { PARAMETERS as ADK_PARAMETERS, validateParameters as validateAdk } from '../../adenylate-kinase/playback.mjs';
import { fixture as atpFixture } from '../../atp-synthase/test/fixture.mjs';
import { kcsaFixture } from '../../kcsa/test/fixture.mjs';

async function hostWithTools() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  for (const plugin of mechanismPlugins) await host.activate(plugin);
  return host;
}

test('the three built-in players are registered as tools for both front ends', async () => {
  const host = await hostWithTools();
  assert.deepEqual(host.listTools({ audience: 'view' }).map(({ id }) => id).sort(), [ADK_PLAYER, ATP_PLAYER, KCSA_PLAYER].sort());
  assert.deepEqual(host.listTools({ audience: 'author' }).map(({ id }) => id).sort(), [ADK_PLAYER, ATP_PLAYER, KCSA_PLAYER].sort());
  for (const tool of host.listTools()) {
    assert.equal(tool.version, '1.0.0');
    assert.ok(tool.model.assumptions.length > 0, `${tool.id} states the limits of its model`);
  }
  await host.deactivate(KCSA_PLAYER);
  assert.equal(host.getTool(KCSA_PLAYER), undefined, 'deactivating a plugin removes its tool');
});

for (const [name, id, PARAMETERS, validateLegacy] of [['KcsA', KCSA_PLAYER, KCSA_PARAMETERS, validateKcsa], ['AdK', ADK_PLAYER, ADK_PARAMETERS, validateAdk]]) {
  test(`${name}: the descriptor's runtime controls equal the plugin's own parameter table and accept the same values`, async () => {
    const tool = (await hostWithTools()).getTool(id);
    const controls = toolControls(tool, 'view');
    assert.deepEqual(controls.map(({ key }) => key), Object.keys(PARAMETERS));
    for (const control of controls) {
      const field = PARAMETERS[control.key];
      assert.deepEqual([control.label, control.min, control.max, control.step, control.default], [field.label, field.min, field.max, field.step, field.value], control.key);
      assert.equal(control.control, field.control);
    }
    for (const [key, field] of Object.entries(PARAMETERS)) {
      for (const value of [field.min, field.max, field.value, (field.min + field.max) / 2, field.min - 1, field.max + 1, NaN, Infinity, field.min + 0.5 * field.step]) {
        const legacy = (() => { try { validateLegacy({ [key]: value }); return true; } catch { return false; } })();
        const generic = (() => { try { validateToolValues(tool, { [key]: value }, 'view'); return true; } catch { return false; } })();
        assert.equal(generic, legacy, `${name} ${key}=${value}`);
      }
    }
    assert.throws(() => validateToolValues(tool, { notAParameter: 1 }, 'view'));
  });
}

test('every author field of every built-in tool resolves, and writing the current value back changes nothing', async () => {
  const host = await hostWithTools();
  for (const tool of host.listTools({ audience: 'author' })) {
    const config = JSON.parse(JSON.stringify(tool.author.template));
    const fields = authorFields(tool, config);
    assert.ok(fields.length >= 20, `${tool.id} offers a useful set of fields (${fields.length})`);
    assert.equal(new Set(fields.map(({ path }) => path)).size, fields.length, `${tool.id}: field paths are unique`);
    for (const field of fields) {
      const value = getPath(config, field.path);
      if (field.path.startsWith('conditions.')) { assert.equal(value, undefined); assert.ok(Number.isFinite(field.default), `${field.path} shows the model default`); continue; }
      assert.notEqual(value, undefined, `${tool.id} ${field.path} exists in the configuration`);
      const raw = value === null ? '' : field.type === 'boolean' ? value : String(value);
      assert.deepEqual(editAuthorField(tool, config, field.path, raw), config, `${tool.id} ${field.path}: re-entering the current value is a no-op`);
    }
  }
});

test('KcsA initial conditions are edited through the model\'s own bounds', async () => {
  const tool = (await hostWithTools()).getTool(KCSA_PLAYER), config = JSON.parse(JSON.stringify(tool.author.template));
  const edited = editAuthorField(tool, config, 'conditions.pH', '7');
  assert.deepEqual(edited.conditions, { pH: 7 });
  assert.throws(() => editAuthorField(tool, config, 'conditions.pH', '9'), /应在 3\.5–8/);
  assert.throws(() => editAuthorField(tool, config, 'conditions.wt', '0.5'), /需要整数/);
  const player = createKcsaPlayer({ ...kcsaFixture(), state: { seed: 3 }, config: edited });
  assert.equal(player.seek(0).parameters.pH, 7, 'the edit reaches the running player');
});

test('ATP edits reach the player: step text, ring size and particle colour', async () => {
  const tool = (await hostWithTools()).getTool(ATP_PLAYER);
  let config = JSON.parse(JSON.stringify(tool.author.template));
  config = editAuthorField(tool, config, 'steps.1.title', '我写的第二步');
  config = editAuthorField(tool, config, 'particles.proton.color', '#00aa55');
  assert.throws(() => editAuthorField(tool, config, 'counts.ringSubunits', '2'), /应在 3–64/);
  const eight = createAtpPlayer({ ...atpFixture(), state: { seed: 1 }, config });
  assert.equal(eight.steps[1].title, '我写的第二步');
  assert.equal(eight.seek(1).particles[0].color, '#00aa55');
  config = editAuthorField(tool, config, 'counts.ringSubunits', '10');
  const ten = createAtpPlayer({ ...atpFixture({ ring: 10 }), state: { seed: 1 }, config });
  assert.equal(ten.seek(4).counters['H⁺'], 10);
  assert.throws(() => createAtpPlayer({ ...atpFixture(), config }), /适用于具有 10 个 c 亚基/, 'the player still refuses a structure that does not fit the configuration');
});
