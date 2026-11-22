import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutFor } from '../shortcuts.mjs';

const press = (key, extra = {}, tag = 'BODY') => ({ key, target: { tagName: tag }, ...extra });

test('Ctrl/Cmd+Z undoes, with Shift or Ctrl+Y redoes, Delete and Backspace remove, anything else means nothing', () => {
  assert.equal(shortcutFor(press('z', { ctrlKey: true })), 'undo'); assert.equal(shortcutFor(press('Z', { metaKey: true })), 'undo');
  assert.equal(shortcutFor(press('z', { ctrlKey: true, shiftKey: true })), 'redo'); assert.equal(shortcutFor(press('y', { ctrlKey: true })), 'redo');
  assert.equal(shortcutFor(press('Delete')), 'remove'); assert.equal(shortcutFor(press('Backspace')), 'remove');
  assert.equal(shortcutFor(press('z')), null, 'a plain z is not a shortcut'); assert.equal(shortcutFor(press('a', { ctrlKey: true })), null);
  assert.equal(shortcutFor(press('Delete', { ctrlKey: true })), null, 'Ctrl+Delete is not "remove"'); assert.equal(shortcutFor(press('z', { ctrlKey: true, altKey: true })), null);
});

test('never while the person is typing: fields and editable text keep Backspace, Delete and Ctrl+Z for themselves', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) { assert.equal(shortcutFor(press('Backspace', {}, tag)), null); assert.equal(shortcutFor(press('z', { ctrlKey: true }, tag)), null); }
  assert.equal(shortcutFor({ key: 'Delete', target: { tagName: 'DIV', isContentEditable: true } }), null);
  assert.equal(shortcutFor(press('Delete', {}, 'BUTTON')), 'remove', 'a focused button (a row of the outline) does not stop it');
});
