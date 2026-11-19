const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..');
const manifest = require('./fixtures/structures.json');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Executed inside the actual packaged page; only fixture data is supplied by the test driver.
async function pageProbe(config) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function wait(predicate, label) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      if (document.querySelector('#status')?.textContent.startsWith('无法打开场景')) throw new Error(document.querySelector('#status').textContent);
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timeout: ' + label);
  }
  function inject(selector, name, contents) {
    const transfer = new DataTransfer(); transfer.items.add(new File([contents], name));
    const input = document.querySelector(selector); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const exports = [], original = URL.createObjectURL;
  URL.createObjectURL = (blob) => { exports.push(blob); return original.call(URL, blob); };
  try {
    await wait(() => window.glowDesktop?.buildInfo, 'preload');
    const build = await glowDesktop.buildInfo();
    let result;
    if (config.kind === 'studio') {
      await wait(() => document.querySelector('#status')?.textContent === '新工程已建立。', 'Studio');
      document.querySelector('#add-box').click();
      await wait(() => document.querySelector('#node-name').value === '方盒', 'Studio box');
      document.querySelector('#node-name').value = 'release-probe-box';
      document.querySelector('#inspector').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(() => document.querySelector('#scene-tree').textContent.includes('release-probe-box'), 'Studio edit');
      const count = document.querySelector('#scene-tree').children.length;
      document.querySelector('#save-project').click(); await wait(() => exports.length, 'project saved');
      document.querySelector('#add-sphere').click();
      await wait(() => document.querySelector('#scene-tree').children.length > count, 'Studio changed');
      inject('#project-file', 'release.glow-project', exports[0]);
      await wait(() => document.querySelector('#status').textContent === '工程已打开。', 'project reopened');
      assert(document.querySelector('#scene-tree').children.length === count, 'project node count');
      assert(document.querySelector('#scene-tree').textContent.includes('release-probe-box'), 'project node identity');
      document.querySelector('#export-scene').click(); await wait(() => exports.length >= 2, 'Studio exported');
      result = { projectRoundTrip: true, exportedScene: true, nodes: count };
    } else if (config.kind === 'classic') {
      await wait(() => window.__viewer?.entryFromFile && window.glow, 'classic Viewer');
      assert(location.pathname === '/index.html', 'classic default entry');
      inject('#file', 'release-test.pdb', config.pdb);
      await wait(() => window.__viewer.groups().length && window.__viewer.groups()[0].atoms.length === 4, 'classic file import');
      const saved = window.__viewer.packs.packFromCurrent();
      assert(saved.scene.structure.name === 'release-test.pdb', 'classic embedded source');
      await glow.load({ pack: saved });
      assert(window.__viewer.groups()[0].atoms.length === 4, 'classic reopen');
      result = { defaultClassic: true, importedResidues: 4, roundTrip: true };
    } else {
      await wait(() => window.glow && document.querySelector('#status').textContent === '基础几何示例', 'platform Viewer');
      document.querySelector('#structure-enabled').click();
      await wait(() => !document.querySelector('#rcsb-load').disabled, 'official plugins');
      const name = config.kind === 'local' ? 'release-test.pdb' : `${config.kind}.glow`;
      inject('#file', name, config.kind === 'local' ? config.pdb : config.pack);
      await wait(() => document.querySelector('#status').textContent === name, 'fixture loaded');
      await glow.represent('blob');
      if (config.kind === 'local') {
        const selected = await glow.select({ chainId: 'A', residueId: '2' });
        assert(selected.highlighted.residueId === '2', 'residue selection');
      } else {
        assert(!document.querySelector('#mechanism-controls').hidden, 'mechanism available');
        if (config.kind === 'atp') {
          const info = await glow.animate({ time: 4 });
          assert(info.counters.ATP === 3 && info.counters['H⁺'] === 8, 'ATP stoichiometry');
        } else if (config.kind === 'kcsa') {
          const info = await glow.animate({ time: 30 });
          assert(info.counters['K⁺ 外流'] > info.counters['K⁺ 内流'], 'KcsA outward current');
          assert(info.reversalPotential < -85 && info.reversalPotential > -86, 'KcsA E_K');
        } else {
          const info = await glow.animate({ morph: 1 });
          assert(Math.abs(info.domainMeasurements.find(({ name }) => name === 'LID').angle - 52.16) < 0.1, 'AdK domain angle');
          await glow.animate({ morph: 'auto' });
        }
        const time = (await glow.info()).time;
        await glow.animate({ pause: false });
        await wait(async () => (await glow.info()).time > time + 0.05, 'mechanism advances');
        await glow.animate({ pause: true });
        if (config.kind === 'adk') await glow.animate({ time: 15, morph: 0.65 });
      }
      const before = await glow.info(), marker = exports.length;
      document.querySelector('#save').click(); await wait(() => exports.length > marker, 'actual save button');
      const blob = exports.at(-1); assert(blob.size > 100, 'ZIP saved');
      inject('#file', 'release-reopened.glow', blob);
      await wait(() => document.querySelector('#status').textContent === 'release-reopened.glow', 'ZIP reopened');
      const after = await glow.info();
      for (const field of ['time', 'counters', 'parameters', 'selection']) assert(JSON.stringify(before[field]) === JSON.stringify(after[field]), 'restored ' + field);
      assert(JSON.stringify(before.camera.position) === JSON.stringify(after.camera.position), 'camera position');
      assert(JSON.stringify(before.camera.target) === JSON.stringify(after.camera.target), 'camera target');
      if (config.kind !== 'local') {
        document.querySelector('#atp-enabled').click(); await wait(() => document.querySelector('#mechanism-controls').hidden, 'plugin disabled');
        document.querySelector('#atp-enabled').click(); await wait(() => !document.querySelector('#mechanism-controls').hidden, 'plugin reenabled');
      }
      result = { roundTrip: true, mechanism: config.kind, time: after.time, counters: after.counters, parameters: after.parameters, selection: after.selection, sources: after.sources.length };
      if (config.kind !== 'local') document.querySelector('#mechanism-controls').scrollIntoView();
    }
    if (window.glow?.snapshot) {
      const data = await glow.snapshot({ width: 320 });
      const bitmap = await createImageBitmap(await (await fetch(data)).blob()), canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 25) colored++;
      assert(colored > 100, 'visible molecular viewport'); result.coloredViewportPixels = colored;
    }
    return { ...result, path: location.pathname, build, exportBlobs: exports.length };
  } finally { URL.createObjectURL = original; }
}

async function main(args = process.argv.slice(2)) {
  const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const structures = path.resolve(option('--fixtures') ?? 'desktop/dist/smoke-structures');
  const output = path.resolve(option('--output') ?? 'desktop/dist/platform-smoke'); fs.mkdirSync(output, { recursive: true });
  for (const entry of manifest.structures) {
    const bytes = fs.readFileSync(path.join(structures, entry.id + '.cif'));
    assert.equal(hash(bytes), entry.sha256, 'Fixture hash: ' + entry.id);
  }
  let stage = option('--stage');
  if (!stage && !option('--exe')) stage = execFileSync(process.execPath, ['desktop/scripts/package-platform.cjs', '--stage-only'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
  if (stage) stage = path.resolve(stage);
  const exe = option('--exe') ? path.resolve(option('--exe')) : path.join(repo, 'desktop/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const packaged = Boolean(option('--exe'));
  let asarHash;
  if (packaged) {
    const archive = path.resolve(option('--asar') ?? path.join(path.dirname(exe), 'win-unpacked/resources/app.asar'));
    asarHash = hash(fs.readFileSync(archive));
    const extracted = fs.mkdtempSync(path.join(output, 'extracted-check-'));
    require(require.resolve('@electron/asar', { paths: [path.join(repo, 'desktop')] })).extractAll(archive, extracted);
    execFileSync(process.execPath, ['--experimental-vm-modules', path.join(repo, 'tools/check-platform-stage.cjs'), extracted], { stdio: 'inherit' });
  }
  const pdb = [0, 3.8, 7.6, 11.4].map((x, i) => 'ATOM  ' + String(i + 1).padStart(5) + '  CA  GLY A' + String(i + 1).padStart(4) + '    ' + x.toFixed(3).padStart(8) + '   0.000   0.000  1.00  0.00           C').join('\n') + '\nEND\n';
  const cases = [
    { kind: 'classic', page: undefined, pdb }, { kind: 'studio', page: 'studio.html' }, { kind: 'local', page: 'viewer.html', pdb },
    ...[['atp', 'atp-synthase'], ['kcsa', 'kcsa'], ['adk', 'adenylate-kinase']].map(([kind, id]) => ({ kind, page: 'viewer.html', pack: fs.readFileSync(path.join(repo, `workshop/official/packs/official.${id}.glow`), 'utf8') })),
  ];
  const reports = [];
  for (const config of cases) {
    const dir = path.join(output, config.kind); fs.mkdirSync(dir, { recursive: true });
    const profile = path.join(dir, 'profile'), cache = path.join(profile, 'structure-cache'); fs.mkdirSync(cache, { recursive: true });
    for (const entry of manifest.structures) {
      const key = crypto.createHash('sha1').update(entry.url).digest('hex');
      fs.copyFileSync(path.join(structures, entry.id + '.cif'), path.join(cache, key + '.bin'));
      fs.writeFileSync(path.join(cache, key + '.json'), JSON.stringify({ url: entry.url, type: 'chemical/x-mmcif', size: entry.bytes, sha256: entry.sha256 }));
    }
    const script = path.join(dir, 'probe.js'), reportFile = path.join(dir, 'report.json');
    fs.writeFileSync(script, `(${pageProbe.toString()})(${JSON.stringify(config)})`);
    fs.rmSync(reportFile, { force: true });
    const env = { ...process.env, GLOW_SMOKE: '120', GLOW_SMOKE_JS: script, GLOW_SMOKE_REPORT: reportFile, GLOW_SMOKE_PROFILE: profile,
      GLOW_SMOKE_OFFLINE: '1', GLOW_QUERY: config.kind === 'classic' ? '?ws=local-test&startup=skip&q=low' : '?startup=skip' };
    delete env.GLOW_PAGE; delete env.ELECTRON_RUN_AS_NODE;
    if (config.page) env.GLOW_PAGE = config.page;
    const stdout = fs.openSync(path.join(dir, 'stdout.log'), 'w'), stderr = fs.openSync(path.join(dir, 'stderr.log'), 'w');
    const child = spawn(exe, [...(packaged ? [] : [stage]), '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--user-data-dir=${profile}`], { env, windowsHide: true, stdio: ['ignore', stdout, stderr] });
    let timer;
    try {
      const code = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }),
        new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Process timeout: ' + config.kind)); }, 150000); })]);
      clearTimeout(timer);
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      assert.equal(code, 0, JSON.stringify(report.errors)); assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.equal(report.packaged, packaged);
      assert.equal(fs.realpathSync(report.cache.dir), fs.realpathSync(cache), 'isolated cache');
      assert.deepEqual(report.preferences, { contextIsolation: true, nodeIntegration: false, sandbox: true });
      if (packaged) { assert(report.appPath.includes('app.asar'), 'actual packaged runtime'); assert.equal(report.asarSha256, asarHash, 'portable launcher must execute the checked ASAR'); }
      else assert.equal(path.resolve(report.appPath), stage, 'stage runtime cannot use repo as application root');
      assert(report.downloads.every(({ state }) => state === 'completed'));
      assert(report.downloads.length >= (config.kind === 'classic' ? 0 : config.kind === 'studio' ? 2 : 1), 'real save downloads');
      for (const item of report.downloads.filter(({ file }) => file.endsWith('.glow'))) {
        const { readScenePackage } = await import(pathToFileURL(path.join(repo, 'packages/schema/archive.mjs')));
        await readScenePackage(new Uint8Array(fs.readFileSync(item.file)));
      }
      reports.push({ kind: config.kind, ok: true, report: reportFile, build: report.build.contentSha256 });
      console.log(config.kind + ': ok');
    } finally { clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr); }
  }
  const summary = { ok: true, packaged, executable: exe, executableSha256: packaged ? hash(fs.readFileSync(exe)) : null,
    stage, asarSha256: asarHash, fixtures: manifest.structures.map(({ id, sha256 }) => ({ id, sha256 })), reports };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary)); return summary;
}
module.exports = { main };
if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
