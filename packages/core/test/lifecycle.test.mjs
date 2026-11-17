import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadCoordinator, createResourceScope } from '../lifecycle.mjs';

test('scope releases in reverse order, is idempotent, and immediately releases late additions', () => {
  const scope = createResourceScope();
  const events = [];
  scope.add(() => events.push('a'));
  scope.add(() => events.push('b'));
  scope.dispose();
  scope.dispose();
  scope.add(() => events.push('late'));
  assert.deepEqual(events, ['b', 'a', 'late']);
});

test('scope attempts every release and reports aggregated failures', () => {
  const scope = createResourceScope();
  const events = [];
  scope.add(() => { events.push('a'); throw Error('a'); });
  scope.add(() => { events.push('b'); throw Error('b'); });
  assert.throws(() => scope.dispose(), AggregateError);
  assert.deepEqual(events, ['b', 'a']);
  assert.doesNotThrow(() => scope.dispose());
});

test('successful commit replaces active scope only after prepare and commit succeed', async () => {
  const events = [];
  const loads = createLoadCoordinator({
    async prepare(value, { scope }) { scope.add(() => events.push(`dispose ${value}`)); return value; },
    commit(value) { events.push(`commit ${value}`); },
  });
  assert.equal(await loads.load('one'), true);
  assert.deepEqual(events, ['commit one']);
  assert.equal(await loads.load('two'), true);
  assert.deepEqual(events, ['commit one', 'commit two', 'dispose one']);
  loads.close();
  loads.close();
  assert.deepEqual(events, ['commit one', 'commit two', 'dispose one', 'dispose two']);
});

test('failed prepare or commit leaves active scope intact and rejects current failure', async () => {
  const events = [];
  let failCommit = false;
  const loads = createLoadCoordinator({
    async prepare(value, { scope }) { scope.add(() => events.push(`dispose ${value}`)); if (value === 'bad') throw Error('prepare'); return value; },
    commit(value) { if (failCommit) throw Error('commit'); events.push(`commit ${value}`); },
  });
  await loads.load('active');
  await assert.rejects(loads.load('bad'), /prepare/);
  failCommit = true;
  await assert.rejects(loads.load('candidate'), /commit/);
  assert.deepEqual(events, ['commit active', 'dispose bad', 'dispose candidate']);
  loads.close();
  assert.deepEqual(events.at(-1), 'dispose active');
});

test('superseded prepare is aborted, disposed promptly, and late result cannot commit', async () => {
  const events = [];
  let finish;
  const loads = createLoadCoordinator({
    prepare(value, { signal, scope }) {
      scope.add(() => events.push(`dispose ${value}`));
      if (value === 'slow') return new Promise(resolve => { finish = () => resolve(value); signal.addEventListener('abort', () => events.push('aborted')); });
      return Promise.resolve(value);
    },
    commit(value) { events.push(`commit ${value}`); },
  });
  const stale = loads.load('slow');
  await Promise.resolve();
  assert.equal(await loads.load('fast'), true);
  assert.deepEqual(events.slice(0, 3), ['aborted', 'dispose slow', 'commit fast']);
  finish();
  assert.equal(await stale, false);
  assert.deepEqual(events, ['aborted', 'dispose slow', 'commit fast']);
  loads.close();
});

test('close aborts pending work and permits a subsequent load', async () => {
  const events = [];
  let finish;
  const loads = createLoadCoordinator({
    prepare(value, { signal, scope }) { scope.add(() => events.push(`dispose ${value}`)); if (value === 'wait') return new Promise(resolve => { finish = () => resolve(value); signal.addEventListener('abort', () => events.push('abort')); }); return value; },
    commit(value) { events.push(`commit ${value}`); },
  });
  const pending = loads.load('wait');
  await Promise.resolve();
  loads.close();
  finish();
  assert.equal(await pending, false);
  assert.equal(await loads.load('again'), true);
  assert.deepEqual(events, ['abort', 'dispose wait', 'commit again']);
  loads.close();
});
