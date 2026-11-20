import { upgradeSceneToV3, attachStructureResources } from '../../packages/schema/migrate.mjs';
import { toolEntriesForScene } from '../../plugins/mechanism-catalog.mjs';

import { autoBindings } from '../../packages/plugin-host/tool-model.mjs';

/**
 * The tool entry of a scene for a tool id, if the scene carries one. `resolve` maps any id the host knows (the tool's id,
 * an earlier alias or its player id) to one canonical id, so a work saved under an old name is still found.
 */
export const toolEntryFor = (scene, toolId, resolve = (id) => id) => {
  const wanted = resolve(toolId);
  return scene?.tools?.find((entry) => resolve(entry.tool.id) === wanted);
};

/**
 * Gives every tool entry that has no saved bindings the tool's own proposal, and keeps it in the scene. Returns true when
 * something was written. Entries whose tool is not registered are left alone.
 */
export function completeBindings(scene, getTool) {
  let changed = false;
  for (const entry of scene.tools ?? []) {
    const tool = getTool(entry.tool.id);
    if (!tool?.inputs || entry.bindings) continue;
    const bindings = autoBindings(tool, scene, entry);
    if (Object.keys(bindings).length) { entry.bindings = bindings; changed = true; }
  }
  return changed;
}

/**
 * A template is fully static: it is for looking at the structure and reading the explanation, nothing moves. Opening a pack as a template removes what makes it move (the declared
 * process or built-in mechanism, a data animation, the second conformation of a two-state pair) before the scene is prepared, so no tool is attached and no player is created; the
 * structure, its components and layout, the membrane, the part names and colours, the notes and the evidence stay. Returns what was removed (for the status line).
 */
export function makeStaticTemplate(loaded) {
  const config = loaded.scene.legacy?.scene, removed = [];
  if (config && typeof config === 'object') for (const key of ['process', 'animation', 'states', 'energy', 'energyHL']) if (key in config) { removed.push(key); delete config[key]; }
  loaded.isTemplate = true;
  return removed;
}

/**
 * Brings a freshly loaded scene to the current format and gives it the tool configuration of its declared mechanism.
 * v2 scenes are upgraded (nothing is removed); a v3 work that carries no entry for its mechanism gets the default one.
 * Problems with individual resources become warnings; the scene still opens.
 */
export async function prepareWorkScene(loaded) {
  const tools = toolEntriesForScene(loaded.scene);
  const { scene, diagnostics } = await upgradeSceneToV3(loaded.scene, loaded.resources, { tools });
  if (!scene.tools.length && tools.length) scene.tools = tools;
  loaded.scene = scene;
  if (loaded.isTemplate) loaded.scene.tools = [];   // a template carries no tool at all
  for (const { message } of diagnostics) loaded.warnings = [...(loaded.warnings ?? []), message];
}

/** Playback state of the tool (ATP/AdK/KcsA save()): kept in the tool entry; old scenes kept it on the primary structure asset. */
export function readPlayerState(scene, toolId, resolve) {
  return toolEntryFor(scene, toolId, resolve)?.state ?? scene.assets.find((asset) => asset.provenance?.parserVersion)?.provenance?.playback;
}

export function storePlayerState(scene, toolId, state, resolve) {
  const entry = toolEntryFor(scene, toolId, resolve);
  if (entry) {
    entry.state = state;
    const source = scene.assets.find((asset) => asset.provenance?.parserVersion);
    if (source?.provenance?.playback) delete source.provenance.playback;   // the entry is the single place now
    return;
  }
  const source = scene.assets.find((asset) => asset.provenance?.parserVersion);
  if (source) source.provenance.playback = state;
}

export { attachStructureResources };
