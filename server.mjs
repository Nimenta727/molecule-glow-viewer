import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const CACHE_TTL_MS = 15 * 60 * 1000;
const ALLOWED_HOSTS = new Set(['data.rcsb.org', 'models.rcsb.org', 'files.rcsb.org']);
const cache = new Map();
const MAX_BODY_BYTES = 1024 * 1024;

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

async function readScenes(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Request body exceeds 1 MB')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Request body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function validScene(scene) {
  return scene && typeof scene === 'object' && typeof scene.name === 'string' &&
    scene.name.length <= 160 && (!scene.config || typeof scene.config === 'object');
}

export function createApiServer({ dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data') } = {}) {
  const sceneFile = path.join(dataDir, 'scenes.json');
  return createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'molecule-glow-viewer-api' });
        return;
      }
      if (requestUrl.pathname === '/api/scenes' && req.method === 'GET') {
        const scenes = await readScenes(sceneFile);
        json(res, 200, Object.values(scenes).map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })));
        return;
      }
      if (requestUrl.pathname === '/api/scenes' && req.method === 'POST') {
        const scene = await requestBody(req);
        if (!validScene(scene)) { json(res, 400, { error: 'Scene requires a name and optional object config' }); return; }
        await mkdir(dataDir, { recursive: true });
        const scenes = await readScenes(sceneFile);
        const now = new Date().toISOString();
        const id = randomUUID();
        scenes[id] = { id, name: scene.name.trim(), config: scene.config || {}, createdAt: now, updatedAt: now };
        await writeFile(sceneFile, JSON.stringify(scenes, null, 2) + '\n');
        json(res, 201, scenes[id]);
        return;
      }
      const sceneMatch = requestUrl.pathname.match(/^\/api\/scenes\/([0-9a-f-]{36})$/i);
      if (sceneMatch && req.method === 'GET') {
        const scenes = await readScenes(sceneFile);
        const scene = scenes[sceneMatch[1]];
        if (!scene) { json(res, 404, { error: 'Scene not found' }); return; }
        json(res, 200, scene);
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
