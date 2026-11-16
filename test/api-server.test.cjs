const assert = require('node:assert/strict');
const test = require('node:test');

test('API server module exposes a factory without extra dependencies', async () => {
  const module = await import('../server.mjs');
  assert.equal(typeof module.createApiServer, 'function');
});
