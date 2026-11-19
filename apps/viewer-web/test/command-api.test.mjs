import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandApi, attachCommandBridge } from '../command-api.mjs';

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
  await assert.rejects(api.run('color'), /尚不支持/);
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

test('bridge requires opt-in and exact trusted origin; URL origin cannot grant access', async () => {
  let listener; const replies = [], calls = [];
  const target = {
    location: { origin: 'http://localhost:8000', search: '?embed=1&origin=https://evil.example' },
    addEventListener: (_, fn) => { listener = fn; }, removeEventListener: (_, fn) => { assert.equal(listener, fn); listener = null; },
  };
  target.parent = target;
  const api = { version: '2', run: async (cmd) => { calls.push(cmd); return 'result'; } };
  const detach = attachCommandBridge(target, api);
  const event = (origin) => ({ origin, data: { glow: 'cmd', id: 7, cmd: 'info' }, source: { postMessage: (...args) => replies.push(args) } });
  for (const origin of ['null', 'https://evil.example', 'http://localhost:8000', 'https://nimenta727.github.io.evil.example']) await listener(event(origin));
  assert.deepEqual(calls, []);
  await listener(event('https://nimenta727.github.io'));
  assert.deepEqual(calls, ['info']);
  assert.deepEqual(replies[0], [{ glow: 'reply', id: 7, ok: true, result: 'result' }, 'https://nimenta727.github.io']);
  detach(); assert.equal(listener, null);
  target.location.search = '';
  attachCommandBridge(target, api); assert.equal(listener, null);
  target.location.search = '?dev=1';
  attachCommandBridge(target, api);
  await listener(event('http://localhost:8000')); assert.equal(calls.length, 2);
});
