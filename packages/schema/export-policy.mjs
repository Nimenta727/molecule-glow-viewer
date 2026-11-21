/**
 * Export policy for scene packages (docs/CONTRACT_4.3.0.md §2 "offline copy"): which resource bytes may travel inside a package.
 *
 *   mode 'project' (default) — your own save: every byte stays, nothing changes (a file you opened locally is yours to keep).
 *   mode 'publish'           — a package to hand to others: a resource whose record says `embedAllowed: false` does not carry its bytes.
 *                              If it has a public source (provider + accession) its asset becomes a reference (`external`, still linked
 *                              to the resource id/version/hash, so whoever opens it fetches the file and checks the hash); if it has no source to fetch
 *                              from (a local file of unknown licence) the export is blocked and says which assets.
 *
 * Pure: returns copies, never touches the inputs. `{ scene, resources, referenced: [assetId], blocked: [{ assetId, resource, reason }] }`.
 */
export function planEmbedding(scene, resources, { mode = 'project' } = {}) {
  if (mode !== 'project' && mode !== 'publish') throw new TypeError(`Unknown export mode "${mode}"`);
  const out = structuredClone(scene), kept = new Map(resources), referenced = [], blocked = [];
  if (mode === 'project') return { scene: out, resources: kept, referenced, blocked };
  const records = new Map((out.resources ?? []).map((record) => [`${record.id}@${record.version}`, record]));
  out.assets = out.assets.map((asset) => {
    if (asset.kind !== 'file' || !asset.resource) return asset;
    const record = records.get(`${asset.resource.id}@${asset.resource.version}`);
    if (!record || record.attribution?.embedAllowed !== false) return asset;
    const { provider, accession } = record.source ?? {};
    if (!provider || provider === 'local' || !accession) {
      blocked.push({ assetId: asset.id, resource: record.id, reason: `资源 ${record.id} 不允许嵌入，且没有可重新取回的公开来源。` });
      return asset;
    }
    kept.delete(asset.path);
    referenced.push(asset.id);
    return { id: asset.id, kind: 'external', source: { provider, accession }, mediaType: asset.mediaType, resource: asset.resource,
      ...(asset.provenance ? { provenance: asset.provenance } : {}) };
  });
  return { scene: out, resources: kept, referenced, blocked };
}
