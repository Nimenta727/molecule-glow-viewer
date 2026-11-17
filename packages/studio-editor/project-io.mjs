import { validateProject } from '../schema/documents.mjs';

const FILE_FORMAT = 'glow-project-file';
const FILE_VERSION = 1;
const MAX_ENCODED_BYTES = 128 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function bytesOf(value, label) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError(`${label} must be Uint8Array or ArrayBuffer`);
}

async function digest(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(text, label) {
  if (typeof text !== 'string') throw new Error(`Invalid base64 resource: ${label}`);
  if (text.length > 4 * Math.ceil(MAX_ASSET_BYTES / 3)) throw new Error(`Resource exceeds 32 MiB: ${label}`);
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error(`Invalid base64 resource: ${label}`);
  }
  const binary = atob(text);
  if (binary.length > MAX_ASSET_BYTES) throw new Error(`Resource exceeds 32 MiB: ${label}`);
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 0x8000) {
    const end = Math.min(offset + 0x8000, binary.length);
    for (let i = offset; i < end; i++) bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function expectedFiles(project) {
  return new Map(project.scenes.map(scene => [scene.id, new Map(scene.assets.filter(asset => asset.kind === 'file').map(asset => [asset.path, asset]))]));
}

function checkResourceMap(project, resourcesByScene) {
  if (!(resourcesByScene instanceof Map)) throw new TypeError('resourcesByScene must be a Map');
  const expected = expectedFiles(project);
  let base64Size = 0;
  for (const sceneId of resourcesByScene.keys()) if (!expected.has(sceneId)) throw new Error(`Unknown resource scene: ${sceneId}`);
  for (const [sceneId, files] of expected) {
    const supplied = resourcesByScene.get(sceneId);
    if (!(supplied instanceof Map)) throw new Error(`Missing resource map for scene: ${sceneId}`);
    for (const path of supplied.keys()) if (!files.has(path)) throw new Error(`Unknown resource path for ${sceneId}: ${path}`);
    for (const [path, asset] of files) {
      if (!supplied.has(path)) throw new Error(`Missing resource for ${sceneId}: ${path}`);
      const value = supplied.get(path);
      if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) throw new TypeError(`Invalid bytes for ${sceneId}/${path}`);
      if (value.byteLength > MAX_ASSET_BYTES) throw new Error(`Resource exceeds 32 MiB: ${sceneId}/${path}`);
      base64Size += 4 * Math.ceil(value.byteLength / 3);
      if (base64Size > MAX_ENCODED_BYTES) throw new Error('Project file exceeds 128 MiB');
      if (typeof asset.sha256 !== 'string') throw new Error(`Invalid file asset metadata: ${sceneId}/${path}`);
    }
  }
  return expected;
}

export async function encodeProject(projectInput, resourcesByScene) {
  const project = validateProject(projectInput);
  const expected = checkResourceMap(project, resourcesByScene);
  const resources = Object.create(null);
  for (const [sceneId, files] of expected) {
    const entries = {};
    for (const [path, asset] of files) {
      const bytes = bytesOf(resourcesByScene.get(sceneId).get(path), `${sceneId}/${path}`);
      if (await digest(bytes) !== asset.sha256) throw new Error(`SHA-256 mismatch for ${sceneId}/${path}`);
      entries[path] = encodeBase64(bytes);
    }
    if (files.size) resources[sceneId] = entries;
  }
  const envelope = { format: FILE_FORMAT, version: FILE_VERSION, project, resources };
  const text = JSON.stringify(envelope);
  const encoded = encoder.encode(text);
  if (encoded.byteLength > MAX_ENCODED_BYTES) throw new Error('Project file exceeds 128 MiB');
  return encoded;
}

export async function decodeProject(input) {
  const inputSize = input instanceof Uint8Array || input instanceof ArrayBuffer ? input.byteLength : null;
  if (inputSize === null) throw new TypeError('input must be Uint8Array or ArrayBuffer');
  if (inputSize > MAX_ENCODED_BYTES) throw new Error('Project file exceeds 128 MiB');
  const inputBytes = bytesOf(input, 'input');
  let envelope;
  try { envelope = JSON.parse(decoder.decode(inputBytes)); }
  catch (error) { throw new Error(`Invalid project file JSON: ${error.message}`); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new TypeError('Project file envelope must be an object');
  if (envelope.format !== FILE_FORMAT || envelope.version !== FILE_VERSION) throw new Error('Unsupported project file format or version');
  if (!envelope.resources || typeof envelope.resources !== 'object' || Array.isArray(envelope.resources)) throw new TypeError('Project file resources must be an object');
  const project = validateProject(envelope.project);
  const expected = expectedFiles(project);
  const suppliedSceneIds = Object.keys(envelope.resources);
  for (const sceneId of suppliedSceneIds) {
    if (!expected.has(sceneId)) throw new Error(`Unknown resource scene: ${sceneId}`);
  }
  const resourcesByScene = new Map();
  for (const [sceneId, files] of expected) {
    const encodedFiles = Object.hasOwn(envelope.resources, sceneId) ? envelope.resources[sceneId] : undefined;
    if (files.size && (!encodedFiles || typeof encodedFiles !== 'object' || Array.isArray(encodedFiles))) throw new Error(`Missing resources for scene: ${sceneId}`);
    if (encodedFiles != null && (typeof encodedFiles !== 'object' || Array.isArray(encodedFiles))) throw new TypeError(`Resources for ${sceneId} must be an object`);
    const entries = encodedFiles ?? {};
    for (const path of Object.keys(entries)) if (!files.has(path)) throw new Error(`Unknown resource path for ${sceneId}: ${path}`);
    const output = new Map();
    for (const [path, asset] of files) {
      if (!Object.hasOwn(entries, path)) throw new Error(`Missing resource for ${sceneId}: ${path}`);
      const bytes = decodeBase64(entries[path], `${sceneId}/${path}`);
      if (await digest(bytes) !== asset.sha256) throw new Error(`SHA-256 mismatch for ${sceneId}/${path}`);
      output.set(path, bytes);
    }
    resourcesByScene.set(sceneId, output);
  }
  return { project, resourcesByScene };
}
