const fs = require('node:fs');
const path = require('node:path');
const WORKSPACES = [
  ['经典 Viewer', 'index.html'], ['新版 Viewer', 'apps/viewer-web/index.html'],
  ['Studio 制作台', 'apps/studio-web/index.html'], ['开发者工作台', 'dev.html'],
];
function resolveEntry(page) {
  const aliases = { 'viewer.html': 'apps/viewer-web/index.html', 'studio.html': 'apps/studio-web/index.html' };
  const entry = Object.hasOwn(aliases, page) ? aliases[page] : page;
  return WORKSPACES.some(([, value]) => value === entry) ? entry : 'index.html';
}
function readBuildInfo(root) {
  const file = path.join(root, 'build-info.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: require('./package.json').version, kind: 'development' };
}
function configureWorkspaces(win, root, buildInfo) {
  const { Menu, dialog } = require('electron');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '工作区', submenu: WORKSPACES.map(([label, page]) => ({ label,
      enabled: fs.existsSync(path.join(root, 'app', page)), click: () => win.loadURL('app://glow/' + page) })) },
    { label: '编辑', submenu: ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map((role) => ({ role })) },
    { label: '窗口', submenu: [{ role: 'togglefullscreen' }, { role: 'minimize' }, { role: 'quit' }] },
    { label: '帮助', submenu: [{ label: '版本与构建', click: () => dialog.showMessageBox(win, {
      type: 'info', title: '分子光影 · 版本与构建', message: `分子光影 ${buildInfo.version}`,
      detail: `构建类型：${buildInfo.kind}\n源码提交：${buildInfo.sourceCommit ?? 'development'}${buildInfo.sourceDirty ? '（含工作区改动）' : ''}\n内容哈希：${buildInfo.contentSha256 ?? 'development'}\n构建时间：${buildInfo.createdAt ?? 'development'}\n功能迁移仍在进行；源码功能不等于旧版已发行 EXE 的功能。`,
    }) }] },
  ]));
}
module.exports = { WORKSPACES, resolveEntry, readBuildInfo, configureWorkspaces };
