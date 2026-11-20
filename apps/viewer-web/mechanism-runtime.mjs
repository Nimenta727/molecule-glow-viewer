import { resolveMechanism } from '../../plugins/mechanism-catalog.mjs';
import { toolEntryFor, readPlayerState, completeBindings } from './work-scene.mjs';

// Adapter only: the loaded scene owns prepared resources and the existing player handle.
// No parallel scene, timing or simulation state is introduced here.
export function createMechanismRuntime(host, { loadAccession, onProgress = () => {} }) {
  // A v3 work names its player in scene.tools; scenes that only carry a legacy declaration keep working through the catalog.
  const resolve = (id) => host.resolveToolId?.(id) ?? id;
  const playerOf = (entry) => host.getTool?.(entry.tool.id)?.player ?? entry.tool.id;
  const playerIdOf = (scene) => {
    for (const entry of scene.tools ?? []) if (host.getPlayer(playerOf(entry))) return playerOf(entry);
    return resolveMechanism(scene);
  };
  function createPlayer(loaded, state) {
    if (!loaded.model) return;
    loaded.playerId = playerIdOf(loaded.scene);
    const factory = host.getPlayer(loaded.playerId);
    if (!factory) return;
    try {
      // The work's own configuration (scene.tools) and saved state; old scenes fall back to the built-in default and the asset's playback.
      completeBindings(loaded.scene, (id) => host.getTool?.(id));   // a work saved without bindings gets the tool's proposal, kept in the scene
      const entry = toolEntryFor(loaded.scene, loaded.playerId, resolve);
      return factory.create({ ...loaded.playerInputs?.get(loaded.playerId), model: loaded.model, scene: loaded.scene,
        state: state ?? readPlayerState(loaded.scene, loaded.playerId, resolve), config: entry?.config, bindings: entry?.bindings });
    } catch (error) {
      loaded.warnings = [...loaded.warnings, `机制播放器无法启动。 ${error.message}`];
    }
  }
  async function preparePlayer(loaded, signal) {
    const id = playerIdOf(loaded.scene), factory = host.getPlayer(id);
    if (!loaded.model || !factory?.prepare) return;
    try {
      onProgress('正在准备机制构象坐标…');
      const prepared = await factory.prepare({ loaded, signal, loadAccession, config: toolEntryFor(loaded.scene, id, resolve)?.config,
        parse: host.getService('org.glow.structure.model', '1.0.0').parse });
      signal.throwIfAborted();
      loaded.playerInputs ??= new Map();
      loaded.playerInputs.set(id, prepared ?? {});
    } catch (error) {
      signal.throwIfAborted();
      loaded.warnings = [...loaded.warnings, `机制构象准备失败。 ${error.message}`];
    }
  }
  return { createPlayer, preparePlayer };
}
