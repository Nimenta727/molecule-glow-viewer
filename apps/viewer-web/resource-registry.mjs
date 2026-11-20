import { attachStructureResources } from '../../packages/schema/migrate.mjs';
import { ResourceError } from '../../packages/schema/resource.mjs';

/**
 * Registers the resources of a v3 scene in the session store. First the scene is made resource-complete (structure files
 * added by a mechanism's preparation get their record and link), then every record the scene carries is stored with its
 * verified bytes. A problem with one file (bytes missing, hash mismatch) becomes a diagnostic for that file only; the scene
 * still opens. Preview geometry is derived data and is not a resource.
 */
export async function registerSceneResources(store, scene, resources) {
  const registered = [];
  const { diagnostics } = await attachStructureResources(scene, resources);
  for (const record of scene.resources) {
    const files = new Map();
    for (const { path } of record.files) {
      const bytes = resources.get(path);
      if (bytes instanceof Uint8Array) files.set(path, bytes);
    }
    try {
      const stored = await store.ensure(record, files);
      registered.push({ id: stored.id, version: stored.version });
    } catch (error) {
      if (!(error instanceof ResourceError)) throw error;
      diagnostics.push({ code: error.code, resourceId: record.id, message: error.message });
    }
  }
  return { registered, diagnostics };
}

export const summarizeResource = (record) => ({
  id: record.id, version: record.version, kind: record.kind, source: record.source,
  license: record.attribution.license, embedAllowed: record.attribution.embedAllowed ?? false,
  files: record.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
});
