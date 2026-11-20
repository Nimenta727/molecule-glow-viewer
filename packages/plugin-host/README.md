# Core plugin host

The plugin host accepts trusted module objects supplied by the application. It does not discover plugins, fetch code, or evaluate downloaded scripts. It has no UI, file, network, or scientific plugin implementation.

```js
import { createPluginHost } from './index.mjs';

const host = createPluginHost({ getScene, dispatch });
await host.activate({
  manifest: {
    id: 'example.import', version: '1.0.0', apiVersion: 1,
    dependencies: [], capabilities: ['importers'],
  },
  activate(context) {
    context.registerImporter('example', { parse: text => JSON.parse(text) });
    context.lifecycle.add(() => console.log('plugin resources released'));
  },
});
const importer = host.getImporter('example');
await host.deactivate('example.import');
```

## Contract

Manifests use an exact `x.y.z` version, `apiVersion: 1`, dependency entries `{ id, version, optional }`, and capabilities drawn from `importers`, `representations`, `services`, `players`, `panels`, and `tools`. A required dependency must already be active at the exact version. An active plugin with a required dependent cannot be deactivated until that dependent is deactivated.

`activate(plugin)` returns the plugin ID. Registrations are staged until activation completes; collisions are global within each capability registry and fail activation. Plugin activation and deactivation are serialized. `deactivate(id)` returns `false` for an inactive plugin and `true` after successful deactivation.

The frozen context exposes `scene.getSnapshot()`, `commands.dispatch(command)`, `signal`, `lifecycle.add(disposer)`, `registerImporter(name, value)`, `registerRepresentation(name, value)`, `registerService(name, version, value)`, and `getService(name, version)`. Register capabilities during activation. The plugin can dispatch scene edits after activation succeeds. The context expires and its signal aborts when activation fails or deactivation begins. On deactivation the host removes registrations, calls the optional `deactivate(context)` hook, then runs lifecycle disposers in reverse order. The hook can read the aborted signal and close over plugin-owned resources.

Invalid manifests, unsupported API versions, missing or mismatched required dependencies, duplicate IDs, capability violations, and registration collisions reject activation. Activation failures run all registered cleanup handlers and reject with the original error; if cleanup also fails, an `AggregateError` includes the activation and cleanup errors. Deactivation still attempts all cleanup and removes the plugin; cleanup failures reject with an `AggregateError` after cleanup. Context calls after deactivation throw. Getters return `undefined` when no matching registration exists. Service lookup uses both name and exact version.

Official mechanism modules can use `registerPlayer(id, factory)` and `registerPanel(id, definition)`. Applications consume them through `getPlayer(id)` and `getPanel(id)`. Panel definitions contain titles, numeric parameter bounds and evidence text. The application renders these through its own controls.

The official catalog in `plugins/mechanism-catalog.mjs` maps legacy process IDs to trusted factories. A factory may expose asynchronous `prepare({loaded,parse,loadAccession,signal})` for cancellable coordinate preparation before `create()`. The KcsA factory uses this to persist measured conformation resources. Its panel adds a `parameters` map of numeric field descriptors; the host renders the controls and calls the player's validated `setParameters()`. Optional snapshot fields include domain `metrics`, `parameters` and conformation weights. The renderer accepts these weights without knowing the biological process. Player evidence is included by the shared export path.

Preparation may return additional trusted `create()` inputs, such as `{states}`; the Viewer retains them for that player ID rather than naming a process-specific model cache. AdK uses this path for two-state coordinates and alignment. The catalog also recognizes its specific legacy `states` declaration without inserting a fictitious `process`. Panel descriptors may request `control: 'range'` and a `parametersTitle`. An optional `functionalDescription` describes the plugin's own domain representation in the shared UI and exported evidence.

The ATP factory accepts `{ model, scene, state }`. Its instance supports `play()`, `pause()`, `seek(seconds)`, `advance(seconds)`, `snapshot()`, `save()` and `dispose()`, together with its speed, playback-rate and step controls. Snapshots provide structure transforms, conformation phase, named particles, counters and events. Scene scopes release instances on replacement. The official plugin also disposes its instances when deactivated.

## Tools (`tools` capability)

A trusted plugin registers a tool with `context.registerTool(id, descriptor)` during activation; `host.getTool(id)` returns the frozen descriptor and `host.listTools({ audience })` lists the tools a front end may mount (`'view'` for the Viewer, `'author'` for Studio), sorted by id. See `tool-descriptor.mjs` for the descriptor contract and [CONTRACT_4.3.0](../../docs/CONTRACT_4.3.0.md) §3 and §10 for the design.

```js
context.registerTool('org.glow.legacy-process.kcsa', {
  version: '1.0.0', title: 'KcsA 钾通道', audience: ['view', 'author'], runtime: 'player-v1',
  parameters: { pH: { type: 'number', label: '胞内 pH', min: 3.5, max: 8, step: 0.1, default: 4 } },   // runtime controls
  author: { template, fields: (config) => [{ path: 'steps.0.title', type: 'text', label: '第 1 步标题' }], validate },  // edits scene.tools[].config
  model: { kind: '…', assumptions: ['教学速率模型，不是分子动力学。'] },
});
```

- `audience` decides which front end may mount the tool. A parameter's own `audience` must lie within the tool's. An `author` block needs `"author"` in the audience.
- `tool-model.mjs` holds the pure logic shared by front ends: `toolControls`, `validateToolValues`, `authorFields`, and `editAuthorField`, which coerces a raw entry to the field type and then lets the tool's own `validate` accept or refuse the whole configuration. Config paths refuse `__proto__`, `constructor`, `prototype`.
- `tool-panel.mjs` builds the input elements (`renderControl`, `renderControls`, `readControl`, `writeControl`). Number and range controls keep the markup the Viewer's mechanism panel has always used.
- The Viewer builds its mechanism parameter controls from the tool descriptor (view audience); a player without a descriptor falls back to its panel definition. Studio's "工具配置" section builds an editor from the author fields of every `scene.tools[]` entry and applies edits with the `setToolConfig` command; a tool that is not registered keeps its configuration untouched and is reported, never downgraded to a static preview.
