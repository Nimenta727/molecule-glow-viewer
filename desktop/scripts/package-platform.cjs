const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'desktop/dist');
fs.mkdirSync(dist, { recursive: true });
const stage = fs.mkdtempSync(path.join(dist, 'platform-stage-'));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
function put(name, content) {
  const file = path.join(stage, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function copy(from, to) {
  const dest = path.join(stage, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(root, from), dest, {
    recursive: true,
    filter: (file) => !['test', 'tests'].includes(path.basename(file)),
  });
}
function replaceOnce(text, before, after) {
  if (!text.includes(before)) throw new Error('Packaging anchor missing: ' + before);
  return text.replace(before, after);
}
execFileSync(process.execPath, ['desktop/scripts/sync.js'], { cwd: root, stdio: 'inherit' });
copy('desktop/vendor/three', 'vendor/three');
copy('desktop/node_modules/three/LICENSE', 'vendor/three/LICENSE');
copy('desktop/preload.js', 'preload.js');
copy('desktop/scripts/regress-scenes.json', 'scripts/regress-scenes.json');
copy('LICENSE', 'LICENSE');
copy('web/index.html', 'app/index.html');
copy('web/dev.html', 'app/dev.html');
copy('web/index.html', 'app/web/index.html');
copy('web/dev.html', 'app/web/dev.html');
for (const name of ['apps/studio-web', 'apps/viewer-web', 'packages/core', 'packages/legacy-compat', 'packages/plugin-host', 'packages/render-three', 'packages/schema', 'packages/studio-editor', 'plugins/rcsb', 'plugins/structure']) copy(name, 'app/' + name);
for (const name of ['src/styles/startup.css', 'src/ui/startup.js', 'src/pack/rules.js', 'src/data/presets.js']) copy(name, 'app/' + name);
copy('node_modules/@cfworker/json-schema/dist/esm', 'app/vendor/json-schema');
for (const name of ['LICENSE', 'NOTICES']) {
  put('app/vendor/json-schema/' + name + '.md', fs.readFileSync(path.join(root, 'desktop/licenses/cfworker-' + name + '.md')));
}
copy('node_modules/@zip.js/zip.js/index-native.min.js', 'app/vendor/zip/index-native.min.js');
copy('node_modules/@zip.js/zip.js/LICENSE', 'app/vendor/zip/LICENSE');
for (const entry of ['studio-web', 'viewer-web']) {
  const name = 'apps/' + entry + '/index.html';
  put('app/' + name, read(name)
    .replace('../../node_modules/@cfworker/json-schema/dist/esm/index.js', '../../vendor/json-schema/index.js')
    .replace('../../node_modules/@zip.js/zip.js/index-native.min.js', '../../vendor/zip/index-native.min.js'));
}
let main = read('desktop/main.js');
main = replaceOnce(main, 'const { app, BrowserWindow,', 'const { app, BrowserWindow, Menu,');
main = replaceOnce(main, "const MIME = {", "const MIME = { '.mjs': 'text/javascript; charset=utf-8',");
main = replaceOnce(main, 'function createWindow() {', `const MODE_PAGES = new Map([
  ['经典 Viewer', 'index.html'],
  ['新版 Viewer', 'apps/viewer-web/index.html'],
  ['Studio 制作台', 'apps/studio-web/index.html'],
  ['开发者工作台', 'dev.html'],
]);
function createWindow() {`);
main = replaceOnce(main, 'autoHideMenuBar: true,', 'autoHideMenuBar: false,');
main = replaceOnce(main,
  "  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });",
  `  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    else if (['app://glow/web/', 'app://glow/web/index.html'].includes(url)) setImmediate(() => win.loadURL('app://glow/index.html'));
    return { action: 'deny' };
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '工作区', submenu: [
      ...[...MODE_PAGES].map(([label, page]) => ({ label, click: () => win.loadURL('app://glow/' + page) })),
      { type: 'separator' }, { label: '退出', role: 'quit' },
    ] },
    { label: '编辑', submenu: ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map(role => ({ role })) },
    { label: '窗口', submenu: [{ role: 'togglefullscreen' }, { role: 'minimize' }] },
  ]));`);
main = replaceOnce(main, "  win.loadURL('app://glow/' + page +", "  const entry = page === 'studio.html' ? MODE_PAGES.get('Studio 制作台') : page === 'viewer.html' || (!process.env.GLOW_PAGE && !process.env.GLOW_QUERY && !process.env.GLOW_SMOKE && !process.env.GLOW_REGRESS) ? MODE_PAGES.get('新版 Viewer') : page;\n  win.loadURL('app://glow/' + entry +");
main = replaceOnce(main, "    const f = inside(APP_DIR, rel);", "    const f = inside(APP_DIR, rel.endsWith('/') ? rel + 'index.html' : rel);");
put('main.js', main);
const original = JSON.parse(read('desktop/package.json'));
const { name, version, description, license, author } = original;
put('package.json', JSON.stringify({ name, version, description, license, author, main: 'main.js' }, null, 2));
put('builder.json', JSON.stringify({
  ...original.build,
  artifactName: 'MoleculeGlow-' + version + '-win-x64.exe',
  electronVersion: JSON.parse(read('desktop/node_modules/electron/package.json')).version,
  electronDist: path.join(root, 'desktop/node_modules/electron/dist'),
  npmRebuild: false,
  directories: { output: path.join(root, 'desktop/dist/release') },
  files: ['main.js', 'preload.js', 'scripts/regress-scenes.json', 'app/**', 'vendor/**', 'LICENSE', 'package.json'],
}, null, 2));

execFileSync(process.execPath, [
  path.join(root, 'desktop/node_modules/electron-builder/out/cli/cli.js'),
  '--projectDir', stage, '--config', 'builder.json', '--win', 'portable', '--x64', '--publish', 'never',
], { cwd: root, stdio: 'inherit' });
