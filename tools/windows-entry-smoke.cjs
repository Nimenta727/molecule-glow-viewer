const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const electron = path.join(repo, 'desktop/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const stage = execFileSync(process.execPath, ['desktop/scripts/package-platform.cjs', '--stage-only'], {
  cwd: repo, encoding: 'utf8',
}).trim().split(/\r?\n/).at(-1);
const probes = [
  ['viewer.html', '?startup=skip', `(async () => {
    document.querySelector('#four-modes-example').click();
    for (let i = 0; i < 50 && document.querySelector('#navigation-heading').dataset.mode !== 'cell'; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { path: location.pathname, mode: document.querySelector('#navigation-heading').dataset.mode };
  })()`, { path: '/apps/viewer-web/index.html', mode: 'cell' }],
  ['studio.html', '?startup=skip', `(async () => {
    document.querySelector('#add-box').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    return { path: location.pathname, viewTarget: document.querySelector('#view-target').selectedOptions[0].text };
  })()`, { path: '/apps/studio-web/index.html', viewTarget: '方盒' }],
  ['index.html', '?ws=local-test&startup=skip&q=low', `(async () => {
    const file = document.querySelector('#file');
    const transfer = new DataTransfer();
    const pdb = [0, 3.8, 7.6, 11.4].map((x, index) =>
      'ATOM  ' + String(index + 1).padStart(5) + '  CA  GLY A' + String(index + 1).padStart(4) + '    ' +
      x.toFixed(3).padStart(8) + '   0.000   0.000  1.00  0.00           C').join('\\n');
    transfer.items.add(new File([pdb + '\\nEND\\n'], 'windows-test.pdb'));
    file.files = transfer.files;
    file.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 50 && !window.__viewer.groups().length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const style = document.querySelector('#bgMode');
    style.value = 'dark';
    style.dispatchEvent(new Event('change'));
    const saved = window.__viewer.packs.packFromCurrent();
    const probe = await window.__viewer.probe(0.1);
    return { path: location.pathname, residues: probe.residues, exported: saved.scene.structure.name, style: style.value };
  })()`, { path: '/index.html', residues: 4, exported: 'windows-test.pdb', style: 'dark' }],
];

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-package-smoke-'));
try {
  const script = path.join(temporary, 'probe.js');
  for (const [page, query, probe, expected] of probes) {
    fs.writeFileSync(script, probe);
    const result = spawnSync(electron, [stage, `--user-data-dir=${path.join(temporary, 'profile')}`], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, GLOW_PAGE: page, GLOW_QUERY: query, GLOW_SMOKE: '8', GLOW_SMOKE_JS: script },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith('[smoke-js] '));
    assert.ok(line, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(line.slice('[smoke-js] '.length)), expected);
    console.log(`${page}: ok`);
  }
} finally {
  fs.unlinkSync(path.join(temporary, 'probe.js'));
}
