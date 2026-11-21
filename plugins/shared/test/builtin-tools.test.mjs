import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { toolControls, authorFields, getPath, editAuthorField, validateToolValues, formatRanges } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { mechanismPlugins } from '../../mechanism-catalog.mjs';
import { ATP_PLAYER, createAtpPlayer } from '../../atp-synthase/index.mjs';
import { KCSA_PLAYER, createKcsaPlayer } from '../../kcsa/index.mjs';
import { ADK_PLAYER } from '../../adenylate-kinase/index.mjs';
import { ATP_TOOL } from '../../atp-synthase/tool.mjs';
import { KCSA_TOOL } from '../../kcsa/tool.mjs';
import { ADK_TOOL } from '../../adenylate-kinase/tool.mjs';
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
  const ids = [ADK_TOOL, ATP_TOOL, KCSA_TOOL].sort();
  assert.deepEqual(host.listTools({ audience: 'view' }).map(({ id }) => id), ids, 'tools are listed under their own ids, once each');
  assert.deepEqual(host.listTools({ audience: 'author' }).map(({ id }) => id), ids);
  for (const [tool, player] of [[ATP_TOOL, ATP_PLAYER], [KCSA_TOOL, KCSA_PLAYER], [ADK_TOOL, ADK_PLAYER]]) {
    assert.equal(host.getTool(player), host.getTool(tool), `works saved under the old name ${player} still find the tool`);
    assert.equal(host.resolveToolId(player), tool);
    assert.equal(host.resolveToolId(tool), tool);
  }
  for (const tool of host.listTools()) {
    assert.equal(tool.version, '1.0.0');
    assert.ok(tool.model.assumptions.length > 0, `${tool.id} states the limits of its model`);
  }
  await host.deactivate(KCSA_PLAYER);
  assert.equal(host.getTool(KCSA_TOOL), undefined, 'deactivating a plugin removes its tool');
  assert.equal(host.getTool(KCSA_PLAYER), undefined, '…and its old names');
  assert.equal(host.resolveToolId(KCSA_PLAYER), undefined);
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
      const raw = value === null ? '' : field.type === 'boolean' ? value : field.format === 'ranges' ? formatRanges(value) : String(value);   // what the input element shows
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

// ---- applicability and role bindings of the built-in tools ----------------------------------------------------------

import { checkApplicability, autoBindings, toolRoles } from '../../../packages/plugin-host/tool-model.mjs';
import { toolEntriesForScene } from '../../mechanism-catalog.mjs';
import { createAdkPlayer, prepareAdk } from '../../adenylate-kinase/index.mjs';
import { fixture as adkFixture } from '../../adenylate-kinase/test/fixture.mjs';

const sceneOf = (input) => ({ ...input.scene, nodes: input.scene.nodes });
// The synthetic ATP fixture carries one extra node without atoms ("C"); a real scene has one node per c subunit.
const atpScene = (input) => ({ ...input.scene, nodes: input.scene.nodes.filter((node) => node.id !== 'C') });

test('each tool states which objects it works on and what makes a scene unsuitable', async () => {
  const host = await hostWithTools();
  const atp = host.getTool(ATP_TOOL), kcsa = host.getTool(KCSA_TOOL), adk = host.getTool(ADK_TOOL);
  assert.deepEqual(toolRoles(atp).map(({ role }) => role), ['rotor']);
  assert.deepEqual(toolRoles(kcsa).map(({ role }) => role), ['channel']);
  assert.deepEqual(toolRoles(adk).map(({ role }) => [role, role && 1]).map(([role]) => role), ['protein']);

  // a ring of 8 and three catalytic chains: applicable, and the rotor is proposed
  const good = atpScene(atpFixture());
  const fits = checkApplicability(atp, good, { config: atp.author.template });
  assert.equal(fits.applicable, true);
  assert.equal(fits.bindings.rotor.length, 9, 'gamma plus the eight ring subunits');
  // a ring of 10 does not fit the 8-subunit configuration; the message says so
  const ten = checkApplicability(atp, atpScene(atpFixture({ ring: 10 })), { config: atp.author.template });
  assert.equal(ten.applicable, false);
  assert.match(ten.problems.join('|'), /c 环有 10 个亚基，配置要求 8 个/);
  // no structure at all
  const empty = checkApplicability(atp, { assets: [], nodes: [] }, { config: atp.author.template });
  assert.match(empty.problems.join('|'), /先导入结构/);
  assert.deepEqual(empty.unbound, ['rotor']);

  const channel = sceneOf(kcsaFixture());
  assert.deepEqual(checkApplicability(kcsa, channel, { config: kcsa.author.template }).bindings.channel, ['node-A', 'node-B', 'node-C', 'node-D']);
  assert.match(checkApplicability(kcsa, { assets: channel.assets, nodes: channel.nodes.slice(0, 3) }, { config: kcsa.author.template }).problems.join('|'), /需要 4 个通道链节点.*找到 3 个/);

  const hinge = sceneOf(adkFixture().loaded);
  assert.deepEqual(checkApplicability(adk, hinge, { config: adk.author.template }).bindings.protein, ['chain-A']);
  assert.match(checkApplicability(adk, { assets: hinge.assets, nodes: [] }, { config: adk.author.template }).problems.join('|'), /找到 0 个/);
});

test('players work on the nodes of their saved binding, and refuse nodes that are not of their structure', () => {
  // ATP: bind only the central stalk as rotor
  const atp = atpFixture();
  const everything = createAtpPlayer({ ...atp, state: { seed: 1 } });
  const onlyStalk = createAtpPlayer({ ...atp, state: { seed: 1 }, bindings: { rotor: ['G'] } });
  assert.deepEqual([...everything.seek(1).transforms.keys()].sort(), ['C', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'G'].sort(), 'without a binding the configured part names decide');
  assert.deepEqual([...onlyStalk.seek(1).transforms.keys()], ['G'], 'the binding decides which nodes rotate');
  assert.throws(() => createAtpPlayer({ ...atp, bindings: { rotor: ['no-such-node'] } }), /绑定的对象 no-such-node 不属于这个结构/);
  // KcsA: bind the channel to a subset and the player's own check still holds
  const kcsa = kcsaFixture();
  assert.throws(() => createKcsaPlayer({ ...kcsa, state: { seed: 1 }, bindings: { channel: ['node-A', 'node-B'] } }), /预览需要四个通道链节点/);
  assert.ok(createKcsaPlayer({ ...kcsa, state: { seed: 1 }, bindings: { channel: ['node-D', 'node-C', 'node-B', 'node-A'] } }), 'the same four nodes in another order still work');
});

test('a work saved without bindings gets them from the tool, written into the entry; legacy declarations get them at upgrade', async () => {
  const host = await hostWithTools();
  const legacy = { ...atpScene(atpFixture()), legacy: { scene: { process: 'atpSynthase' } } };
  const [entry] = toolEntriesForScene(legacy);
  assert.equal(entry.tool.id, ATP_TOOL);
  assert.equal(entry.bindings.rotor.length, 9, 'proposal written at the moment the legacy declaration becomes a tool entry');
  assert.deepEqual(entry.bindings.rotor.slice().sort(), checkApplicability(host.getTool(ATP_TOOL), legacy, { config: entry.config }).bindings.rotor.slice().sort());
  const { completeBindings } = await import('../../../apps/viewer-web/work-scene.mjs');
  const work = { ...atpScene(atpFixture()), tools: [{ id: 'a', tool: { id: ATP_PLAYER, version: '1.0.0' }, config: JSON.parse(JSON.stringify(host.getTool(ATP_TOOL).author.template)) }] };
  assert.equal(completeBindings(work, (id) => host.getTool(id)), true, 'found through the old player id');
  assert.equal(work.tools[0].bindings.rotor.length, 9);
  assert.equal(completeBindings(work, (id) => host.getTool(id)), false, 'idempotent');
  const unknown = { ...work, tools: [{ ...work.tools[0], id: 'u', tool: { id: 'not.registered', version: '1.0.0' } }] };
  assert.equal(completeBindings(unknown, (id) => host.getTool(id)), false, 'a tool that is not registered is left alone');
});

test('a second two-state protein is a different binding, not a different tool (AdK engine, hinge protein)', async () => {
  const host = await hostWithTools(), adk = host.getTool(ADK_TOOL);
  const { hingeFixture, HINGE_CONFIG } = await import('../../adenylate-kinase/test/fixture.mjs');
  const { loaded } = hingeFixture();
  const entry = { config: HINGE_CONFIG };
  const result = checkApplicability(adk, sceneOf(loaded), entry);
  assert.equal(result.applicable, true, result.problems.join('|'));
  assert.deepEqual(result.bindings.protein, ['chain-B']);
  assert.equal(checkApplicability(adk, sceneOf(loaded), { config: adk.author.template }).applicable, false, 'the default 4AKE configuration does not fit the hinge protein');
});
