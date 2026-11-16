const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.loadFile(INDEX_PATH);
  return win;
}

ipcMain.handle('save-screenshot', async (event, { dataUrl, suggestedName }) => {
  if (!event.senderFrame.url.startsWith('file://')) throw new Error('Untrusted screenshot request');
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Invalid screenshot data');
  }

  const safeName = typeof suggestedName === 'string'
    ? suggestedName.replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'molecule-glow-viewer.png'
    : 'molecule-glow-viewer.png';
  const result = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: safeName,
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return false;

  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));
  return true;
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
