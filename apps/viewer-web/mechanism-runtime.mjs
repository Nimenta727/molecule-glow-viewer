import { resolveMechanism } from '../../plugins/mechanism-catalog.mjs';
import { toolEntryFor, readPlayerState } from './work-scene.mjs';

// Adapter only: the loaded scene owns prepared resources and the existing player handle.
// No parallel scene, timing or simulation state is introduced here.
export function createMechanismRuntime(host, { loadAccession, onProgress = () => {} }) {
  // A v3 work names its player in scene.tools; scenes that only carry a legacy declaration keep working through the catalog.
  const playerIdOf = (scene) => scene.tools?.find((entry) => host.getPlayer(entry.tool.id))?.tool.id ?? resolveMechanism(scene);
  function createPlayer(loaded, state) {
    if (!loaded.model) return;
    loaded.playerId = playerIdOf(loaded.scene);
    const factory = host.getPlayer(loaded.playerId);
    if (!factory) return;
    try {
      // The work's own configuration (scene.tools) and saved state; old scenes fall back to the built-in default and the asset's playback.
      return factory.create({ ...loaded.playerInputs?.get(loaded.playerId), model: loaded.model, scene: loaded.scene,
        state: state ?? readPlayerState(loaded.scene, loaded.playerId), config: toolEntryFor(loaded.scene, loaded.playerId)?.config });
    } catch (error) {
      loaded.warnings = [...loaded.warnings, `机制播放器无法启动。 ${error.message}`];
    }
  }
  async function preparePlayer(loaded, signal) {
    const id = playerIdOf(loaded.scene), factory = host.getPlayer(id);
    if (!loaded.model || !factory?.prepare) return;
    try {
      onProgress('正在准备机制构象坐标…');
      const prepared = await factory.prepare({ loaded, signal, loadAccession, config: toolEntryFor(loaded.scene, id)?.config,
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
