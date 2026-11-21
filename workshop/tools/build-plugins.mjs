#!/usr/bin/env node
// Rebuild workshop/official/plugins/index.json — the plugin zone of the workshop — from plugins/packages/*.json (one manifest per plugin).
// Deterministic and offline. The workshop lists the manifest and its sha256; the CODE of an official plugin ships with the application and is
// switched on from an allow-list, so nothing here is downloaded and run (the project has no sandbox for third-party code yet).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WS, sha256 } from './glow-lib.mjs';
import { validatePluginManifest } from '../../packages/plugin-host/plugin-manifest.mjs';

const dir = path.join(ROOT, 'plugins', 'packages'), plugins = [];
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
  const bytes = fs.readFileSync(path.join(dir, name)), manifest = validatePluginManifest(JSON.parse(bytes.toString('utf8')));
  plugins.push({ id: manifest.id, file: `plugins/packages/${name}`, sha256: sha256(bytes), manifest });
}
plugins.sort((a, b) => a.id.localeCompare(b.id));
const ids = new Set(plugins.map((p) => p.id));
for (const { manifest } of plugins) for (const dep of manifest.dependencies) if (dep.id.startsWith('org.glow.plugin.') && !ids.has(dep.id)) throw new Error(`! ${manifest.id} depends on ${dep.id}, which is not in this catalogue`);   // host plugins (org.glow.structure …) ship with the application; workshop plugins must resolve here
const index = { format: 'glow-plugins', version: 1, source: 'official', name: '官方插件', note: '官方插件的代码随应用发布；这里的“启用/停用”只是开关，不会下载或运行任何代码。', plugins };
const out = path.join(WS, 'official', 'plugins', 'index.json'), json = JSON.stringify(index, null, 1) + '\n';
fs.mkdirSync(path.dirname(out), { recursive: true });
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ official/plugins/index.json：${plugins.length} 个插件`); }
else console.log(`= official/plugins/index.json 无变化（${plugins.length} 个插件）`);
