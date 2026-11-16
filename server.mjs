import { createServer } from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const CACHE_TTL_MS = 15 * 60 * 1000;
const ALLOWED_HOSTS = new Set(['data.rcsb.org', 'models.rcsb.org', 'files.rcsb.org']);
const cache = new Map();

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value));
}

async function proxyRcsb(res, target) {
  const cached = cache.get(target.href);
  if (cached && cached.expires > Date.now()) {
    send(res, 200, cached.body, cached.type);
    return;
  }

  const upstream = await fetch(target);
  if (!upstream.ok) {
    json(res, upstream.status, { error: `RCSB request failed with status ${upstream.status}` });
    return;
  }
  const body = await upstream.text();
  const type = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
  cache.set(target.href, { body, type, expires: Date.now() + CACHE_TTL_MS });
  send(res, 200, body, type);
}

export function createApiServer() {
  return createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'molecule-glow-viewer-api' });
        return;
      }
      if (requestUrl.pathname === '/api/rcsb') {
        const raw = requestUrl.searchParams.get('url');
        if (!raw) { json(res, 400, { error: 'Missing url query parameter' }); return; }
        const target = new URL(raw);
        if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
          json(res, 400, { error: 'Only approved RCSB HTTPS hosts are allowed' });
          return;
        }
        await proxyRcsb(res, target);
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, 502, { error: `Upstream request failed: ${error.message}` });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApiServer().listen(PORT, '127.0.0.1', () => {
    console.log(`Molecule Glow Viewer API listening on http://127.0.0.1:${PORT}`);
  });
}
