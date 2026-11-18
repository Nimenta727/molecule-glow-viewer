// The only bridge between the viewer page and the desktop shell. The viewer checks `window.glowDesktop`
// to know it is running as the app (the same index.html also runs on the web).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glowDesktop', {
  version: '0.3.2',
  startupSkip: Boolean(process.env.GLOW_SMOKE || process.env.GLOW_REGRESS),
  cacheInfo: () => ipcRenderer.invoke('glow:cache-info'),
  clearCache: () => ipcRenderer.invoke('glow:cache-clear'),
});
