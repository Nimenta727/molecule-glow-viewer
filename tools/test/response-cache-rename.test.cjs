const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { renameSafe } = require('../../desktop/response-cache.cjs');

test('renameSafe falls back to copy + unlink when the rename reports EXDEV (seen on a Windows machine)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-')), from = path.join(dir, 'a.part'), to = path.join(dir, 'a.bin');
  fs.writeFileSync(from, 'payload');
  await renameSafe(from, to, async () => { throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }); });
  assert.equal(fs.readFileSync(to, 'utf8'), 'payload'); assert.equal(fs.existsSync(from), false);
});

test('renameSafe renames normally and rethrows every other error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-')), from = path.join(dir, 'b.part'), to = path.join(dir, 'b.bin');
  fs.writeFileSync(from, 'x'); await renameSafe(from, to); assert.equal(fs.readFileSync(to, 'utf8'), 'x');
  await assert.rejects(renameSafe(from, to, async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }), { code: 'EACCES' });
});
