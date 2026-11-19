const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createResponseCache, CacheLimitError } = require('../../desktop/response-cache.cjs');
const { classifyNavigation, installNavigationPolicy } = require('../../desktop/network-policy.cjs');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
function cache(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-cache-security-'));
  t.after(() => {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'glow-cache-security-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, ...createResponseCache(dir, { maxResource: 16, maxTotal: 32, ...options }) };
}
const url = 'https://files.rcsb.org/download/test.cif';
function chunks(values, headers = {}) {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { const value = values.shift(); value === undefined ? controller.close() : controller.enqueue(Buffer.from(value)); }, cancel() { cancelled = true; } });
  return { response: new Response(stream, { headers }), cancelled: () => cancelled };
}

test('bounded disk stream accepts unknown lengths; metadata commits only a complete response', async t => {
  const c = cache(t), sample = chunks(['a', 'bcd']);
  const result = await c.download(url, () => sample.response);
  assert.equal(await result.text(), 'abcd');
  assert.equal(await c.read(url).text(), 'abcd');
  const meta = JSON.parse(fs.readFileSync(path.join(c.dir, fs.readdirSync(c.dir).find(f => f.endsWith('.json')))));
  assert.equal(meta.size, 4); assert.match(meta.sha256, /^[a-f0-9]{64}$/);
  assert(!fs.readdirSync(c.dir).some(f => f.endsWith('.part')));
});

test('oversized and lying responses cancel streams and leave no committed partial data', async t => {
  for (const [values, headers, pattern] of [
    [['x'], { 'content-length': '17' }, /limit/],
    [['0123456789', '0123456789', 'trailing'], {}, /limit/],
    [['0123456789', '0123456789', 'trailing'], { 'content-length': '2' }, /limit/],
    [['x'], { 'content-length': '4' }, /Incomplete/],
  ]) {
    const c = cache(t), sample = chunks(values, headers);
    await assert.rejects(c.download(url, () => sample.response), pattern);
    assert.equal(c.read(url), null); assert.deepEqual(fs.readdirSync(c.dir), []);
  }
});

test('HTTP errors preserve their status/body without creating a cache entry', async t => {
  const c=cache(t), response=await c.download(url,()=>new Response('not found',{status:404}));
  assert.equal(response.status,404);assert.equal(await response.text(),'not found');assert.equal(c.read(url),null);
});

test('request cancellation, stream failure and timeout retain previous complete cache', async t => {
  const c = cache(t, { timeoutMs: 40 });
  await (await c.download(url, () => new Response('old'))).text();
  const controller = new AbortController();
  let cancel;
  const stalled = new Response(new ReadableStream({ start() {}, cancel() { cancel = true; } }));
  const pending = c.download(url, () => stalled, { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending); assert.equal(cancel, true);
  const timeout = new Response(new ReadableStream({}));
  await assert.rejects(c.download(url, () => timeout), /timed out/);
  await assert.rejects(c.download(url, () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken')); } }))), /broken/);
  assert.equal(await c.read(url).text(), 'old');
  assert(!fs.readdirSync(c.dir).some(f => f.endsWith('.part')));
});

test('concurrent same-URL downloads return their own bytes and atomically select one complete generation', async t => {
  const c = cache(t);
  const responses = await Promise.all(['first', 'second'].map(body => c.download(url, () => new Response(body))));
  assert.deepEqual(await Promise.all(responses.map(r => r.text())), ['first', 'second']);
  assert(['first', 'second'].includes(await c.read(url).text()));
});

test('cache clears cancel active writers; concurrent limit and total budget are enforced', async t => {
  const c = cache(t, { maxConcurrent: 1 });
  const pending = c.download(url, () => new Response(new ReadableStream({})));
  await assert.rejects(c.download(url, () => new Response('next')), CacheLimitError);
  const rejected = assert.rejects(pending); await c.clear(); await rejected;
  assert.equal(c.read(url), null); assert.deepEqual(fs.readdirSync(c.dir), []);
  for (let i = 0; i < 5; i++) await (await c.download(url + i, () => new Response('0123456789'))).text();
  const total = fs.readdirSync(c.dir).filter(f => f.endsWith('.bin')).reduce((n, f) => n + fs.statSync(path.join(c.dir, f)).size, 0);
  assert(total <= 32); assert.equal(c.read(url + 0), null); assert.equal(await c.read(url + 4).text(), '0123456789');
});

test('corrupt, oversized and escaped cached files are misses', async t => {
  const c = cache(t); await (await c.download(url, () => new Response('valid'))).text();
  const metaPath = path.join(c.dir, fs.readdirSync(c.dir).find(f => f.endsWith('.json'))), meta = JSON.parse(fs.readFileSync(metaPath));
  fs.writeFileSync(path.join(c.dir, meta.file), 'partial'); assert.equal(c.read(url), null);
  meta.file = '../outside.bin'; fs.writeFileSync(metaPath, JSON.stringify(meta)); assert.equal(c.read(url), null);
});

test('real HTTP chunked and gzip responses use decoded-byte limits and atomically cached bytes', async t => {
  const http = require('node:http'), { gzipSync } = require('node:zlib');
  const c = cache(t);
  const server = http.createServer((req, res) => {
    if (req.url === '/gzip') { const body = gzipSync('compressed'); res.writeHead(200, {'content-encoding':'gzip','content-length':String(body.length)}); res.end(body); }
    else { res.writeHead(200); res.write('first'); setTimeout(() => res.end('last'), 2); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal(await (await c.download(base, signal => fetch(base, {signal}))).text(), 'firstlast');
  // Compressed wire bytes can exceed the per-resource bound even when decoded bytes do not.
  const roomy = cache(t, {maxResource:64,maxTotal:128});
  assert.equal(await (await roomy.download(base+'/gzip', signal => fetch(base+'/gzip', {signal}))).text(), 'compressed');
  assert.equal(await roomy.read(base+'/gzip').text(), 'compressed');
});

test('external navigation and popup paths share exact host/protocol policy', async () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/x', 'mailto:a@b.test', 'ms-settings:test', 'app://evil/index.html',
    'app://glow.evil/index.html', 'app://glow:99/index.html', 'app://glow/unknown.html', 'https://user:pass@example.com', 'bad url']) assert.equal(classifyNavigation(value), 'deny', value);
  for (const value of ['app://glow/index.html', 'app://glow/apps/viewer-web/index.html?embed=1', 'app://glow/apps/studio-web/']) assert.equal(classifyNavigation(value), 'internal', value);
  for (const value of ['https://doi.org/10.1000/test', 'http://localhost:8000/']) assert.equal(classifyNavigation(value), 'external', value);
  const contents = new EventEmitter(), external = [], internal = [];
  contents.setWindowOpenHandler = fn => { contents.popup = fn; };
  installNavigationPolicy(contents, { openExternal: url => external.push(url), loadURL: url => internal.push(url) });
  for (const event of ['will-navigate', 'will-redirect']) {
    let prevented = 0; contents.emit(event, { preventDefault() { prevented++; } }, 'ms-settings:test'); assert.equal(prevented, 1);
    contents.emit(event, { preventDefault() { prevented++; } }, 'https://example.com'); assert.equal(prevented, 2);
    contents.emit(event, { preventDefault() { throw Error('internal blocked'); } }, 'app://glow/index.html');
  }
  assert.deepEqual(contents.popup({ url: 'file:///secret' }), { action: 'deny' });
  contents.popup({ url: 'app://glow/dev.html' }); await new Promise(setImmediate);
  assert.deepEqual(internal, ['app://glow/dev.html']); assert.deepEqual(external, ['https://example.com', 'https://example.com']);
});

test('classic command queue checks shared consent before execution and before returning private data', async () => {
  let complete, valid=true, ran=false;
  const context=vm.createContext({window:{},GLOW_CMDS:{snapshot:{params:[],fn:()=>new Promise(resolve=>{complete=resolve;})},select:{params:[],fn:()=>{ran=true;}}},
    CmdError:Error,GLOW_API:'test',randSeed:1,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/api/run.js'),'utf8'),context);
  const guard=()=>{if(!valid)throw Error('revoked');};
  const first=context.window.glow.run('snapshot',{},guard);await Promise.resolve();
  const second=context.window.glow.run('select',{},guard);
  const rejected=[assert.rejects(first,/revoked/),assert.rejects(second,/revoked/)];
  valid=false;complete('private-bytes');await Promise.all(rejected);assert.equal(ran,false);
});
