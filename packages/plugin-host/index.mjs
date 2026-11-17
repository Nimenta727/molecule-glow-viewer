const CAPABILITIES = new Set(['importers', 'representations', 'services']);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const isVersion = (value) => typeof value === 'string' && SEMVER.test(value);

function checkManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('Plugin manifest is required');
  if (typeof manifest.id !== 'string' || !ID.test(manifest.id)) throw new TypeError('Invalid plugin id');
  if (!isVersion(manifest.version)) throw new TypeError(`Invalid version for plugin ${manifest.id}`);
  if (manifest.apiVersion !== 1) throw new Error(`Unsupported API version for plugin ${manifest.id}`);
  if (!Array.isArray(manifest.dependencies) || !Array.isArray(manifest.capabilities)) throw new TypeError('Manifest dependencies and capabilities must be arrays');
  for (const capability of manifest.capabilities) if (!CAPABILITIES.has(capability)) throw new Error(`Unknown capability: ${capability}`);
  const dependencies = manifest.dependencies.map((dep) => {
    if (!dep || typeof dep.id !== 'string' || !ID.test(dep.id) || !isVersion(dep.version)) {
      throw new TypeError('Dependencies require an id and exact x.y.z version');
    }
    if (dep.optional !== undefined && typeof dep.optional !== 'boolean') throw new TypeError('optional must be a boolean');
    return { id: dep.id, version: dep.version, optional: dep.optional ?? false };
  });
  const dependenciesById = new Set(dependencies.map(({ id }) => id));
  if (dependenciesById.size !== dependencies.length || dependenciesById.has(manifest.id)) {
    throw new TypeError('A plugin needs distinct dependency IDs and cannot depend on itself');
  }
  return { id: manifest.id, version: manifest.version, dependencies, capabilities: [...manifest.capabilities] };
}

function registryKey(capability, name) { return `${capability}:${name}`; }

export function createPluginHost({ getScene, dispatch }) {
  if (typeof getScene !== 'function' || typeof dispatch !== 'function') throw new TypeError('getScene and dispatch are required');
  const active = new Map();
  const registries = { importers: new Map(), representations: new Map(), services: new Map() };
  let queue = Promise.resolve();
  const exclusive = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  function lookup(registry, key) {
    return registry.get(key)?.value;
  }

  async function activate(plugin) {
    return exclusive(async () => {
      if (!plugin || typeof plugin.activate !== 'function') throw new TypeError('Trusted plugin module must provide activate(context)');
      const manifest = checkManifest(plugin.manifest);
      if (active.has(manifest.id)) throw new Error(`Plugin already active: ${manifest.id}`);
      for (const dependency of manifest.dependencies) {
        const installed = active.get(dependency.id);
        if (!installed) {
          if (!dependency.optional) throw new Error(`Missing required dependency ${dependency.id}@${dependency.version}`);
        } else if (installed.manifest.version !== dependency.version) {
          throw new Error(`Dependency version mismatch for ${dependency.id}: requires ${dependency.version}, active ${installed.manifest.version}`);
        }
      }
      let phase = 'activating';
      const controller = new AbortController();
      const disposers = [];
      const staged = [];
      const ensureUsable = () => {
        if (phase === 'closed') throw new Error(`Plugin context is no longer active: ${manifest.id}`);
      };
      const register = (capability, name, value, version) => {
        ensureUsable();
        if (phase !== 'activating') throw new Error('Registrations are only accepted during activation');
        if (!manifest.capabilities.includes(capability)) throw new Error(`Plugin ${manifest.id} lacks ${capability} capability`);
        if (typeof name !== 'string' || !ID.test(name)) throw new TypeError('Invalid registration name');
        if (capability === 'services' && !isVersion(version)) throw new TypeError('Service registration requires an exact x.y.z version');
        const key = registryKey(capability, capability === 'services' ? `${name}@${version}` : name);
        staged.push({ capability, key, value });
      };
      const lifecycle = Object.freeze({ add(disposer) {
        ensureUsable();
        if (typeof disposer !== 'function') throw new TypeError('Lifecycle disposer must be a function');
        disposers.push(disposer);
      } });
      const context = Object.freeze({
        scene: Object.freeze({ getSnapshot() { ensureUsable(); return getScene(); } }),
        commands: Object.freeze({ dispatch(command) {
          ensureUsable();
          if (phase !== 'active') throw new Error('Scene commands require an active plugin');
          return dispatch(command);
        } }),
        signal: controller.signal,
        lifecycle,
        registerImporter(name, importer) { register('importers', name, importer); },
        registerRepresentation(name, representation) { register('representations', name, representation); },
        registerService(name, version, service) { register('services', name, service, version); },
        getService(name, version) {
          ensureUsable();
          return lookup(registries.services, registryKey('services', `${name}@${version}`));
        },
      });
      const record = { manifest, plugin, controller, context, disposers, registrations: staged,
        deactivateContext() { phase = 'closed'; } };
      try {
        await plugin.activate(context);
        const keys = new Set();
        for (const item of staged) {
          if (keys.has(item.key) || registries[item.capability].has(item.key)) throw new Error(`Registration collision: ${item.key}`);
          keys.add(item.key);
        }
        for (const item of staged) registries[item.capability].set(item.key, item);
        active.set(manifest.id, record);
        phase = 'active';
      } catch (error) {
        phase = 'closed';
        controller.abort();
        const errors = [];
        for (const dispose of disposers.reverse()) { try { await dispose(); } catch (failure) { errors.push(failure); } }
        if (errors.length) throw new AggregateError([error, ...errors], `Plugin activation and cleanup failed: ${manifest.id}`);
        throw error;
      }
      return manifest.id;
    });
  }

  async function deactivate(id) {
    return exclusive(async () => {
      const record = active.get(id);
      if (!record) return false;
      for (const dependent of active.values()) {
        if (dependent.manifest.dependencies.some(dep => dep.id === id && !dep.optional)) {
          throw new Error(`Cannot deactivate ${id}; required by active plugin ${dependent.manifest.id}`);
        }
      }
      const errors = [];
      record.deactivateContext();
      active.delete(id);
      for (const { capability, key } of record.registrations) registries[capability].delete(key);
      record.controller.abort();
      try { await record.plugin.deactivate?.(record.context); } catch (error) { errors.push(error); }
      for (const dispose of record.disposers.reverse()) { try { await dispose(); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AggregateError(errors, `Plugin deactivation failed: ${id}`);
      return true;
    });
  }

  return Object.freeze({
    activate,
    deactivate,
    getImporter(id) { return lookup(registries.importers, registryKey('importers', id)); },
    getRepresentation(id) { return lookup(registries.representations, registryKey('representations', id)); },
    getService(id, version) { return lookup(registries.services, registryKey('services', `${id}@${version}`)); },
    listActive() { return [...active.values()].map(record => Object.freeze({ id: record.manifest.id, version: record.manifest.version })); },
  });
}
