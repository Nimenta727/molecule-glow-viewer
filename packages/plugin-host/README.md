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

Manifests use an exact `x.y.z` version, `apiVersion: 1`, dependency entries `{ id, version, optional }`, and capabilities drawn from `importers`, `representations`, and `services`. A required dependency must already be active at the exact version. An active plugin with a required dependent cannot be deactivated until that dependent is deactivated.

`activate(plugin)` returns the plugin ID. Registrations are staged until activation completes; collisions are global within each capability registry and fail activation. Plugin activation and deactivation are serialized. `deactivate(id)` returns `false` for an inactive plugin and `true` after successful deactivation.

The frozen context exposes `scene.getSnapshot()`, `commands.dispatch(command)`, `signal`, `lifecycle.add(disposer)`, `registerImporter(name, value)`, `registerRepresentation(name, value)`, `registerService(name, version, value)`, and `getService(name, version)`. Register capabilities during activation. The plugin can dispatch scene edits after activation succeeds. The context expires and its signal aborts when activation fails or deactivation begins. On deactivation the host removes registrations, calls the optional `deactivate(context)` hook, then runs lifecycle disposers in reverse order. The hook can read the aborted signal and close over plugin-owned resources.

Invalid manifests, unsupported API versions, missing or mismatched required dependencies, duplicate IDs, capability violations, and registration collisions reject activation. Activation failures run all registered cleanup handlers and reject with the original error; if cleanup also fails, an `AggregateError` includes the activation and cleanup errors. Deactivation still attempts all cleanup and removes the plugin; cleanup failures reject with an `AggregateError` after cleanup. Context calls after deactivation throw. Getters return `undefined` when no matching registration exists. Service lookup uses both name and exact version.
