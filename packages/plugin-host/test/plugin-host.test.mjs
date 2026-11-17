import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginHost } from '../index.mjs';

const manifest = (id, capabilities = [], dependencies = []) => ({ id, version: '1.0.0', apiVersion: 1, capabilities, dependencies });
const makeHost = () => createPluginHost({ getScene: () => ({ revision: 1 }), dispatch: command => command });

test('activates a trusted module, exposes frozen context and capability registrations', async () => {
  const host = makeHost();
  const importer = { parse() {} };
  const rep = { render() {} };
  const service = { go() {} };
  let context;
  await host.activate({ manifest: manifest('a', ['importers', 'representations', 'services']), activate(ctx) {
    context = ctx;
    assert.equal(Object.isFrozen(ctx), true);
    assert.deepEqual(ctx.scene.getSnapshot(), { revision: 1 });
    assert.throws(() => ctx.commands.dispatch({ type: 'x' }), /active plugin/);
    ctx.registerImporter('json', importer);
    ctx.registerRepresentation('orb', rep);
    ctx.registerService('math', '2.1.0', service);
  } });
  assert.equal(host.getImporter('json'), importer);
  assert.equal(host.getRepresentation('orb'), rep);
  assert.equal(host.getService('math', '2.1.0'), service);
  assert.equal(host.getService('math', '2.0.0'), undefined);
  assert.equal(context.getService('math', '2.1.0'), service);
  assert.deepEqual(context.commands.dispatch({ type: 'x' }), { type: 'x' });
  assert.throws(() => context.registerImporter('late', importer), /during activation/);
  assert.deepEqual(host.listActive(), [{ id: 'a', version: '1.0.0' }]);
});

test('requires dependencies first and prevents removing required dependency', async () => {
  const host = makeHost();
  const dep = { manifest: manifest('dep'), activate() {} };
  const child = { manifest: manifest('child', [], [{ id: 'dep', version: '1.0.0' }]), activate() {} };
  await assert.rejects(host.activate(child), /Missing required dependency/);
  await host.activate(dep);
  await host.activate(child);
  await assert.rejects(host.deactivate('dep'), /required by active plugin child/);
  await host.deactivate('child');
  assert.equal(await host.deactivate('dep'), true);
});

test('stages registrations and rolls back sync/async activation failures', async () => {
  const host = makeHost();
  const events = [];
  await assert.rejects(host.activate({ manifest: manifest('bad', ['importers']), activate(ctx) {
    ctx.registerImporter('bad', {});
    ctx.lifecycle.add(() => events.push('cleanup'));
    throw Error('boom');
  } }), /boom/);
  assert.equal(host.getImporter('bad'), undefined);
  assert.deepEqual(events, ['cleanup']);
  await assert.rejects(host.activate({ manifest: manifest('async-bad', ['importers']), async activate(ctx) {
    ctx.registerImporter('late', {});
    ctx.lifecycle.add(async () => { events.push('async cleanup'); });
    await Promise.resolve();
    throw Error('later');
  } }), /later/);
  assert.equal(host.getImporter('late'), undefined);
  assert.deepEqual(events, ['cleanup', 'async cleanup']);
});

test('global collisions reject activation and clean up candidate', async () => {
  const host = makeHost();
  let cleaned = 0;
  await host.activate({ manifest: manifest('one', ['importers']), activate(ctx) { ctx.registerImporter('same', 'first'); } });
  await assert.rejects(host.activate({ manifest: manifest('two', ['importers']), activate(ctx) {
    ctx.registerImporter('same', 'second');
    ctx.lifecycle.add(() => cleaned++);
  } }), /Registration collision/);
  assert.equal(host.getImporter('same'), 'first');
  assert.equal(cleaned, 1);
  await assert.rejects(host.activate({ manifest: manifest('three', ['importers']), activate(ctx) {
    ctx.registerImporter('duplicate', 1);
    ctx.registerImporter('duplicate', 2);
  } }), /Registration collision/);
  assert.equal(host.getImporter('duplicate'), undefined);
});

test('disposes resources and registrations in reverse order; context expires', async () => {
  const host = makeHost();
  const events = [];
  let savedContext;
  await host.activate({ manifest: manifest('cleanup', ['importers']), activate(ctx) {
    savedContext = ctx;
    ctx.lifecycle.add(() => events.push('first'));
    ctx.registerImporter('one', 1);
    ctx.lifecycle.add(() => events.push('last'));
  }, async deactivate(ctx) {
    assert.equal(ctx, savedContext);
    assert.equal(ctx.signal.aborted, true);
    assert.equal(host.getImporter('one'), undefined);
    events.push('deactivate');
  } });
  assert.equal(await host.deactivate('cleanup'), true);
  assert.deepEqual(events, ['deactivate', 'last', 'first']);
  assert.equal(host.getImporter('one'), undefined);
  assert.throws(() => savedContext.scene.getSnapshot(), /no longer active/);
  assert.throws(() => savedContext.registerImporter('x', 1), /no longer active/);
});

test('serializes concurrent activation and reports contract violations', async () => {
  const host = makeHost();
  let finish;
  const slow = host.activate({ manifest: manifest('slow', ['importers']), activate: async ctx => {
    ctx.registerImporter('claim', 'slow');
    await new Promise(resolve => { finish = resolve; });
  } });
  const next = host.activate({ manifest: manifest('next', ['importers']), activate(ctx) { ctx.registerImporter('claim', 'next'); } });
  await Promise.resolve();
  finish();
  await slow;
  await assert.rejects(next, /Registration collision/);
  await assert.rejects(host.activate({ manifest: manifest('bad-cap', []), activate(ctx) { ctx.registerImporter('x', 1); } }), /lacks importers/);
  assert.equal(await host.deactivate('missing'), false);
});
