import { readScenePackage } from '../../packages/schema/archive.mjs';
import { validateScene } from '../../packages/schema/documents.mjs';
import { decodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { validateDocument } from '../../packages/core/index.mjs';

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
