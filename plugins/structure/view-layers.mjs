/**
 * The structure part of a scene's display layers in a chosen representation (ink blobs, cartoon, backbone, functional
 * domains, surface). One implementation for the Viewer and Studio: both hold the parsed structure model of every raw structure
 * file and ask for the layers of each chain node in the representation they show.
 */
export const STRUCTURE_FILE_TYPES = Object.freeze(['chemical/x-mmcif', 'chemical/x-pdb']);
export const STRUCTURE_STYLES = Object.freeze(['cartoon', 'backbone', 'blob', 'functional', 'surface']);
const STYLE_SET = new Set(STRUCTURE_STYLES);
const STRUCTURE = 'org.glow.structure';

export const structureSources = (scene) => scene.assets.filter(({ kind, mediaType }) => kind === 'file' && STRUCTURE_FILE_TYPES.includes(mediaType));

/**
 * Replaces, in `layers` (assetId -> layers), the preview geometry of every chain node by the layers of `style`.
 *   models   Map(sourceAssetId -> parsed model)
 *   build    representation.build(model, { style, functionalRules }) -> groups
 *   style    the style asked for the primary structure; otherwise the stored style of the structure, then `defaultStyle`
 *   onTarget optional (target, source, isPrimary) for callers that keep pick targets
 *   recolor  optional (group, index, count) -> colour string or undefined: the colour a chain group is drawn in (the Viewer's `color` command); wins over a classic scene's own colour
 *   look     optional (model, source) -> { colorOf(atom), styleOf(atom) } | undefined: the per-residue colour and style the author gave parts of the structure (look.mjs). Every residue-level
 *            representation (cartoon, backbone, blob) draws it itself; layers that carry a residue colour are `pinned` and keep it when a chain-wide colour is applied.
 *   residueColor  optional (group, atom) -> colour string or undefined: the colour of one residue (`atom` is the residue's first atom); only the blob representation, which has one sphere per
 *            residue, can show it. The sphere layer is split by colour; a layer that carries conformations is left whole.
 * A preview that cannot be matched to a group keeps its preview geometry. Returns { layers, representationSource }.
 */
/** The layers of one chain group with its blob spheres split by residue colour. Everything else is returned as it is. */
function splitByResidueColor(mapped, group, residueColor) {
  const marker = group.pointTargets.findIndex((targets, i) => group.layers[i]?.mode === 'points' && targets?.length && targets[0].kind === 'residue');
  if (marker < 0) return mapped;
  const targets = group.pointTargets[marker], out = [];
  for (const layer of mapped) {
    if (layer.mode !== 'spheres' || layer.conformations || layer.positions.length / 3 !== targets.length) { out.push(layer); continue; }
    const colors = targets.map((target) => residueColor(group, target.atom));
    if (colors.every((c) => c === undefined)) { out.push(layer); continue; }
    const buckets = new Map();
    colors.forEach((c, i) => { const key = c ?? layer.color; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(i); });
    for (const [color, indices] of buckets) {
      const positions = []; for (const i of indices) positions.push(layer.positions[3 * i], layer.positions[3 * i + 1], layer.positions[3 * i + 2]);
      out.push({ ...layer, color, positions, ...(layer.radii ? { radii: indices.map((i) => layer.radii[i]) } : {}), pointTargets: null });
    }
  }
  return out;
}

export function buildStructureLayers({ scene, models, layers, build, style, defaultStyle, onTarget, recolor, residueColor, look }) {
  const sources = structureSources(scene);
  let representationSource;
  const nodesByAsset = new Map(scene.nodes.map((node) => [node.assetId, node]));
  for (const source of sources) {
    const model = models.get(source.id);
    if (!model) continue;
    const previews = scene.assets.filter(({ id, provenance }) => layers.has(id) && provenance?.sourceAssetId === source.id && provenance.style === 'cartoon');
    if (!previews.length) continue;
    representationSource ??= source;
    const stored = source.provenance?.viewerStyle;
    const chosen = (source === sources[0] ? style : undefined) ?? (STYLE_SET.has(stored) ? stored : defaultStyle);
    const builds = new Map();
    const built = (mode) => {
      if (!builds.has(mode)) {
        const groups = build(model, { style: mode, functionalRules: scene.legacy?.scene, ...(look ? { look: look(model, source) ?? {} } : {}) });
        builds.set(mode, { groups, byKey: new Map(groups.map((group) => [group.key, group])) });
      }
      return builds.get(mode);
    };
    for (const [index, asset] of previews.entries()) {
      const metadata = nodesByAsset.get(asset.id)?.extensions?.[STRUCTURE];
      const effective = STYLE_SET.has(asset.provenance.legacyStyle) ? asset.provenance.legacyStyle : chosen;
      const { byKey, groups } = built(effective);
      const group = metadata?.chainKey ? byKey.get(metadata.chainKey) : groups[index];
      if (!group || metadata?.sourceAssetId !== source.id || metadata.chainId !== group.chainId) continue;
      for (const targets of group.pointTargets) for (const target of targets ?? []) onTarget?.(target, source, source === sources[0]);
      const tint = recolor?.(group, groups.indexOf(group), groups.length) ?? asset.provenance.legacyColor;
      const mapped = group.layers.map((layer, layerIndex) => ({
        ...layer, representationStyle: effective,
        ...(tint && !layer.pinned && layer.mode !== 'points' && layer.role !== 'functional-core' ? { color: tint } : {}),
        pointTargets: group.pointTargets[layerIndex],
      }));
      layers.set(asset.id, residueColor ? splitByResidueColor(mapped, group, residueColor) : mapped);
    }
  }
  return { layers, representationSource };
}
