// Application-owned allow-list; never populated from scene package code.
import { atpSynthasePlugin, ATP_PLAYER } from './atp-synthase/index.mjs';
import { kcsaPlugin, KCSA_PLAYER } from './kcsa/index.mjs';
export const mechanismPlugins = [atpSynthasePlugin, kcsaPlugin];
export const mechanismPlayers = Object.freeze({ atpSynthase: ATP_PLAYER, kcsa: KCSA_PLAYER });
