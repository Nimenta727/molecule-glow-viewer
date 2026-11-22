import assert from 'node:assert/strict';
import test from 'node:test';
import { STUDIO_COMMANDS, READ_ONLY, LIMITS, createStudioAdapter, createStudioHelp } from '../studio-commands.mjs';
import { createCommandApi } from '../../viewer-web/command-api.mjs';

const stub = () => ({ ready: async () => {}, structureList: () => [], scene: () => ({}), selectionBox: { get: () => ({ expression: '' }), set() {} }, lookState: () => ({ colors: { residues: [], chains: {} }, styles: [], surfaces: [] }), annotations: () => ({ measures: [], labels: [], bonds: [] }) });

test('every documented command has an implementation and the read-only ones are documented', () => {
  const adapter = createStudioAdapter(stub());
  assert.deepEqual(Object.keys(STUDIO_COMMANDS).filter((name) => name !== 'help' && typeof adapter[name] !== 'function'), []);
  assert.deepEqual([...READ_ONLY].filter((name) => !Object.hasOwn(STUDIO_COMMANDS, name)), []);
  for (const [name, doc] of Object.entries(STUDIO_COMMANDS)) assert.ok(doc.length >= 4, `${name} is documented`);
});

test('help gives the commands, the rules an AI has to follow and the limits; one command can be asked for; unknown ones are refused', async () => {
  const queue = createCommandApi(createStudioAdapter(stub()), { commands: STUDIO_COMMANDS, readOnly: READ_ONLY, version: '1.0.0', help: (api, table, input) => (typeof input === 'string' ? { commands: [{ cmd: input, doc: table[input] }] } : createStudioHelp()(api, table)) });
  const help = await queue.api.help(); assert.equal(help.api, '1.0.0'); assert.ok(help.commands.length === Object.keys(STUDIO_COMMANDS).length && help.rules.some((r) => /limits/.test(r)) && help.limits.superpose.length >= 3);
  assert.equal((await queue.api.help('surface')).commands[0].cmd, 'surface'); await assert.rejects(queue.api.run('nope'), /尚不支持命令|请调用/);
  assert.deepEqual(Object.keys(LIMITS), ['contacts', 'composition', 'secondary', 'superpose', 'surface']);
});

test('without a structure the commands that need one say so', async () => {
  const adapter = createStudioAdapter(stub());
  await assert.rejects(adapter.select('chain A'), /还没有结构/); await assert.rejects(adapter.contacts({ a: 'chain A', b: 'chain B' }), /还没有结构/);
  await assert.rejects(adapter.camera({ position: [0, 0, 0] }), /需要|env|undefined/);
});
