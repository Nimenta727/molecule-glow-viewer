/* Shared scoped postMessage policy. Local window.glow stays available to the workbench. */
const BRIDGE_ON = params.get('embed') === '1' || params.get('dev') === '1';
const detachClassicBridge = attachScopedCommandBridge(window, glow, {
  commands: Object.keys(GLOW_CMDS), getSceneToken: () => current, allowControlFromOtherHttps: true,
});
addEventListener('pagehide', event => { if (!event.persisted) detachClassicBridge(); });
if (params.get('embed') === '1') { document.body.classList.add('embed'); $('panel').classList.add('hidden'); }
