# Platform 2.0 Core contracts

These decisions cover the P1 prototype. The [architecture roadmap](PLATFORM_2_0_REFACTOR_PLAN.md) assigns published schemas and packaging to P2.

## ADR-001 · Core and application boundaries

Viewer and Studio consume the same ES module entry point at `packages/core/index.mjs`. Core owns document validation, edits, selection identifiers, resources and playback. It runs in Node tests without a canvas, DOM, browser storage or network. Application adapters own user input, file pickers and Three.js objects. Dependencies flow from apps and adapters into Core. The legacy build continues through `src/index.html.tpl`.

The renderer builds its scene from document snapshots and receives separate playback poses. A pick resolves to the stable node ID. The document remains the source of saved transforms. P1 renders built-in box and sphere meshes with a basic color. The pinned Three.js version follows the legacy viewer during this prototype.

## ADR-002 · Scene document and units

The prototype document is JSON data with `format: "glow-prototype"`, `version: 1`, `assets`, `nodes` and `timeline`. This format is an internal local-file fixture. P2 adopts the independently versioned published format and connects the v1 compatibility adapter.

Assets and nodes have stable, unique string IDs within their respective collections. A node stores `id`, `name`, `parentId`, `assetId`, `visible` and `transform`. Root nodes use `parentId: null`. Group nodes use `assetId: null`. Parents and assets must resolve when a document is accepted. Every ancestry chain ends at a root.

Assets use `{ id, kind: "primitive", shape, color }` with shape `box` or `sphere`, and an sRGB `#rrggbb` color. Transforms are local to the parent. They use `{ position, rotation, scale }` with three finite position coordinates, a normalized quaternion in XYZW order and three positive finite scale factors. The prototype uses right-handed coordinates and meters for scene positions.

The timeline is `{ duration, tracks }` with times in seconds. Each track stores `{ nodeId, keyframes }` and each keyframe stores `{ time, transform }`. A node has at most one track. Times are strictly increasing within a track and run from zero up to the duration. Position and scale interpolate linearly. Quaternion interpolation follows the shortest path. A track samples its first or last keyframe outside the keyed interval. Sampling a pose leaves the saved document intact.

## ADR-006 · Edit history and scene lifetime

Use `createDocumentStore(document)` with `getSnapshot()`, `dispatch(command)`, `undo()`, `redo()` and `subscribe(listener)`. P1 commands are plain data for adding or updating a node, removing a subtree, and batching existing commands. An update preserves the node ID. Subtree removal also removes its animation tracks. A batch validates its resulting document and publishes at most one edit and one undo entry. A rejected edit changes neither the visible snapshot nor the history. A successful edit following undo invalidates the redo branch.

Build and validate a replacement scene in a separate resource scope. Commit it only if the load is still current, then dispose the previous scene. Advancing the load cancels pending work via `AbortSignal`. Scene close and adapter disposal are idempotent. File parse, validation and preparation errors are shown in the app while the current scene remains available.
