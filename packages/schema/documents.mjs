import { Validator } from '@cfworker/json-schema';
import { validateDocument as validateCoreDocument } from '../core/scene-document.mjs';
import { GEOMETRY_MEDIA_TYPE } from './geometry.mjs';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const SHA256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const JSON_VALUE = {
  anyOf: [
    { type: 'null' }, { type: 'boolean' }, { type: 'number' }, { type: 'string' },
    { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
    { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
  ],
};
const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const QUATERNION = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['position', 'rotation', 'scale'],
  properties: {
    position: VEC3,
    rotation: QUATERNION,
    scale: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 }, minItems: 3, maxItems: 3 },
  },
};
const CORE_NODE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'parentId', 'assetId', 'visible', 'transform'],
  properties: {
    id: ID, name: { type: 'string' },
    parentId: { anyOf: [{ type: 'null' }, ID] },
    assetId: { anyOf: [{ type: 'null' }, ID] },
    visible: { type: 'boolean' }, transform: TRANSFORM_SCHEMA,
  },
};
const SCENE_NODE_SCHEMA = {
  ...CORE_NODE_SCHEMA,
  properties: { ...CORE_NODE_SCHEMA.properties, extensions: { type: 'object', additionalProperties: JSON_VALUE } },
};
const PRIMITIVE_ASSET = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'shape', 'color'],
  properties: {
    id: ID, kind: { const: 'primitive' }, shape: { enum: ['box', 'sphere'] },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    provenance: { type: 'object', additionalProperties: JSON_VALUE },
  },
};
const FILE_ASSET = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'path', 'sha256', 'mediaType'],
  properties: {
    id: ID, kind: { const: 'file' }, path: { type: 'string' }, sha256: SHA256,
    mediaType: { type: 'string', minLength: 1 },
    provenance: { type: 'object', additionalProperties: JSON_VALUE },
  },
};
const EXTERNAL_ASSET = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'source', 'mediaType'],
  properties: {
    id: ID, kind: { const: 'external' },
    source: {
      type: 'object', additionalProperties: false, required: ['provider', 'accession'],
      properties: { provider: { type: 'string', minLength: 1 }, accession: { type: 'string', minLength: 1 } },
    },
    mediaType: { type: 'string', minLength: 1 },
    provenance: { type: 'object', additionalProperties: JSON_VALUE },
  },
};
const TIMELINE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['duration', 'tracks'],
  properties: {
    duration: { type: 'number', minimum: 0 },
    tracks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['nodeId', 'keyframes'],
        properties: {
          nodeId: ID,
          keyframes: {
            type: 'array', minItems: 1, items: {
              type: 'object', additionalProperties: false, required: ['time', 'transform'],
              properties: { time: { type: 'number', minimum: 0 }, transform: TRANSFORM_SCHEMA },
            },
          },
        },
      },
    },
  },
};

const SCENE_PROPERTIES = {
  format: { const: 'glow-scene' }, schemaVersion: { const: 2 }, id: ID,
  title: { type: 'string', minLength: 1 },
  units: {
    type: 'object', additionalProperties: false, required: ['length', 'time'],
    properties: { length: { const: 'meter' }, time: { const: 'second' } },
  },
  assets: { type: 'array', items: { oneOf: [PRIMITIVE_ASSET, FILE_ASSET, EXTERNAL_ASSET] } },
  nodes: { type: 'array', items: SCENE_NODE_SCHEMA },
  timeline: TIMELINE_SCHEMA,
  dependencies: {
    type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'version', 'optional'],
      properties: { id: ID, version: { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' }, optional: { type: 'boolean' } },
    },
  },
  evidence: { type: 'array', items: { type: 'object', additionalProperties: JSON_VALUE } },
  legacy: { type: 'object', additionalProperties: JSON_VALUE },
};
const SCENE_REQUIRED = ['format', 'schemaVersion', 'id', 'title', 'units', 'assets', 'nodes', 'timeline', 'dependencies', 'evidence'];
const schemaCopy = (schema) => JSON.parse(JSON.stringify(schema));
const COMMON_DEFS = { jsonValue: schemaCopy(JSON_VALUE) };

const SCENE_DEFINITION = {
  type: 'object', additionalProperties: false,
  required: SCENE_REQUIRED, properties: SCENE_PROPERTIES,
};
export const SCENE_SCHEMA = {
  $schema: DRAFT, $id: 'https://molecule-glow-viewer.invalid/schema/scene-v2.json',
  $defs: COMMON_DEFS, ...SCENE_DEFINITION,
};

export const PROJECT_SCHEMA = {
  $schema: DRAFT, $id: 'https://molecule-glow-viewer.invalid/schema/project-v1.json',
  $defs: { jsonValue: schemaCopy(JSON_VALUE), scene: schemaCopy(SCENE_DEFINITION) },
  type: 'object', additionalProperties: false, required: ['format', 'schemaVersion', 'id', 'title', 'scenes', 'activeSceneId'],
  properties: {
    format: { const: 'glow-project' }, schemaVersion: { const: 1 }, id: ID,
    title: { type: 'string', minLength: 1 },
    scenes: { type: 'array', minItems: 1, items: { $ref: '#/$defs/scene' } },
    activeSceneId: ID,
  },
};

export const PACKAGE_SCHEMA = {
  $schema: DRAFT, $id: 'https://molecule-glow-viewer.invalid/schema/package-v1.json',
  type: 'object', additionalProperties: false, required: ['format', 'schemaVersion', 'id', 'kind', 'scene', 'files'],
  properties: {
    format: { const: 'glow-package' }, schemaVersion: { const: 1 }, id: ID,
    kind: { const: 'scene' }, scene: { const: 'scene.json' },
    files: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['path', 'sha256', 'size'],
      properties: { path: { type: 'string' }, sha256: SHA256, size: { type: 'integer', minimum: 0 } },
    } },
  },
};

const validators = new WeakMap();
function schemaErrors(schema, input, label) {
  let validator = validators.get(schema);
  if (!validator) { validator = new Validator(schema, '2020-12', false); validators.set(schema, validator); }
  const result = validator.validate(input);
  if (!result.valid) throw new SchemaValidationError(label, result.errors);
}

export class SchemaValidationError extends Error {
  constructor(label, errors = []) {
    super(`${label} is invalid${errors.length ? `: ${errors.map((error) => `${error.instanceLocation || '$'} ${error.error}`).join('; ')}` : ''}`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

function detachedJson(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SchemaValidationError(`non-finite number at ${path}`);
    return value;
  }
  if (typeof value !== 'object') throw new SchemaValidationError(`non-JSON value at ${path}`);
  if (ancestors.has(value)) throw new SchemaValidationError(`cyclic value at ${path}`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new SchemaValidationError(`non-plain object at ${path}`);
  ancestors.add(value);
  let copy;
  if (Array.isArray(value)) copy = Array.from(value, (entry, index) => detachedJson(entry, `${path}[${index}]`, ancestors));
  else {
    copy = {};
    for (const key of Object.keys(value)) Object.defineProperty(copy, key, {
      value: detachedJson(value[key], `${path}.${key}`, ancestors), enumerable: true, writable: true, configurable: true,
    });
  }
  ancestors.delete(value);
  return copy;
}

function checkSceneReferences(scene) {
  const assetIds = new Set();
  const assetPaths = new Set();
  for (const asset of scene.assets) {
    if (assetIds.has(asset.id)) throw new SchemaValidationError(`duplicate asset ID "${asset.id}" across asset variants`);
    assetIds.add(asset.id);
    if (asset.kind === 'file') {
      if (!asset.path.startsWith('assets/') || !isPackagePath(asset.path)) throw new SchemaValidationError(`file asset path is not portable: ${asset.path}`);
      const path = asset.path.toLowerCase();
      if (assetPaths.has(path)) throw new SchemaValidationError(`duplicate file asset path "${asset.path}"`);
      assetPaths.add(path);
    }
  }
  for (const node of scene.nodes) {
    if (node.assetId !== null && !assetIds.has(node.assetId)) throw new SchemaValidationError(`node "${node.id}" has unknown asset "${node.assetId}"`);
  }
  if (new Set(scene.dependencies.map(({ id }) => id)).size !== scene.dependencies.length) {
    throw new SchemaValidationError('duplicate scene dependency ID');
  }
  try { validateCoreDocument(projectCoreDocument(scene)); }
  catch (error) { throw new SchemaValidationError(error.message); }
}

export function isPackagePath(value) {
  if (value === 'scene.json') return true;
  if (typeof value !== 'string' || !value.startsWith('assets/')) return false;
  if (value.includes('\\') || value.includes('%') || value.includes(':') || value.startsWith('/') || value.endsWith('/')) return false;
  const parts = value.split('/');
  if (parts[0] !== 'assets' || parts.length < 2) return false;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  for (const part of parts.slice(1)) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part) || part.endsWith('.') || part === '.' || part === '..' || reserved.test(part)) return false;
  }
  return true;
}

export function validateScene(input) {
  const scene = detachedJson(input);
  schemaErrors(SCENE_SCHEMA, scene, 'Scene');
  checkSceneReferences(scene);
  return scene;
}

export function validateProject(input) {
  const project = detachedJson(input);
  schemaErrors(PROJECT_SCHEMA, project, 'Project');
  const ids = new Set();
  for (const scene of project.scenes) {
    checkSceneReferences(scene);
    if (ids.has(scene.id)) throw new SchemaValidationError(`duplicate scene ID "${scene.id}"`);
    ids.add(scene.id);
  }
  if (!ids.has(project.activeSceneId)) throw new SchemaValidationError(`activeSceneId "${project.activeSceneId}" does not reference a scene`);
  return project;
}

export function validatePackageManifest(input) {
  const manifest = detachedJson(input);
  schemaErrors(PACKAGE_SCHEMA, manifest, 'Package manifest');
  const paths = new Set();
  for (const file of manifest.files) {
    if (!isPackagePath(file.path)) throw new SchemaValidationError(`package file path is not portable: ${file.path}`);
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new SchemaValidationError(`duplicate package file path "${file.path}"`);
    paths.add(key);
  }
  if (!paths.has('scene.json')) throw new SchemaValidationError('package manifest must list scene.json');
  return manifest;
}

function projectCoreDocument(scene, geometryIds = new Set()) {
  const assets = [];
  for (const asset of scene.assets) {
    const { id, kind, shape, color } = asset;
    if (kind === 'primitive') assets.push({ id, kind, shape, color });
    if (kind === 'file' && asset.mediaType === GEOMETRY_MEDIA_TYPE && geometryIds.has(id)) {
      assets.push({ id, kind: 'geometry' });
    }
  }
  const renderable = new Set(assets.map(({ id }) => id));
  return {
    format: 'glow-prototype', version: 1,
    assets,
    nodes: scene.nodes.map(({ id, name, parentId, assetId, visible, transform }) => ({
      id, name, parentId, assetId: renderable.has(assetId) ? assetId : null, visible, transform,
    })),
    timeline: scene.timeline,
  };
}

export function toCoreDocument(input, geometryIds) {
  return projectCoreDocument(validateScene(input), geometryIds);
}
