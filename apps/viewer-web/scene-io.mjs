import { readScenePackage } from '../../packages/schema/archive.mjs';
import { validateScene } from '../../packages/schema/documents.mjs';
import { validateDocument } from '../../packages/core/index.mjs';

const MiB = 1024 * 1024;

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
