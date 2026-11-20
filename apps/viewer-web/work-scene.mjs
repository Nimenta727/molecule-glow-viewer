import { upgradeSceneToV3, attachStructureResources } from '../../packages/schema/migrate.mjs';
import { toolEntriesForScene } from '../../plugins/mechanism-catalog.mjs';

/** The tool entry of a scene for a given tool id (player id), if the scene carries one. */
export const toolEntryFor = (scene, toolId) => scene?.tools?.find((entry) => entry.tool.id === toolId);

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
  for (const { message } of diagnostics) loaded.warnings = [...(loaded.warnings ?? []), message];
}

/** Playback state of the tool (ATP/AdK/KcsA save()): kept in the tool entry; old scenes kept it on the primary structure asset. */
export function readPlayerState(scene, toolId) {
  return toolEntryFor(scene, toolId)?.state ?? scene.assets.find((asset) => asset.provenance?.parserVersion)?.provenance?.playback;
}

export function storePlayerState(scene, toolId, state) {
  const entry = toolEntryFor(scene, toolId);
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
