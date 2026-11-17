import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { isPackagePath, validatePackageManifest, validateScene } from './documents.mjs';

const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_ASSET = 32 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const MAX_ENTRIES = 256;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} must be bytes`);
}

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value));
}

function parseJson(bytes, label) {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch (error) { throw new TypeError(`${label} is not valid UTF-8 JSON`, { cause: error }); }
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertSize(bytes, max, label) {
  if (bytes.byteLength > max) throw new RangeError(`${label} exceeds the ${max}-byte limit`);
}

function fileAssets(scene) {
  return new Map(scene.assets.filter(({ kind }) => kind === 'file').map((asset) => [asset.path, asset]));
}

export async function writeScenePackage(scene, resources = new Map()) {
  const validScene = validateScene(scene);
  const assets = fileAssets(validScene);
  if (!(resources instanceof Map)) throw new TypeError('Package resources must be a Map');
  if (assets.size + 2 > MAX_ENTRIES) throw new RangeError('Package has too many entries');
  for (const path of resources.keys()) {
    if (!assets.has(path)) throw new TypeError(`Unexpected package asset bytes: ${path}`);
  }
  const sceneData = jsonBytes(validScene);
  assertSize(sceneData, MAX_JSON, 'Scene JSON');
  let total = sceneData.byteLength;
  const assetFiles = new Map();
  for (const path of assets.keys()) {
    if (!resources.has(path)) throw new TypeError(`Missing package asset bytes: ${path}`);
    const bytes = asBytes(resources.get(path), `Asset ${path}`);
    assertSize(bytes, MAX_ASSET, `Asset ${path}`);
    total += bytes.byteLength;
    if (total > MAX_ARCHIVE) throw new RangeError('Package content exceeds the archive limit');
    assetFiles.set(path, new Uint8Array(bytes));
  }
  const files = [{ path: 'scene.json', sha256: await sha256(sceneData), size: sceneData.byteLength }];
  for (const [path, bytes] of assetFiles) {
    const hash = await sha256(bytes);
    if (assets.get(path).sha256 !== hash) throw new TypeError(`Asset hash does not match bytes: ${path}`);
    files.push({ path, sha256: hash, size: bytes.byteLength });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = validatePackageManifest({
    format: 'glow-package', schemaVersion: 1, id: validScene.id, kind: 'scene', scene: 'scene.json', files,
  });
  const manifestData = jsonBytes(manifest);
  assertSize(manifestData, MAX_JSON, 'Package manifest');
  if (total + manifestData.byteLength > MAX_ARCHIVE) throw new RangeError('Package content exceeds the archive limit');

  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false, level: 0 });
  try {
    await writer.add('manifest.json', new Uint8ArrayReader(manifestData), { useWebWorkers: false, level: 0 });
    await writer.add('scene.json', new Uint8ArrayReader(sceneData), { useWebWorkers: false, level: 0 });
    for (const [path, bytes] of assetFiles) {
      await writer.add(path, new Uint8ArrayReader(bytes), { useWebWorkers: false, level: 0 });
    }
    const zipped = await writer.close();
    const result = asBytes(zipped, 'Archive');
    assertSize(result, MAX_ARCHIVE, 'Archive');
    return result.slice();
  } catch (error) {
    try { await writer.close(); } catch { /* Preserve the original write failure. */ }
    throw error;
  }
}

export async function readScenePackage(input) {
  const bytes = asBytes(input, 'Archive');
  assertSize(bytes, MAX_ARCHIVE, 'Archive');
  if (!bytes.byteLength) throw new TypeError('Package archive is empty');
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    strictness: 'strict',
    checkCrc32: true,
    checkLocalDirectory: true,
    checkOverlappingEntry: true,
  });
  try {
    const byPath = new Map();
    const casePaths = new Set();
    let declaredTotal = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (byPath.size >= MAX_ENTRIES) throw new RangeError('Package has too many entries');
      const path = entry.filename;
      const caseKey = path.toLowerCase();
      if (entry.directory || path.endsWith('/') || entry.symlink) throw new TypeError(`Directory or link entry is not allowed: ${path}`);
      if (entry.encrypted) throw new TypeError(`Encrypted ZIP entry is not allowed: ${path}`);
      if (entry.compressionMethod !== 0) throw new TypeError(`Only ZIP Store entries are supported: ${path}`);
      if (byPath.has(path) || casePaths.has(caseKey)) throw new TypeError(`Duplicate or case-colliding ZIP path: ${path}`);
      if (path !== 'manifest.json' && path !== 'scene.json' && !isPackagePath(path)) throw new TypeError(`Invalid package path: ${path}`);
      const limit = path === 'manifest.json' || path === 'scene.json' ? MAX_JSON : MAX_ASSET;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limit) {
        throw new RangeError(`ZIP entry exceeds its size limit: ${path}`);
      }
      if (entry.compressedSize !== entry.uncompressedSize) throw new TypeError(`ZIP Store size mismatch: ${path}`);
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > MAX_ARCHIVE) throw new RangeError('Package content exceeds the archive limit');
      byPath.set(path, entry);
      casePaths.add(caseKey);
    }
    if (reader.prependedData?.byteLength || reader.appendedData?.byteLength) throw new TypeError('Package contains data outside the ZIP archive');

    const manifestEntry = byPath.get('manifest.json');
    const sceneEntry = byPath.get('scene.json');
    if (!manifestEntry || !sceneEntry) throw new TypeError('Package must contain manifest.json and scene.json');
    const manifestData = await manifestEntry.getData(new Uint8ArrayWriter(), { checkCrc32: true });
    const manifest = validatePackageManifest(parseJson(manifestData, 'Package manifest'));
    const listed = new Map(manifest.files.map((file) => [file.path, file]));
    if (listed.size + 1 !== byPath.size || [...byPath.keys()].some((path) => path !== 'manifest.json' && !listed.has(path))) {
      throw new TypeError('ZIP entries do not exactly match the package manifest');
    }
    for (const { path, size } of manifest.files) {
      if (byPath.get(path).uncompressedSize !== size) throw new TypeError(`ZIP size does not match manifest: ${path}`);
    }

    const sceneData = await sceneEntry.getData(new Uint8ArrayWriter(), { checkCrc32: true });
    if (await sha256(sceneData) !== listed.get('scene.json').sha256) throw new TypeError('SHA-256 does not match manifest: scene.json');
    const scene = validateScene(parseJson(sceneData, 'Scene document'));
    if (manifest.id !== scene.id || manifest.scene !== 'scene.json') throw new TypeError('Package manifest does not identify its scene');
    const resources = new Map();
    const assets = fileAssets(scene);
    if (assets.size + 1 !== listed.size) throw new TypeError('Package assets do not match scene references');
    for (const [path, asset] of assets) {
      if (listed.get(path)?.sha256 !== asset.sha256) throw new TypeError(`Unexpected package asset: ${path}`);
      const data = await byPath.get(path).getData(new Uint8ArrayWriter(), { checkCrc32: true });
      if (await sha256(data) !== asset.sha256) throw new TypeError(`SHA-256 does not match manifest: ${path}`);
      resources.set(path, data);
    }
    return { manifest, scene, resources };
  } finally {
    await reader.close();
  }
}
