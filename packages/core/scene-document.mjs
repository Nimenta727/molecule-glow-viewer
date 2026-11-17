const FORMAT = 'glow-prototype';
const VERSION = 1;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const NODE_FIELDS = new Set(['id', 'name', 'parentId', 'assetId', 'visible', 'transform']);
const ASSET_FIELDS = new Set(['id', 'kind', 'shape', 'color']);
const DOCUMENT_FIELDS = new Set(['format', 'version', 'assets', 'nodes', 'timeline']);
const TIMELINE_FIELDS = new Set(['duration', 'tracks']);
const TRACK_FIELDS = new Set(['nodeId', 'keyframes']);
const KEYFRAME_FIELDS = new Set(['time', 'transform']);
const TRANSFORM_FIELDS = new Set(['position', 'rotation', 'scale']);

export class DocumentValidationError extends Error {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'DocumentValidationError';
    this.path = path;
  }
}

function fail(path, message) {
  throw new DocumentValidationError(message, path);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function cloneJson(value, path = '$', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') fail(path, 'value is not JSON-compatible');
  if (seen.has(value)) fail(path, 'cyclic values are not JSON-compatible');
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = Array.from(value, (entry, index) => cloneJson(entry, `${path}[${index}]`, seen));
  } else {
    if (!isRecord(value)) fail(path, 'objects must be plain JSON objects');
    copy = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: cloneJson(value[key], `${path}.${key}`, seen), enumerable: true, writable: true, configurable: true,
      });
    }
  }
  seen.delete(value);
  return copy;
}

function checkFields(value, allowed, path) {
  for (const field of Object.keys(value)) if (!allowed.has(field)) fail(`${path}.${field}`, 'unknown field');
}

function checkId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(path, 'expected a non-empty stable ID (1–128 letters, digits, ., _, :, or -)');
}

function checkVector(value, length, path, positive = false) {
  if (!Array.isArray(value) || value.length !== length) fail(path, `expected an array of ${length} finite numbers`);
  value.forEach((n, i) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || (positive && n <= 0)) {
      fail(`${path}[${i}]`, positive ? 'expected a positive finite number' : 'expected a finite number');
    }
  });
}

function checkTransform(value, path) {
  if (!isRecord(value)) fail(path, 'expected a transform object');
  checkFields(value, TRANSFORM_FIELDS, path);
  checkVector(value.position, 3, `${path}.position`);
  checkVector(value.rotation, 4, `${path}.rotation`);
  const norm = Math.hypot(...value.rotation);
  if (Math.abs(norm - 1) > 1e-5) fail(`${path}.rotation`, 'quaternion must be normalized (x, y, z, w)');
  checkVector(value.scale, 3, `${path}.scale`, true);
}

function checkNode(node, path) {
  if (!isRecord(node)) fail(path, 'expected a node object');
  checkFields(node, NODE_FIELDS, path);
  checkId(node.id, `${path}.id`);
  if (typeof node.name !== 'string') fail(`${path}.name`, 'expected a string');
  if (node.parentId !== null) checkId(node.parentId, `${path}.parentId`);
  if (node.assetId !== null) checkId(node.assetId, `${path}.assetId`);
  if (typeof node.visible !== 'boolean') fail(`${path}.visible`, 'expected a boolean');
  checkTransform(node.transform, `${path}.transform`);
}

function checkAsset(asset, path) {
  if (!isRecord(asset)) fail(path, 'expected an asset object');
  checkFields(asset, ASSET_FIELDS, path);
  checkId(asset.id, `${path}.id`);
  if (asset.kind !== 'primitive') fail(`${path}.kind`, 'expected "primitive"');
  if (!['box', 'sphere'].includes(asset.shape)) fail(`${path}.shape`, 'expected "box" or "sphere"');
  if (typeof asset.color !== 'string' || !COLOR_PATTERN.test(asset.color)) fail(`${path}.color`, 'expected an sRGB #rrggbb color');
}

function checkTrack(track, path, duration) {
  if (!isRecord(track)) fail(path, 'expected a track object');
  checkFields(track, TRACK_FIELDS, path);
  checkId(track.nodeId, `${path}.nodeId`);
  if (!Array.isArray(track.keyframes) || track.keyframes.length === 0) fail(`${path}.keyframes`, 'expected at least one keyframe');
  let previous = -Infinity;
  track.keyframes.forEach((keyframe, index) => {
    const keyPath = `${path}.keyframes[${index}]`;
    if (!isRecord(keyframe)) fail(keyPath, 'expected a keyframe object');
    checkFields(keyframe, KEYFRAME_FIELDS, keyPath);
    if (typeof keyframe.time !== 'number' || !Number.isFinite(keyframe.time)) fail(`${keyPath}.time`, 'expected a finite time');
    if (keyframe.time < 0 || keyframe.time > duration) fail(`${keyPath}.time`, 'time must be within the timeline duration');
    if (keyframe.time <= previous) fail(`${keyPath}.time`, 'keyframe times must be strictly increasing');
    previous = keyframe.time;
    checkTransform(keyframe.transform, `${keyPath}.transform`);
  });
}

export function createDocument(assets = [], nodes = [], timeline = { duration: 0, tracks: [] }) {
  return validateDocument({ format: FORMAT, version: VERSION, assets, nodes, timeline });
}

export function validateDocument(input) {
  const document = cloneJson(input);
  if (!isRecord(document)) fail('$', 'expected a document object');
  checkFields(document, DOCUMENT_FIELDS, '$');
  if (document.format !== FORMAT) fail('format', `expected "${FORMAT}"`);
  if (document.version !== VERSION) fail('version', `expected ${VERSION}`);
  if (!Array.isArray(document.assets)) fail('assets', 'expected an array');
  if (!Array.isArray(document.nodes)) fail('nodes', 'expected an array');
  if (!isRecord(document.timeline)) fail('timeline', 'expected a timeline object');
  checkFields(document.timeline, TIMELINE_FIELDS, 'timeline');
  if (typeof document.timeline.duration !== 'number' || !Number.isFinite(document.timeline.duration) || document.timeline.duration < 0) {
    fail('timeline.duration', 'expected a non-negative finite number in seconds');
  }
  if (!Array.isArray(document.timeline.tracks)) fail('timeline.tracks', 'expected an array');

  const assets = new Map();
  document.assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    checkAsset(asset, path);
    if (assets.has(asset.id)) fail(`${path}.id`, `duplicate asset ID "${asset.id}"`);
    assets.set(asset.id, asset);
  });

  const nodes = new Map();
  document.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    checkNode(node, path);
    if (nodes.has(node.id)) fail(`${path}.id`, `duplicate node ID "${node.id}"`);
    nodes.set(node.id, node);
  });

  for (const [id, node] of nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) fail(`nodes.${id}.parentId`, `unknown parent "${node.parentId}"`);
    if (node.assetId !== null && !assets.has(node.assetId)) fail(`nodes.${id}.assetId`, `unknown asset "${node.assetId}"`);
  }
  const verified = new Set();
  for (const id of nodes.keys()) {
    const seen = new Set();
    let parentId = id;
    while (parentId !== null && !verified.has(parentId)) {
      if (seen.has(parentId)) fail(`nodes.${id}.parentId`, 'parent graph contains a cycle');
      seen.add(parentId);
      parentId = nodes.get(parentId).parentId;
    }
    for (const ancestor of seen) verified.add(ancestor);
  }

  const tracked = new Set();
  document.timeline.tracks.forEach((track, index) => {
    const path = `timeline.tracks[${index}]`;
    checkTrack(track, path, document.timeline.duration);
    if (!nodes.has(track.nodeId)) fail(`${path}.nodeId`, `unknown target node "${track.nodeId}"`);
    if (tracked.has(track.nodeId)) fail(`${path}.nodeId`, `node "${track.nodeId}" already has a track`);
    tracked.add(track.nodeId);
  });
  return document;
}

export function freezeDocument(document) {
  if (Array.isArray(document)) {
    for (const value of document) freezeDocument(value);
  } else if (document && typeof document === 'object') {
    for (const value of Object.values(document)) freezeDocument(value);
  }
  return Object.freeze(document);
}
