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
    filter: (file) => !['test', 'tests'].includes(path.basename(file)) && !file.endsWith('.d.ts'),
  });
}
execFileSync(process.execPath, ['desktop/scripts/sync.js'], { cwd: root, stdio: 'inherit' });
copy('desktop/vendor/three', 'vendor/three');
copy('desktop/node_modules/three/LICENSE', 'vendor/three/LICENSE');
copy('desktop/preload.js', 'preload.js');
copy('desktop/platform-shell.cjs', 'platform-shell.cjs');
copy('desktop/response-cache.cjs', 'response-cache.cjs');
copy('desktop/network-policy.cjs', 'network-policy.cjs');
copy('desktop/smoke-runner.cjs', 'smoke-runner.cjs');
copy('desktop/scripts/regress-scenes.json', 'scripts/regress-scenes.json');
copy('LICENSE', 'LICENSE');
copy('web/index.html', 'app/index.html');
copy('web/dev.html', 'app/dev.html');
copy('web/index.html', 'app/web/index.html');
copy('web/dev.html', 'app/web/dev.html');
// Copy official plugin source as a unit. Execution remains restricted to the application-owned catalog.
for (const name of ['apps/studio-web', 'apps/viewer-web', 'packages/core', 'packages/legacy-compat', 'packages/plugin-host', 'packages/render-three', 'packages/schema', 'packages/studio-editor', 'plugins']) copy(name, 'app/' + name);
for (const name of ['src/styles/startup.css', 'src/ui/startup.js', 'src/api/embed-permissions.js', 'src/pack/rules.js', 'src/data/presets.js']) copy(name, 'app/' + name);
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
copy('desktop/main.js', 'main.js');
const original = JSON.parse(read('desktop/package.json'));
const { name, version, description, license, author } = original;
put('package.json', JSON.stringify({ name, version, description, license, author, main: 'main.js' }, null, 2));
const buildInfo = require('./stage-manifest.cjs').writeManifest(root, stage, version);
const artifactName = `MoleculeGlow-${version}-${buildInfo.sourceCommit.slice(0, 8)}${buildInfo.sourceDirty ? '-worktree' : ''}-win-x64.exe`;
put('builder.json', JSON.stringify({
  ...original.build,
  artifactName,
  electronVersion: JSON.parse(read('desktop/node_modules/electron/package.json')).version,
  electronDist: path.join(root, 'desktop/node_modules/electron/dist'),
  npmRebuild: false,
  directories: { output: path.join(root, 'desktop/dist/release') },
  files: ['main.js', 'preload.js', 'platform-shell.cjs', 'response-cache.cjs', 'network-policy.cjs', 'smoke-runner.cjs', 'build-info.json', 'scripts/regress-scenes.json', 'app/**', 'vendor/**', 'LICENSE', 'package.json'],
}, null, 2));
execFileSync(process.execPath, ['--experimental-vm-modules', 'tools/check-platform-stage.cjs', stage], { cwd: root, stdio: 'inherit' });

if (process.argv.includes('--stage-only')) {
  console.log(stage);
} else {
  execFileSync(process.execPath, [
    path.join(root, 'desktop/node_modules/electron-builder/out/cli/cli.js'),
    '--projectDir', stage, '--config', 'builder.json', '--win', 'portable', '--x64', '--publish', 'never',
  ], { cwd: root, stdio: 'inherit' });
  const candidate = path.join(root, 'desktop/dist/release', artifactName);
  fs.writeFileSync(path.join(root, 'desktop/dist/release/candidate.json'), JSON.stringify({ file: artifactName,
    bytes: fs.statSync(candidate).size, sha256: require('./stage-manifest.cjs').sha256(fs.readFileSync(candidate)),
    sourceCommit: buildInfo.sourceCommit, sourceDirty: buildInfo.sourceDirty, contentSha256: buildInfo.contentSha256 }, null, 2));
}
