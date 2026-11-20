// Application-owned allow-list; never populated from scene package code.
import { atpSynthasePlugin, ATP_PLAYER } from './atp-synthase/index.mjs';
import { kcsaPlugin, KCSA_PLAYER } from './kcsa/index.mjs';
import { adenylateKinasePlugin, ADK_PLAYER } from './adenylate-kinase/index.mjs';
import { ADK_4AKE_TEMPLATE } from './adenylate-kinase/config.mjs';
import { ATP_6ZPO_TEMPLATE } from './atp-synthase/config.mjs';
import { KCSA_1K4C_TEMPLATE } from './kcsa/config.mjs';
export const mechanismPlugins = [atpSynthasePlugin, kcsaPlugin, adenylateKinasePlugin];
export const mechanismPlayers = Object.freeze({ atpSynthase: ATP_PLAYER, kcsa: KCSA_PLAYER });

export function resolveMechanism(scene) {
  const config = scene.legacy?.scene;
  if (config?.process) return mechanismPlayers[config.process];
  const { open, closed } = ADK_4AKE_TEMPLATE.states;   // legacy declaration -> the AdK work template (opening and closing reference states)
  if (config?.id === open && config.states?.length === 2 && config.states[0] === open && config.states[1] === closed &&
      !config.components?.length) return ADK_PLAYER;
}

// The work configuration each built-in player starts from, keyed by player id (legacy declaration -> template).
const TEMPLATES = { [ATP_PLAYER]: ATP_6ZPO_TEMPLATE, [KCSA_PLAYER]: KCSA_1K4C_TEMPLATE, [ADK_PLAYER]: ADK_4AKE_TEMPLATE };

/**
 * The `tools` entries a scene should carry. For a scene that declares one of the built-in mechanisms (legacy `process`,
 * or the adenylate-kinase pair) this is that player with its full default configuration, so the configuration
 * travels with the work and reopens identically even if the built-in template changes later.
 */
export function toolEntriesForScene(scene) {
  const id = resolveMechanism(scene);
  const plugin = mechanismPlugins.find(({ manifest }) => manifest.id === id);
  if (!plugin || !TEMPLATES[id]) return [];
  return [{ id: TEMPLATES[id].id, tool: { id, version: plugin.manifest.version }, config: JSON.parse(JSON.stringify(TEMPLATES[id])) }];
}
