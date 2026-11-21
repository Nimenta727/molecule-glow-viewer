import { sha256Hex } from './resource.mjs';

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
/** Providers a package can be re-fetched from when it is opened (the Viewer knows how to fetch these); anything else (a local file) has no source to come back from. */
const FETCHABLE = /^rcsb/i;

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
    if (!FETCHABLE.test(provider ?? '') || !accession) {
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

/**
 * The other half of 'publish': opening a package whose structure came as a reference. For every `external` asset linked to a resource
 * (id, version, sha256) the scene carries, `fetchBytes({ provider, accession, file, record })` supplies the bytes; they are accepted only when their SHA-256
 * is the one the resource record states, and the asset becomes an ordinary `file` asset again (so the rest of the opening path does not need to know).
 * A failure (no fetcher for the provider, network, wrong hash) leaves that asset a reference and is reported; the scene is never refused for it.
 * Returns copies: `{ scene, resources, diagnostics: [{ assetId, code, message }] }`.
 */
export async function hydrateReferences(scene, resources, fetchBytes) {
  const out = structuredClone(scene), kept = new Map(resources), diagnostics = [];
  const records = new Map((out.resources ?? []).map((record) => [`${record.id}@${record.version}`, record]));
  const assets = [];
  for (const asset of out.assets) {
    if (asset.kind !== 'external' || !asset.resource) { assets.push(asset); continue; }
    const fail = (code, message) => { diagnostics.push({ assetId: asset.id, code, message }); assets.push(asset); };
    const record = records.get(`${asset.resource.id}@${asset.resource.version}`);
    const file = record?.files.find(({ sha256 }) => sha256 === asset.resource.sha256);
    if (!file) { fail('reference-no-record', `引用资产 ${asset.id} 在场景里找不到对应的资源文件记录。`); continue; }
    let bytes;
    try { bytes = await fetchBytes({ provider: asset.source.provider, accession: asset.source.accession, file, record }); }
    catch (error) { fail('reference-fetch-failed', `无法取回 ${asset.source.provider} ${asset.source.accession}：${error.message}`); continue; }
    if (!(bytes instanceof Uint8Array)) { fail('reference-fetch-failed', `没有取回 ${asset.source.accession} 的字节。`); continue; }
    if (await sha256Hex(bytes) !== file.sha256) { fail('reference-hash-mismatch', `${asset.source.accession} 取回的文件与发布时记录的哈希不同，已拒绝使用。`); continue; }
    kept.set(file.path, bytes);
    assets.push({ id: asset.id, kind: 'file', path: file.path, sha256: file.sha256, mediaType: asset.mediaType, resource: asset.resource, ...(asset.provenance ? { provenance: asset.provenance } : {}) });
  }
  out.assets = assets;
  return { scene: out, resources: kept, diagnostics };
}
