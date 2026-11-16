const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  saveScreenshot(dataUrl, suggestedName) {
    return ipcRenderer.invoke('save-screenshot', { dataUrl, suggestedName });
  }
}));
