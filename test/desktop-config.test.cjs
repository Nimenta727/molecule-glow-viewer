const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

test('Electron packaging keeps the HTML entrypoint and Windows targets', () => {
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.equal(pkg.build.files.includes('index.html'), true);
  assert.deepEqual(pkg.build.win.target, ['nsis', 'portable']);
  assert.equal(fs.existsSync(path.join(root, pkg.main)), true);
});

test('desktop wrapper uses isolated, non-Node renderer settings', () => {
  const main = fs.readFileSync(path.join(root, pkg.main), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /loadFile\(INDEX_PATH\)/);
});
