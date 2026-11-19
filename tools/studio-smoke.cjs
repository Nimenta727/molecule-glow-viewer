const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..');
const { app, BrowserWindow, session } = require('electron');

const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/test/atp.cif' && process.env.GLOW_ATP_CIF) {
    console.log('[atp] serving cached coordinates');
    res.writeHead(200, { 'content-type': 'chemical/x-mmcif', 'access-control-allow-origin': '*' });
    fs.createReadStream(process.env.GLOW_ATP_CIF).pipe(res);
    return;
  }
  if (pathname === '/test/structure.cif' && (process.env.GLOW_STRUCTURE_SCREENSHOTS || process.env.GLOW_COMMAND_SMOKE)) {
    res.writeHead(200, { 'content-type': 'chemical/x-mmcif', 'access-control-allow-origin': '*' }).end(structureCif);
    return;
  }
  if (pathname === '/test/unavailable.cif' && process.env.GLOW_STRUCTURE_SCREENSHOTS) {
    res.writeHead(503, { 'access-control-allow-origin': '*' }).end();
    return;
  }
  const file = path.resolve(repo, `.${pathname}`);
  const allowed = /^\/(apps|packages|plugins|src|desktop\/vendor|node_modules)\//.test(pathname);
  if (!allowed || !file.startsWith(repo + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found'); return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(file).pipe(res);
});

let stage = 'startup';
function waitFor(win, expression, label, timeout = 15000) {
  const end = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        if (await win.webContents.executeJavaScript(expression)) return resolve();
        if (Date.now() > end) return reject(new Error(`Timed out: ${label}`));
        setTimeout(poll, 100);
      } catch (error) { reject(error); }
    };
    poll();
  });
}

async function viewportPixels(win) {
  await win.webContents.executeJavaScript(`new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const rect = await win.webContents.executeJavaScript(`(() => { const r=document.querySelector('#viewport').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,iw:innerWidth,ih:innerHeight}; })()`);
  const image = await win.capturePage(undefined, { stayAwake: true });
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const x0 = Math.max(0, Math.floor(rect.x * width / rect.iw));
  const y0 = Math.max(0, Math.floor(rect.y * height / rect.ih));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width / rect.iw));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height / rect.ih));
  let colored = 0, red = 0, green = 0, blue = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
    if ((g > 70 && g > r * 1.2 && g > b * 1.05) || (r > 100 && r > g * 1.12 && r > b * 1.15) || (b < 210 && b > r * 1.18 && g > r * 1.1)) colored++;
    if (r > 180 && g < 170 && b < 170) red++;
    if (g > 175 && r < 175 && b < 155) green++;
    if (b > 180 && r < 165 && g < 190) blue++;
  }
  return { colored, height, axes: { red, green, blue } };
}

function injectFile(win, { name, data, type = 'application/octet-stream', input = '#structure-file' }) {
  const base64 = Buffer.from(data).toString('base64');
  return win.webContents.executeJavaScript(`(() => {
    const target=document.querySelector(${JSON.stringify(input)}), transfer=new DataTransfer();
    const raw=atob(${JSON.stringify(base64)}), bytes=Uint8Array.from(raw,(c)=>c.charCodeAt(0));
    transfer.items.add(new File([bytes],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));
    target.files=transfer.files; target.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}

async function captureWindow(win, directory, name, focusSelector) {
  const original = win.getContentSize();
  try {
    for (const [layout, width] of [['normal', original[0]], ['narrow', 560]]) {
      win.setContentSize(width, original[1]);
      await waitFor(win, `Math.abs(innerWidth - ${width}) < 4`, `${name} ${layout} resize`);
      if (focusSelector) await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(focusSelector)}).scrollIntoView({ block: 'start' })`,
      );
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(directory, `${name}-${layout}.png`), (await win.webContents.capturePage()).toPNG());
    }
  } finally {
    win.setContentSize(...original);
  }
}

async function verifyPresentationDemo(viewer, directory, scenePath, readScenePackage) {
  const status = (label) => `document.querySelector('#status').textContent === ${JSON.stringify(label)}`;
  await captureWindow(viewer, directory, 'viewer-baseline');
  // Save and reopen the ordinary v2 package first, then verify the new package.
  async function saveAndReopen(name, expectedScene) {
    const completed = new Promise((resolve, reject) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.once('done', (_finished, state) => state === 'completed' ? resolve() : reject(new Error(state)));
      });
    });
    await viewer.webContents.executeJavaScript("document.querySelector('#save').click()");
    await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('Viewer save timeout')), 10000))]);
    const saved = fs.readFileSync(scenePath);
    assert.deepEqual((await readScenePackage(saved)).scene, expectedScene);
    await injectFile(viewer, { name, data: saved, input: '#file' });
    await waitFor(viewer, status(name), name);
  }
  const ordinary = await readScenePackage(fs.readFileSync(scenePath));
  await saveAndReopen('ordinary-reopened.glow', ordinary.scene);
  const demo = fs.readFileSync(path.join(repo, 'apps/viewer-web/four-modes-demo.glow'));
  await injectFile(viewer, { name: 'four-modes-demo.glow', data: demo, input: '#file' });
  await waitFor(viewer, status('four-modes-demo.glow'), 'four-mode demo open');
  assert.ok((await viewportPixels(viewer)).colored > 1000, 'demo geometry must render');
  await captureWindow(viewer, directory, 'viewer-four-modes-demo');
  await viewer.webContents.executeJavaScript("document.querySelector('#play').click()");
  await waitFor(viewer, "Number(document.querySelector('#time').value.split(' / ')[0]) > 0.2", 'demo playback advances');
  await saveAndReopen('four-modes-reopened.glow', (await readScenePackage(demo)).scene);
  await injectFile(viewer, { name: 'broken.glow', data: Buffer.from('{'), input: '#file' });
  await waitFor(viewer, "document.querySelector('#status').textContent.startsWith('无法打开场景。')", 'malformed package refused');
  assert.equal(await viewer.webContents.executeJavaScript("document.querySelector('#playhead').max"), '4');
  assert.ok((await viewportPixels(viewer)).colored > 1000, 'malformed package must leave the demo visible');
  const v1 = fs.readFileSync(path.join(repo, 'workshop/official/packs/official.kcsa-data.glow'));
  await injectFile(viewer, { name: 'legacy-v1.glow', data: v1, input: '#file' });
  await waitFor(viewer, status('legacy-v1.glow'), 'legacy v1 open');
  assert.equal(await viewer.webContents.executeJavaScript("document.querySelector('#legacy-viewer').hidden"), false);
}

async function verifyNavigation(viewer, directory) {
  const evaluate = (code) => viewer.webContents.executeJavaScript(code);
  const state = () => evaluate(`({
    mode: document.querySelector('#navigation-heading').dataset.mode ?? null,
    path: [...document.querySelectorAll('#navigation-path li')].map(li => li.textContent),
    selected: document.querySelector('#navigation-selection').textContent,
    notes: document.querySelector('#viewer-notes').textContent,
    focus: document.activeElement.id
  })`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enter = (id) => click(`[data-view-id="view-${id}"]`);
  const back = () => click('#navigation-back');
  const escape = () => evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}))");
  const settle = async () => {
    await waitFor(viewer, 'window.navigationProbe.pending.size === 0', 'camera returns to idle');
    return evaluate('({ frames: navigationProbe.frames, buffers: navigationProbe.buffers.size })');
  };
  const imageHash = async () => {
    const rect = await evaluate(`(() => {
      const {x,y,width,height} = document.querySelector('#viewport').getBoundingClientRect();
      return {x:Math.round(x),y:Math.round(y),width:Math.floor(width),height:Math.floor(height)};
    })()`);
    const image = await viewer.webContents.capturePage(rect);
    return crypto.createHash('sha256').update(image.toBitmap()).digest('hex');
  };
  viewer.webContents.debugger.attach();
  const emulateMotion = (value) => viewer.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
  await emulateMotion('no-preference');
  assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), false);
  await click('#close');
  await evaluate(`(() => {
    const canvas = document.querySelector('#viewport canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new Error('Missing WebGL context');
    const probe = window.navigationProbe = {frames:0,pending:new Set(),buffers:new Set()};
    const request = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = request(time => { probe.pending.delete(id); probe.frames++; callback(time); });
      probe.pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { probe.pending.delete(id); cancel(id); };
    const create = gl.createBuffer.bind(gl), release = gl.deleteBuffer.bind(gl);
    gl.createBuffer = () => { const buffer = create(); if (buffer) probe.buffers.add(buffer); return buffer; };
    gl.deleteBuffer = buffer => { probe.buffers.delete(buffer); release(buffer); };
    const draw = gl.drawArrays.bind(gl);
    gl.drawArrays = (mode, start, count) => {
      if (mode === gl.LINES && count) probe.lineVertices = count;
      draw(mode, start, count);
    };
  })()`);
  await click('#four-modes-example');
  await waitFor(viewer, "document.querySelector('#navigation-heading').dataset.mode === 'cell'", 'demo button opens cell');
  const root = await settle();
  assert.ok(root.buffers > 0, 'demo has live geometry buffers');
  const hotspotPoint = await evaluate(`(() => {
    const {x,y,width,height} = document.querySelector('#viewport canvas').getBoundingClientRect();
    return {x: x + width * 0.58, y: y + height * 0.60};
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await viewer.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, ...hotspotPoint, button: 'left', clickCount: 1,
    });
  }
  assert.equal((await state()).selected, '当前选择：传递区');
  assert.equal(await evaluate("document.querySelector('.is-hotspot')?.dataset.viewId"), 'view-system');
  await settle();
  const cellImage = await imageHash();
  await enter('system');
  const system = await settle();
  assert.ok(system.frames - root.frames > 2, `normal camera navigation animates (${system.frames - root.frames} frames)`);
  const systemImage = await imageHash();
  assert.notEqual(systemImage, cellImage, 'system visibly changes camera framing');
  assert.match((await state()).notes, /橙色颗粒/);
  await enter('protein');
  assert.equal((await state()).selected, '当前选择：示意蛋白质');
  await enter('mechanism');
  assert.deepEqual((await state()).path, ['细胞', '局部系统', '蛋白质', '反应机理']);
  assert.equal((await state()).focus, 'navigation-heading');
  await settle();
  await captureWindow(viewer, directory, 'viewer-navigation');
  await settle();
  await escape();
  assert.equal((await state()).mode, 'protein');
  assert.match((await state()).notes, /示意蛋白质/);
  await back();
  await settle();
  assert.equal((await state()).mode, 'system');
  assert.equal(await imageHash(), systemImage, 'return restores caller camera');
  await enter('mechanism');
  await escape();
  assert.equal((await state()).mode, 'system', 'mechanism also returns directly to system');
  await back();
  await settle();
  assert.equal(await imageHash(), cellImage, 'rapid navigation settles at the final destination');
  assert.equal((await state()).selected, '当前选择：传递区', 'return restores selected hotspot');
  for (let i = 0; i < 8; i++) {
    await enter('system');
    await enter('protein');
    await enter('mechanism');
    await back();
    await back();
    await back();
  }
  assert.equal((await settle()).buffers, root.buffers);
  assert.equal(await imageHash(), cellImage);

  await emulateMotion('reduce');
  assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
  const before = await settle();
  await enter('system');
  const after = await settle();
  assert.ok(after.frames - before.frames <= 2, 'reduced motion completes without transition frames');
  assert.equal(await imageHash(), systemImage, 'reduced motion reaches the same target');
  await click('#reset-camera');
  await settle();
  assert.equal((await state()).mode, 'system');
  assert.equal(await imageHash(), systemImage);

  const original = viewer.getContentSize();
  try {
    viewer.setContentSize(560, original[1]);
    await waitFor(viewer, 'Math.abs(innerWidth - 560) < 4', 'narrow navigation');
    assert.equal(await evaluate(`(() => {
      const viewport = document.querySelector('#viewport');
      const canvas = viewport.querySelector('canvas');
      return canvas.clientWidth === viewport.clientWidth && canvas.clientHeight === viewport.clientHeight;
    })()`), true, 'canvas fits the narrow viewport');
    await back();
    const button = await evaluate(`(() => {
      const button = document.querySelector('[data-view-id="view-system"]');
      button.focus();
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { enabled: !button.disabled, reachable: button.contains(hit) };
    })()`);
    assert.deepEqual(button, { enabled: true, reachable: true });
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await viewer.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await viewer.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...key });
    await viewer.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await waitFor(viewer, "document.querySelector('#navigation-heading').dataset.mode === 'system'", 'keyboard opens system');
    assert.equal((await state()).focus, 'navigation-heading');
  } finally {
    viewer.setContentSize(...original);
    viewer.webContents.debugger.detach();
  }
  await settle();
  assert.equal((await settle()).buffers, root.buffers, 'navigation reuses the same geometry buffers');
  await injectFile(viewer, { name: 'broken.glow', data: Buffer.from('{'), input: '#file' });
  await waitFor(viewer, "document.querySelector('#status').textContent.startsWith('无法打开场景。')", 'navigation survives failed replacement');
  assert.equal((await state()).mode, 'system');
  await enter('protein');
  await click('#example');
  await waitFor(viewer, "document.querySelector('#status').textContent === '基础几何示例'", 'ordinary scene replaces navigation');
  assert.equal((await state()).mode, null);
  assert.equal(await evaluate("document.querySelector('#mode-panel').hidden"), true);
  assert.ok((await settle()).buffers < root.buffers, 'replacement releases navigation geometry');
  await click('#close');
  assert.equal((await settle()).buffers, 0, 'closing releases all sampled geometry buffers');

  const step = () => evaluate("document.querySelector('#mode-panel [aria-current=step]')?.dataset.step");
  const seek = (time) => evaluate(`(() => {
    const playhead = document.querySelector('#playhead');
    playhead.value = ${time};
    playhead.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('#four-modes-example');
  await waitFor(viewer, "document.querySelector('#navigation-heading').dataset.mode === 'cell'", 'mode panel example opens');
  assert.match(await evaluate("document.querySelector('#mode-panel').textContent"), /细胞区域.*\+Y 向上/);
  await click('#mode-panel [data-node-id="region"]');
  assert.equal((await state()).selected, '当前选择：传递区');
  await enter('system');
  assert.match(await evaluate("document.querySelector('#mode-panel').textContent"), /系统对象.*示意方向.*起点 → 示意接触点/);
  await settle();
  assert.equal(await evaluate('navigationProbe.lineVertices'), 12, 'system draws two directed connections');
  await captureWindow(viewer, directory, 'viewer-system');
  await enter('protein');
  await settle();
  const proteinImage = await imageHash();
  assert.equal(await evaluate("document.querySelectorAll('#mode-panel [data-node-id]').length"), 3);
  await click('#mode-panel [data-node-id="binding-site"]');
  assert.equal((await state()).selected, '当前选择：示意接触点');
  assert.equal(await evaluate("document.querySelector('#mode-panel [data-node-id=binding-site]').getAttribute('aria-pressed')"), 'true');
  await click('#mode-panel [data-rotate="1"]');
  await settle();
  assert.notEqual(await imageHash(), proteinImage, 'protein controls change the view');
  await click('#reset-camera');
  await settle();
  const callerImage = await imageHash();
  await captureWindow(viewer, directory, 'viewer-protein');

  await enter('mechanism');
  assert.equal(await step(), '0');
  assert.match(await evaluate("document.querySelector('#mode-panel').textContent"), /参与对象：示意颗粒、示意接触点/);
  await seek(2.5);
  assert.equal(await step(), '1');
  await settle();
  assert.equal(await evaluate('navigationProbe.lineVertices'), 48, 'step draws two participant highlights');
  const contactImage = await imageHash();
  await click('#mode-panel [data-step="2"]');
  assert.equal(await step(), '2');
  assert.equal(await evaluate("document.querySelector('#playhead').value"), '4');
  await settle();
  assert.notEqual(await imageHash(), contactImage, 'step changes scene pose and highlight');
  await seek(1.7);
  assert.equal(await step(), '0');
  await click('#play');
  await waitFor(viewer, "document.querySelector('#mode-panel [aria-current=step]')?.dataset.step === '1'", 'playback advances the mechanism step');
  await click('#play');
  assert.equal(await step(), '1');
  assert.equal(await evaluate("document.querySelector('#play').textContent"), '播放');
  await captureWindow(viewer, directory, 'viewer-mechanism');
  await back();
  assert.equal((await state()).mode, 'protein');
  assert.equal((await state()).selected, '当前选择：示意接触点');
  await settle();
  assert.equal(await imageHash(), callerImage, 'mechanism returns to isolated protein with restored camera');
  await back();
  await enter('mechanism');
  assert.equal(await step(), '1', 'both entrances use the shared timeline');
  await back();
  assert.equal((await state()).mode, 'system');
  await click('#close');
  assert.equal((await settle()).buffers, 0, 'mode overlays dispose with their scene');

  const { fourModesDemo } = await import(pathToFileURL(path.join(repo, 'apps/viewer-web/four-modes-demo.mjs')));
  const { writeScenePackage } = await import(pathToFileURL(path.join(repo, 'packages/schema/archive.mjs')));
  const untimed = structuredClone(fourModesDemo);
  untimed.timeline = { duration: 0, tracks: [] };
  const mechanism = untimed.presentation.navigation.views.find(({ mode }) => mode === 'mechanism');
  for (const item of mechanism.steps) delete item.time;
  untimed.nodes.find(({ id }) => id === 'protein').visible = false;
  await injectFile(viewer, { name: 'untimed.glow', data: await writeScenePackage(untimed), input: '#file' });
  await waitFor(viewer, "document.querySelector('#status').textContent === 'untimed.glow'", 'untimed mechanism opens');
  await enter('system');
  assert.equal(await evaluate("Boolean(document.querySelector('#mode-panel [data-node-id=protein]'))"), false);
  await enter('mechanism');
  assert.equal(await step(), '0');
  await click('#mode-panel [data-step="1"]');
  assert.equal(await step(), '1');
  assert.equal(await evaluate("document.querySelector('#playhead').disabled"), true);
  await settle();
  assert.equal(await evaluate('navigationProbe.lineVertices'), 24, 'hidden descendants do not receive outlines');
  await click('#close');
}

function pdbAtom(serial, seq, x, y = 0, z = 0) {
  const line = Array(80).fill(' ');
  const put = (start, end, value) => line.splice(start, end - start, ...String(value).padEnd(end - start, ' ').slice(0, end - start));
  put(0, 6, 'ATOM'); put(6, 11, String(serial).padStart(5)); put(12, 16, ' CA ');
  put(17, 20, 'GLY'); put(21, 22, 'A'); put(22, 26, String(seq).padStart(4));
  put(30, 38, Number(x).toFixed(3).padStart(8)); put(38, 46, Number(y).toFixed(3).padStart(8));
  put(46, 54, Number(z).toFixed(3).padStart(8)); put(76, 78, ' C');
  return line.join('');
}
function syntheticPdb() {
  return Buffer.from([pdbAtom(1, 1, 0), pdbAtom(2, 2, 3.8), pdbAtom(3, 3, 7.6, 1), pdbAtom(4, 4, 11.4, 1), 'END', ''].join('\n'));
}

const structureCif = Buffer.from(`data_viewer_smoke
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.auth_asym_id
_atom_site.label_seq_id
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA GLY X A 1 7 . -10 0 0
ATOM 2 C CA HIS X A 2 8 B 0 0 0
HETATM 3 FE FE HEM Y A . 101 . 10 0 0
ATOM 4 N ND1 HIS X A 2 8 B 7 0 0
#
`);

const assemblyCif = Buffer.concat([structureCif, Buffer.from(`
loop_
_pdbx_struct_assembly_gen.assembly_id
_pdbx_struct_assembly_gen.oper_expression
_pdbx_struct_assembly_gen.asym_id_list
1 '1,2' X,Y
loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 0 1 0 0 0 0 1 0
2 1 0 0 32 0 1 0 0 0 0 1 0
`)]);

async function verifyStructureWorkflow(viewer, directory, scenePath, readScenePackage) {
  const run = (code) => viewer.webContents.executeJavaScript(code);
  const status = (message) => waitFor(viewer, `document.querySelector('#status').textContent === ${JSON.stringify(message)}`, message);
  const inject = (name, data) => injectFile(viewer, { name, data, input: '#file' });
  const toggle = () => run("document.querySelector('#structure-enabled').click()");
  async function saveScene() {
    const completed = new Promise((resolve, reject) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.once('done', (_finished, state) => state === 'completed' ? resolve() : reject(new Error(state)));
      });
    });
    await run("document.querySelector('#save').click()");
    await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('Structure save timeout')), 10000))]);
    return fs.readFileSync(scenePath);
  }
  await toggle();
  await waitFor(viewer, "!document.querySelector('#rcsb-load').disabled", 'structure plugin enabled');
  await run("document.querySelector('#structure-assembly').checked = true");
  await inject('assembly.cif', assemblyCif);
  await status('assembly.cif');
  const assemblySummary = () => run("document.querySelector('#structure-summary').textContent");
  assert.match(await assemblySummary(), /生物组装体 1 · 8 个原子 · 2 条链/);
  const useStyle = (value) => run(`(() => {
    const style = document.querySelector('#representation-style');
    style.value = ${JSON.stringify(value)}; style.dispatchEvent(new Event('change'));
  })()`);
  await useStyle('functional');
  assert.ok(await run("!document.querySelector('#functional-evidence').hidden"));
  const assemblyBytes = await saveScene();
  const assembled = await readScenePackage(assemblyBytes);
  assert.equal(assembled.scene.assets[0].provenance.assemblyId, '1');
  assert.equal(assembled.scene.assets[0].provenance.viewerStyle, 'functional');
  assert.ok(assembled.scene.evidence.some(({ type, citation }) => type === 'illustrative' && citation?.includes('功能分区')));
  assert.deepEqual(Buffer.from(assembled.resources.get(assembled.scene.assets[0].path)), assemblyCif);
  await inject('assembly.glow', assemblyBytes);
  await status('assembly.glow');
  assert.match(await assemblySummary(), /生物组装体 1 · 8 个原子 · 2 条链/);
  assert.equal(await run("document.querySelector('#representation-style').value"), 'functional');
  assert.ok((await viewportPixels(viewer)).colored > 0);
  await toggle();
  await waitFor(viewer, "document.querySelector('#rcsb-load').disabled", 'assembly plugin disabled');
  await inject('assembly-offline.glow', assemblyBytes);
  await status('assembly-offline.glow');
  assert.ok((await viewportPixels(viewer)).colored > 0, 'assembly preview without the plugin');
  await toggle();
  await waitFor(viewer, "!document.querySelector('#rcsb-load').disabled", 'assembly plugin re-enabled');
  assert.match(await assemblySummary(), /生物组装体 1/);
  await inject('missing-assembly.cif', structureCif);
  await status('missing-assembly.cif');
  assert.match(await run("document.querySelector('#warning').textContent"), /没有所选的生物组装体.*显示原始坐标/);
  await inject('assembly.pdb', Buffer.concat([Buffer.from([
    'REMARK 350 BIOMOLECULE: 1',
    'REMARK 350 APPLY THE FOLLOWING TO CHAINS: A',
    'REMARK 350   BIOMT1   1  1  0  0  0',
    'REMARK 350   BIOMT2   1  0  1  0  0',
    'REMARK 350   BIOMT3   1  0  0  1  0',
    'REMARK 350   BIOMT1   2  1  0  0  12',
    'REMARK 350   BIOMT2   2  0  1  0  0',
    'REMARK 350   BIOMT3   2  0  0  1  0',
    '',
  ].join('\n')), syntheticPdb()]));
  await status('assembly.pdb');
  assert.match(await assemblySummary(), /PDB · 生物组装体 1 · 8 个原子 · 2 条链/);
  if (process.env.GLOW_LIVE_STRUCTURE_SMOKE) {
    await run(`document.querySelector('#accession').value = '1K4C'; document.querySelector('#rcsb-form').requestSubmit()`);
    await status('1K4C');
    assert.match(await assemblySummary(), /RCSB PDB 1K4C · MMCIF · 生物组装体 1/);
    await useStyle('blob');
    await run("document.querySelector('#structure-tools').open = true");
    await captureWindow(viewer, directory, 'viewer-1k4c-assembly');
  }
  await run("document.querySelector('#structure-assembly').checked = false");
  await run(`document.querySelector('#accession').value = '4HHB'; document.querySelector('#rcsb-form').requestSubmit()`);
  await status('4HHB');
  assert.match(await run("document.querySelector('#structure-summary').textContent"), /RCSB PDB 4HHB/);
  await useStyle('blob');
  assert.equal(await run("document.querySelector('#representation-style').value"), 'blob');
  assert.ok((await viewportPixels(viewer)).colored > 0, 'blob representation renders');
  if (process.env.GLOW_LIVE_STRUCTURE_SMOKE) await captureWindow(viewer, directory, 'viewer-4hhb-blob');
  await useStyle('functional');
  assert.ok((await viewportPixels(viewer)).colored > 0, 'functional preview renders');
  if (process.env.GLOW_LIVE_STRUCTURE_SMOKE) await captureWindow(viewer, directory, 'viewer-4hhb-functional');
  await inject('structure.pdb', syntheticPdb());
  await status('structure.pdb');
  await inject('structure.cif', structureCif);
  await status('structure.cif');
  await run(`(() => {
    const transfer = new DataTransfer();
    const stale = new File(['invalid'], 'superseded.pdb');
    transfer.items.add(stale);
    const file = document.querySelector('#file');
    file.files = transfer.files;
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = original;
      return new Promise(resolve => { window.finishTestStructureRead = () => original.call(this).then(resolve); });
    };
    file.dispatchEvent(new Event('change'));
  })()`);
  await inject('structure.cif', structureCif);
  await status('structure.cif');
  await run('window.finishTestStructureRead()');
  await viewportPixels(viewer);
  await status('structure.cif');
  await run(`(() => {
    const style = document.querySelector('#representation-style');
    style.value = 'backbone'; style.dispatchEvent(new Event('change'));
  })()`);
  await inject('invalid.cif', Buffer.from('invalid data'));
  await waitFor(viewer, "document.querySelector('#status').textContent.startsWith('无法打开场景')", 'invalid coordinate error');
  assert.match(await run("document.querySelector('#structure-summary').textContent"), /structure\.cif/);
  const rect = await run(`(() => {
    const {x,y,width,height} = document.querySelector('#viewport canvas').getBoundingClientRect();
    return {x,y,width,height,iw:innerWidth,ih:innerHeight};
  })()`);
  const click = (x, y) => {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      viewer.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    }
  };
  const picked = (text) => waitFor(viewer, `(() => {
    const card = document.querySelector('#structure-pick');
    return !card.hidden && card.textContent.includes(${JSON.stringify(text)});
  })()`, text);
  click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await picked('残基 HIS · 作者编号 A:8B · 标签编号 X:2');
  await run("document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
  assert.ok(await run("document.querySelector('#structure-pick').hidden"));
  await run("document.querySelector('#reset-camera').click()");
  await viewportPixels(viewer);
  const image = await viewer.webContents.capturePage();
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let count = 0, sumX = 0, sumY = 0;
  for (let y = Math.ceil(rect.y / rect.ih * height); y < Math.floor((rect.y + rect.height) / rect.ih * height); y++) {
    for (let x = Math.ceil(rect.x / rect.iw * width); x < Math.floor((rect.x + rect.width) / rect.iw * width); x++) {
      const i = (y * width + x) * 4;
      const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
      if (r > 190 && g > 90 && g < 180 && b < 100) { count++; sumX += x; sumY += y; }
    }
  }
  assert.ok(count > 0, 'ligand marker is visible');
  click(sumX / count / width * rect.iw, sumY / count / height * rect.ih);
  await picked('配体 HEM · 作者编号 A:101');
  await run("document.querySelector('#structure-contacts summary').click()");
  await waitFor(viewer, "document.querySelector('#structure-contact-list').textContent.includes('HIS A:8B · 3.00 Å')", 'nearest heavy-atom contact');
  const bytes = await saveScene();
  const { scene, resources } = await readScenePackage(bytes);
  const asset = scene.assets.find(({ mediaType }) => mediaType === 'chemical/x-mmcif');
  assert.deepEqual(Buffer.from(resources.get(asset.path)), structureCif);
  assert.equal(asset.sha256, crypto.createHash('sha256').update(structureCif).digest('hex'));
  assert.deepEqual(asset.provenance.source, { provider: 'local file', name: 'structure.cif' });
  assert.equal(asset.provenance.viewerStyle, 'backbone');
  assert.match(asset.provenance.viewerState.selection, /HEM/);
  assert.notDeepEqual(asset.provenance.viewerState.camera.position, asset.provenance.viewerState.camera.target);
  await run("document.querySelector('#close').click()");
  await inject('structure.glow', bytes);
  await status('structure.glow');
  await picked('配体 HEM · 作者编号 A:101');
  assert.equal(await run("document.querySelector('#representation-style').value"), 'backbone');
  const reopened = await readScenePackage(await saveScene());
  const savedView = asset.provenance.viewerState;
  const reopenedView = reopened.scene.assets.find(({ id }) => id === asset.id).provenance.viewerState;
  assert.equal(reopenedView.selection, savedView.selection);
  for (const key of ['position', 'target']) {
    assert.ok(reopenedView.camera[key].every((value, index) => Math.abs(value - savedView.camera[key][index]) < 1e-9));
  }
  await captureWindow(viewer, directory, 'viewer-structure');
  await toggle();
  await waitFor(viewer, "document.querySelector('#rcsb-load').disabled", 'structure plugin disabled');
  await inject('offline-preview.glow', bytes);
  await status('offline-preview.glow');
  assert.ok(await run("document.querySelector('#warning').textContent.includes('org.glow.structure')"));
  assert.ok(await run("document.querySelector('#structure-pick').hidden"));
  const preview = await viewportPixels(viewer);
  assert.ok(preview.colored > 0, 'embedded preview still renders');

  await toggle();
  await waitFor(viewer, "!document.querySelector('#rcsb-load').disabled", 'structure plugin re-enabled');
  const legacy = (scene) => Buffer.from(JSON.stringify({
    format: 'glow-scene', version: 1, id: 'test.structure', title: 'Legacy structure smoke', scene,
  }));
  await inject('legacy-embedded.glow', legacy({
    structure: { name: 'structure.cif', text: structureCif.toString() },
    caption: 'Legacy caption', evidence: { illustrative: ['test'] },
    axis: 'native', colors: { Ring: '#8844bb' }, reps: { Ring: 'simplified', 'Chain A': 'hidden' },
    components: [{ id: '4HHB', label: 'Ring', axis: 'native', dy: 8, arrange: { kind: 'ring', n: 3, radius: 30 } }],
  }));
  await status('legacy-embedded.glow');
  assert.match(await run("document.querySelector('#structure-summary').textContent"), /structure\.cif/);
  assert.match(await run("document.querySelector('#viewer-notes').textContent"), /Legacy caption/);
  assert.match(await run("document.querySelector('#viewer-evidence').textContent"), /示意 · test/);
  assert.ok((await viewportPixels(viewer)).colored > 0, 'v1 embedded coordinates render');
  const compositeBytes = await saveScene();
  const composite = await readScenePackage(compositeBytes);
  const placements = composite.scene.nodes.filter(({ id }) => id.startsWith('legacy-component-1-placement-'));
  assert.equal(placements.length, 3);
  const [first, second] = placements.map(({ transform }) => transform.position);
  assert.ok(Math.abs(first[1] - second[1]) < 1e-9);
  assert.ok(Math.hypot(first[0] - second[0], first[2] - second[2]) > 1);
  assert.ok(composite.scene.assets.some((asset) => asset.provenance?.legacyColor === '#8844bb'));
  assert.ok(composite.scene.assets.some((asset) => asset.provenance?.legacyStyle === 'functional'));
  assert.ok(composite.scene.nodes.some((node) => node.name === 'Chain A' && !node.visible));
  await run("document.querySelector('#close').click()");
  await inject('legacy-composite.glow', compositeBytes);
  await status('legacy-composite.glow');
  assert.deepEqual((await readScenePackage(await saveScene())).scene.nodes, composite.scene.nodes);
  assert.match(await run("document.querySelector('#diagnostic-summary').textContent"), /旧包静态预览/);
  assert.ok(await run("!document.querySelector('#diagnostic').open"));
  await captureWindow(viewer, directory, 'viewer-legacy-composite');
  await run(`[...document.querySelectorAll('#structure-part-list label')]
    .find((label) => label.textContent.trim() === 'Ring').querySelector('input').click()`);
  const hiddenComposite = await readScenePackage(await saveScene());
  assert.ok(hiddenComposite.scene.nodes.filter((node) => node.name === 'Ring' && node.assetId).every((node) => !node.visible));
  await run(`(() => {
    const select = [...document.querySelectorAll('#structure-part-list li')].find((li) =>
      li.querySelector('label').textContent.trim() === 'Ring').querySelector('select');
    select.value = 'surface'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.ok((await readScenePackage(await saveScene())).scene.assets.some((asset) => asset.provenance?.legacyStyle === 'surface'));
  await inject('legacy-accession.glow', legacy({
    id: '4HHB', process: 'atpSynthase', core: [{ part: 'Chain A', seqs: [[7, 8]] }],
  }));
  await status('legacy-accession.glow');
  assert.match(await run("document.querySelector('#structure-summary').textContent"), /RCSB PDB 4HHB/);
  assert.match(await run("document.querySelector('#warning').textContent"), /atpSynthase/);
  assert.ok((await viewportPixels(viewer)).colored > 0, 'v1 accession restores the main structure');
  await useStyle('functional');
  assert.match(await run("document.querySelector('#functional-evidence').textContent"), /场景指定的核心残基/);
  assert.ok((await viewportPixels(viewer)).colored > 0, 'v1 functional preview renders');
  await inject('legacy-offline.glow', legacy({ id: '9ZZZ' }));
  await status('legacy-offline.glow');
  assert.match(await run("document.querySelector('#warning').textContent"), /无法恢复旧包主结构.*503/);
  assert.ok(await run("!document.querySelector('#legacy-viewer').hidden"));

  if (process.env.GLOW_LIVE_STRUCTURE_SMOKE) {
    const packDir = path.join(repo, 'workshop', 'official', 'packs');
    const names = fs.readdirSync(packDir).filter((name) => name.endsWith('.glow')).sort();
    assert.equal(names.length, 15);
    const report = [];
    for (const name of names) {
      const bytes = fs.readFileSync(path.join(packDir, name));
      const expectedComponents = JSON.parse(bytes).scene.components?.length ?? 0;
      await inject(name, bytes);
      await waitFor(viewer, `document.querySelector('#status').textContent === ${JSON.stringify(name)} ||
        document.querySelector('#status').textContent.startsWith('无法打开场景')`, name, 120000)
        .catch(async (error) => { throw new Error(`${error.message} · ${await run("document.querySelector('#status').textContent")}`); });
      const result = await run(`({
        status: document.querySelector('#status').textContent,
        structure: document.querySelector('#structure-summary').textContent,
        components: [...document.querySelectorAll('#legacy-component-list li')].map((li) => li.textContent),
        mechanismPlayback: !document.querySelector('#mechanism-controls').hidden,
        diagnostics: document.querySelector('#warning').textContent
      })`);
      const pixels = await viewportPixels(viewer);
      report.push({ name, ...result, expectedComponents, coloredPixels: pixels.colored });
      if (['official.respiratory-chain.glow', 'official.flagellar-motor.glow', 'official.chloroplast-light.glow'].includes(name)) {
        await run("document.querySelector('#legacy-components').open = true");
        await captureWindow(viewer, directory, name.replace(/^official\.|\.glow$/g, ''));
      }
    }
    fs.writeFileSync(path.join(directory, 'official-v1-report.json'), JSON.stringify(report, null, 2));
    for (const entry of report) {
      assert.equal(entry.status, entry.name);
      assert.match(entry.structure, /RCSB PDB/);
      assert.ok(entry.coloredPixels > 500, `No visible molecular preview: ${entry.name}`);
      assert.equal(entry.components.length, entry.expectedComponents, `Missing components: ${entry.name}`);
    }
  }
}

async function verifyAtpPlayer(viewer, directory, scenePath, readScenePackage) {
  console.log('[atp] starting');
  const run = (code) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`ATP browser call timed out: ${code.slice(0, 120)}`)), 30000);
    viewer.webContents.executeJavaScript(code).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
  const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const status = async (name) => {
    await waitFor(viewer, `document.querySelector('#status').textContent === ${JSON.stringify(name)} ||
      document.querySelector('#status').textContent.startsWith('无法打开场景')`, name, 90000)
      .catch(async (error) => { throw new Error(`${error.message} · ${await run("document.querySelector('#status').textContent")}`); });
    assert.equal(await run("document.querySelector('#status').textContent"), name);
  };
  const counters = () => run("document.querySelector('#mechanism-counters').textContent");
  const seek = (time) => run(`(() => {
    const slider = document.querySelector('#playhead'); slider.value = ${time};
    slider.dispatchEvent(new Event('input'));
  })()`);
  async function download() {
    const completed = new Promise((resolve, reject) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.once('done', (_finished, state) => state === 'completed' ? resolve() : reject(new Error(state)));
      });
    });
    await click('#save');
    await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('ATP save timeout')), 15000))]);
    return fs.readFileSync(scenePath);
  }
  await click('#structure-enabled');
  console.log('[atp] enable requested');
  await waitFor(viewer, "!document.querySelector('#rcsb-load').disabled", 'structure plugin enabled');
  console.log('[atp] enabled');
  const pack = fs.readFileSync(path.join(repo, 'workshop/official/packs/official.atp-synthase.glow'));
  await injectFile(viewer, { name: 'atp.glow', data: pack, input: '#file' });
  await status('atp.glow');
  console.log('[atp] loaded');
  const diagnostics = await run("document.querySelector('#warning').textContent");
  assert.ok(await run("!document.querySelector('#mechanism-controls').hidden"), diagnostics);
  assert.equal(await run("document.querySelectorAll('#mechanism-steps button').length"), 5);
  await run(`document.querySelector('#representation-style').value = 'surface';
    document.querySelector('#representation-style').dispatchEvent(new Event('change'))`);
  console.log('[atp] surface built');
  assert.equal(await run("document.querySelector('#representation-style').value"), 'surface');
  await captureWindow(viewer, directory, 'atp-surface');
  console.log('[atp] surface captured');
  await run(`document.querySelector('#representation-style').value = 'functional';
    document.querySelector('#representation-style').dispatchEvent(new Event('change'))`);
  console.log('[atp] functional built');
  await click('#mechanism-step');
  assert.match(await counters(), /0.03/);
  await seek(4);
  assert.match(await counters(), /ATP 3 · H⁺ 8/);
  await viewportPixels(viewer);
  const viewRect = await run(`(() => {
    const { x, y, width, height } = document.querySelector('#viewport').getBoundingClientRect();
    return { x: Math.ceil(x), y: Math.ceil(y), width: Math.floor(width), height: Math.floor(height) };
  })()`);
  const imageA = (await viewer.capturePage(viewRect)).toPNG();
  await seek(5);
  await viewportPixels(viewer);
  const imageB = (await viewer.capturePage(viewRect)).toPNG();
  assert.notDeepEqual(imageA, imageB, 'playing pose changes rendered pixels');
  await seek(4);
  await click('#mechanism-enter');
  assert.ok(await run("!document.querySelector('#mechanism-back').disabled"));
  await click('#mechanism-back');
  assert.ok(await run("document.querySelector('#mechanism-back').disabled"));
  await click('#play');
  await waitFor(viewer, "document.querySelector('#play').textContent === '暂停'", 'ATP starts playing');
  await waitFor(viewer, "Number(document.querySelector('#playhead').value) > 4.1", 'ATP clock advances');
  await click('#play');
  assert.equal(await run("document.querySelector('#play').textContent"), '播放');
  await seek(4);
  const bytes = await download();
  const saved = await readScenePackage(bytes);
  const source = saved.scene.assets.find((asset) => asset.provenance?.playback);
  assert.deepEqual(source.provenance.playback, { time: 4, speed: 0.25, seed: 1 });
  await click('#close');
  await injectFile(viewer, { name: 'atp-reopened.glow', data: bytes, input: '#file' });
  await status('atp-reopened.glow');
  assert.match(await counters(), /ATP 3 · H⁺ 8/);
  await run("document.querySelector('#mechanism-seed').value = '7'");
  await click('#mechanism-reset');
  assert.match(await counters(), /ATP 0 · H⁺ 0/);
  await seek(4);
  const replayA = await counters();
  await click('#mechanism-reset');
  await seek(4);
  assert.equal(await counters(), replayA);
  await run("document.querySelector('#mechanism-speed').value = '0.5'; document.querySelector('#mechanism-speed').dispatchEvent(new Event('change'))");
  assert.match(await counters(), /ATP 3 · H⁺ 8/);
  await seek(6);
  assert.match(await counters(), /ATP 6 · H⁺ 16/);
  await click('#mechanism-enter');
  assert.equal(await run("document.querySelector('#navigation-heading').dataset.mode"), 'mechanism');
  await run(`document.querySelector('#mode-panel [data-step="3"]').click()`);
  assert.equal(await run(`document.querySelector('#mode-panel [aria-current="step"]').dataset.step`), '3');
  await captureWindow(viewer, directory, 'atp-mechanism', '#mechanism-controls');
  await click('#mechanism-back');
  await seek(6);
  await click('#atp-enabled');
  await waitFor(viewer, "document.querySelector('#mechanism-controls').hidden", 'ATP plugin disabled');
  assert.match(await run("document.querySelector('#warning').textContent"), /org.glow.legacy-process.atp-synthase/);
  await click('#atp-enabled');
  await waitFor(viewer, "!document.querySelector('#mechanism-controls').hidden", 'ATP plugin enabled');
  const apiStepped = await run('glow.animate({seed:19,time:0,step:1/30,steps:180})');
  const apiSeeked = await run('glow.animate({time:6})');
  assert.deepEqual(apiStepped.counters, apiSeeked.counters);
  assert.equal(apiSeeked.seed, 19);
  assert.equal(apiSeeked.paused, true);
  await assert.rejects(run('glow.animate({speed:0.4,steps:-1})'), /steps/);
  assert.deepEqual((await run('glow.info()')).counters, apiSeeked.counters);
  await run('glow.animate({pause:false})');
  await waitFor(viewer, "Number(document.querySelector('#playhead').value) > 6.05", 'command starts mechanism');
  await run('glow.animate({pause:true})');
  assert.equal((await run('glow.info()')).paused, true);
  assert.match(await counters(), /ATP 6 · H⁺ 16/);
  await click('#close');
  assert.ok(await run("document.querySelector('#mechanism-controls').hidden"));
}

async function verifyNavigationAuthoring(studio, viewer, directory, { projectPath, scenePath, selectDownload, decodeProject, readScenePackage }) {
  const evaluate = (code) => studio.webContents.executeJavaScript(code);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const set = (selector, value, event = 'input') => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const value = ${JSON.stringify(value)};
    if (Array.isArray(value)) {
      for (const option of input.options) option.selected = value.includes(option.value);
    } else if (typeof value === 'boolean') input.checked = value;
    else input.value = value;
    const change = ${JSON.stringify(event ?? null)};
    if (change) input.dispatchEvent(new Event(change, { bubbles: true }));
  })()`);
  const status = (message) => waitFor(studio, `document.querySelector('#status').textContent === ${JSON.stringify(message)}`, message);
  const seek = (time) => set('#studio-playhead', time, 'input');
  async function addNode(name, parentId, x, color, particle = false) {
    await click(particle ? '#add-sphere' : '#add-box');
    await status(particle ? '已添加球体。' : '已添加方盒。');
    await set('#node-name', name);
    await set('#node-parent', parentId);
    await set('#position-x', x);
    await set('#node-color', color);
    if (particle) {
      await set('#position-y', 0.85);
      for (const axis of ['x', 'y', 'z']) await set(`#scale-${axis}`, 0.34);
    }
    await click('#inspector button[type=submit]');
    await status('已应用属性。');
    return evaluate(`[...document.querySelector('#view-target').options].find(option => option.text === ${JSON.stringify(name)}).value`);
  }
  async function saveView({ mode, title, target, parents = [], hotspot, configure }) {
    await set('#navigation-view', '', 'change');
    await set('#navigation-mode', mode, 'change');
    await set('#view-title', title);
    await set('#view-target', target);
    if (parents.length) await set('#view-parents', parents);
    if (hotspot) await set('#view-hotspot', hotspot);
    if (configure) await configure();
    await click('#save-view');
    await status('已保存展示导航。');
    return evaluate("document.querySelector('#navigation-view').value");
  }
  async function download(kind, selector, path) {
    selectDownload(kind);
    const done = new Promise((resolve, reject) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.once('done', (_finished, state) => state === 'completed' ? resolve() : reject(new Error(state)));
      });
    });
    await click(selector);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error(`${kind} download timed out`)), 10000))]);
    return fs.readFileSync(path);
  }

  await click('#new-project');
  await status('新工程已建立。');
  await set('#project-title', '四模式教学工程');
  await set('#scene-title', '示意场景 · 教学颗粒移动');
  await click('#scene-title-form button');
  await status('已重命名场景。');
  const cell = await addNode('教学细胞', '', 0, '#97bdb3');
  const system = await addNode('转运示意区', cell, 1.3, '#527e91');
  const protein = await addNode('示意蛋白质对象', system, 1.3, '#388775');
  const particle = await addNode('示意颗粒', system, -0.3, '#ef9d42', true);
  await click('#add-keyframe');
  await status('已保存关键帧。');
  await seek(2);
  await set('#position-x', 1.1);
  await click('#inspector button[type=submit]');
  await status('已应用属性。');
  await click('#add-keyframe');
  await status('已保存关键帧。');
  await set('#bookmark-name', '教学场景总览');
  await click('#add-bookmark');
  await status('已保存视角书签。');
  await evaluate("document.querySelector('#navigation-settings').open = true");
  await set('#view-target', '');
  await click('#save-view');
  assert.match(await evaluate("document.querySelector('.navigation-error').textContent"), /目标对象/);
  await evaluate("[...document.querySelectorAll('.navigation-form button')].find(button => button.textContent === '放弃草稿').click()");
  const cellView = await saveView({ mode: 'cell', title: '教学细胞总览', target: cell, configure: async () => {
    await click('#export-scene');
    await waitFor(studio, "document.querySelector('#status').textContent.includes('未保存的草稿')", 'export blocks an unsaved view draft');
    await set('#bookmark-name', '草稿期间新增镜头');
    await click('#add-bookmark');
    await status('已保存视角书签。');
    assert.equal(await evaluate("document.querySelector('#view-title').value"), '教学细胞总览');
    const bookmark = await evaluate("[...document.querySelector('#view-camera').options].find(option => option.text === '草稿期间新增镜头').value");
    await set('#view-camera', bookmark);
  } });
  const systemView = await saveView({ mode: 'system', title: '教学局部系统', target: system, parents: [cellView], hotspot: system });
  const proteinView = await saveView({ mode: 'protein', title: '教学蛋白质', target: protein, parents: [systemView], hotspot: protein });
  await saveView({ mode: 'mechanism', title: '教学机理', target: system, parents: [systemView, proteinView], configure: async () => {
    await set('#view-timed', true, 'change');
    await set('[data-step-title]', '示意 · 起点');
    await set('[data-step-nodes]', [particle]);
    await seek(0);
    await click('.navigation-step button');
    await seek(1);
    await click('#add-keyframe');
    await status('已保存关键帧。');
    assert.equal(await evaluate("document.querySelector('[data-step-title]').value"), '示意 · 起点');
    assert.equal(await evaluate("document.querySelector('[data-step-nodes]').selectedOptions[0].value"), particle);
    await click('#add-view-step');
    await set('.navigation-step:nth-child(2) [data-step-title]', '示意 · 接近对象');
    await set('.navigation-step:nth-child(2) [data-step-nodes]', [protein, particle]);
    await seek(2);
    await click('.navigation-step:nth-child(2) button');
  } });
  await click('#remove-node');
  await waitFor(studio, "document.querySelector('#status').textContent.includes('示意颗粒') && document.querySelector('#status').textContent.includes('教学机理')", 'referenced node deletion is explained');
  await click('#undo');
  await status('已撤销。');
  assert.equal(await evaluate("document.querySelector('#navigation-view').options.length"), 4);
  await click('#redo');
  await status('已重做。');
  const saved = await download('project', '#save-project', projectPath);
  fs.writeFileSync(path.join(directory, 'studio-four-modes.glow-project'), saved);
  const { project } = await decodeProject(saved);
  const expected = project.scenes[0].presentation.navigation;
  assert.deepEqual(expected.views.map(({ mode }) => mode), ['cell', 'system', 'protein', 'mechanism']);
  assert.deepEqual(expected.views[3].steps.map(({ time }) => time), [0, 2]);
  assert.ok(expected.views[0].bookmarkId);
  await click('#new-project');
  await status('新工程已建立。');
  await injectFile(studio, { name: 'm3.glow-project', data: saved, input: '#project-file' });
  await status('工程已打开。');
  await set('#navigation-view', expected.views[3].id, 'change');
  assert.equal(await evaluate("document.querySelectorAll('[data-step-title]').length"), 2);
  assert.deepEqual(await evaluate("[...document.querySelector('#view-parents').selectedOptions].map(option => option.value)"), [systemView, proteinView]);
  await captureWindow(studio, directory, 'studio-navigation', '#navigation-settings');
  const exported = await download('scene', '#export-scene', scenePath);
  fs.writeFileSync(path.join(directory, 'studio-four-modes.glow'), exported);
  assert.deepEqual((await readScenePackage(exported)).scene.presentation.navigation, expected);
  await injectFile(viewer, { name: 'm3.glow', data: exported, input: '#file' });
  await waitFor(viewer, "document.querySelector('#status').textContent === 'm3.glow'", 'Viewer opens authored export');
  assert.equal(await viewer.webContents.executeJavaScript("document.querySelector('#structure-enabled').checked"), false);
  for (const { id, mode } of expected.views.slice(1)) {
    await viewer.webContents.executeJavaScript(`document.querySelector('[data-view-id="${id}"]').click()`);
    await waitFor(viewer, `document.querySelector('#navigation-heading').dataset.mode === '${mode}'`, `Viewer enters authored ${mode}`);
  }
  await viewer.webContents.executeJavaScript(`document.querySelector('[data-step="1"]').click()`);
  assert.equal(await viewer.webContents.executeJavaScript("document.querySelector('#playhead').value"), '2');
  await captureWindow(viewer, directory, 'viewer-authored');
  await viewer.webContents.executeJavaScript("document.querySelector('#navigation-back').click()");
  assert.equal(await viewer.webContents.executeJavaScript("document.querySelector('#navigation-heading').dataset.mode"), 'protein');
}

async function run() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const networkRequests = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    if (process.env.GLOW_ATP_CIF && url.href === 'https://files.rcsb.org/download/6ZPO.cif') {
      callback({ redirectURL: `http://127.0.0.1:${port}/test/atp.cif` });
      return;
    }
    if ((process.env.GLOW_STRUCTURE_SCREENSHOTS || process.env.GLOW_COMMAND_SMOKE) && url.href === 'https://files.rcsb.org/download/4HHB.cif') {
      callback(process.env.GLOW_LIVE_STRUCTURE_SMOKE ? {} : { redirectURL: `http://127.0.0.1:${port}/test/structure.cif` });
      return;
    }
    if (process.env.GLOW_STRUCTURE_SCREENSHOTS && url.href === 'https://files.rcsb.org/download/9ZZZ.cif') {
      callback({ redirectURL: `http://127.0.0.1:${port}/test/unavailable.cif` });
      return;
    }
    if ((process.env.GLOW_LIVE_STRUCTURE_SMOKE || process.env.GLOW_ATP_SMOKE) && url.origin === 'https://files.rcsb.org' &&
        /^\/(download|header)\/[0-9][A-Z0-9]{3}\.cif$/.test(url.pathname)) {
      callback({});
      return;
    }
    if (process.env.GLOW_LIVE_STRUCTURE_SMOKE && url.origin === 'https://models.rcsb.org' &&
        /^\/v1\/[0-9][a-z0-9]{3}\/atoms$/.test(url.pathname) &&
        ['CA', 'P'].includes(url.searchParams.get('label_atom_id'))) {
      callback({});
      return;
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/three@0.160.0/')) {
      callback({ redirectURL: `http://127.0.0.1:${port}/desktop/vendor/three/${url.pathname.split('/three@0.160.0/')[1]}` });
      return;
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'blob:') {
      networkRequests.push(details.url); callback({ cancel: true }); return;
    }
    callback({});
  });

  const studio = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const studioErrors = [];
  studio.webContents.on('console-message', (_event, level, message) => { if (level >= 3) studioErrors.push(message); });
  studio.webContents.on('did-fail-load', (_event, code, description) => studioErrors.push(`load ${code}: ${description}`));
  const tempDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'glow-studio-smoke-'));
  const projectPath = path.join(tempDir, 'project.glow-project');
  const scenePath = path.join(tempDir, 'scene.glow');
  let nextDownload = 'project', resolveProject, rejectProject, resolveScene, rejectScene;
  const projectDownload = new Promise((resolve, reject) => { resolveProject = resolve; rejectProject = reject; });
  const sceneDownload = new Promise((resolve, reject) => { resolveScene = resolve; rejectScene = reject; });
  session.defaultSession.on('will-download', (_event, item) => {
    const mode = nextDownload;
    item.setSavePath(mode === 'project' ? projectPath : scenePath);
    item.once('done', (_event, state) => {
      const done = mode === 'project' ? resolveProject : resolveScene;
      const fail = mode === 'project' ? rejectProject : rejectScene;
      state === 'completed' ? done() : fail(new Error(`${mode} download ${state}`));
    });
  });

  let viewer;
  try {
    const { decodeProject } = await import(pathToFileURL(path.join(repo, 'packages/studio-editor/project-io.mjs')));
    const { readScenePackage } = await import(pathToFileURL(path.join(repo, 'packages/schema/archive.mjs')));
    const { GEOMETRY_MEDIA_TYPE } = await import(pathToFileURL(path.join(repo, 'packages/schema/geometry.mjs')));

    if (process.env.GLOW_COMMAND_SMOKE) {
      stage = 'command-api';
      const directory = process.env.GLOW_COMMAND_SMOKE;
      fs.mkdirSync(directory, { recursive: true });
      viewer = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false,
        webPreferences: { backgroundThrottling: false } });
      const errors = [];
      viewer.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
      await viewer.loadURL(`http://127.0.0.1:${port}/apps/viewer-web/index.html?startup=skip&dev=1`);
      await waitFor(viewer, "document.querySelector('#status').textContent === '基础几何示例' && Boolean(window.glow)", 'command startup');
      viewer.show();
      const run = (source) => viewer.webContents.executeJavaScript(source);
      const accession = await run("glow.load({pdb:'4HHB'})");
      assert(accession.plugins.some(({ id }) => id === 'org.glow.structure'));
      assert.equal(accession.sources[0].source.accession, '4HHB');
      const pack = { format: 'glow-scene', version: 1, id: 'api-structure', title: 'API structure',
        scene: { structure: { name: 'structure.cif', text: structureCif.toString() } } };
      // Reuse the schema-valid v1 wrapper from the structure workflow.
      const legacy = JSON.parse(fs.readFileSync(path.join(repo, 'workshop/official/packs/official.atp-synthase.glow'), 'utf8'));
      legacy.id = 'api-structure'; legacy.title = 'API structure';
      legacy.scene = { ...legacy.scene, id: '4HHB', process: undefined, components: undefined,
        structure: pack.scene.structure };
      await run(`glow.load({packText:${JSON.stringify(JSON.stringify(legacy))}})`);
      const picked = await run("glow.select({chainId:'X',residueId:{authSeqId:'8',insertionCode:'B'}})");
      assert(picked.atoms > 0); assert.equal(picked.highlighted.insertionCode, 'B');
      await run("glow.represent('blob')");
      await assert.rejects(run("glow.represent('unknown')"), /表示应为/);
      await assert.rejects(run("glow.load({pdb:'INVALID'})"), /PDB 编号/);
      await assert.rejects(run("glow.load({url:'https://evil.example/model.cif'})"), /只允许/);
      const before = await run('glow.info()');
      const exported = await run('glow.exportPack()');
      const bytes = Buffer.from(exported.data, 'base64');
      const decoded = await readScenePackage(bytes);
      assert(decoded.scene.assets.some((asset) => asset.provenance?.parserVersion));
      const validation = await run(`glow.validatePack(${JSON.stringify(exported)})`);
      assert.equal(validation.ok, true);
      await run("glow.select('none')");
      await run(`glow.load(${JSON.stringify(exported)})`);
      const reopened = await run('glow.info()');
      assert.deepEqual(reopened.selection, before.selection);
      assert.equal(reopened.representation, 'blob');
      assert.deepEqual(reopened.camera, before.camera);
      const screenshot = await run('glow.snapshot({width:800})');
      assert(screenshot.startsWith('data:image/png;base64,'));
      fs.writeFileSync(path.join(directory, 'api-snapshot.png'), Buffer.from(screenshot.split(',')[1], 'base64'));
      const bridge = await run(`new Promise(resolve=>{
        const listener=e=>{if(e.data?.glow==='reply'&&e.data.id==='smoke'){removeEventListener('message',listener);resolve(e.data)}};
        addEventListener('message',listener);postMessage({glow:'cmd',id:'smoke',cmd:'info'},location.origin);
      })`);
      assert.equal(bridge.ok, true); assert.equal(bridge.result.sceneId, reopened.sceneId);
      await run("glow.animate({time:0,step:0.1,steps:2})");
      assert.equal((await run('glow.info()')).paused, true);
      assert((await viewportPixels(viewer)).colored > 100);
      await captureWindow(viewer, directory, 'command-workflow', '#structure-tools');
      assert.deepEqual(errors, []);
      assert.deepEqual(networkRequests, []);
      console.log(JSON.stringify({ ok: true, commands: true, embed: true, exportRoundTrip: true }));
      return;
    }

    if (process.env.GLOW_ATP_SMOKE) {
      stage = 'atp-player';
      const directory = process.env.GLOW_ATP_SMOKE;
      fs.mkdirSync(directory, { recursive: true });
      viewer = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false,
        webPreferences: { backgroundThrottling: false } });
      const errors = [];
      viewer.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
      await viewer.loadURL(`http://127.0.0.1:${port}/apps/viewer-web/index.html?startup=skip`);
      await waitFor(viewer, "document.querySelector('#status').textContent === '基础几何示例'", 'Viewer startup');
      viewer.show();
      nextDownload = 'scene';
      await verifyAtpPlayer(viewer, directory, scenePath, readScenePackage);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ ok: true, atpPlayer: true, surface: true, playbackRoundTrip: true }));
      return;
    }

    const structureOutput = process.env.GLOW_STRUCTURE_SCREENSHOTS;
    if (structureOutput) {
      stage = 'structure-workflow';
      fs.mkdirSync(structureOutput, { recursive: true });
      viewer = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false,
        webPreferences: { backgroundThrottling: false } });
      const viewerErrors = [];
      viewer.webContents.on('console-message', (_event, level, message) => { if (level >= 3) viewerErrors.push(message); });
      await viewer.loadURL(`http://127.0.0.1:${port}/apps/viewer-web/index.html?startup=skip`);
      await waitFor(viewer, "document.querySelector('#status').textContent === '基础几何示例'", 'Viewer startup');
      viewer.show();
      nextDownload = 'scene';
      await verifyStructureWorkflow(viewer, structureOutput, scenePath, readScenePackage);
      assert.deepEqual(viewerErrors.filter((message) => !message.includes('503 (Service Unavailable)')), []);
      assert.deepEqual(networkRequests, []);
      console.log(JSON.stringify({ ok: true, structureWorkflow: true,
        rcsbFixture: !process.env.GLOW_LIVE_STRUCTURE_SMOKE, legacyPrimaryStructure: true, legacyComposite: true }));
      return;
    }

    stage = 'studio-start';
    await studio.loadURL(`http://127.0.0.1:${port}/apps/studio-web/index.html?startup=skip`);
    await waitFor(studio, `document.querySelector('#status').textContent === '新工程已建立。' && document.querySelector('#scene-picker').options.length === 1`, 'Studio startup');
    studio.show();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const m0Output = process.env.GLOW_M0_SCREENSHOTS;
    if (m0Output) {
      fs.mkdirSync(m0Output, { recursive: true });
      await captureWindow(studio, m0Output, 'studio-baseline');
    }

    stage = 'structure-import';
    const rawPdb = syntheticPdb();
    await injectFile(studio, { name: 'p4-synthetic.pdb', data: rawPdb });
    await waitFor(studio, `document.querySelector('#status').textContent === '已导入 p4-synthetic.pdb。' && document.querySelector('#scene-picker').options.length === 2`, 'synthetic PDB import');
    assert.ok(await studio.webContents.executeJavaScript(`document.querySelector('#scene-tree').textContent.includes('Chain A')`));

    stage = 'primitive-edit-undo-redo';
    await studio.webContents.executeJavaScript(`document.querySelector('#add-box').click()`);
    await waitFor(studio, `document.querySelector('#status').textContent === '已添加方盒。' && document.querySelector('#node-name').value === '方盒'`, 'box creation');
    await studio.webContents.executeJavaScript(`(() => {
      const $=(id)=>document.getElementById(id);
      $('node-name').value='P4 Box'; $('node-color').value='#d040f0'; $('position-x').value='0.5';
      $('inspector').requestSubmit();
    })()`);
    await waitFor(studio, `document.querySelector('#status').textContent === '已应用属性。' && document.querySelector('#node-name').value === 'P4 Box' && document.querySelector('#position-x').value === '0.5'`, 'inspector batch edit');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const gizmoView = await viewportPixels(studio);
    assert.ok(gizmoView.axes.red > 5 && gizmoView.axes.green > 5 && gizmoView.axes.blue > 5,
      `expected visible RGB transform gizmo, got ${JSON.stringify(gizmoView.axes)}`);
    await studio.webContents.executeJavaScript(`document.querySelector('#undo').click()`);
    await waitFor(studio, `document.querySelector('#node-name').value === '方盒' && document.querySelector('#position-x').value === '0' && document.querySelector('#node-color').value === '#31846b'`, 'single undo restores full inspector batch');
    await studio.webContents.executeJavaScript(`document.querySelector('#redo').click()`);
    await waitFor(studio, `document.querySelector('#node-name').value === 'P4 Box' && document.querySelector('#position-x').value === '0.5' && document.querySelector('#node-color').value === '#d040f0'`, 'single redo reapplies full inspector batch');

    stage = 'primitive-group';
    await studio.webContents.executeJavaScript(`document.querySelector('#add-sphere').click()`);
    await waitFor(studio, `document.querySelector('#scene-tree').textContent.includes('球体')`, 'sphere creation');
    await studio.webContents.executeJavaScript(`(() => [...document.querySelectorAll('#scene-tree button')].find((b)=>b.textContent==='P4 Box').click())()`);
    await waitFor(studio, `document.querySelector('#node-name').value === 'P4 Box'`, 'reselect box');
    await studio.webContents.executeJavaScript(`document.querySelector('#group-node').click()`);
    await waitFor(studio, `document.querySelector('#scene-tree').textContent.includes('组') && document.querySelector('#status').textContent === '已将对象加入组。'`, 'group operation');
    await studio.webContents.executeJavaScript(`(() => [...document.querySelectorAll('#scene-tree button')].find((b)=>b.textContent==='P4 Box').click())()`);
    await waitFor(studio, `document.querySelector('#node-name').value === 'P4 Box'`, 'select grouped box');

    stage = 'timeline-two-keys';
    await studio.webContents.executeJavaScript(`(() => { const p=document.querySelector('#studio-playhead'); p.value='0'; p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#add-keyframe').click(); })()`);
    await waitFor(studio, `document.querySelector('#studio-time').value.startsWith('0.00')`, 'keyframe at zero');
    await studio.webContents.executeJavaScript(`(() => { const p=document.querySelector('#studio-playhead'); p.value='2'; p.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await waitFor(studio, `document.querySelector('#studio-time').value.startsWith('2.00')`, 'seek to second key');
    await studio.webContents.executeJavaScript(`(() => { document.querySelector('#position-x').value='1.25'; document.querySelector('#inspector').requestSubmit(); })()`);
    await waitFor(studio, `document.querySelector('#status').textContent === '已应用属性。' && document.querySelector('#position-x').value === '1.25'`, 'edit second pose');
    await studio.webContents.executeJavaScript(`document.querySelector('#add-keyframe').click()`);
    await waitFor(studio, `document.querySelector('#status').textContent === '已保存关键帧。'`, 'keyframe at two seconds');

    stage = 'presentation-metadata';
    await studio.webContents.executeJavaScript(`(() => {
      const $=(id)=>document.getElementById(id);
      $('annotation').value='Synthetic model note'; $('add-annotation').click();
      $('evidence-kind').value='source'; $('citation').value='Local synthetic coordinate fixture'; $('add-evidence').click();
      $('bookmark-name').value='P4 camera'; $('add-bookmark').click();
    })()`);
    await waitFor(studio, `document.querySelector('#annotation-list').textContent.includes('Synthetic model note') && document.querySelector('#evidence-list').textContent.includes('Local synthetic coordinate fixture') && document.querySelector('#bookmark-list').textContent.includes('P4 camera')`, 'annotation, evidence and bookmark');
    await studio.webContents.executeJavaScript(`document.querySelector('#project-title').value='P4 Smoke Project'`);

    stage = 'save-project';
    nextDownload = 'project';
    await studio.webContents.executeJavaScript(`document.querySelector('#save-project').click()`);
    await Promise.race([projectDownload, new Promise((_, reject) => setTimeout(() => reject(new Error('project download timeout')), 10000))]);
    const projectBytes = new Uint8Array(fs.readFileSync(projectPath));
    const decoded = await decodeProject(projectBytes);
    assert.equal(decoded.project.title, 'P4 Smoke Project');
    assert.equal(decoded.project.scenes.length, 2);
    const structureScene = decoded.project.scenes.find((scene) => scene.assets.some((asset) => asset.mediaType === 'chemical/x-pdb'));
    assert.ok(structureScene);
    assert.equal(structureScene.timeline.tracks.find((track) => track.nodeId === structureScene.nodes.find((node) => node.name === 'P4 Box')?.id)?.keyframes.length, 2);
    assert.equal(structureScene.presentation.notes[0].text, 'Synthetic model note');
    assert.equal(structureScene.presentation.bookmarks[0].name, 'P4 camera');
    assert.ok(structureScene.evidence.some((entry) => entry.citation === 'Local synthetic coordinate fixture'));
    const sourceAsset = structureScene.assets.find((asset) => asset.mediaType === 'chemical/x-pdb');
    const sceneResources = decoded.resourcesByScene.get(structureScene.id);
    const sourceBytes = sceneResources.get(sourceAsset.path);
    assert.deepEqual(Buffer.from(sourceBytes), rawPdb);
    const sourceHash = crypto.createHash('sha256').update(rawPdb).digest('hex');
    assert.equal(sourceAsset.sha256, sourceHash);

    stage = 'reopen-project';
    await studio.webContents.executeJavaScript(`document.querySelector('#new-project').click()`);
    await waitFor(studio, `document.querySelector('#status').textContent === '新工程已建立。' && document.querySelector('#scene-picker').options.length === 1`, 'reset before project reopen');
    await injectFile(studio, { name: 'saved-project.glow-project', data: projectBytes, input: '#project-file' });
    await waitFor(studio, `document.querySelector('#status').textContent === '工程已打开。' && document.querySelector('#project-title').value === 'P4 Smoke Project' && document.querySelector('#scene-picker').options.length === 2`, 'reopen saved project');
    await studio.webContents.executeJavaScript(`(() => [...document.querySelectorAll('#scene-tree button')].find((b)=>b.textContent==='P4 Box').click())()`);
    await waitFor(studio, `document.querySelector('#node-name').value === 'P4 Box' && document.querySelector('#position-x').value === '1.25'`, 'reopened edited transform');
    assert.ok(await studio.webContents.executeJavaScript(`document.querySelector('#annotation-list').textContent.includes('Synthetic model note')`));
    assert.ok(await studio.webContents.executeJavaScript(`document.querySelector('#bookmark-list').textContent.includes('P4 camera')`));

    stage = 'export-scene';
    nextDownload = 'scene';
    await studio.webContents.executeJavaScript(`document.querySelector('#export-scene').click()`);
    await Promise.race([sceneDownload, new Promise((_, reject) => setTimeout(() => reject(new Error('scene export timeout')), 10000))]);
    const sceneBytes = new Uint8Array(fs.readFileSync(scenePath));
    const { scene: exportedScene, resources } = await readScenePackage(sceneBytes);
    assert.equal(exportedScene.format, 'glow-scene');
    assert.equal(exportedScene.timeline.tracks.find((track) => track.nodeId === exportedScene.nodes.find((node) => node.name === 'P4 Box')?.id)?.keyframes.length, 2);
    assert.equal(exportedScene.presentation.notes[0].text, 'Synthetic model note');
    assert.equal(exportedScene.presentation.bookmarks[0].name, 'P4 camera');
    assert.ok(exportedScene.evidence.some((entry) => entry.citation === 'Local synthetic coordinate fixture'));
    const exportedSource = exportedScene.assets.find((asset) => asset.mediaType === 'chemical/x-pdb');
    assert.deepEqual(Buffer.from(resources.get(exportedSource.path)), rawPdb);
    assert.equal(exportedSource.sha256, sourceHash);
    assert.ok(exportedScene.assets.some((asset) => asset.mediaType === GEOMETRY_MEDIA_TYPE));

    stage = 'viewer-open-and-playback';
    viewer = new BrowserWindow({ width: 1060, height: 780, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const viewerErrors = [];
    viewer.webContents.on('console-message', (_event, level, message) => { if (level >= 3) viewerErrors.push(message); });
    viewer.webContents.on('did-fail-load', (_event, code, description) => viewerErrors.push(`load ${code}: ${description}`));
    await viewer.loadURL(`http://127.0.0.1:${port}/apps/viewer-web/index.html?startup=skip`);
    await waitFor(viewer, `document.querySelector('#status').textContent === '基础几何示例'`, 'Viewer starts with structure plugin disabled');
    viewer.show();
    await injectFile(viewer, { name: 'studio-export.glow', data: sceneBytes, type: 'application/zip', input: '#file' });
    await waitFor(viewer, `document.querySelector('#status').textContent === 'studio-export.glow' && !document.querySelector('#presentation').hidden`, 'Viewer opens exported package');
    assert.ok(await viewer.webContents.executeJavaScript(`document.querySelector('#viewer-notes').textContent.includes('Synthetic model note')`));
    assert.ok(await viewer.webContents.executeJavaScript(`document.querySelector('#viewer-evidence').textContent.includes('Local synthetic coordinate fixture')`));
    assert.ok(await viewer.webContents.executeJavaScript(`document.querySelector('#viewer-bookmarks').textContent.includes('P4 camera')`));
    assert.equal(await viewer.webContents.executeJavaScript(`document.querySelector('#playhead').max`), '4');
    await waitFor(viewer, `document.querySelector('#close').disabled === false`, 'Viewer has active scene');
    await waitFor(viewer, `document.querySelector('#time').value.startsWith('0.00')`, 'Viewer timeline ready');
    const viewportImage = await viewportPixels(viewer);
    // The OS can cap the client height below the requested 780 px, reducing projected area.
    const minColored = 1000 * Math.min(1, viewportImage.height / 780) ** 2;
    assert.ok(viewportImage.colored > minColored,
      `Viewer did not display exported geometry (${viewportImage.colored} colored pixels at height ${viewportImage.height})`);
    await viewer.webContents.executeJavaScript(`document.querySelector('#play').click()`);
    await waitFor(viewer, `document.querySelector('#play').textContent === '暂停'`, 'Viewer playback starts');
    await waitFor(viewer, `Number(document.querySelector('#time').value.split(' / ')[0]) > 0.2`, 'Viewer timeline advances');
    if (m0Output) {
      stage = 'm0-presentation-demo';
      await verifyPresentationDemo(viewer, m0Output, scenePath, readScenePackage);
    }
    const m1Output = process.env.GLOW_M1_SCREENSHOTS;
    if (m1Output) {
      stage = 'm1-navigation';
      fs.mkdirSync(m1Output, { recursive: true });
      await verifyNavigation(viewer, m1Output);
    }
    const m3Output = process.env.GLOW_M3_SCREENSHOTS;
    if (m3Output) {
      stage = 'm3-navigation-authoring';
      fs.mkdirSync(m3Output, { recursive: true });
      await verifyNavigationAuthoring(studio, viewer, m3Output, {
        projectPath, scenePath, selectDownload: (mode) => { nextDownload = mode; }, decodeProject, readScenePackage,
      });
    }
    assert.equal(studioErrors.length, 0, studioErrors.join('\n'));
    assert.equal(viewerErrors.length, 0, viewerErrors.join('\n'));
    assert.equal(networkRequests.length, 0, `unexpected external requests: ${networkRequests.join(', ')}`);
    console.log(JSON.stringify({
      ok: true, sourceSha256: sourceHash, scenes: decoded.project.scenes.length,
      keyframes: 2, notes: exportedScene.presentation.notes.length, evidence: exportedScene.evidence.length,
      bookmarks: exportedScene.presentation.bookmarks.length, viewerPlayback: true, inspectorUndoRedo: true,
      ...(m0Output ? { m0PresentationRoundTrip: true, olderV1Import: true, failedLoadRetainsScene: true } : {}),
      ...(m1Output ? { m1Navigation: true, reducedMotion: true, navigationResourcesReleased: true, m2ModePanels: true } : {}),
      ...(m3Output ? { m3NavigationAuthoring: true, m3ProjectAndSceneRoundTrip: true } : {}),
      gizmoAxisPixels: gizmoView.axes, noExternalRequests: true,
    }));
  } finally {
    viewer?.destroy();
    studio.destroy();
    server.close();
    app.quit();
    try { fs.unlinkSync(projectPath); } catch {}
    try { fs.unlinkSync(scenePath); } catch {}
    try { fs.rmdirSync(tempDir); } catch {}
  }
}

run().catch((error) => { console.error(`[${stage}]`, error.stack || error); app.exit(1); });
