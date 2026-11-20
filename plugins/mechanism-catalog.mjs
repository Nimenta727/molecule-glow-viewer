// Application-owned allow-list; never populated from scene package code.
import { atpSynthasePlugin, ATP_PLAYER } from './atp-synthase/index.mjs';
import { kcsaPlugin, KCSA_PLAYER } from './kcsa/index.mjs';
import { adenylateKinasePlugin, ADK_PLAYER } from './adenylate-kinase/index.mjs';
import { ADK_4AKE_TEMPLATE } from './adenylate-kinase/config.mjs';
import { ATP_6ZPO_TEMPLATE } from './atp-synthase/config.mjs';
import { KCSA_1K4C_TEMPLATE } from './kcsa/config.mjs';
import { atpToolDescriptor, ATP_TOOL } from './atp-synthase/tool.mjs';
import { adkToolDescriptor, ADK_TOOL } from './adenylate-kinase/tool.mjs';
import { kcsaToolDescriptor, KCSA_TOOL } from './kcsa/tool.mjs';
import { motionPlugin } from './motion/index.mjs';
import { SOLUTION_TOOL } from './motion/solution-tool.mjs';
import { simulationPlugin } from './simulation/index.mjs';
import { DATA_TOOL, normalizeDataConfig } from './simulation/data-tool.mjs';
import { autoBindings } from '../packages/plugin-host/tool-model.mjs';
export const mechanismPlugins = [atpSynthasePlugin, kcsaPlugin, adenylateKinasePlugin];
/** Plugins that offer tools other than the mechanism players. They follow the structure plugin (both front ends activate them with it). */
export const toolPlugins = [motionPlugin, simulationPlugin];
export { SOLUTION_TOOL, DATA_TOOL };
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
// A player's tool id (what new works name) and descriptor (for applicability and bindings).
const TOOLS = {
  [ATP_PLAYER]: [ATP_TOOL, atpToolDescriptor], [KCSA_PLAYER]: [KCSA_TOOL, kcsaToolDescriptor], [ADK_PLAYER]: [ADK_TOOL, adkToolDescriptor],
};

/**
 * The `tools` entries a scene should carry. For a scene that declares one of the built-in mechanisms (legacy `process`,
 * or the adenylate-kinase pair) this is that player with its full default configuration, so the configuration
 * travels with the work and reopens identically even if the built-in template changes later.
 */
/** Display name of one of the built-in tools by id (new id or old player id), without needing its plugin to be active. */
export function toolTitle(id) {
  if (id === SOLUTION_TOOL) return '溶液粒子与流';
  if (id === DATA_TOOL) return '数据反应动画';
  for (const [player, [toolId, describe]] of Object.entries(TOOLS)) if (id === toolId || id === player) return describe('1.0.0', player).title;
  return id;
}

/** The id of the tool a scene's legacy mechanism declaration stands for, or undefined when it declares none. */
export function toolIdForScene(scene) {
  const id = resolveMechanism(scene);
  return id && TOOLS[id] ? TOOLS[id][0] : undefined;
}

/**
 * The data animation entry of a scene that carries a classic `animation` declaration (plain data: compartments, pools, flows, reactions). The declaration
 * and the classic scene's axis and membrane placement become the tool's configuration; a declaration the engine cannot run is left out (the scene keeps it
 * in its legacy block).
 */
export function dataAnimationEntry(scene) {
  const legacy = scene.legacy?.scene, animation = legacy?.animation;
  if (!animation || typeof animation !== 'object') return undefined;
  try {
    const config = normalizeDataConfig({ animation, axis: legacy.axis, membranes: legacy.membranes ?? (Number.isFinite(legacy.memY) ? [{ at: '', offset: legacy.memY }] : []), seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7 });
    return { id: 'data-animation', tool: { id: DATA_TOOL, version: simulationPlugin.manifest.version }, config };
  } catch { return undefined; }
}

export function toolEntriesForScene(scene) {
  const data = dataAnimationEntry(scene);
  return [...mechanismEntriesForScene(scene), ...(data ? [data] : [])];
}

function mechanismEntriesForScene(scene) {
  const id = resolveMechanism(scene);
  const plugin = mechanismPlugins.find(({ manifest }) => manifest.id === id);
  if (!plugin || !TEMPLATES[id]) return [];
  const [toolId, describe] = TOOLS[id], version = plugin.manifest.version;
  const entry = { id: TEMPLATES[id].id, tool: { id: toolId, version }, config: JSON.parse(JSON.stringify(TEMPLATES[id])) };
  // The tool's own proposal for which nodes it works on is written into the work, so reopening never depends on name matching.
  const bindings = autoBindings(describe(version, id), scene, entry);
  return [Object.keys(bindings).length ? { ...entry, bindings } : entry];
}
