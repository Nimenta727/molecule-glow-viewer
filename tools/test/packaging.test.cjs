const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkStage } = require('../check-platform-stage.cjs');
const { sha256 } = require('../../desktop/scripts/stage-manifest.cjs');
const { resolveEntry } = require('../../desktop/platform-shell.cjs');
function fixture(t) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-stage-test-'));
  t.after(() => {
    const target = fs.realpathSync(stage);
    if (path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith('glow-stage-test-')) throw new Error('Unsafe test cleanup target');
    fs.rmSync(target, { recursive: true, force: true });
  });
  const put = (name, text) => { const file = path.join(stage, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  for (const entry of ['index.html', 'dev.html', 'apps/studio-web/index.html']) put('app/' + entry, '<html></html>');
  put('app/apps/viewer-web/index.html', '<script type="module" src="./main.mjs"></script>');
  put('app/apps/viewer-web/main.mjs', "import '../../plugins/mechanism-catalog.mjs';");
  put('app/plugins/mechanism-catalog.mjs', "export { player } from './kcsa/index.mjs';");
  put('app/plugins/kcsa/index.mjs', 'export const player = {};');
  for (const name of ['main.js', 'preload.js', 'platform-shell.cjs', 'smoke-runner.cjs']) put(name, 'void 0;');
  put('build-info.json', JSON.stringify({ files: [], contentSha256: sha256('[]') }));
  return { stage, put };
}
test('classic is the temporary default while explicit platform launch parameters are retained', () => {
  assert.equal(resolveEntry(), 'index.html');
  assert.equal(resolveEntry('viewer.html'), 'apps/viewer-web/index.html');
  assert.equal(resolveEntry('studio.html'), 'apps/studio-web/index.html');
  assert.equal(resolveEntry('dev.html'), 'dev.html');
  assert.equal(resolveEntry('../escape.html'), 'index.html');
});
test('stage graph fails for missing catalog and transitive mechanism dependencies', (t) => {
  const { stage } = fixture(t); assert.equal(checkStage(stage).ok, true);
  fs.unlinkSync(path.join(stage, 'app/plugins/kcsa/index.mjs'));
  assert.throws(() => checkStage(stage), /Missing or escaped/);
});
test('stage graph rejects escaped imports, unresolved dynamic literals and content tampering', (t) => {
  const { stage, put } = fixture(t);
  put('app/apps/viewer-web/main.mjs', "await import('./missing.mjs');");
  assert.throws(() => checkStage(stage), /missing.mjs/);
  put('app/apps/viewer-web/main.mjs', "import '../../../../outside.mjs';");
  assert.throws(() => checkStage(stage), /Missing or escaped/);
  put('app/apps/viewer-web/main.mjs', '');
  put('build-info.json', JSON.stringify({ files: [{ path: 'main.js', sha256: 'incorrect' }], contentSha256: sha256(JSON.stringify([{ path: 'main.js', sha256: 'incorrect' }])) }));
  assert.throws(() => checkStage(stage), /content hash mismatch/);
});
test('remote module script and missing CommonJS helper block the candidate', (t) => {
  const { stage, put } = fixture(t);
  put('app/apps/viewer-web/index.html', '<script type="module" src="https://example.org/missing.mjs"></script>');
  assert.throws(() => checkStage(stage), /Unbundled remote/);
  put('app/apps/viewer-web/index.html', '<html></html>');
  put('main.js', "require('./missing-helper.cjs');");
  assert.throws(() => checkStage(stage), /missing-helper/);
});
