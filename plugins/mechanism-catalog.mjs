// Application-owned allow-list; never populated from scene package code.
import { atpSynthasePlugin, ATP_PLAYER } from './atp-synthase/index.mjs';
import { kcsaPlugin, KCSA_PLAYER } from './kcsa/index.mjs';
import { adenylateKinasePlugin, ADK_PLAYER } from './adenylate-kinase/index.mjs';
export const mechanismPlugins = [atpSynthasePlugin, kcsaPlugin, adenylateKinasePlugin];
export const mechanismPlayers = Object.freeze({ atpSynthase: ATP_PLAYER, kcsa: KCSA_PLAYER });

export function resolveMechanism(scene) {
  const config = scene.legacy?.scene;
  if (config?.process) return mechanismPlayers[config.process];
  if (config?.id === '4AKE' && config.states?.length === 2 && config.states[0] === '4AKE' && config.states[1] === '1AKE' &&
      !config.components?.length) return ADK_PLAYER;
}
