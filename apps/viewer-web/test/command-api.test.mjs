import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandApi, attachCommandBridge } from '../command-api.mjs';
import { attachScopedCommandBridge } from '../../../src/api/embed-permissions.js';

test('commands serialize mutations, copy arguments, and recover after a failure', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const { api } = createCommandApi({
    async load(value) { await gate; seen.push(value); throw new Error('failed'); },
    select(value) { seen.push(value); return value; },
  });
  const value = { pdb: '4HHB' };
  const first = assert.rejects(api.load(value), /failed/);
  value.pdb = 'oops';
  const second = api.select('chain A');
  release(); await first;
  assert.equal(await second, 'chain A');
  assert.deepEqual(seen, [{ pdb: '4HHB' }, 'chain A']);
  assert.deepEqual(api.log.map(({ ok }) => ok), [false, true]);
  assert.deepEqual(api.log[0].args, { omitted: true });
  api.log.pop(); assert.equal(api.log.length, 2);
  await assert.rejects(api.run('style'), /尚不支持/);
});

test('replay skips reads, failed commands and files; disposal rejects queued work', async () => {
  const seen = [];
  const { api, dispose } = createCommandApi({ select: (value) => { seen.push(value); } });
  const results = await api.replay([
    { cmd: 'info', ok: true }, { cmd: 'load', ok: true, args: { omitted: true } },
    { cmd: 'select', ok: false, args: 'chain B' }, { cmd: 'select', ok: true, args: 'chain A' },
  ]);
  assert.deepEqual(seen, ['chain A']);
  assert.equal(results.filter(({ skipped }) => skipped).length, 3);
  const queued = api.select('chain B'); dispose();
  await assert.rejects(queued, /已关闭/);
  await assert.rejects(api.info(), /已关闭/);
});

function bridgeHarness({ consent = async () => true, scene = { id: 1 } } = {}) {
  const listeners = new Map(), replies = [], calls = [], asks = [];
  const parent = { postMessage: (...args) => replies.push(args) };
  const target = {
    location: { origin: 'http://localhost:8000', search: '?embed=1&origin=https://evil.example' }, parent,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
  };
  const commands = createCommandApi(Object.fromEntries(['info','snapshot','exportPack','camera','animate','load','select','measure','sequence','color','clip'].map(cmd => [cmd, value => { calls.push(cmd); return { secret: 'private.cif', value }; }])));
  const detach = attachCommandBridge(target, commands.api, { getSceneToken: () => scene, requestConsent: (origin, scope, signal) => { asks.push(scope); return consent(scope, signal); } });
  replies.length = 0;
  const send = (cmd, { origin = 'https://nimenta727.github.io', source = parent, args } = {}) => listeners.get('message')?.({ origin, source, data: { glow: 'cmd', id: 7, cmd, args } });
  return { target, replies, calls, asks, send, detach, api: commands.api,
    revoke: () => listeners.get('glow:scene-changing')(), changeScene: () => { scene = { id: 2 }; } };
}

test('bridge rejects wrong origins, self, unrelated same-origin windows and opaque sources', async () => {
  const h = bridgeHarness();
  for (const origin of ['null', 'https://evil.example', 'http://localhost:8000', 'https://nimenta727.github.io.evil.example']) await h.send('info', { origin });
  await h.send('info', { source: h.target });
  await h.send('info', { source: { postMessage() { throw Error('unrelated frame'); } } });
  assert.deepEqual(h.calls, []); assert.deepEqual(h.asks, []);
  await h.send('help'); assert.equal(h.replies.at(-1)[0].ok, true); assert.deepEqual(h.asks, []);
  h.detach();
  assert.equal(await h.api.info().then(x => x.secret), 'private.cif'); // local API is unchanged
});

test('trusted origin needs explicit sensitive consent; denial is memoized and read adapters are not called', async () => {
  const h = bridgeHarness({ consent: async () => false });
  for (const cmd of ['info','snapshot','exportPack','log']) { await h.send(cmd); assert.equal(h.replies.at(-1)[0].ok, false); }
  assert.deepEqual(h.calls, []); assert.deepEqual(h.asks, ['sensitive']); h.detach();
});

test('scene control has a separate grant and cannot leak mutation info() results', async () => {
  const h = bridgeHarness({ consent: async scope => scope === 'scene' });
  for (const cmd of ['camera','animate','select']) {
    await h.send(cmd); assert.deepEqual(h.replies.at(-1)[0].result, { accepted: true });
  }
  await h.send('info'); assert.equal(h.replies.at(-1)[0].ok, false);
  assert.deepEqual(h.asks, ['scene', 'sensitive']);
  h.revoke(); await h.send('camera'); assert.deepEqual(h.asks, ['scene', 'sensitive', 'scene']); h.detach();
});

test('scene changes, request-window changes and revocation invalidate pending approval and queued reads', async () => {
  let release;
  const h = bridgeHarness({ consent: () => new Promise(resolve => { release = resolve; }) });
  const waiting = h.send('exportPack'); h.revoke(); release(true); await waiting;
  assert.deepEqual(h.calls, []); assert.equal(h.replies.at(-1)[0].ok, false);
  const next = h.send('snapshot'); h.changeScene(); release(true); await next;
  assert.deepEqual(h.calls, []);
  const last = h.send('info'); h.target.parent = {}; release(true); await last;
  assert.deepEqual(h.calls, []); h.detach();
  // A queued read authorized before revoke must not start after another command completes.
  const q = bridgeHarness(); let unblock;
  const block = createCommandApi({ select: async () => new Promise(resolve => { unblock = resolve; }), exportPack: () => { throw Error('must never run'); } });
  const busy = block.api.select('A'); await Promise.resolve();
  let guard = true;
  const queued = assert.rejects(block.api.run('exportPack', null, () => { if (!guard) throw Error('revoked'); }), /revoked/);
  guard = false; unblock(); await busy; await queued; q.detach();
});

test('sensitive results in flight are suppressed after revoke, and replay checks authorization per command', async () => {
  let finish, valid = true;
  const c = createCommandApi({ snapshot: () => new Promise(resolve => { finish = resolve; }), select: () => { valid = false; } });
  const pending = assert.rejects(c.api.run('snapshot', null, () => { if (!valid) throw Error('revoked'); }), /revoked/);
  await Promise.resolve(); valid = false; finish('secret-image'); await pending;
  valid = true;
  await assert.rejects(c.api.replay([{cmd:'select',args:'A',ok:true},{cmd:'select',args:'B',ok:true}], () => { if (!valid) throw Error('revoked'); }), /revoked/);
});

test('dev same-origin parent remains usable with consent; opt-out does not attach', async () => {
  const listeners = new Map(), calls = [];
  const parent = {postMessage(){}};
  const target = {parent, location:{origin:'app://glow',search:'?dev=1'}, addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
  const c=createCommandApi({camera:()=>{calls.push('camera');}});
  const detach=attachCommandBridge(target,c.api,{requestConsent:async()=>true});
  await listeners.get('message')({origin:'app://glow',source:parent,data:{glow:'cmd',cmd:'camera'}});
  assert.deepEqual(calls,['camera']); detach(); target.location.search='';
  attachCommandBridge(target,c.api); assert.equal(listeners.size,0);
});

test('shared classic bridge keeps other HTTPS control opt-in but blocks private reads', async () => {
  let listener; const replies=[],calls=[],asks=[];
  const parent={postMessage:value=>{if(value.glow==='reply')replies.push(value);}};
  const target={parent,location:{origin:'app://glow',search:'?embed=1'},addEventListener:(k,v)=>{if(k==='message')listener=v;},removeEventListener(){}};
  const api=createCommandApi({camera:()=>{calls.push('camera');return {private:'hidden'};},info:()=>{throw Error('blocked');}}).api;
  const detach=attachScopedCommandBridge(target,api,{commands:['camera','info'],allowControlFromOtherHttps:true,requestConsent:async(_origin,scope)=>{asks.push(scope);return true;}});
  for(const cmd of ['camera','info'])await listener({source:parent,origin:'https://example.org',data:{glow:'cmd',cmd}});
  assert.deepEqual(calls,['camera']);assert.deepEqual(asks,['scene']);
  assert.deepEqual(replies[0].result,{accepted:true});assert.equal(replies[1].ok,false);detach();
});

test('a successful load acknowledges without leaking info after it revokes its own scene grant', async () => {
  const h=bridgeHarness();
  // Use the same production queue guard semantics with a load that changes the scene.
  let listener, token=1;const replies=[];const parent={postMessage:x=>{if(x.glow==='reply')replies.push(x);}};
  const target={parent,location:{origin:'http://localhost',search:'?dev=1'},addEventListener:(k,v)=>{if(k==='message')listener=v;},removeEventListener(){}};
  const {api}=createCommandApi({load:()=>{token++;return {secret:'private'};}});
  const detach=attachCommandBridge(target,api,{getSceneToken:()=>token,requestConsent:async()=>true});
  await listener({source:parent,origin:'http://localhost',data:{glow:'cmd',cmd:'load'}});
  assert.deepEqual(replies.at(-1).result,{accepted:true});detach();h.detach();
});

test('remote command logs omit arguments from earlier private scenes', async () => {
  const h=bridgeHarness();
  await h.api.load({packText:'PRIVATE_COORDINATES'});
  await h.api.camera({private:'older-scene'});
  await h.send('log');
  const result=h.replies.at(-1)[0];assert.equal(result.ok,true);
  assert(!JSON.stringify(result).includes('PRIVATE_COORDINATES'));
  assert(!JSON.stringify(result).includes('older-scene'));
  assert(result.result.every(entry=>entry.args.omitted===true));h.detach();
});

test('commands that return residue names, distances or sequences need the sensitive consent; colour and clip are plain scene control', async () => {
  const h = bridgeHarness();
  await h.send('measure', { args: ['a', 'b'] }); await h.send('sequence');
  assert.deepEqual(h.asks, ['sensitive'], 'asked once for the sensitive scope, memoized for the second');
  assert.equal(h.replies.at(-1)[0].ok, true); assert.ok(h.replies.at(-1)[0].result.secret, 'a sensitive read gets the result');
  const control = bridgeHarness();
  await control.send('color', { args: 'chain' }); await control.send('clip', { args: { enabled: true } });
  assert.deepEqual(control.asks, ['scene']); assert.deepEqual(control.replies.at(-1)[0].result, { accepted: true }, 'control consent never returns scene data');
  h.detach(); control.detach();
});
