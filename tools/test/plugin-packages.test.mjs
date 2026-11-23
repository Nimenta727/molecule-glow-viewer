import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validatePluginManifest } from '../../packages/plugin-host/plugin-manifest.mjs';
import { COMMANDS } from '../../apps/viewer-web/command-api.mjs';
import { PROCESS_PRESETS } from '../../plugins/simulation/process-models.mjs';
import { PROCESS_TOOL } from '../../plugins/simulation/process-tool.mjs';

const root = new URL('../../', import.meta.url), dir = new URL('plugins/packages/', root);
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
const manifests = files.map((name) => ({ name, manifest: validatePluginManifest(JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'))) }));
import { contactsPanel } from '../../plugins/structure/panels/contacts-panel.mjs';
import { compositionPanel } from '../../plugins/structure/panels/composition-panel.mjs';
import { secondaryPanel } from '../../plugins/structure/panels/secondary-panel.mjs';
import { superpositionPanel } from '../../plugins/structure/panels/superposition-panel.mjs';
import { surfacePanel } from '../../plugins/structure/panels/surface-panel.mjs';
const STUDIO_PANELS = new Set([contactsPanel.id, compositionPanel.id, secondaryPanel.id, superpositionPanel.id, surfacePanel.id]);   // the panels apps/studio-web/main.mjs registers
const KNOWN_PLUGINS = new Set(['org.glow.structure']);
const exists = (path) => fs.existsSync(new URL(path, root));

test('the twenty-six plugins are all packaged, each under its own id and file name', () => {
  assert.equal(manifests.length, 26);
  assert.equal(new Set(manifests.map(({ manifest }) => manifest.id)).size, 26, 'ids are unique');
  for (const { name, manifest } of manifests) assert.equal(manifest.id, `org.glow.plugin.${name.replace(/\.json$/, '')}`, `${name}: the id follows the file name`);
});

test('every plugin adds a function a user can reach, and what its manifest says it provides really exists', async () => {
  const problems = [];
  for (const { manifest } of manifests) {
    for (const entry of manifest.provides) {
      if (entry.type === 'command' && !Object.hasOwn(COMMANDS, entry.name)) problems.push(`${manifest.id}: the command "${entry.name}" is not in the Viewer's command table`);
      if (entry.type === 'tool-preset') {
        if (entry.tool !== PROCESS_TOOL) problems.push(`${manifest.id}: presets of the tool ${entry.tool} cannot be checked here`);
        else if (!PROCESS_PRESETS.some((p) => p.id === entry.preset)) problems.push(`${manifest.id}: the preset "${entry.preset}" is not a preset of ${PROCESS_TOOL}`);
      }
      if (entry.type === 'panel' && !STUDIO_PANELS.has(entry.id)) problems.push(`${manifest.id}: the panel "${entry.id}" is not registered in the Studio`);
      if (entry.type === 'cli' && !exists(entry.path)) problems.push(`${manifest.id}: the script ${entry.path} does not exist`);
      if (entry.type === 'module') {
        if (!exists(entry.path)) { problems.push(`${manifest.id}: the module ${entry.path} does not exist`); continue; }
        const loaded = await import(new URL(entry.path, root));
        for (const name of entry.exports) if (!(name in loaded)) problems.push(`${manifest.id}: ${entry.path} does not export ${name}`);
      }
    }
    for (const doc of manifest.docs) if (!exists(doc)) problems.push(`${manifest.id}: the document ${doc} does not exist`);
    for (const dependency of manifest.dependencies) if (!KNOWN_PLUGINS.has(dependency.id)) problems.push(`${manifest.id}: depends on unknown plugin ${dependency.id}`);
    if (manifest.provides.some((p) => p.type === 'cli') === false && ['browser', 'real-and-browser'].includes(manifest.status.level)) problems.push(`${manifest.id}: a plugin verified beyond unit tests should list the script that checks it`);
  }
  assert.deepEqual(problems, []);
});

test('only the data-source plugin may ask for the network, and the honest limits are never left empty', () => {
  for (const { manifest } of manifests) {
    assert.equal(manifest.permissions.includes('network'), manifest.id === 'org.glow.plugin.data-sources', manifest.id);
    assert.ok(manifest.status.limits.length >= 1 && manifest.status.limits.every((text) => text.length > 6), `${manifest.id} lists what it does not do`);
  }
});

import { COMMAND_OWNERS, PLUGIN_NAMES, createPluginSwitch } from '../../plugins/workshop/plugin-gate.mjs';
test('the plugin switch knows exactly the commands the manifests give each plugin, and a disabled plugin refuses with a way back', () => {
  const byId = new Map(manifests.map(({ manifest }) => [manifest.id, manifest]));
  for (const [command, owner] of Object.entries(COMMAND_OWNERS)) {
    const manifest = byId.get(owner); assert.ok(manifest, `${command}: ${owner} has no manifest`);
    assert.ok(manifest.provides.some((p) => p.type === 'command' && p.name === command), `${owner} does not list the command ${command}`);
    assert.equal(PLUGIN_NAMES[owner], manifest.name, `the display name of ${owner} drifted from its manifest`);
  }
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, gate = createPluginSwitch(storage), run = gate.guard('embed', () => 'ran');
  assert.equal(run(), 'ran'); gate.set('org.glow.plugin.membrane-embedding', false);
  assert.throws(run, /已停用.*插件区/); assert.equal(gate.guard('help', () => 'free')(), 'free', 'a command no plugin owns is never blocked');
  assert.equal(createPluginSwitch(storage).isEnabled('org.glow.plugin.membrane-embedding'), false, 'the choice is remembered'); gate.set('org.glow.plugin.membrane-embedding', true); assert.equal(run(), 'ran');
  assert.equal(createPluginSwitch({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }).isEnabled('x'), true, 'blocked storage is not an error');
});
