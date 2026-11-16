const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { request } = require('node:http');
const test = require('node:test');

test('API server module exposes a factory without extra dependencies', async () => {
  const module = await import('../server.mjs');
  assert.equal(typeof module.createApiServer, 'function');
});

test('API server persists and retrieves scenes', async () => {
  const { createApiServer } = await import('../server.mjs');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'molecule-scenes-'));
  const server = createApiServer({ dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, route, body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: route, method, headers: body ? { 'content-type': 'application/json' } : {} }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); if (body) req.end(JSON.stringify(body)); else req.end();
  });
  try {
    const created = await call('POST', '/api/scenes', { name: '课堂演示', config: { preset: '6ZPO' } });
    assert.equal(created.status, 201);
    const fetched = await call('GET', `/api/scenes/${created.body.id}`);
    assert.deepEqual(fetched.body.config, { preset: '6ZPO' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
