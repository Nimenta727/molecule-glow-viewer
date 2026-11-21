// Shared helpers for the workshop tools (Node 18+, no dependencies).
// The validation rules are NOT re-implemented here: sanitizePack / checkAnimation / PackError and the presets are imported
// from the viewer source (src/pack/rules.js, src/data/presets.js) - the same code the build puts into web/index.html -
// so the viewer and the CI can never disagree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESETS, presetCat } from '../../src/data/presets.js';
import { sanitizePack, PackError, GLOW_VERSION, ANIM_VERSION, PACK_CATS } from '../../src/pack/rules.js';
import { checkDerivation } from '../../plugins/workshop/diagnose.mjs';
import { checkPublication } from '../../plugins/workshop/publish.mjs';
import { loadCatalog } from '../../plugins/workshop/catalog.mjs';
import { readScenePackage } from '../../packages/schema/archive.mjs';
import { buildViewer } from '../../tools/build.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WS = process.env.GLOW_WORKSHOP_DIR ? path.resolve(process.env.GLOW_WORKSHOP_DIR) : path.join(ROOT, 'workshop');   // GLOW_WORKSHOP_DIR: a copy of the workshop folder (tests)
export const SOURCES = ['official', 'community'];
export const MAX_BYTES = 30 * 1024 * 1024;

/* Names of the built-in processes (a pack's scene.process may only name one of them). The process code needs Three.js and
   the DOM, so only the NAMES are read, from the module script the build assembles out of src/: the top-level keys of
   `const PROCESSES = { ... }` and every `PROCESSES.<name> = `. */
export function processNames() {
  const js = buildViewer();   /* LF line endings */
  const i = js.indexOf('const PROCESSES = {'), j = js.indexOf('\n};\n', i);
  if (i < 0 || j < 0) throw new Error('PROCESSES table not found in the built viewer');
  const block = js.slice(i, j);
  return [...new Set([...block.matchAll(/^ {2}([A-Za-z_]\w*): \{/gm), ...js.matchAll(/^PROCESSES\.([A-Za-z_]\w*) = /gm)].map(m => m[1]))];
}

export function loadRules() {
  /* src/pack/rules.js reads the free name PROCESSES (in the page it is the real table); here a name-only stand-in */
  globalThis.PROCESSES ??= Object.fromEntries(processNames().map(k => [k, {}]));
  return { PRESETS, PROCESSES: globalThis.PROCESSES, presetCat, sanitizePack, PackError, GLOW_VERSION, ANIM_VERSION, PACK_CATS };
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
  if (raw.derivedFrom !== undefined) {
    const from = raw.derivedFrom;
    if (!from || typeof from !== 'object' || Array.isArray(from) || typeof from.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(from.id) || Object.keys(from).some((key) => !['id', 'revision'].includes(key)) ||
        from.revision !== undefined && !(Number.isInteger(from.revision) && from.revision >= 1)) errors.push(`${base}: derivedFrom 应为 { id, revision? }（id 是被派生作品的编号，revision 是正整数）`);
  }
  if (!raw.description) warnings.push(`${base}: 没有 description（工坊卡片上会是空的）`);
  if (raw.title !== pack.title) warnings.push(`${base}: 标题超过 80 字被截短`);
  return { ok: !errors.length, errors, warnings, pack, raw, text };
}

/* The derivation records of all packs against each other (a parent must exist, the licence must be allowed, no loops): the same rules the workshop dialog shows. Returns the problems. */
export function derivationProblems() {
  const byId = new Map();
  for (const src of SOURCES) for (const file of listPacks(src)) {
    try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (raw?.id) byId.set(raw.id, { id: raw.id, license: raw.license || '', revision: Number.isInteger(raw.revision) ? raw.revision : 1, derivedFrom: raw.derivedFrom && typeof raw.derivedFrom.id === 'string' ? raw.derivedFrom : undefined }); } catch { /* reported by checkFile */ }
  }
  return [...byId.values()].flatMap((entry) => checkDerivation(entry, byId));
}

/* ---- v2/v3 scene packages (what Studio exports) in the workshop, next to the classic v1 packs ------------------------------------------------------------------------------------
   A package is a ZIP (first bytes "PK"). It is read with the same reader the Viewer uses, then run through the same publish check Studio shows. */
export const isZipFile = (file) => { const fd = fs.openSync(file, 'r'); try { const head = Buffer.alloc(2); fs.readSync(fd, head, 0, 2, 0); return head[0] === 0x50 && head[1] === 0x4b; } finally { fs.closeSync(fd); } };

/** The catalogue as the workshop folder holds it, loaded through the real client over the file system. `omitSha` leaves out the entry of an already published identical file. */
export async function localCatalog(omitSha) {
  const base = 'https://workshop.invalid/';
  const fetchLocal = async (url) => {
    const target = path.join(WS, String(url).slice(base.length));
    if (!fs.existsSync(target)) return { ok: false, status: 404 };
    const bytes = fs.readFileSync(target);
    return { ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  };
  const catalog = await loadCatalog({ base, fetch: fetchLocal });
  return omitSha ? { ...catalog, works: catalog.works.filter((entry) => entry.sha256 !== omitSha), templates: catalog.templates.filter((entry) => entry.sha256 !== omitSha) } : catalog;
}

/** Full check of one package file. Returns { ok, errors[], warnings[], scene, entry, buf }. `toolAvailable` says which tools this application has. */
export async function checkPackageFile(file, src, { toolAvailable } = {}) {
  const errors = [], warnings = [], base = path.basename(file);
  const st = fs.statSync(file); if (st.size > MAX_BYTES) return { ok: false, errors: [`${base}: 文件超过 30 MB`], warnings };
  const buf = fs.readFileSync(file);
  let scene;
  try { ({ scene } = await readScenePackage(new Uint8Array(buf))); } catch (e) { return { ok: false, errors: [`${base}: 不是有效的场景包（${e.message}）`], warnings }; }
  if (base !== scene.id + '.glow') errors.push(`${base}: 文件名应为 ${scene.id}.glow（与场景编号一致）`);
  const catalog = await localCatalog(sha256(buf));
  const result = checkPublication(scene, catalog, { toolAvailable, source: src });
  for (const { level, message } of result.problems) (level === 'error' ? errors : level === 'warning' ? warnings : []).push(`${base}: ${message}`);
  return { ok: !errors.length, errors, warnings, scene, entry: result.entry, buf };
}
