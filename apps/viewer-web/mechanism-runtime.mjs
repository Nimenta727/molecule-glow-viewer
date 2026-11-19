import { resolveMechanism } from '../../plugins/mechanism-catalog.mjs';

// Adapter only: the loaded scene owns prepared resources and the existing player handle.
// No parallel scene, timing or simulation state is introduced here.
export function createMechanismRuntime(host, { loadAccession, onProgress = () => {} }) {
  function createPlayer(loaded, state) {
    if (!loaded.model) return;
    loaded.playerId = resolveMechanism(loaded.scene);
    const factory = host.getPlayer(loaded.playerId);
    if (!factory) return;
    try {
      const source = loaded.scene.assets.find(asset => asset.provenance?.parserVersion);
      return factory.create({ ...loaded.playerInputs?.get(loaded.playerId), model: loaded.model, scene: loaded.scene,
        state: state ?? source?.provenance?.playback });
    } catch (error) {
      loaded.warnings = [...loaded.warnings, `机制播放器无法启动。 ${error.message}`];
    }
  }
  async function preparePlayer(loaded, signal) {
    const id = resolveMechanism(loaded.scene), factory = host.getPlayer(id);
    if (!loaded.model || !factory?.prepare) return;
    try {
      onProgress('正在准备机制构象坐标…');
      const prepared = await factory.prepare({ loaded, signal, loadAccession,
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
