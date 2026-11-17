/* =============================================================================
   window.glow: COMMAND API for developers, scripts and AI agents (small, like ChimeraX commands / the Mol* plugin API)
   - JSON in, JSON out; every command is async and returns plain data. glow.help() lists them with their arguments.
   - Same commands from another window: postMessage({ glow: 'cmd', id, cmd, args }) -> { glow: 'reply', id, ok, result | error }.
     Full access only for EMBED_ORIGINS (or the same origin with ?dev=1); other https pages get BRIDGE_SAFE after the viewer's user allows it.
   - Commands run one after another (a queue), and each is logged in glow.log (last 200): glow.replay(glow.log) repeats a session.
   - Scenes from outside go in only as packs, through sanitizePack (escaped text, built-in processes only) — never raw configs.
   ============================================================================= */
const GLOW_API = 1;
/* allowed download sources for glow.load({url}) (X2) */
const URL_OK = (U0) => U0.protocol === 'https:' && (U0.href.startsWith(WS_BASE) || U0.host === 'files.rcsb.org' || U0.host === 'alphafold.ebi.ac.uk') || (U0.origin === location.origin && location.origin !== 'null');
/* exact preset name / key / alias only (the panel's fuzzy presetKey would open a random preset for load('a')) */
const presetExact = (q) => presetName(q);   /* API: exact key (or the exact display name); no fuzzy matching */
class CmdError extends Error {}
const glowSel = { expr: 'none', r: [], l: [] };   /* the last selection: color / camera focus default to it ('sele') */
