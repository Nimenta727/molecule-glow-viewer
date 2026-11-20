import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2), directory = args[args.indexOf('--dir') + 1];
if (!args.includes('--dir') || !directory) throw new Error('Usage: node tools/fetch-smoke-structures.mjs --dir <directory> [--refresh]');
const manifest = JSON.parse(await fs.readFile(new URL('./fixtures/structures.json', import.meta.url), 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(directory, { recursive: true });
const records = await Promise.all(manifest.structures.map(async (entry) => {
  const file = path.join(directory, `${entry.id}.cif`);
  if (!args.includes('--refresh')) {
    try { const bytes = await fs.readFile(file); if (hash(bytes) === entry.sha256) return { id: entry.id, source: 'verified-cache', sha256: entry.sha256 }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${entry.id}: HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 64 * 1024 * 1024) throw new Error(`${entry.id}: response too large`); chunks.push(value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`${entry.id}: RCSB bytes changed; review fixture before updating the pinned manifest`);
  const temporary = file + `.${process.pid}.tmp`;
  try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
  return { id: entry.id, source: 'live-rcsb', sha256: entry.sha256 };
}));
console.log(JSON.stringify({ ok: true, directory: path.resolve(directory), records }, null, 2));
