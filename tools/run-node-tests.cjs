const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), files = [];
function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) visit(file);
    else if (/\.test\.(?:mjs|cjs)$/.test(item.name)) files.push(file);
  }
}
visit(path.join(root, 'apps/viewer-web/test')); visit(path.join(root, 'tools/test'));
for (const parent of ['packages', 'plugins']) for (const entry of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
  if (entry.isDirectory()) visit(path.join(root, parent, entry.name, 'test'));
}
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...files.sort()], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
