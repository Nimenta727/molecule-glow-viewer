import { cloneJson, freezeDocument, validateDocument } from './scene-document.mjs';

const PATCHABLE_FIELDS = new Set(['name', 'parentId', 'assetId', 'visible', 'transform']);
const PATCHABLE_ASSET_FIELDS = new Set(['shape', 'color']);

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyCommand(document, command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('command must be an object');
  switch (command.type) {
    case 'addAsset': {
      if (!command.asset || typeof command.asset !== 'object' || Array.isArray(command.asset)) throw new TypeError('addAsset requires an asset object');
      if (document.assets.some((asset) => asset.id === command.asset.id)) throw new TypeError(`asset ID "${command.asset.id}" already exists`);
      document.assets.push(command.asset);
      break;
    }
    case 'updateAsset': {
      if (typeof command.id !== 'string' || !command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch)) {
        throw new TypeError('updateAsset requires an id and patch object');
      }
      const asset = document.assets.find((entry) => entry.id === command.id);
      if (!asset) throw new TypeError(`unknown asset "${command.id}"`);
      if (asset.kind !== 'primitive') throw new TypeError('only primitive assets can be updated');
      for (const key of Object.keys(command.patch)) if (!PATCHABLE_ASSET_FIELDS.has(key)) throw new TypeError(`asset field "${key}" cannot be updated`);
      Object.assign(asset, command.patch);
      break;
    }
    case 'addNode': {
      if (!command.node || typeof command.node !== 'object' || Array.isArray(command.node)) throw new TypeError('addNode requires a node object');
      if (document.nodes.some((node) => node.id === command.node.id)) throw new TypeError(`node ID "${command.node.id}" already exists`);
      document.nodes.push(command.node);
      break;
    }
    case 'updateNode': {
      if (typeof command.id !== 'string' || !command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch)) {
        throw new TypeError('updateNode requires an id and patch object');
      }
      const node = document.nodes.find((entry) => entry.id === command.id);
      if (!node) throw new TypeError(`unknown node "${command.id}"`);
      for (const key of Object.keys(command.patch)) if (!PATCHABLE_FIELDS.has(key)) throw new TypeError(`node field "${key}" cannot be updated`);
      Object.assign(node, command.patch);
      break;
    }
    case 'removeNode': {
      if (typeof command.id !== 'string') throw new TypeError('removeNode requires an id');
      if (!document.nodes.some((node) => node.id === command.id)) throw new TypeError(`unknown node "${command.id}"`);
      const children = new Map();
      for (const node of document.nodes) {
        const siblings = children.get(node.parentId) ?? [];
        siblings.push(node.id);
        children.set(node.parentId, siblings);
      }
      const removed = new Set([command.id]);
      for (const id of removed) {
        for (const child of children.get(id) ?? []) removed.add(child);
      }
      document.nodes = document.nodes.filter((node) => !removed.has(node.id));
      document.timeline.tracks = document.timeline.tracks.filter((track) => !removed.has(track.nodeId));
      break;
    }
    case 'setTimeline': {
      if (!command.timeline || typeof command.timeline !== 'object' || Array.isArray(command.timeline)) throw new TypeError('setTimeline requires a timeline object');
      document.timeline = command.timeline;
      break;
    }
    case 'batch': {
      if (!Array.isArray(command.commands) || command.commands.length === 0) throw new TypeError('batch requires a non-empty commands array');
      for (const child of command.commands) {
        if (child?.type === 'batch') throw new TypeError('nested batches are not supported');
        applyCommand(document, child);
      }
      break;
    }
    default:
      throw new TypeError(`unsupported command type "${String(command.type)}"`);
  }
}

function result(ok, changed, revision, error) {
  return error ? { ok, changed, revision, error } : { ok, changed, revision };
}

export function createDocumentStore(initialDocument) {
  let current = freezeDocument(validateDocument(initialDocument));
  let revision = 0;
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();

  const publish = (reason) => {
    for (const listener of [...listeners]) {
      try { listener(current, { reason, revision }); } catch { /* A subscriber cannot roll back a committed edit. */ }
    }
  };

  const commit = (next, reason, recordHistory) => {
    const frozenNext = freezeDocument(next);
    if (sameJson(current, frozenNext)) return result(true, false, revision);
    if (recordHistory) {
      undoStack.push(current);
      redoStack.length = 0;
    }
    current = frozenNext;
    revision += 1;
    publish(reason);
    return result(true, true, revision);
  };

  const failure = (error) => result(false, false, revision, {
    name: error.name || 'CommandError', message: error.message || String(error), path: error.path || '',
  });

  return Object.freeze({
    getSnapshot() { return current; },
    getRevision() { return revision; },
    dispatch(command) {
      try {
        const next = structuredClone(current);
        applyCommand(next, cloneJson(command));
        return commit(validateDocument(next), 'dispatch', true);
      } catch (error) {
        return failure(error);
      }
    },
    undo() {
      if (undoStack.length === 0) return result(true, false, revision);
      const previous = undoStack.pop();
      redoStack.push(current);
      current = previous;
      revision += 1;
      publish('undo');
      return result(true, true, revision);
    },
    redo() {
      if (redoStack.length === 0) return result(true, false, revision);
      const next = redoStack.pop();
      undoStack.push(current);
      current = next;
      revision += 1;
      publish('redo');
      return result(true, true, revision);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return false;
        subscribed = false;
        return listeners.delete(listener);
      };
    },
  });
}
