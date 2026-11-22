import { Validator } from '@cfworker/json-schema';
import { validateDocument as validateCoreDocument } from '../core/scene-document.mjs';
import { GEOMETRY_MEDIA_TYPE } from './geometry.mjs';
import { SchemaValidationError } from './errors.mjs';
import { validateResource } from './resource.mjs';

export { SchemaValidationError };

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
  // What the workshop needs to publish the scene as a work: who made it, under what licence, which revision, what it was derived from. Optional; the workshop's publish check says what is missing.
  publication: {
    type: 'object', additionalProperties: false, required: ['license', 'author'],
    properties: {
      license: { type: 'string', minLength: 1, maxLength: 40 },
      author: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, url: { type: 'string', pattern: '^https://\\S+$', maxLength: 300 } } },
      revision: { type: 'integer', minimum: 1 },
      updated: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      topic: { enum: ['mechanism', 'protein', 'local-system', 'cell'] },
      description: { type: 'string', maxLength: 400 },
      tags: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 20 } },
      derivedFrom: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' }, revision: { type: 'integer', minimum: 1 } } },
    },
  },
  legacy: { type: 'object', additionalProperties: JSON_VALUE },
  presentation: {
    type: 'object', additionalProperties: false, required: ['notes', 'bookmarks'],
    properties: {
      notes: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'text', 'nodeId'],
        properties: { id: ID, text: { type: 'string', minLength: 1, maxLength: 5000 }, nodeId: { anyOf: [ID, { type: 'null' }] } },
      } },
      bookmarks: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'position', 'target'],
        properties: { id: ID, name: { type: 'string', minLength: 1, maxLength: 200 }, position: VEC3, target: VEC3 },
      } },
      cameraKeys: { type: 'array', maxItems: 64, items: {
        type: 'object', additionalProperties: false, required: ['id', 'time', 'bookmarkId'],
        properties: { id: ID, time: { type: 'number', minimum: 0 }, bookmarkId: ID },
      } },
      navigation: {
        type: 'object', additionalProperties: false, required: ['version', 'entryId', 'views'],
        properties: {
          version: { const: 1 }, entryId: ID,
          views: { type: 'array', minItems: 1, items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'mode', 'title', 'nodeId', 'parentIds', 'bookmarkId', 'labelIds'],
            properties: {
              id: ID, mode: { enum: ['cell', 'system', 'protein', 'mechanism'] },
              title: { type: 'string', minLength: 1 }, nodeId: ID,
              hotspotNodeId: ID,
              connections: { type: 'array', items: {
                type: 'object', additionalProperties: false, required: ['from', 'to', 'label'],
                properties: { from: ID, to: ID, label: { type: 'string', minLength: 1 } },
              } },
              parentIds: { type: 'array', uniqueItems: true, items: ID },
              bookmarkId: { anyOf: [ID, { type: 'null' }] },
              labelIds: { type: 'array', uniqueItems: true, items: ID },
              steps: { type: 'array', minItems: 1, items: {
                type: 'object', additionalProperties: false, required: ['id', 'title', 'nodeIds'],
                properties: {
                  id: ID, title: { type: 'string', minLength: 1 },
                  nodeIds: { type: 'array', minItems: 1, uniqueItems: true, items: ID },
                  time: { type: 'number', minimum: 0 },
                },
              } },
            },
          } },
        },
      },
    },
  },
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

// ---- Scene v3: assets may reference immutable resources, and the scene carries the tool configurations that make it a "work".
// v3 = v2 + `resource` on file/external assets + required `tools` and `resources`. See docs/CONTRACT_4.3.0.md §2, §4, §12.
const SEMVER = { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' };
const RESOURCE_REF = {
  type: 'object', additionalProperties: false, required: ['id', 'version', 'sha256'],
  properties: { id: ID, version: { type: 'string', pattern: '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$' }, sha256: SHA256 },
};
const withResource = (asset) => ({ ...asset, properties: { ...asset.properties, resource: RESOURCE_REF } });
const JSON_OBJECT = { type: 'object', additionalProperties: JSON_VALUE };
const TOOL_ENTRY = {
  type: 'object', additionalProperties: false, required: ['id', 'tool', 'config'],
  properties: {
    id: ID,
    tool: { type: 'object', additionalProperties: false, required: ['id', 'version'], properties: { id: ID, version: SEMVER } },
    config: JSON_OBJECT,   // validated by the tool that owns it
    bindings: { type: 'object', additionalProperties: { type: 'array', uniqueItems: true, maxItems: 512, items: ID } },   // role -> node ids the tool works on
    state: JSON_OBJECT,    // the tool's save() output (seed, parameter history, playback)
  },
};
// Deep copy: the validator caches $ref bases per schema object, so v2 and v3 must not share sub-schemas.
const SCENE_PROPERTIES_V3 = schemaCopy({
  ...SCENE_PROPERTIES,
  schemaVersion: { const: 3 },
  assets: { type: 'array', items: { oneOf: [PRIMITIVE_ASSET, withResource(FILE_ASSET), withResource(EXTERNAL_ASSET)] } },
  tools: { type: 'array', items: TOOL_ENTRY },
  resources: { type: 'array', items: { type: 'object' } },   // glow-resource records, checked by validateResource
});
export const SCENE_SCHEMA_V3 = {
  $schema: DRAFT, $id: 'https://molecule-glow-viewer.invalid/schema/scene-v3.json',
  $defs: schemaCopy(COMMON_DEFS),
  type: 'object', additionalProperties: false,
  required: [...SCENE_REQUIRED, 'tools', 'resources'], properties: SCENE_PROPERTIES_V3,
};
const SCENE_ENVELOPE = { type: 'object', required: ['schemaVersion'], properties: { schemaVersion: { enum: [2, 3] } } };

export const PROJECT_SCHEMA = {
  $schema: DRAFT, $id: 'https://molecule-glow-viewer.invalid/schema/project-v1.json',
  type: 'object', additionalProperties: false, required: ['format', 'schemaVersion', 'id', 'title', 'scenes', 'activeSceneId'],
  properties: {
    format: { const: 'glow-project' }, schemaVersion: { const: 1 }, id: ID,
    title: { type: 'string', minLength: 1 },
    scenes: { type: 'array', minItems: 1, items: SCENE_ENVELOPE },   // each scene is then validated as v2 or v3
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
  if (scene.presentation) {
    const { notes, bookmarks } = scene.presentation;
    if (new Set(notes.map(({ id }) => id)).size !== notes.length ||
        new Set(bookmarks.map(({ id }) => id)).size !== bookmarks.length) {
      throw new SchemaValidationError('duplicate presentation item ID');
    }
    const nodeIds = new Set(scene.nodes.map(({ id }) => id));
    if (notes.some(({ nodeId }) => nodeId !== null && !nodeIds.has(nodeId))) {
      throw new SchemaValidationError('presentation note refers to an unknown node');
    }
    if (bookmarks.some(({ position, target }) => position.every((value, index) => value === target[index]))) {
      throw new SchemaValidationError('bookmark camera position must differ from its target');
    }
    const keys = scene.presentation.cameraKeys ?? [], bookmarkIds = new Set(bookmarks.map(({ id }) => id));
    if (new Set(keys.map(({ id }) => id)).size !== keys.length || new Set(keys.map(({ time }) => time)).size !== keys.length) throw new SchemaValidationError('duplicate camera key ID or time');
    if (keys.some(({ bookmarkId }) => !bookmarkIds.has(bookmarkId))) throw new SchemaValidationError('camera key refers to an unknown bookmark');
    checkNavigation(scene.presentation, nodeIds, scene.timeline);
  }
  if (scene.schemaVersion === 3) checkWorkReferences(scene);
  try { validateCoreDocument(projectCoreDocument(scene)); }
  catch (error) { throw new SchemaValidationError(error.message); }
}

function checkWorkReferences(scene) {
  const fail = (message) => { throw new SchemaValidationError(message); };
  const toolIds = new Set();
  const nodeIds = new Set(scene.nodes.map(({ id }) => id));
  for (const entry of scene.tools) {
    if (toolIds.has(entry.id)) fail(`duplicate tool entry ID "${entry.id}"`);
    toolIds.add(entry.id);
    for (const [role, ids] of Object.entries(entry.bindings ?? {})) {
      const unknown = ids.find((id) => !nodeIds.has(id));
      if (unknown !== undefined) fail(`tool "${entry.id}" binds role "${role}" to unknown node "${unknown}"`);
    }
  }
  const records = new Map();
  for (const input of scene.resources) {
    const record = validateResource(input);
    const key = `${record.id}@${record.version}`;
    if (records.has(key)) fail(`duplicate resource ${key}`);
    records.set(key, record);
  }
  for (const asset of scene.assets) {
    if (!asset.resource) continue;
    const { id, version, sha256 } = asset.resource, record = records.get(`${id}@${version}`);
    if (!record) fail(`asset "${asset.id}" refers to resource ${id}@${version}, which the scene does not carry`);
    if (!record.files.some((file) => file.sha256 === sha256)) fail(`asset "${asset.id}" expects sha256 ${sha256}, which is not part of resource ${id}@${version}`);
    if (asset.kind === 'file' && asset.sha256 !== sha256) fail(`asset "${asset.id}" bytes (${asset.sha256}) differ from its resource reference (${sha256})`);
  }
}

function checkNavigation({ navigation, notes, bookmarks }, nodeIds, timeline) {
  if (!navigation) return;
  const { entryId, views } = navigation;
  const byId = new Map(views.map((view) => [view.id, view]));
  const noteIds = new Set(notes.map(({ id }) => id));
  const bookmarkIds = new Set(bookmarks.map(({ id }) => id));
  const parents = { cell: [], system: ['cell'], protein: ['system'], mechanism: ['system', 'protein'] };
  if (byId.size !== views.length || !['cell', 'system', 'protein'].includes(byId.get(entryId)?.mode)) {
    throw new SchemaValidationError('presentation navigation requires unique view IDs and a cell, system or protein entry');
  }
  for (const view of views) {
    const fail = (reason) => { throw new SchemaValidationError(`presentation view "${view.id}": ${reason}`); };
    const root = view.id === entryId;
    if ((root && view.parentIds.length) || (!root && !view.parentIds.length) ||
        (view.mode !== 'mechanism' && view.parentIds.length > 1) ||
        view.parentIds.some((id) => !parents[view.mode].includes(byId.get(id)?.mode))) {
      fail('invalid parent view, missing target or cycle');
    }
    if (!nodeIds.has(view.nodeId)) fail('unknown target node');
    if (view.hotspotNodeId !== undefined && (root || !nodeIds.has(view.hotspotNodeId))) fail('invalid hotspot node');
    if (view.connections && (view.mode !== 'system' || view.connections.some(({ from, to }) =>
      from === to || !nodeIds.has(from) || !nodeIds.has(to)))) fail('invalid illustrative connection');
    if (view.bookmarkId !== null && !bookmarkIds.has(view.bookmarkId)) fail('unknown camera bookmark');
    if (view.labelIds.some((id) => !noteIds.has(id))) fail('unknown label');
    if ((view.mode === 'mechanism') !== Boolean(view.steps)) fail('steps are required only for mechanism views');
    if (view.steps?.some((step) => (step.time === undefined) !== (view.steps[0].time === undefined))) {
      fail('steps must be either all timed or all untimed');
    }
    let previousTime = -1;
    const stepIds = new Set();
    for (const step of view.steps ?? []) {
      if (stepIds.has(step.id) || step.nodeIds.some((id) => !nodeIds.has(id))) fail('duplicate step ID or unknown step node');
      stepIds.add(step.id);
      if (step.time === undefined) continue;
      if (!timeline.tracks.length || step.time > timeline.duration || step.time <= previousTime) fail('invalid step time');
      previousTime = step.time;
    }
  }
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
  schemaErrors(scene?.schemaVersion === 3 ? SCENE_SCHEMA_V3 : SCENE_SCHEMA, scene, 'Scene');
  checkSceneReferences(scene);
  return scene;
}

export function validateProject(input) {
  const project = detachedJson(input);
  schemaErrors(PROJECT_SCHEMA, project, 'Project');
  const ids = new Set();
  project.scenes = project.scenes.map((scene) => validateScene(scene));
  for (const scene of project.scenes) {
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
