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
  return { colored, axes: { red, green, blue } };
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

async function run() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const networkRequests = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
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

    stage = 'studio-start';
    await studio.loadURL(`http://127.0.0.1:${port}/apps/studio-web/index.html`);
    await waitFor(studio, `document.querySelector('#status').textContent === '新工程已建立。' && document.querySelector('#scene-picker').options.length === 1`, 'Studio startup');
    studio.show();
    await new Promise((resolve) => setTimeout(resolve, 250));

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
    await viewer.loadURL(`http://127.0.0.1:${port}/apps/viewer-web/index.html`);
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
    assert.ok(viewportImage.colored > 1000, `Viewer did not display exported geometry (${viewportImage.colored} colored pixels)`);
    await viewer.webContents.executeJavaScript(`document.querySelector('#play').click()`);
    await waitFor(viewer, `document.querySelector('#play').textContent === '暂停'`, 'Viewer playback starts');
    await waitFor(viewer, `Number(document.querySelector('#time').value.split(' / ')[0]) > 0.2`, 'Viewer timeline advances');
    assert.equal(studioErrors.length, 0, studioErrors.join('\n'));
    assert.equal(viewerErrors.length, 0, viewerErrors.join('\n'));
    assert.equal(networkRequests.length, 0, `unexpected external requests: ${networkRequests.join(', ')}`);
    console.log(JSON.stringify({
      ok: true, sourceSha256: sourceHash, scenes: decoded.project.scenes.length,
      keyframes: 2, notes: exportedScene.presentation.notes.length, evidence: exportedScene.evidence.length,
      bookmarks: exportedScene.presentation.bookmarks.length, viewerPlayback: true, inspectorUndoRedo: true,
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
