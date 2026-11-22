/**
 * Adds a second structure to a work: the assets and nodes of an imported (v3) structure scene are merged into the scene of the work under new ids, so that two structures — for example the open and the
 * closed form of a protein, two entries of the PDB — can be shown and compared in one scene. Nothing of the first structure is touched. The new parts are named "<title> · <chain>" and start at the
 * origin like the first structure (each structure is centred on its own box), so they overlay until one is moved. Only the first structure takes the look, annotations, surfaces and the viewer state of the
 * work; the added ones are shown in the work's representation.
 *   scene            the work (v3)                        resources   Map(path -> bytes) of the work
 *   imported         the v3 scene of the new structure    importedResources   Map(path -> bytes)
 * Returns { scene, resources, prefix } — new objects, the inputs are not changed.
 */
const STRUCTURE = 'org.glow.structure';
export const MAX_STRUCTURES = 4;

export function mergeStructure(scene, resources, imported, importedResources, { title } = {}) {
  if (scene.schemaVersion !== 3 || imported.schemaVersion !== 3) throw new TypeError('只能把 v3 作品合并进 v3 作品。');
  const used = new Set(scene.assets.map(({ id }) => id).concat(scene.nodes.map(({ id }) => id)));
  const sources = scene.assets.filter(({ kind, mediaType }) => kind === 'file' && /chemical\/x-(mmcif|pdb)/.test(mediaType));
  if (sources.length >= MAX_STRUCTURES) throw new RangeError(`一个场景最多放 ${MAX_STRUCTURES} 个结构。`);
  let n = 1; while (used.has(`s${n}-source`) || scene.assets.some((a) => a.id.startsWith(`s${n}-`)) || scene.nodes.some((x) => x.id.startsWith(`s${n}-`))) n++;
  const prefix = `s${n}`, id = (old) => `${prefix}-${old}`, pathOf = (old) => old.replace(/^assets\//, `assets/${prefix}-`);
  const next = structuredClone(scene), moved = new Map(resources), label = String(title ?? imported.title ?? '结构').slice(0, 40);
  for (const asset of imported.assets) {
    const copy = structuredClone(asset); copy.id = id(asset.id); copy.path = pathOf(asset.path);
    if (copy.provenance?.sourceAssetId) copy.provenance.sourceAssetId = id(copy.provenance.sourceAssetId);
    if (copy.provenance) delete copy.provenance.viewerState;
    next.assets.push(copy);
    const bytes = importedResources.get(asset.path); if (!bytes) throw new Error(`导入的结构缺少文件 ${asset.path}。`);
    moved.set(copy.path, bytes);
  }
  for (const node of imported.nodes) {
    const copy = structuredClone(node); copy.id = id(node.id); copy.name = `${label} · ${node.name}`; copy.parentId = node.parentId ? id(node.parentId) : null;
    if (copy.assetId) copy.assetId = id(copy.assetId);
    if (copy.extensions?.[STRUCTURE]?.sourceAssetId) copy.extensions[STRUCTURE].sourceAssetId = id(copy.extensions[STRUCTURE].sourceAssetId);
    next.nodes.push(copy);
  }
  const known = new Set(next.resources.map((record) => `${record.id}@${record.version}`));
  for (const record of imported.resources) {
    if (known.has(`${record.id}@${record.version}`)) continue;
    const copy = structuredClone(record); copy.files = copy.files.map((file) => ({ ...file, path: pathOf(file.path) })); next.resources.push(copy);
  }
  for (const entry of imported.evidence) {
    const copy = structuredClone(entry);
    if (copy.assetId) copy.assetId = id(copy.assetId);
    if (Array.isArray(copy.assets)) copy.assets = copy.assets.map(id);
    next.evidence.push(copy);
  }
  return { scene: next, resources: moved, prefix };
}
