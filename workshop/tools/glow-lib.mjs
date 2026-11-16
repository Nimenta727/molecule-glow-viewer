// Shared helpers for the workshop tools (Node 18+, no dependencies).
// The validation rules are NOT re-implemented here: they are read out of web/index.html (the same sanitizePack /
// checkAnimation the viewer runs) and executed in a sandbox, so the viewer and the CI can never disagree.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WS = path.join(ROOT, 'workshop');
export const SOURCES = ['official', 'community'];
export const MAX_BYTES = 30 * 1024 * 1024;

function between(src, start, end, from = 0) {
  const i = src.indexOf(start, from); if (i < 0) throw new Error('marker not found in viewer: ' + start);
  const j = src.indexOf(end, i + start.length); if (j < 0) throw new Error('end marker not found in viewer: ' + end);
  return src.slice(i, j + end.length);
}

export function loadRules(viewer = path.join(ROOT, 'web', 'index.html')) {
  const html = fs.readFileSync(viewer, 'utf8').replace(/\r\n/g, '\n');
  const presets = between(html, 'const PRESETS = {', '\n};\n');
  const procBlock = between(html, 'const PROCESSES = {', '\n};\n');
  const procNames = [...new Set([...procBlock.matchAll(/^ {2}([A-Za-z_]\w*): \{/gm), ...html.matchAll(/^PROCESSES\.([A-Za-z_]\w*) = /gm)].map(m => m[1]))];
  /* v18+: stable ASCII preset keys and tiers (PRESET_META / PRESET_BY_KEY / presetName), which presetCat uses */
  const keys = html.includes('const PRESET_META = {') ? between(html, 'const PRESET_META = {', '/* key or exact display name -> display name */') : '';
  const presetCat = between(html, 'const presetCat = ', ";\n");
  const rules = between(html, "const GLOW_FORMAT = 'glow-scene'", '/* a pack -> loadScene config */');
  const code = `${presets}\nconst PROCESSES = Object.fromEntries(${JSON.stringify(procNames)}.map(k => [k, {}]));\n${keys}\n${presetCat}\n${rules}\n` +
    `({ PRESETS, PROCESSES, presetCat, sanitizePack, PackError, GLOW_VERSION, ANIM_VERSION, PACK_CATS });`;
  return vm.runInNewContext(code, { RegExp, JSON, Math, Number, Object, Array, String, Set, Map, Error, console }, { filename: 'viewer-rules.js' });
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const listPacks = (src) => {
  const d = path.join(WS, src, 'packs'); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.glow')).sort().map(f => path.join(d, f));
};

/* full check of one pack file. Returns { ok, errors[], warnings[], pack, text } */
export function checkFile(file, src, R) {
  const errors = [], warnings = [], base = path.basename(file);
  const st = fs.statSync(file); if (st.size > MAX_BYTES) return { ok: false, errors: [`${base}: 文件超过 30 MB`], warnings };
  const text = fs.readFileSync(file, 'utf8');
  let raw; try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`${base}: 不是有效的 JSON（${e.message}）`], warnings }; }
  let pack; try { pack = R.sanitizePack(raw, src === 'official'); } catch (e) { return { ok: false, errors: [`${base}: ${e.message}`], warnings }; }
  if (base !== raw.id + '.glow') errors.push(`${base}: 文件名应为 ${raw.id}.glow（与 id 一致）`);
  if (src === 'community') {
    if (/^(official|example)\./.test(raw.id)) errors.push(`${base}: 社区场景的 id 不能以 official. / example. 开头`);
    if (!raw.author?.name?.trim()) errors.push(`${base}: 社区场景要写 author.name`);
    if (raw.scene?.process) warnings.push(`${base}: 用了内置过程 ${raw.scene.process}（允许，但社区动画建议用 animation 描述）`);
    if (!['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0'].includes(raw.license)) errors.push(`${base}: license 请用 CC-BY-4.0、CC-BY-SA-4.0 或 CC0-1.0`);
  }
  if (!raw.description) warnings.push(`${base}: 没有 description（工坊卡片上会是空的）`);
  if (raw.title !== pack.title) warnings.push(`${base}: 标题超过 80 字被截短`);
  return { ok: !errors.length, errors, warnings, pack, raw, text };
}
