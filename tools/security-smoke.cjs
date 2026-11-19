// Actual Electron renderer regression: parser -> DOM and real parent/iframe consent UI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');

async function probe({ kind, cif, network }) {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async (predicate, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 30)); }
    const child = document.querySelector('iframe')?.contentWindow;
    throw Error('Timeout: ' + label + ' ' + JSON.stringify({name:child?.__viewer?.current?.()?.name, status:child?.document?.querySelector('#status')?.textContent,disabled:child?.document?.querySelector('#load')?.disabled}));
  };
  function inject(w, name, text) {
    const transfer = new w.DataTransfer(); transfer.items.add(new w.File([text], name));
    const input = w.document.querySelector('#file'); input.files = transfer.files; input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  if (kind === 'network-live') {
    await wait(() => window.glowDesktop?.cacheInfo, 'desktop cache');
    const before = await glowDesktop.cacheInfo();
    const fetchBytes = async () => {
      const response = await fetch(network.url); assert(response.ok, 'live HTTP failed');
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      assert(hash === network.sha256, 'live structure hash mismatch'); return bytes.byteLength;
    };
    const size = await fetchBytes(), first = await glowDesktop.cacheInfo(); await fetchBytes(); const second = await glowDesktop.cacheInfo();
    assert(first.miss === before.miss + 1 && second.hit === first.hit + 1, 'network/cache path not exercised');
    assert(size === network.bytes && second.files === 1, 'partial or duplicated cache payload');
    return {liveRetrieval:true, hash:network.sha256, bytes:size, atomicDiskCache:true, subsequentCacheHit:true};
  }
  if (kind === 'classic-dom') {
    await wait(() => window.__viewer && window.glow, 'classic');
    window.__xss = 0;
    const fetchOriginal = window.fetch;
    window.fetch = (url, options) => String(url).includes('residueSurroundings') ? Promise.resolve(new Response(cif))
      : String(url).includes('/ligand') ? Promise.resolve(new Response('', { status: 404 })) : fetchOriginal(url, options);
    inject(window, 'malicious.cif', cif);
    await wait(() => document.querySelector('#legend').textContent.includes('<img/src=x/onerror='), 'ligand legend');
    assert(!document.querySelector('#legend img,#legend svg'), 'legend parsed input HTML');
    assert(document.querySelector('#legend .nm').title.includes('<svg/'), 'entity title preserved');
    const ligand = __viewer.model().ligands[0];
    // Local structures have no remote binding-site source; emulate a ModelServer response
    // with the same synthetic coordinates to exercise the real focus renderer.
    ligand.src = 'security-fixture'; ligand.asym0 = ligand.asym;
    const buttons = document.querySelectorAll('#legend .fbtn'); buttons[buttons.length - 1].click();
    await wait(() => document.querySelector('#infoT').textContent.includes('结合位点'), 'binding site');
    assert(document.querySelector('#infoB').textContent.includes('<svg/'), 'host/contact labels lost');
    assert(!document.querySelector('#infoB img,#infoB svg'), 'binding site parsed input HTML');
    await new Promise(r => setTimeout(r, 150)); assert(window.__xss === 0, 'injected script executed');
    const pocket = document.querySelector('#pocketBtn'); assert(pocket, 'normal focus controls missing');
    assert(document.querySelector('#infoB').textContent.includes('氢键（1）'), 'interaction path not exercised');
    const bridge = await __viewer.bridgeTest(); assert(!bridge.unsafeAnswered.length, 'classic bridge bypass');
    const title = document.querySelector('#infoT').textContent;
    return { parserToLegend: true, bindingSiteTextOnly: true, focusControls: true, scriptExecutions: window.__xss, title };
  }
  await wait(() => document.querySelector('#status'), 'host');
  const frame = document.createElement('iframe'); frame.id = 'security-viewer'; frame.title = '嵌入权限回归';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background:white;border:0;z-index:100';
  const classic = kind === 'embed-classic';
  frame.src = classic ? 'app://glow/index.html?dev=1&ws=local-test&startup=skip&q=low' : 'app://glow/apps/viewer-web/index.html?dev=1&startup=skip'; document.body.append(frame);
  const child = frame.contentWindow;
  await wait(() => typeof child.glow?.run === 'function' && (classic || child.document.querySelector('#status').textContent === '基础几何示例'), 'embedded Viewer');
  if (!classic) {
    child.document.querySelector('#structure-enabled').click();
    await wait(() => !child.document.querySelector('#rcsb-load').disabled, 'structure plugin');
  }
  const loaded = name => classic ? child.__viewer?.current()?.name === name && !child.document.querySelector('#load').disabled : child.document.querySelector('#status').textContent === name;
  const pdb = [0, 3.8, 7.6, 11.4].map((x,i) => 'ATOM  '+String(i+1).padStart(5)+'  CA  GLY A'+String(i+1).padStart(4)+'    '+x.toFixed(3).padStart(8)+'   0.000   0.000  1.00  0.00           C').join('\n')+'\nEND\n';
  inject(child, 'private-structure.pdb', pdb);
  await wait(() => loaded('private-structure.pdb'), 'private file');
  let seq = 0; const responses = new Map();
  window.addEventListener('message', event => { if (event.source === child && event.data?.glow === 'reply') responses.set(event.data.id, event.data); });
  const send = (cmd, args) => {
    const id = ++seq; child.postMessage({ glow:'cmd',id,cmd,args }, location.origin);
    return { id, result: async () => { await wait(() => responses.has(id), cmd + ' reply'); return responses.get(id); } };
  };
  const control = action => child.document.querySelector(`#glow-bridge-permissions [data-action=${action}]`);
  const help = await send('help').result(); assert(help.ok, 'help rejected'); assert(!control('allow'), 'help requested data consent');
  const denied = send('exportPack'); await wait(() => control('deny'), 'sensitive prompt'); control('deny').click();
  assert(!(await denied.result()).ok, 'export not denied'); control('revoke').click();
  const camera = send('camera', 'reset'); await wait(() => control('allow'), 'control prompt'); control('allow').click();
  assert(JSON.stringify((await camera.result()).result) === JSON.stringify({accepted:true}), 'control leaked detailed result');
  const info = send('info'); await wait(() => control('allow'), 'separate data prompt');
  assert(child.document.querySelector('#glow-bridge-permissions').textContent.includes('未公开数据'), 'data disclosure absent');
  control('allow').click(); const details = await info.result(); assert(details.ok && JSON.stringify(details.result).includes('private-structure.pdb'), 'consented data unavailable');
  const pack = await send('exportPack').result(); assert(pack.ok && (classic ? pack.result.scene?.structure?.text === pdb : pack.result.encoding === 'base64'), 'consented export unavailable');
  control('revoke').click(); const afterRevoke = send('snapshot'); await wait(() => control('allow'), 'revoke reprompt'); control('deny').click(); assert(!(await afterRevoke.result()).ok, 'revoke ignored');
  // Scene replacement must reset both a denial and previous grants.
  inject(child, 'second-private.pdb', pdb);
  await wait(() => loaded('second-private.pdb'), 'replacement');
  const pending = send('info'); await wait(() => control('allow'), 'new scene consent');
  inject(child, 'third-private.pdb', pdb);
  assert(!(await pending.result()).ok, 'pending permission survived scene change');
  await wait(() => loaded('third-private.pdb'), 'third scene');
  // Leave an actual disclosure prompt visible for screenshot review.
  send('info'); await wait(() => control('allow'), 'final prompt');
  return { realParentIframe:true, refusedExport:true, separateScopes:true, mutationReplyRedacted:true,
    explicitPrivateFileRead:true, revoke:true, sceneChange:true, exportBytes:classic ? JSON.stringify(pack.result).length : atob(pack.result.data).length };
}

async function main(args = process.argv.slice(2)) {
  const option = name => args.includes(name) ? args[args.indexOf(name)+1] : undefined;
  const output = path.resolve(option('--output') ?? 'desktop/dist/security-smoke'); fs.mkdirSync(output,{recursive:true});
  const stage = path.resolve(option('--stage') ?? execFileSync(process.execPath,['desktop/scripts/package-platform.cjs','--stage-only'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/).at(-1));
  const exe = option('--exe') ? path.resolve(option('--exe')) : path.join(repo,'desktop/node_modules/electron/dist/electron.exe');
  const reports = [];
  for (const kind of ['classic-dom','embed-consent','embed-classic', ...(option('--live') ? ['network-live'] : [])].filter(kind => !option('--case') || kind === option('--case'))) {
    const dir=path.join(output,kind);fs.mkdirSync(dir,{recursive:true});
    const profile=path.join(dir,'profile'), script=path.join(dir,'probe.js'), reportFile=path.join(dir,'report.json');
    fs.writeFileSync(script,`(${probe.toString()})(${JSON.stringify({kind,network:require('./fixtures/structures.json').structures.find(x=>x.id==='1K4C'),cif:fs.readFileSync(path.join(repo,'tools/fixtures/security/malicious.cif'),'utf8')})})`);
    const env={...process.env,GLOW_SMOKE:'120',GLOW_SMOKE_JS:script,GLOW_SMOKE_REPORT:reportFile,GLOW_SMOKE_PROFILE:profile,
      GLOW_SMOKE_OFFLINE:kind==='network-live'?'0':'1',GLOW_QUERY:'?ws=local-test&startup=skip&q=low'};
    delete env.ELECTRON_RUN_AS_NODE;delete env.GLOW_PAGE;
    if(kind!=='classic-dom')env.GLOW_PAGE='studio.html';
    const out=fs.openSync(path.join(dir,'stdout.log'),'w'),err=fs.openSync(path.join(dir,'stderr.log'),'w');
    const child=spawn(exe,[...(option('--exe')?[]:[stage]),'--enable-unsafe-swiftshader','--use-angle=swiftshader',`--user-data-dir=${profile}`],{env,windowsHide:true,stdio:['ignore',out,err]});
    let timer;
    try {
      const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error(kind+' timeout'));},150000);})]);
      const report=JSON.parse(fs.readFileSync(reportFile));assert.equal(code,0,JSON.stringify(report.errors));assert.equal(report.ok,true,JSON.stringify(report.errors));
      reports.push({kind,result:report.result,packaged:report.packaged,build:report.build});console.log(kind+': ok');
    }finally{clearTimeout(timer);fs.closeSync(out);fs.closeSync(err);}
  }
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({ok:true,reports},null,2));
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
