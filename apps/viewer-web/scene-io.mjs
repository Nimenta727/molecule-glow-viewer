import { readScenePackage } from '../../packages/schema/archive.mjs';
import { validateScene } from '../../packages/schema/documents.mjs';
import { decodeGeometry, encodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { validateDocument } from '../../packages/core/index.mjs';
import { createLegacyLayout, legacyColor, matchesPart } from './legacy-layout.mjs';

const MiB = 1024 * 1024;
export const isStructureFile = (name) => /\.(pdb|ent|cif|mmcif)$/i.test(name);

export function geometryLayers({ scene, resources }) {
  const layers = new Map();
  for (const asset of scene.assets) {
    if (asset.kind !== 'file' || asset.mediaType !== GEOMETRY_MEDIA_TYPE) continue;
    const bytes = resources.get(asset.path);
    if (!bytes) throw new Error(`缺少预览资源 ${asset.path}。`);
    layers.set(asset.id, decodeGeometry(bytes));
  }
  return layers;
}

export async function loadLegacyStructures(loaded, { importer, representation, loadAccession, signal, onProgress }) {
  const { scene, resources } = loaded;
  if (!scene.legacy || scene.assets.some(({ mediaType }) => mediaType === GEOMETRY_MEDIA_TYPE)) return;
  const embedded = scene.assets.find(({ kind, mediaType }) =>
    kind === 'file' && ['chemical/x-mmcif', 'chemical/x-pdb'].includes(mediaType));
  const external = scene.assets.filter((asset) => asset.kind === 'external' && asset.source.provider === 'RCSB PDB');
  const primary = embedded ?? external[0];
  if (!primary) return;

  const config = scene.legacy.scene ?? {};
  const components = Array.isArray(config.components) ? config.components : [];
  const structure = 'org.glow.structure';
  // Reserve one scene and one manifest entry, then share the preview budget with components.
  const previewLimit = Math.floor((254 - components.length - 1) / (components.length + 1));
  let imported;
  try {
    signal.throwIfAborted();
    onProgress?.('正在恢复旧包主结构…');
    const input = embedded ? {
      name: scene.legacy.scene?.structure?.name ?? embedded.path,
      bytes: resources.get(embedded.path), mediaType: embedded.mediaType,
      source: { provider: 'Glow v1', name: scene.legacy.scene?.structure?.name ?? embedded.path },
    } : await loadAccession(primary.source.accession, signal);
    imported = await importer.importScene(input, {
      signal, previewGroupLimit: previewLimit, includeLayout: true, chains: config.chains,
      assembly: embedded ? config.assembly === true : config.assembly !== false,
    });
  } catch (error) {
    signal.throwIfAborted();
    loaded.warnings.push(`无法恢复旧包主结构。 ${error.message}`);
    return;
  }
  signal.throwIfAborted();

  function displayPart(name, component) {
    if (component) return component.split ? `${component.label || component.id} · ${name}` : component.label || component.id;
    const grouped = Array.isArray(config.groupParts) && config.groupParts.find((group) =>
      Array.isArray(group) && group.slice(1).some((selector) => matchesPart(name, selector)));
    return typeof grouped?.[0] === 'string' ? grouped[0] : name;
  }

  function describeLayout(entry, component) {
    const polymer = entry.layout.filter((group) => group.polymer);
    const groups = polymer.length ? polymer : entry.layout;
    return groups.map((group) => ({ ...group, part: displayPart(group.name, component) }));
  }

  function describe(entry, component) {
    const overrides = config.reps ?? {};
    const builds = new Map();
    function overrideLayers(style) {
      if (!builds.has(style)) builds.set(style, new Map(representation.build(entry.model, {
        style, functionalRules: config,
      }).map(({ key, layers }) => [key, layers])));
      return builds.get(style);
    }
    return entry.scene.assets.slice(1).map((asset, index) => {
      const node = entry.scene.nodes[index];
      const { partName: name, chainKey } = node.extensions[structure];
      const part = displayPart(name, component);
      const bytes = entry.resources.get(asset.path);
      const override = Object.hasOwn(overrides, part) ? overrides[part] : undefined;
      const style = override === 'simplified' ? 'functional' : override;
      const trace = representation && ['surface', 'functional'].includes(style) ? overrideLayers(style).get(chainKey) : undefined;
      const layers = trace ?? decodeGeometry(bytes);
      return { name, part, bytes, layers, node, asset, override, style, trace: Boolean(trace) };
    });
  }

  let resourceBytes = [...resources.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
  const main = describe(imported);
  const layout = createLegacyLayout(describeLayout(imported), config, loaded.warnings);

  async function attach(entry, groups, poses, prefix, parent, existingSource, component) {
    const [coordinates] = entry.scene.assets;
    const sourceId = existingSource?.id ?? `${prefix}-source`;
    const sourcePath = coordinates.path.replace('assets/', `assets/${prefix}-`);
    const children = [];
    for (const [index, group] of groups.entries()) {
      signal.throwIfAborted();
      const id = `${prefix}-preview-${index + 1}`;
      const path = `assets/${id}.json`;
      const color = legacyColor(config.colors, group.name, group.part);
      const altered = Boolean(color || group.trace);
      const bytes = altered ? encodeGeometry(group.layers.map((layer) => {
        if (layer.mode === 'spheres') return { mode: 'points', positions: layer.positions, color: layer.color, pointSize: 0.1 };
        return color && layer.mode !== 'points' ? { ...layer, color } : layer;
      })) : group.bytes;
      const sha256 = altered ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (value) => value.toString(16).padStart(2, '0')).join('') : group.asset.sha256;
      children.push({ group, bytes, asset: {
        ...group.asset, id, path, sha256,
        provenance: { ...group.asset.provenance, sourceAssetId: sourceId, ...(color ? { legacyColor: color } : {}),
          ...(['functional', 'surface', 'blob', 'cartoon'].includes(group.style) ? { legacyStyle: group.style } : {}) },
      } });
    }
    signal.throwIfAborted();
    const added = children.reduce((total, { bytes }) => total + bytes.byteLength, existingSource ? 0 : entry.resources.get(coordinates.path).byteLength);
    if (resourceBytes + added > 120 * MiB || scene.nodes.length + poses.length * (children.length + 1) > 3200) {
      throw new RangeError('预览超过场景包容量。');
    }
    resourceBytes += added;
    loaded.models ??= new Map();
    loaded.models.set(sourceId, entry.model);
    if (existingSource) existingSource.provenance = coordinates.provenance;
    else {
      scene.assets.push({ ...coordinates, id: sourceId, path: sourcePath });
      resources.set(sourcePath, entry.resources.get(coordinates.path));
    }
    for (const { asset, bytes } of children) {
      scene.assets.push(asset);
      resources.set(asset.path, bytes);
    }
    for (const [index, transform] of poses.entries()) {
      const id = `${prefix}-placement-${index + 1}`;
      scene.nodes.push({
        id, name: component?.label || parent?.name || entry.scene.title, assetId: null,
        parentId: parent?.id ?? null, visible: true, transform,
        ...(component ? { extensions: { [structure]: { legacyComponent: component } } } : {}),
      });
      for (const { group, asset } of children) scene.nodes.push({
        ...group.node, id: `${asset.id}-${index + 1}`, name: group.part, assetId: asset.id, parentId: id,
        visible: group.override !== 'hidden',
        extensions: { [structure]: { ...group.node.extensions[structure], sourceAssetId: sourceId, partName: group.part } },
      });
    }
    const [sourceEvidence, displayEvidence, ...derivedEvidence] = entry.scene.evidence;
    scene.evidence.push({ ...sourceEvidence, assetId: sourceId },
      { ...displayEvidence, assets: children.map(({ asset }) => asset.id) },
      ...derivedEvidence.map((evidence) => ({ ...evidence, assetId: sourceId })));
  }

  await attach(imported, main, [layout.primary], 'legacy-primary', scene.nodes.find(({ assetId }) => assetId === primary.id), embedded);
  for (const [index, component] of components.entries()) {
    const label = component.label || component.id;
    try {
      signal.throwIfAborted();
      onProgress?.(`正在恢复组件 ${index + 1}/${components.length} · ${label}…`);
      const input = await loadAccession(component.id, signal);
      const entry = await importer.importScene(input, {
        signal, previewGroupLimit: previewLimit, chains: component.chains, includeLayout: true, assembly: true,
      });
      const groups = describe(entry, component);
      const markers = describeLayout(entry, component);
      const hint = external.find(({ source }) => source.accession === component.id.toUpperCase());
      const parent = scene.nodes.find(({ assetId }) => assetId === hint?.id);
      const maxCopies = Math.floor((3200 - scene.nodes.length) / (groups.length + 1));
      if (maxCopies < 1) throw new RangeError('预览超过场景节点上限。');
      const poses = layout.place(markers, component, maxCopies);
      await attach(entry, groups, poses, `legacy-component-${index + 1}`, parent, undefined,
        { index, accession: component.id.toUpperCase(), label });
      layout.include(markers, poses);
    } catch (error) {
      signal.throwIfAborted();
      loaded.warnings.push(`无法恢复组件“${label}”。 ${error.message}`);
    }
  }
  const source = embedded ?? scene.assets.find(({ id }) => id === 'legacy-primary-source');
  source.provenance.legacyCamera = layout.camera();
  loaded.warnings.push('已生成旧包的静态结构预览。构象切换和机制由相应迁移能力提供。');
  scene.legacy.warnings = loaded.warnings.slice();
  loaded.model = imported.model;
}

export function fromPrototype(raw) {
  const { assets, nodes, timeline } = validateDocument(raw);
  return {
    scene: validateScene({
      format: 'glow-scene',
      schemaVersion: 2,
      id: 'glow-scene',
      title: 'Glow 场景',
      units: { length: 'meter', time: 'second' },
      assets,
      nodes,
      timeline,
      dependencies: [],
      evidence: [],
    }),
    resources: new Map(),
    warnings: [],
  };
}

export async function openSceneFile(file) {
  if (file.size > 128 * MiB) throw new Error('场景文件超过 128 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const result = await readScenePackage(bytes);
    const previousWarnings = result.scene.legacy?.warnings;
    const warnings = Array.isArray(previousWarnings) ? previousWarnings.filter((entry) => typeof entry === 'string') : [];
    return { ...result, warnings };
  }
  if (bytes.length > 32 * MiB) throw new Error('文本场景超过 32 MiB。');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data?.format === 'glow-scene' && data.version === 1) {
    const { migrateLegacyScene } = await import('../../packages/legacy-compat/index.mjs');
    return migrateLegacyScene(data);
  }
  return fromPrototype(data);
}
