import assert from 'node:assert/strict';
import test from 'node:test';
import { describeArgs, describeResult, TAB_OF, PACES } from '../process-log.mjs';
import { STUDIO_COMMANDS } from '../studio-commands.mjs';

test('arguments are shown short and long texts (a structure file given inline) are not dumped', () => {
  assert.equal(describeArgs(null), ''); assert.equal(describeArgs(['chain A', 'sticks']), '"chain A","sticks"');
  const long = describeArgs({ name: 'x.cif', text: 'data_x\n'.repeat(500) }); assert.ok(long.length <= 110 && /个字符/.test(long), long);
});

test('an answer is told by its own note, else by its main numbers', () => {
  assert.equal(describeResult({ note: '60 个残基画成“卡通”。' }), '60 个残基画成“卡通”。');
  assert.match(describeResult({ pairs: 36, rmsd: 0.61, wrote: ['place', 'record'] }), /pairs 36；rmsd 0.61；写入：place、record/);
  assert.match(describeResult({ surface: { triangles: 82860 } }), /表面 82860 个三角形/); assert.equal(describeResult(null), '');
});

test('every command the log follows exists, and the paces start at "off"', () => {
  assert.deepEqual(Object.keys(TAB_OF).filter((cmd) => !Object.hasOwn(STUDIO_COMMANDS, cmd)), []); assert.deepEqual(PACES[0], [0, '不放慢']);
});
