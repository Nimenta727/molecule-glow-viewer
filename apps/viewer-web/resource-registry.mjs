import { describeStructureAsset, ResourceError } from '../../packages/schema/resource.mjs';

const isStructureFile = (asset) => asset.kind === 'file' && /^chemical\//.test(asset.mediaType ?? '') &&
  Boolean(asset.provenance?.parserVersion || asset.provenance?.mechanismState);

/**
 * Registers every raw structure file of a loaded scene as an immutable resource and links the asset to it through
 * `provenance.resource` ({ id, version, sha256 }). A problem with one file (bytes missing, hash mismatch) becomes a
 * diagnostic for that file only; the scene still opens. Preview geometry is derived data and is not a resource.
 */
export async function registerSceneResources(store, scene, resources) {
  const registered = [], diagnostics = [];
  for (const asset of scene.assets) {
    if (!isStructureFile(asset)) continue;
    const bytes = resources.get(asset.path);
    if (!(bytes instanceof Uint8Array)) {
      diagnostics.push({ code: 'res-missing', assetId: asset.id, message: `资源文件缺失：${asset.path}` });
      continue;
    }
    try {
      const { record } = describeStructureAsset(asset, bytes);
      const stored = await store.ensure(record, new Map([[asset.path, bytes]]));
      asset.provenance = { ...asset.provenance, resource: { id: stored.id, version: stored.version, sha256: asset.sha256 } };
      registered.push({ assetId: asset.id, id: stored.id, version: stored.version });
    } catch (error) {
      if (!(error instanceof ResourceError)) throw error;
      diagnostics.push({ code: error.code, assetId: asset.id, message: error.message });
    }
  }
  return { registered, diagnostics };
}

export const summarizeResource = (record) => ({
  id: record.id, version: record.version, kind: record.kind, source: record.source,
  license: record.attribution.license, embedAllowed: record.attribution.embedAllowed ?? false,
  files: record.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
});
