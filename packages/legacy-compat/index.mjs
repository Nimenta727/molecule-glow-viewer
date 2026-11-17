import { cleanData, PDB_ID, sanitizePack } from '../../src/pack/rules.js';

const KNOWN_PROCESSES = new Set([
  'atpSynthase', 'kcsa', 'translation', 'respiratoryChain', 'chloroplast',
  'flagellarMotor', 'cellCorner', 'wholeCell', 'auto', 'dataAnim',
]);
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 48) || 'legacy';
const clone = value => structuredClone(value);

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Read-only conversion of a sanitized .glow v1 pack into a v2 scene fixture. */
export async function migrateLegacyScene(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('旧场景必须是对象');
  if (raw.format !== 'glow-scene' || raw.version !== 1) throw new TypeError('需要 .glow v1 场景');
  if (!raw.scene || typeof raw.scene !== 'object' || Array.isArray(raw.scene)) throw new TypeError('旧场景缺少 scene');
  const legacyProcess = raw.scene.process;
  if (legacyProcess && !KNOWN_PROCESSES.has(legacyProcess)) throw new TypeError(`未知的旧版过程：${legacyProcess}`);
  if (legacyProcess && legacyProcess !== 'dataAnim') warnings.push(`已保留过程“${legacyProcess}”的声明；需要兼容能力才能播放，当前迁移不会运行旧版过程。`);
  if (raw.scene.animation) warnings.push('已保留旧版数据动画，当前查看器可显示通用场景。');
  if (legacyProcess === 'dataAnim' && !raw.scene.animation) warnings.push('旧版 dataAnim 没有 animation 数据，已保留静态场景。');

  // The process name is validated above without consulting the legacy runtime's global process table.
  const cleanInput = { ...raw, scene: { ...raw.scene } };
  delete cleanInput.scene.process;
  const needsPlaceholder = !cleanInput.scene.structure && cleanInput.scene.id == null;
  if (needsPlaceholder) cleanInput.scene.id = '0000';
  const pack = sanitizePack(cleanInput, false);
  const cleanScene = pack.scene;
  if (needsPlaceholder) delete cleanScene.id;
  const unmapped = cleanData(Object.fromEntries(Object.entries(raw.scene).filter(([key]) =>
    key !== 'process' && !Object.hasOwn(cleanScene, key))), false);
  for (const key of Object.keys(unmapped)) warnings.push(`已将旧版字段“scene.${key}”保存在迁移元数据中。`);

  const id = pack.id;
  const assets = [];
  const nodes = [];
  const resources = new Map();
  const accessions = [];
  if (PDB_ID.test(cleanScene.id ?? '')) accessions.push(cleanScene.id.toUpperCase());
  for (const state of cleanScene.states ?? []) if (PDB_ID.test(state)) accessions.push(state.toUpperCase());
  for (const component of cleanScene.components ?? []) if (PDB_ID.test(component.id ?? '')) accessions.push(component.id.toUpperCase());
  const uniqueAccessions = [...new Set(accessions)];

  if (cleanScene.structure) {
    const name = cleanScene.structure.name;
    const extension = name.toLowerCase().endsWith('.cif') || name.toLowerCase().endsWith('.mmcif') ? 'cif' : 'pdb';
    const path = `assets/${slug(id)}-${slug(name.replace(/\.[^.]+$/, ''))}.${extension}`;
    const bytes = new TextEncoder().encode(cleanScene.structure.text);
    const assetId = `${slug(id)}.embedded`;
    assets.push({ id: assetId, kind: 'file', path, sha256: await sha256(bytes), mediaType: extension === 'cif' ? 'chemical/x-mmcif' : 'chemical/x-pdb' });
    resources.set(path, bytes);
    nodes.push({ id: `${slug(id)}.model`, name: cleanScene.caption || pack.title, parentId: null, assetId, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
  }
  if (uniqueAccessions.length) {
    uniqueAccessions.forEach((accession, index) => {
      const assetId = `${slug(id)}.pdb-${accession.toLowerCase()}`;
      assets.push({ id: assetId, kind: 'external', source: { provider: 'RCSB PDB', accession }, mediaType: 'chemical/x-pdb' });
      nodes.push({ id: `${slug(id)}.model-${index + 1}`, name: index === 0 ? (cleanScene.caption || pack.title) : `PDB ${accession}`, parentId: null, assetId, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
    });
  }
  if (!assets.length) {
    warnings.push('旧场景没有可迁移的 PDB 编号或内嵌结构；场景元数据已保留，但没有可显示的几何。');
  }

  const dependencies = [];
  if (legacyProcess && legacyProcess !== 'dataAnim') {
    const processId = legacyProcess.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    dependencies.push({ id: `org.glow.legacy-process.${processId}`, version: '1.0.0', optional: true });
  }
  if (assets.length) {
    dependencies.push({ id: 'org.glow.structure', version: '1.0.0', optional: true });
  }
  const legacyScene = clone(cleanScene);
  if (legacyScene.structure) {
    const fileAsset = assets.find(asset => asset.kind === 'file');
    delete legacyScene.structure.text;
    legacyScene.structure.path = fileAsset.path;
    legacyScene.structure.sha256 = fileAsset.sha256;
  }
  if (legacyProcess && legacyProcess !== 'dataAnim') legacyScene.process = legacyProcess;
  const evidence = (cleanScene.evidence == null ? [] : [cleanScene.evidence].flat()).map((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry });
  const metadata = Object.fromEntries(
    ['format', 'version', 'revision', 'category', 'tags', 'author', 'license', 'description',
      'citations', 'cover', 'created', 'updated', 'viewer']
      .filter((field) => pack[field] !== undefined)
      .map((field) => [field, pack[field]]),
  );
  const scene = {
    format: 'glow-scene', schemaVersion: 2, id, title: pack.title,
    units: { length: 'meter', time: 'second' }, assets, nodes,
    timeline: { duration: 0, tracks: [] }, dependencies,
    evidence: clone(evidence),
    legacy: {
      ...metadata,
      scene: legacyScene, originalId: pack.id, warnings: [...warnings], unmappedSceneFields: unmapped,
    },
  };
  return { scene, resources, warnings };
}
