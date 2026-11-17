# Core document prototype

The public entry is `packages/core/index.mjs`. `createDocument(assets, nodes, timeline)` creates the `glow-prototype` v1 shape; `validateDocument(document)` returns a detached normalized copy or throws `DocumentValidationError` with a `.path`. `createDocumentStore(document)` validates its initial input and throws on invalid initial data.

Store semantics:

- `getSnapshot()` returns the current deeply frozen snapshot. `getRevision()` returns a monotonic revision starting at zero.
- `dispatch(command)` returns `{ ok, changed, revision }` on success, or `{ ok: false, changed: false, revision, error: { name, message, path } }` for invalid commands or resulting documents. Errors do not throw from dispatch and leave the snapshot and history unchanged.
- Supported commands are `{ type: 'addAsset', asset }`, `{ type: 'updateAsset', id, patch }`, `{ type: 'addNode', node }`, `{ type: 'updateNode', id, patch }`, `{ type: 'removeNode', id }`, `{ type: 'setTimeline', timeline }`, and `{ type: 'batch', commands }`. Asset and node IDs/kinds cannot be changed by updates; primitive asset updates accept only `shape` and `color`. Subtree deletion removes associated timeline tracks. `setTimeline` replaces the whole timeline. Batches apply sequentially to a private copy, validate the final document, and publish at most one history entry and notification, so adding an asset and a node that references it can be one reversible operation. Nested batches are rejected.
- Successful no-op edits return `changed: false` and do not affect history or revision. `undo()` / `redo()` use the same result shape and increment revision only when they change state. A new successful edit after undo clears the redo branch.
- `subscribe(listener)` calls the listener as `(snapshot, { reason, revision })` after each committed dispatch, undo, or redo. It does not call immediately. It returns an idempotent unsubscribe function.

Snapshots validate JSON-compatible finite data, unique stable asset/node IDs, primitive definitions and geometry references, parent/asset/track references, acyclic parent chains, local transforms, and strictly increasing in-range keyframes. Geometry bytes stay with the format and rendering adapters. Positions are meters and transforms use position (3), normalized XYZW quaternion (4), and positive scale (3). The timeline duration and keyframe times are seconds.

Run the focused Core tests from the repository root:

```sh
node --test packages/core/test/*.test.mjs
```
