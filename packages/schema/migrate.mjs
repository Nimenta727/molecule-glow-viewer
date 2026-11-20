import { validateScene } from './documents.mjs';
import { describeStructureAsset, sha256Hex } from './resource.mjs';

/**
 * Scene v2 -> v3 (docs/CONTRACT_4.3.0.md §12). The upgrade only adds: every v2 field is kept as it was.
 *  - `tools` (empty unless given) and `resources` (records for the raw structure files whose bytes are available);
 *  - assets of raw structure files get `resource: { id, version, sha256 }`; the transitional `provenance.resource` link
 *    written by earlier builds is promoted to it.
 * A structure file whose bytes are missing or do not match its hash gets no resource link and a diagnostic; the scene still opens.
 */
const isStructureFile = (asset) => asset.kind === 'file' && /^chemical\//.test(asset.mediaType ?? '') &&
  Boolean(asset.provenance?.parserVersion || asset.provenance?.mechanismState);

/** Makes a v3 scene resource-complete: records and links for every raw structure file. Mutates `scene`. */
export async function attachStructureResources(scene, resources) {
  const diagnostics = [];
  for (const asset of scene.assets) {
    if (!isStructureFile(asset)) continue;
    const linked = asset.resource && scene.resources.some((record) => record.id === asset.resource.id && record.version === asset.resource.version);
    const bytes = resources.get(asset.path);
    if (linked) continue;
    if (asset.provenance?.resource) {   // transitional v2 link; promoted below or dropped when it cannot be backed by a record
      const { resource, ...rest } = asset.provenance;
      asset.provenance = rest;
    }
    if (!(bytes instanceof Uint8Array)) {
      diagnostics.push({ code: 'res-missing', assetId: asset.id, message: `资源文件缺失：${asset.path}` });
      continue;
    }
    if (await sha256Hex(bytes) !== asset.sha256) {
      diagnostics.push({ code: 'res-hash-mismatch', assetId: asset.id, message: `资源文件与其哈希不符：${asset.path}` });
      continue;
    }
    const { record } = describeStructureAsset(asset, bytes);
    if (!scene.resources.some((item) => item.id === record.id && item.version === record.version)) scene.resources.push(record);
    asset.resource = { id: record.id, version: record.version, sha256: asset.sha256 };
  }
  return { diagnostics };
}

/** Returns { scene, diagnostics }. A v3 scene is returned as it is; `tools` only applies to a scene that is being upgraded. */
export async function upgradeSceneToV3(input, resources = new Map(), { tools = [] } = {}) {
  const scene = validateScene(input);
  if (scene.schemaVersion === 3) return { scene, diagnostics: [] };
  const upgraded = { ...scene, schemaVersion: 3, tools: structuredClone(tools), resources: [] };
  const { diagnostics } = await attachStructureResources(upgraded, resources);
  return { scene: validateScene(upgraded), diagnostics };
}
