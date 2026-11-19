// Application-owned allow-list; never populated from scene package code.
import { atpSynthasePlugin, ATP_PLAYER } from './atp-synthase/index.mjs';
import { kcsaPlugin, KCSA_PLAYER } from './kcsa/index.mjs';
import { adenylateKinasePlugin, ADK_PLAYER } from './adenylate-kinase/index.mjs';
import { ADK_4AKE_TEMPLATE } from './adenylate-kinase/config.mjs';
export const mechanismPlugins = [atpSynthasePlugin, kcsaPlugin, adenylateKinasePlugin];
export const mechanismPlayers = Object.freeze({ atpSynthase: ATP_PLAYER, kcsa: KCSA_PLAYER });

export function resolveMechanism(scene) {
  const config = scene.legacy?.scene;
  if (config?.process) return mechanismPlayers[config.process];
  const { open, closed } = ADK_4AKE_TEMPLATE.states;   // legacy declaration -> the AdK work template (opening and closing reference states)
  if (config?.id === open && config.states?.length === 2 && config.states[0] === open && config.states[1] === closed &&
      !config.components?.length) return ADK_PLAYER;
}
