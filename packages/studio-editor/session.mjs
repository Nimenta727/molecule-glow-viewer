import { createDocumentStore } from '../core/index.mjs';
import { validateScene, toCoreDocument } from '../schema/documents.mjs';
import { GEOMETRY_MEDIA_TYPE } from '../schema/geometry.mjs';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) Object.defineProperty(output, key, {
      value: clone(entry), enumerable: true, writable: true, configurable: true,
    });
    return output;
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function copyResources(source) {
  return new Map([...source].map(([path, bytes]) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`Missing bytes for ${path}`);
    return [path, new Uint8Array(bytes)];
  }));
}

function geometryIds(scene, resources) {
  return new Set(scene.assets
    .filter((asset) => asset.kind === 'file' && asset.mediaType === GEOMETRY_MEDIA_TYPE && resources.has(asset.path))
    .map((asset) => asset.id));
}

function projected(scene, resources) {
  return freeze(toCoreDocument(scene, geometryIds(scene, resources)));
}

function commandAssetIntents(command, output = new Map()) {
  if (command?.type === 'batch' && Array.isArray(command.commands)) {
    for (const child of command.commands) commandAssetIntents(child, output);
  } else if (command?.type === 'addNode' && command.node) {
    output.set(command.node.id, command.node.assetId);
  } else if (command?.type === 'updateNode' && Object.hasOwn(command.patch || {}, 'assetId')) {
    output.set(command.id, command.patch.assetId);
  }
  return output;
}

function adaptUnsupportedAssetRefs(command, unsupportedAssetIds) {
  const output = clone(command);
  if (output.type === 'batch') {
    output.commands = output.commands.map((child) => adaptUnsupportedAssetRefs(child, unsupportedAssetIds));
  } else if (output.type === 'addNode' && unsupportedAssetIds.has(output.node?.assetId)) {
    output.node.assetId = null;
  } else if (output.type === 'updateNode' && unsupportedAssetIds.has(output.patch?.assetId)) {
    output.patch.assetId = null;
  }
  return output;
}

function mergeCore(scene, coreDocument, renderableAssetIds, assetIntents) {
  const previousAssets = new Map(scene.assets.map((asset) => [asset.id, asset]));
  const previousNodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const corePrimitiveAssets = new Map(coreDocument.assets
    .filter((asset) => asset.kind === 'primitive')
    .map((asset) => [asset.id, asset]));
  const assets = [];
  for (const asset of scene.assets) {
    if (asset.kind !== 'primitive') { assets.push(asset); continue; }
    const updated = corePrimitiveAssets.get(asset.id);
    if (updated) assets.push({ ...asset, ...updated });
  }
  for (const asset of corePrimitiveAssets.values()) {
    const previous = previousAssets.get(asset.id);
    if (!previous) assets.push(asset);
    else if (previous.kind !== 'primitive') throw new Error(`Asset ID already exists: ${asset.id}`);
  }

  const nodes = coreDocument.nodes.map((node) => {
    const previous = previousNodes.get(node.id);
    const hasIntent = assetIntents.has(node.id);
    const intendedAssetId = assetIntents.get(node.id);
    const assetId = hasIntent
      ? (intendedAssetId !== null && !renderableAssetIds.has(intendedAssetId) ? intendedAssetId : node.assetId)
      : (previous?.assetId !== null && previous?.assetId !== undefined && !renderableAssetIds.has(previous.assetId) ? previous.assetId : node.assetId);
    return {
      ...node,
      assetId,
      ...(previous?.extensions ? { extensions: previous.extensions } : {}),
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  let presentation = scene.presentation;
  for (const view of presentation?.navigation?.views ?? []) {
    const references = [
      view.nodeId, view.hotspotNodeId,
      ...(view.steps ?? []).flatMap(({ nodeIds }) => nodeIds),
      ...(view.connections ?? []).flatMap(({ from, to }) => [from, to]),
      ...presentation.notes.filter(({ id }) => view.labelIds.includes(id)).map(({ nodeId }) => nodeId),
    ];
    const missing = references.find((id) => id != null && !nodeIds.has(id));
    if (missing) throw new Error(`「${previousNodes.get(missing)?.name || missing}」仍被展示视图「${view.title}」引用。请先修改该视图。`);
  }
  if (presentation && presentation.notes.some((note) => note.nodeId !== null && !nodeIds.has(note.nodeId))) {
    presentation = {
      ...presentation,
      notes: presentation.notes.filter((note) => note.nodeId === null || nodeIds.has(note.nodeId)),
    };
  }
  return validateScene({
    ...scene,
    assets,
    nodes,
    timeline: coreDocument.timeline,
    ...(presentation ? { presentation } : {}),
  });
}

function applyMetadata(scene, command) {
  const next = clone(scene);
  switch (command.type) {
    case 'setSceneTitle':
      if (typeof command.title !== 'string' || !command.title.trim()) throw new TypeError('请输入场景名称。');
      next.title = command.title.trim();
      break;
    case 'setNavigation': {
      if (command.navigation === undefined) throw new TypeError('setNavigation requires navigation or null');
      if (command.navigation === null && !next.presentation?.navigation) return scene;
      next.presentation ??= { notes: [], bookmarks: [] };
      if (command.navigation === null) delete next.presentation.navigation;
      else next.presentation.navigation = clone(command.navigation);
      break;
    }
    case 'addNote': {
      const note = command.note;
      if (!note || typeof note !== 'object' || Array.isArray(note) || typeof note.id !== 'string' || typeof note.text !== 'string' || !(typeof note.nodeId === 'string' || note.nodeId === null)) {
        throw new TypeError('addNote requires { id, text, nodeId: string|null }');
      }
      next.presentation ??= { notes: [], bookmarks: [] };
      next.presentation.notes.push(clone(note));
      break;
    }
    case 'addBookmark': {
      const bookmark = command.bookmark;
      if (!bookmark || typeof bookmark !== 'object' || Array.isArray(bookmark) || typeof bookmark.id !== 'string' || typeof bookmark.name !== 'string' || !Array.isArray(bookmark.position) || !Array.isArray(bookmark.target)) {
        throw new TypeError('addBookmark requires { id, name, position, target }');
      }
      next.presentation ??= { notes: [], bookmarks: [] };
      next.presentation.bookmarks.push(clone(bookmark));
      break;
    }
    case 'setToolConfig': {
      if (next.schemaVersion !== 3) throw new TypeError('工具配置需要 v3 作品。');
      const entry = next.tools.find(({ id }) => id === command.id);
      if (!entry) throw new TypeError(`作品里没有工具条目 ${String(command.id)}。`);
      if (!command.config || typeof command.config !== 'object' || Array.isArray(command.config)) throw new TypeError('setToolConfig requires a config object');
      entry.config = clone(command.config);
      break;
    }
    case 'addEvidence': {
      const entry = command.entry;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.type !== 'string' || typeof entry.citation !== 'string') {
        throw new TypeError('addEvidence requires { type, citation }');
      }
      next.evidence.push(clone(entry));
      break;
    }
    default: throw new TypeError(`unsupported Studio metadata command "${command.type}"`);
  }
  return validateScene(next);
}

export function createStudioSession(sceneInput, resources = new Map()) {
  if (!(resources instanceof Map)) throw new TypeError('resources must be a Map');
  const storedResources = copyResources(resources);
  let current = freeze(validateScene(sceneInput));
  const undoStack = [];
  const redoStack = [];

  function commit(next) {
    if (sameJson(current, next)) return false;
    undoStack.push(current);
    redoStack.length = 0;
    current = freeze(next);
    return true;
  }

  function dispatch(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('command must be an object');
    if (['addNote', 'addBookmark', 'addEvidence', 'setNavigation', 'setSceneTitle', 'setToolConfig'].includes(command.type)) {
      return commit(applyMetadata(current, command));
    }

    const coreDocument = projected(current, storedResources);
    const renderableAssetIds = new Set(coreDocument.assets.map((asset) => asset.id));
    const allAssetIds = new Set(current.assets.map((asset) => asset.id));
    const unsupportedAssetIds = new Set([...allAssetIds].filter((id) => !renderableAssetIds.has(id)));
    const intents = commandAssetIntents(command);
    const coreStore = createDocumentStore(coreDocument);
    const outcome = coreStore.dispatch(adaptUnsupportedAssetRefs(command, unsupportedAssetIds));
    if (!outcome.ok) throw new Error(outcome.error.message);
    if (!outcome.changed && intents.size === 0) return false;
    return commit(mergeCore(current, coreStore.getSnapshot(), renderableAssetIds, intents));
  }

  function restore(from, to) {
    if (from.length === 0) return false;
    to.push(current);
    current = from.pop();
    return true;
  }

  return Object.freeze({
    getScene() { return current; },
    getCoreDocument() { return projected(current, storedResources); },
    getResources() { return copyResources(storedResources); },
    dispatch,
    undo() { return restore(undoStack, redoStack); },
    redo() { return restore(redoStack, undoStack); },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
  });
}
