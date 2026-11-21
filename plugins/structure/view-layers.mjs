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
 * A preview that cannot be matched to a group keeps its preview geometry. Returns { layers, representationSource }.
 */
export function buildStructureLayers({ scene, models, layers, build, style, defaultStyle, onTarget, recolor }) {
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
        const groups = build(model, { style: mode, functionalRules: scene.legacy?.scene });
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
      layers.set(asset.id, group.layers.map((layer, layerIndex) => ({
        ...layer, representationStyle: effective,
        ...(tint && layer.mode !== 'points' && layer.role !== 'functional-core' ? { color: tint } : {}),
        pointTargets: group.pointTargets[layerIndex],
      })));
    }
  }
  return { layers, representationSource };
}
